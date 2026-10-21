import { spawn } from "node:child_process";
import { mkdtemp, readFile, rm, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { httpFixture } from "../tests/cloud/fixture";
import { box, open, newReplyKey } from "../integrations/hcmue/crypto";
import type { Device, CommandReply } from "../integrations/hcmue/protocol";
if (!["darwin", "win32"].includes(process.platform))
  throw new Error("Requires macOS Keychain or Windows DPAPI.");
const app = await httpFixture(undefined, true),
  dir = await mkdtemp(join(tmpdir(), "hcmue-native-smoke-"));
const runner = spawn(
  process.env.HCMUE_SMOKE_RUNTIME??process.execPath,
  [
    process.env.HCMUE_SMOKE_ENTRY??resolve("build/hcmue/runner/main.mjs"),
    "--no-open",
    "--origin=" + app.config.origin,
  ],
  {
    env: { ...process.env, HCMUE_DATA_DIR: dir, HCMUE_FIXTURE: "1" },
    stdio: ["ignore", "pipe", "pipe"],
  },
);
let localUrl = "",
  stderr = "";
runner.stdout.on("data", (b) => {
  const m = b.toString().match(/http:\/\/127\.0\.0\.1:\d+\/\?token=[0-9a-f]+/);
  if (m) localUrl = m[0];
});
runner.stderr.on("data", (b) => (stderr += b.toString()));
const pause = (ms: number) => new Promise((r) => setTimeout(r, ms));
try {
  for (let i = 0; i < 200 && !localUrl; i++) await pause(50);
  if (!localUrl)
    throw new Error("Runner failed to start: " + stderr.slice(0, 300));
  const unlock = await fetch(localUrl, { redirect: "manual" }),
    cookie = unlock.headers.get("set-cookie")!.split(";")[0],
    origin = new URL(localUrl).origin;
  let state: any;
  for (let i = 0; i < 200; i++) {
    state = await (
      await fetch(origin + "/state", { headers: { Cookie: cookie } })
    ).json();
    if (state.error) throw new Error(state.error);
    if (state.connected && state.pairCode) break;
    await pause(100);
  }
  if (!state.pairCode) throw new Error("No pair code");
  const paired = await app.api("hcmue/pair", 0, { code: state.pairCode });
  if (!paired.ok) throw new Error("Pair failed");
  const device = (await paired.json()) as Device;
  await pause(150);
  const commandId = crypto.randomUUID(),
    replyKey = newReplyKey(),
    encrypted = await box(
      device.publicKey,
      { issuedAt: Date.now(), commandId, command: "state", args: {}, replyKey },
      commandId,
    );
  const response = await app.api("hcmue/devices/" + device.id + "/command", 0, {
    issuedAt: Date.now(),
    commandId,
    command: "state",
    box: encrypted,
  });
  if (!response.ok)
    throw new Error("Encrypted command failed: " + response.status);
  const envelope = (await response.json()) as any,
    result = await open<CommandReply>(replyKey, envelope.box, commandId);
  if (!result.ok || (result.data as any).accounts.length !== 0)
    throw new Error("Unexpected state");
  if (
    (
      await fetch(origin + "/stop", {
        method: "POST",
        headers: { Cookie: cookie, Origin: origin },
      })
    ).status !== 200
  )
    throw new Error("Local stop failed");
  const vault = await readFile(join(dir, "state.enc"), "utf8");
  if (vault.includes(device.id) || vault.includes("privateKey"))
    throw new Error("Plaintext vault");
  await mkdir("test-results/hcmue", { recursive: true });
  await writeFile(
    "test-results/hcmue/native-smoke.json",
    JSON.stringify(
      {
        passed: true,
        platform: process.platform,
        arch: process.arch,
        scope:
          "Actual bundled runner, OS vault, pairing, encrypted worker state reply, local stop. No HCMUE HTTP calls.",
        measuredAt: new Date().toISOString(),
      },
      null,
      2,
    ),
  );
  console.log(
    "PASS native runner: OS vault + worker startup + pairing + encrypted state + local stop; no school requests.",
  );
} finally {
  runner.kill("SIGTERM");
  await Promise.race([new Promise((r) => runner.once("exit", r)), pause(5000)]);
  if (runner.exitCode === null) runner.kill("SIGKILL");
  await app.close();
  await rm(dir, { recursive: true, force: true });
}
