import { spawn } from "node:child_process";
import { mkdtemp, readFile, rm, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { httpFixture } from "../tests/cloud/fixture";
import { box, open, newReplyKey } from "../integrations/chinesetest/crypto";
import type { Device, CommandReply } from "../integrations/chinesetest/protocol";
import { DONG_A, personalFrom } from "../integrations/chinesetest/protocol";
import { freshData } from "../integrations/chinesetest/runner/engine";
import { Vault, systemKey } from "../integrations/chinesetest/runner/vault";
import { chromium, expect } from "@playwright/test";
if (!["darwin", "win32"].includes(process.platform))
  throw new Error("Requires macOS Keychain or Windows DPAPI.");
const app = await httpFixture(undefined, false, true),
  dir = await mkdtemp(join(tmpdir(), "chinesetest-native-smoke-"));
const seeded = await freshData("ChineseTest native fixture");
seeded.schedules.push({id:crypto.randomUUID(),accountId:"fixture",accountKey:"fixture",target:{...DONG_A,targetAt:Date.now()+60000},personal:personalFrom({}),test:true,status:"prepared",message:"Fixture only: no registration requests",version:1,updatedAt:Date.now(),attempt:{count:0},identityHash:"a".repeat(64)});
await new Vault(join(dir,"state.enc"),await systemKey(dir)).write(seeded);
const runner = spawn(
  process.env.CHINESETEST_SMOKE_RUNTIME??process.execPath,
  [
    process.env.CHINESETEST_SMOKE_ENTRY??resolve("build/chinesetest/runner/main.mjs"),
    "--no-open",
    "--origin=" + app.config.origin,
  ],
  {
    env: { ...process.env, CHINESETEST_DATA_DIR: dir, CHINESETEST_FIXTURE: "1" },
    stdio: ["ignore", "pipe", "pipe", "ipc"],
  },
);
let localUrl = "",
  stderr = "";
runner.on("message", (m: any) => { if (m.type === "LOCAL_READY") localUrl = m.url; });
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
  const paired = await app.api("chinesetest/pair", 0, { code: state.pairCode });
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
  const response = await app.api("chinesetest/devices/" + device.id + "/command", 0, {
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
  const replay=await app.api("chinesetest/devices/"+device.id+"/command",0,{commandId,command:"state",box:encrypted});
  const replayEnvelope=await replay.json() as any;
  if(!replay.ok || (await open<CommandReply>(replyKey,replayEnvelope.box,commandId)).ok)throw new Error("Replay was not rejected");
  if((await fetch(origin+"/state")).status!==401)throw new Error("Local state is not protected");
  if((await fetch(origin+"/stop",{method:"POST",headers:{Cookie:cookie,Origin:"https://example.invalid"}})).status!==403)throw new Error("Foreign Origin accepted");
  const browser=await chromium.launch({channel:process.platform==="win32"?"msedge":"chrome",headless:true});
  try{const page=await browser.newPage();const errors:string[]=[];page.on("pageerror",e=>errors.push(e.message));await page.goto(localUrl);await expect(page.locator("#runs")).toContainText(DONG_A.ksDate);await expect(page.locator("#summary")).toContainText("0 tài khoản");await page.getByRole("button",{name:"Dừng tất cả trên máy",exact:true}).click();await expect(page.locator("#runs")).toContainText("stopped");expect(errors).toEqual([]);}finally{await browser.close();}
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
  await mkdir("test-results/chinesetest", { recursive: true });
  await writeFile(
    "test-results/chinesetest/native-smoke.json",
    JSON.stringify(
      {
        passed: true,
        platform: process.platform,
        arch: process.arch,
        scope:
          "Actual bundled runner, OS vault, pairing, encrypted worker reply, replay rejection, local browser rendering, Origin protection and stop. No ChineseTest HTTP calls.",
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
  if (resolve(dir).startsWith(resolve(tmpdir()) + (process.platform === "win32" ? "\\" : "/")) && dir.includes("chinesetest-native-smoke-")) await rm(dir, { recursive: true, force: true });
}

