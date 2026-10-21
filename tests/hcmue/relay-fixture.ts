import { WebSocket } from "ws";
import {
  box,
  unbox,
  seal,
  open,
  newReplyKey,
} from "../../integrations/hcmue/crypto";
import { fixtureEngine } from "./support";
import type {
  SecretCommand,
  Command,
  CommandReply,
  Device,
} from "../../integrations/hcmue/protocol";
import type { httpFixture } from "../cloud/fixture";
export async function connectRunner(
  app: Awaited<ReturnType<typeof httpFixture>>,
) {
  const f = await fixtureEngine(),
    identity = await f.engine.identity();
  const ws = new WebSocket(
    app.config.origin.replace("http:", "ws:") + "/hcmue-runner",
  );
  let code = "";
  let resolveReady!: () => void, rejectReady!: (e: Error) => void;
  const ready = new Promise<void>((r, j) => {
    resolveReady = r;
    rejectReady = j;
  });
  ws.on("error", rejectReady);
  ws.on("open", () =>
    ws.send(JSON.stringify({ type: "HELLO", ...identity, platform: "test" })),
  );
  ws.on("message", async (raw) => {
    const m = JSON.parse(raw.toString());
    if (m.type === "PAIR_CODE") code = m.code;
    if (m.type === "WELCOME") resolveReady();
    if (m.type === "COMMAND") {
      let reply: CommandReply;
      const secret = await unbox<SecretCommand>(
        f.data.keys.privateKey,
        m.box,
        m.commandId,
      );
      try {
        reply = {
          ok: true,
          data: await f.engine.execute(secret.command, secret.args, m.limits),
        };
      } catch (e) {
        reply = { ok: false, error: (e as Error).message };
      }
      ws.send(
        JSON.stringify({
          type: "RESULT",
          commandId: m.commandId,
          box: await seal(secret.replyKey, reply, m.commandId),
        }),
      );
    }
  });
  await ready;
  async function command(
    device: Device,
    kind: Command,
    args: Record<string, unknown> = {},
    owner = 0,
  ) {
    const commandId = crypto.randomUUID(),
      replyKey = newReplyKey();
    const encrypted = await box(
      device.publicKey,
      { issuedAt: Date.now(), commandId, command: kind, args, replyKey },
      commandId,
    );
    const response = await app.api(
      "hcmue/devices/" + device.id + "/command",
      owner,
      { issuedAt: Date.now(), commandId, command: kind, box: encrypted },
    );
    const result = (await response.json()) as any;
    if (!response.ok) return { status: response.status, result };
    return {
      status: response.status,
      result: await open<CommandReply>(replyKey, result.box, commandId),
    };
  }
  return {
    ...f,
    ws,
    code,
    identity,
    command,
    async close() {
      ws.terminate();
      await f.engine.close();
    },
  };
}
