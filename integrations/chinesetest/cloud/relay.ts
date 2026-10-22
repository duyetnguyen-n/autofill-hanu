import { randomBytes, createHash } from "node:crypto";
import type { IncomingMessage, ServerResponse } from "node:http";
import type { Duplex } from "node:stream";
import { WebSocketServer, WebSocket } from "ws";
import type { SqlPool } from "../../../manager/cloud/postgres-store";
import type { Account } from "../../../src/account";
import { CloudError, transaction } from "../../../manager/cloud/postgres-store";
import {
  COMMANDS,
  MAX_ACCOUNTS,
  type Device,
  type Command,
  type EncryptedBox,
  type Limits,
} from "../protocol";
import { fingerprint } from "../crypto";
const hash = (value: string) =>
  createHash("sha256").update(value).digest("hex");
interface Peer {
  ws: WebSocket;
  owner?: string;
  id: string;
  pending: Map<
    string,
    {
      resolve: (data: unknown) => void;
      reject: (e: Error) => void;
      timer: ReturnType<typeof setTimeout>;
    }
  >;
}
export class ChineseTestRelay {
  private wss = new WebSocketServer({
    noServer: true,
    maxPayload: 3 * 1024 * 1024,
  });
  private peers = new Map<string, Peer>();
  private rate = new Map<string, { count: number; until: number }>();
  constructor(
    private pool: SqlPool,
    private allowed: (owner: string) => Promise<Account>,
    private origin: () => string,
  ) {}
  private limit(key: string, max = 60) {
    const now = Date.now(),
      item = this.rate.get(key);
    if (item && item.until > now) {
      if (++item.count > max)
        throw new CloudError("Quá nhiều yêu cầu CHINESETEST.", 429);
    } else this.rate.set(key, { count: 1, until: now + 60000 });
    if (this.rate.size > 5000)
      for (const [k, v] of this.rate) if (v.until < now) this.rate.delete(k);
  }
  async check() {
    await this.pool.query("SELECT id FROM chinesetest.runners LIMIT 0");
  }
  private view(row: any): Device {
    return {
      id: row.id,
      name: row.name,
      platform: row.platform,
      publicKey: row.public_key,
      fingerprint: row.fingerprint,
      connected: this.peers.has(row.id),
      createdAt: new Date(row.created_at).toISOString(),
      lastSeen: new Date(row.last_seen).toISOString(),
    };
  }
  async route(
    account: Account,
    path: string,
    method: string,
    body: () => Promise<any>,
  ) {
    this.limit("owner:" + account.id, 180);
    if (path === "/api/chinesetest/devices" && method === "GET")
      return (
        await this.pool.query(
          "SELECT * FROM chinesetest.runners WHERE owner=$1 ORDER BY created_at",
          [account.id],
        )
      ).rows.map((r) => this.view(r));
    if (path === "/api/chinesetest/pair" && method === "POST") {
      const b = await body();
      if (typeof b.code !== "string" || !/^[-a-fA-F0-9 ]{12,40}$/.test(b.code))
        throw new CloudError("Mã liên kết không hợp lệ.");
      this.limit("pair:" + account.id, 10);
      const code = b.code.replace(/[- ]/g, "").toUpperCase();
      const row = await transaction(this.pool, async (db) => {
        await db.query(
          "SELECT user_id FROM hanu.accounts WHERE user_id=$1 FOR UPDATE",
          [account.id],
        );
        if (
          Number(
            (
              await db.query(
                "SELECT count(*) AS n FROM chinesetest.runners WHERE owner=$1",
                [account.id],
              )
            ).rows[0].n,
          ) >= 3
        )
          throw new CloudError("Tối đa 3 máy chạy cho một tài khoản.");
        const r = await db.query(
          "UPDATE chinesetest.runners SET owner=$1,pair_hash=NULL,pair_expires_at=NULL WHERE owner IS NULL AND pair_hash=$2 AND pair_expires_at>now() RETURNING *",
          [account.id, hash(code)],
        );
        if (!r.rows[0])
          throw new CloudError("Mã đã dùng, hết hạn hoặc không đúng.");
        return r.rows[0];
      });
      const peer = this.peers.get(row.id);
      if (peer) {
        peer.owner = account.id;
        peer.ws.send(JSON.stringify({ type: "BOUND", owner: account.id }));
      }
      return this.view(row);
    }
    const match = path.match(
      /^\/api\/chinesetest\/devices\/([0-9a-f-]{36})(?:\/(command))?$/,
    );
    if (!match) throw new CloudError("Không tìm thấy API CHINESETEST.", 404);
    const id = match[1],
      row = (
        await this.pool.query(
          "SELECT * FROM chinesetest.runners WHERE id=$1 AND owner=$2",
          [id, account.id],
        )
      ).rows[0];
    if (!row) throw new CloudError("Không tìm thấy máy chạy.", 404);
    if (method === "DELETE" && !match[2]) {
      const peer = this.peers.get(id);
      if (peer?.pending.size) throw new CloudError("Máy đang xử lý lệnh.");
      peer?.ws.send(JSON.stringify({ type: "REVOKED" }));
      peer?.ws.close(1008, "Unlinked");
      await this.pool.query(
        "DELETE FROM chinesetest.runners WHERE id=$1 AND owner=$2",
        [id, account.id],
      );
      return { ok: true };
    }
    if (method !== "POST" || match[2] !== "command")
      throw new CloudError("Method không hợp lệ.", 405);
    const b = await body(),
      command = b.command as Command;
    if (
      !COMMANDS.includes(command) ||
      typeof b.commandId !== "string" ||
      !/^[0-9a-f-]{36}$/.test(b.commandId) ||
      !b.box ||
      typeof b.box.iv !== "string" ||
      typeof b.box.data !== "string" ||
      typeof b.box.key !== "string"
    )
      throw new CloudError("Lệnh mã hóa không hợp lệ.");
    if (
      b.box.data.length > 2_000_000 ||
      b.box.key.length > 1000 ||
      b.box.iv.length > 30
    )
      throw new CloudError("Lệnh quá lớn.");
    const peer = this.peers.get(id);
    if (!peer || peer.owner !== account.id || peer.ws.readyState !== 1)
      throw new CloudError(
        "Máy chạy chưa kết nối. Lịch đã bật vẫn được giữ trên máy.",
        409,
      );
    if (peer.pending.has(b.commandId))
      throw new CloudError(
        "Lệnh đang xử lý. Đọc trạng thái để đối chiếu.",
        409,
      );
    if (peer.pending.size >= 10)
      throw new CloudError("Máy đang xử lý nhiều lệnh.", 429);
    const expires = account.expiresAt
      ? Date.parse(account.expiresAt)
      : Infinity;
    const limits: Limits = {
      maxAccounts: Math.min(MAX_ACCOUNTS, account.maxProfiles),
      maxConcurrent: Math.min(MAX_ACCOUNTS, account.maxConcurrent),
      liveEnabled: account.liveEnabled,
      expiresAt: Math.min(Date.now() + 7 * 86400000, expires),
    };
    let claimGrant: string | undefined;
    if (command === "arm" && b.claimKey !== undefined) {
      if (!account.liveEnabled || typeof b.claimKey !== "string" || !/^[a-f0-9]{64}$/.test(b.claimKey) || !/^[a-f0-9-]{36}$/.test(b.runId || "")) throw new CloudError("Thiếu quyền Live hoặc khóa lượt chạy không hợp lệ.", 403);
      const grant = await this.pool.query("INSERT INTO chinesetest.claims(owner,claim_key,runner_id,run_id) VALUES($1,$2,$3,$4) ON CONFLICT(owner,claim_key) DO UPDATE SET claim_key=EXCLUDED.claim_key RETURNING runner_id,run_id", [account.id,b.claimKey,id,b.runId]);
      if (grant.rows[0]?.runner_id !== id || grant.rows[0]?.run_id !== b.runId) throw new CloudError("Lượt cùng tài khoản/kỳ thi còn khóa trên máy khác hoặc lượt trước. Đối chiếu trước khi chạy lại.",409);
      claimGrant = b.claimKey;
    }
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        peer.pending.delete(b.commandId);
        reject(
          new CloudError(
            "Chưa nhận xác nhận của máy. Đọc trạng thái trước khi thử lại.",
            504,
          ),
        );
      }, 90000);
      peer.pending.set(b.commandId, { resolve, reject, timer });
      peer.ws.send(
        JSON.stringify({
          type: "COMMAND",
          commandId: b.commandId,
          command,
          box: b.box,
          limits,
          owner: account.id,
          claimGrant,
          claimRunId: b.runId,
        }),
      );
    });
  }
  upgrade(req: IncomingMessage, socket: Duplex, head: Buffer) {
    if (req.url !== "/chinesetest-runner") return false;
    try {
      if (
        req.headers.host !== new URL(this.origin()).host ||
        req.headers.origin
      )
        throw new Error("Origin");
      this.limit("ip:" + req.socket.remoteAddress, 30);
      this.wss.handleUpgrade(req, socket, head, (ws) => {
        let peer: Peer | undefined;
        let chain = Promise.resolve();
        const timer = setTimeout(
          () => ws.close(1008, "Handshake expired"),
          10000,
        );
        ws.on("message", (raw) => {
          chain = chain
            .then(async () => {
              const m = JSON.parse(raw.toString());
              if (!peer) {
                if (
                  m.type !== "HELLO" ||
                  typeof m.id !== "string" ||
                  !/^[0-9a-f-]{36}$/.test(m.id)
                )
                  throw new Error("Handshake");
                let row = (
                  await this.pool.query(
                    "SELECT * FROM chinesetest.runners WHERE id=$1",
                    [m.id],
                  )
                ).rows[0];
                if (row) {
                  if (
                    typeof m.token !== "string" ||
                    hash(m.token) !== row.token_hash
                  )
                    throw new Error("Authentication");
                  if (row.owner) await this.allowed(row.owner);
                } else {
                  if (
                    typeof m.name !== "string" ||
                    !m.name.trim() ||
                    m.name.length > 100 ||
                    !["darwin", "win32", "test"].includes(m.platform) ||
                    m.publicKey?.kty !== "RSA" ||
                    typeof m.publicKey.n !== "string" ||
                    m.publicKey.n.length < 300 ||
                    m.publicKey.n.length > 800 ||
                    m.publicKey.d
                  )
                    throw new Error("Device");
                  const token = randomBytes(32).toString("hex"),
                    code = randomBytes(8).toString("hex").toUpperCase(),
                    fp = await fingerprint(m.publicKey);
                  row = (
                    await this.pool.query(
                      "INSERT INTO chinesetest.runners(id,name,platform,public_key,fingerprint,token_hash,pair_hash,pair_expires_at) VALUES($1,$2,$3,$4,$5,$6,$7,now()+interval '5 minutes') RETURNING *",
                      [
                        m.id,
                        m.name.trim(),
                        m.platform,
                        JSON.stringify(m.publicKey),
                        fp,
                        hash(token),
                        hash(code),
                      ],
                    )
                  ).rows[0];
                  ws.send(JSON.stringify({ type: "REGISTERED", token, code }));
                }
                if (this.peers.has(m.id))
                  throw new Error("Runner already connected");
                peer = {
                  id: m.id,
                  owner: row.owner ?? undefined,
                  ws,
                  pending: new Map(),
                };
                this.peers.set(peer.id, peer);
                clearTimeout(timer);
                if (!row.owner) {
                  const code = randomBytes(8).toString("hex").toUpperCase();
                  await this.pool.query(
                    "UPDATE chinesetest.runners SET pair_hash=$2,pair_expires_at=now()+interval '5 minutes' WHERE id=$1",
                    [peer.id, hash(code)],
                  );
                  ws.send(JSON.stringify({ type: "PAIR_CODE", code }));
                }
                ws.send(
                  JSON.stringify({ type: "WELCOME", owner: row.owner ?? null }),
                );
                return;
              }
              if (m.type === "PING") {
                await this.pool.query(
                  "UPDATE chinesetest.runners SET last_seen=now() WHERE id=$1",
                  [peer.id],
                );
                ws.send(JSON.stringify({ type: "PONG" }));
                return;
              }
              if (m.type === "CLAIMS" && peer.owner && Array.isArray(m.claims)) {
                for (const claim of m.claims.slice(-1000)) {
                  if (!/^[a-f0-9]{64}$/.test(claim.key || "") || !/^[a-f0-9-]{36}$/.test(claim.runId || "")) continue;
                  if (claim.release === true) await this.pool.query("DELETE FROM chinesetest.claims WHERE owner=$1 AND claim_key=$2 AND runner_id=$3 AND run_id=$4", [peer.owner,claim.key,peer.id,claim.runId]);
                }
                return;
              }
              if (m.type === "COMMAND_ERROR") {
                const pending = peer.pending.get(m.commandId);
                if (pending) {
                  peer.pending.delete(m.commandId);
                  clearTimeout(pending.timer);
                  pending.reject(
                    new CloudError(
                      "Máy từ chối lệnh. Đối chiếu thiết bị và kết nối lại.",
                      409,
                    ),
                  );
                }
                return;
              }
              if (m.type === "RESULT") {
                const pending = peer.pending.get(m.commandId);
                if (pending) {
                  peer.pending.delete(m.commandId);
                  clearTimeout(pending.timer);
                  pending.resolve({ box: m.box });
                }
                return;
              }
            })
            .catch(() => ws.close(1008, "Invalid runner message"));
        });
        ws.on("close", () => {
          clearTimeout(timer);
          if (peer && this.peers.get(peer.id) === peer) {
            this.peers.delete(peer.id);
            for (const p of peer.pending.values()) {
              clearTimeout(p.timer);
              p.reject(
                new CloudError(
                  "Mất kết nối Runner. Đối chiếu trạng thái khi kết nối lại.",
                  409,
                ),
              );
            }
          }
        });
        ws.on("error", () => ws.terminate());
      });
    } catch {
      socket.destroy();
    }
    return true;
  }
  close() {
    for (const ws of this.wss.clients) ws.terminate();
    this.wss.close();
  }
}
