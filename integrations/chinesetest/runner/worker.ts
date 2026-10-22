import { parentPort, workerData } from "node:worker_threads";
import { join } from "node:path";
import { Vault, systemKey, runnerDirectory } from "./vault";
import { Engine, freshData, type RunnerData } from "./engine";
import { unbox, seal } from "../crypto";
import type { SecretCommand, CommandReply } from "../protocol";
async function start() {
  const dir = workerData?.dir ?? runnerDirectory(),
    key = await systemKey(dir),
    vault = new Vault<RunnerData>(join(dir, "state.enc"), key);
  const data =
    (await vault.load(() => null as unknown as RunnerData)) ??
    (await freshData(workerData?.name ?? "Máy CHINESETEST"));
  const claims = () => data.schedules.map(s => ({ key: s.identityHash, runId: s.id, release: s.verifiedAbsent === true || s.attempt.count === 0 && ["stopped", "failed", "test_passed"].includes(s.status) }));
  const engine = new Engine(data, vault, undefined, () =>
    parentPort!.postMessage({ type: "CHANGED", state: engine.snapshot(), claims: claims() }),
  );
  await engine.persist();
  parentPort!.postMessage({
    type: "READY",
    identity: await engine.identity(),
    cloud: data.cloud,
    state: engine.snapshot(),
  });
  parentPort!.on("message", async (m) => {
    try {
      if (m.type === "LOCAL_COMMAND") {
        try {
          if (!["login", "finish-login", "cancel-login"].includes(m.command)) throw new Error("Lệnh local không được phép.");
          await engine.execute(m.command, {}, { maxAccounts: 20, maxConcurrent: 20, liveEnabled: false, expiresAt: Date.now() });
          parentPort!.postMessage({ type: "LOCAL_RESULT", id: m.id, ok: true, state: engine.snapshot() });
        } catch (e) { parentPort!.postMessage({ type: "LOCAL_RESULT", id: m.id, ok: false, error: (e as Error).message, state: engine.snapshot() }); }
        return;
      }
      if (m.type === "CLOSE") {
        await engine.close();
        parentPort!.postMessage({ type: "CLOSED" });
        return;
      }
      if (m.type === "LOCAL_STOP") {
        await engine.execute("stop-all", {}, m.limits);
        parentPort!.postMessage({ type: "CHANGED", state: engine.snapshot() });
        return;
      }
      if (m.type === "CLOUD") {
        data.cloud = m.cloud;
        await engine.persist();
        return;
      }
      if (m.type === "REVOKED") {
        await engine.revoke();
        return;
      }
      if (m.type !== "COMMAND") return;
      if (!data.cloud?.owner || m.owner !== data.cloud.owner)
        throw new Error("Sai chủ thiết bị.");
      const command = await unbox<SecretCommand>(
        data.keys.privateKey,
        m.box,
        m.commandId,
      );
      if (
        !Number.isFinite(command.issuedAt) ||
        Math.abs(Date.now() - command.issuedAt) > 120000 ||
        !command.args ||
        typeof command.args !== "object" ||
        command.commandId !== m.commandId ||
        command.command !== m.command
      )
        throw new Error("Lệnh không khớp.");
      let reply: CommandReply;
      if (command.command === "arm") {
        const schedule = data.schedules.find(s => s.id === command.args.id);
        if (schedule && !schedule.test && (m.claimGrant !== schedule.identityHash || m.claimRunId !== schedule.id)) throw new Error("Website chưa cấp khóa gửi liên máy.");
      }
      if (data.seen.includes(m.commandId))
        reply = {
          ok: false,
          error: "Lệnh đã xử lý. Đọc trạng thái để đối chiếu.",
        };
      else {
        data.seen.push(m.commandId);
        data.seen = data.seen.slice(-500);
        await engine.persist();
        try {
          reply = {
            ok: true,
            data: await engine.execute(command.command, command.args, m.limits),
          };
        } catch (e) {
          reply = { ok: false, error: (e as Error).message };
        }
      }
      const box = await seal(command.replyKey, reply, m.commandId);
      parentPort!.postMessage({
        type: "RESULT",
        commandId: m.commandId,
        box,
        state: engine.snapshot(),
      });
    } catch {
      parentPort!.postMessage({
        type: "COMMAND_ERROR",
        commandId: m.commandId,
      });
    }
  });
}
start().catch(() => {
  parentPort!.postMessage({
    type: "FATAL",
    error:
      "Không mở được kho phiên hoặc worker CHINESETEST. Kiểm tra Keychain/DPAPI và quyền ghi thư mục.",
  });
});
