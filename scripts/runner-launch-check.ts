import { spawn, type ChildProcess } from "node:child_process";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import assert from "node:assert/strict";
import { runnerLaunchUrl, type Provider } from "../integrations/runner/launch";

const root = await mkdtemp(join(tmpdir(), "hanu-dual-runner-"));
const children: ChildProcess[] = [];
const origin = "https://runner-fixture.invalid";
function start(provider: Provider, args: string[]) {
  const child = spawn(process.execPath, [resolve(`build/${provider}/runner/main.mjs`), "--no-open", ...args], {
    env: { ...process.env, [`${provider.toUpperCase()}_DATA_DIR`]: join(root, provider), [`${provider.toUpperCase()}_FIXTURE`]: "1" },
    stdio: ["ignore", "pipe", "pipe", "ipc"],
  });
  children.push(child);
  let stderr = "";
  child.stderr!.on("data", chunk => { stderr += chunk.toString(); });
  const exited = new Promise<number | null>(resolve => child.once("exit", resolve));
  return { child, exited, error: () => stderr };
}
async function ready(provider: Provider) {
  const run = start(provider, ["--origin=" + origin]);
  const url = await new Promise<string>((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error("Runner startup timed out: " + run.error())), 15000);
    run.child.on("message", (message: any) => {
      if (message.type === "LOCAL_READY") { clearTimeout(timeout); resolve(message.url); }
    });
    run.child.once("exit", code => { clearTimeout(timeout); reject(new Error(`Runner exited ${code}: ${run.error()}`)); });
  });
  const descriptor = JSON.parse(await readFile(join(root, provider, "runner-open.json"), "utf8"));
  return { ...run, url, descriptor };
}
try {
  const [hcmue, chinesetest] = await Promise.all([ready("hcmue"), ready("chinesetest")]);
  assert.notEqual(new URL(hcmue.url).port, new URL(chinesetest.url).port);
  for (const [provider, running] of [["hcmue", hcmue], ["chinesetest", chinesetest]] as const) {
    const descriptorFile = join(root, provider, "runner-open.json");
    const before = await readFile(descriptorFile, "utf8");
    const clicks = Array.from({ length: 3 }, () => start(provider, ["--launch-url=" + runnerLaunchUrl(provider, origin)]));
    for (const click of clicks) assert.equal(await click.exited, 0, click.error());
    assert.equal(await readFile(descriptorFile, "utf8"), before, "Opening again must preserve the running process");
    const wrong = start(provider, ["--launch-url=" + runnerLaunchUrl(provider === "hcmue" ? "chinesetest" : "hcmue", origin)]);
    assert.notEqual(await wrong.exited, 0);
    const foreign = start(provider, ["--launch-url=" + runnerLaunchUrl(provider, "https://other-fixture.invalid")]);
    assert.notEqual(await foreign.exited, 0);
    assert.equal(JSON.parse(await readFile(join(root, provider, "website.json"), "utf8")).origin, origin);
    const response = await fetch(running.url, { redirect: "manual" });
    const cookie = response.headers.get("set-cookie")!.split(";")[0];
    const state = await fetch(new URL("/state", running.url), { headers: { Cookie: cookie } });
    assert.equal(state.status, 200);
    assert.equal((await fetch(new URL("/state", running.url))).status, 401);
    assert.equal(running.child.exitCode, null);
  }
  console.log("PASS dual native runners: separate ports/vaults, repeated deep links reuse each process, wrong provider/website rejected, local state stays authenticated. No school API calls.");
} finally {
  for (const child of children) if (child.exitCode === null && child.signalCode === null) child.kill("SIGTERM");
  await Promise.all(children.map(child => child.exitCode !== null || child.signalCode !== null ? Promise.resolve() : new Promise(resolve => {
    const timeout = setTimeout(() => { child.kill("SIGKILL"); resolve(null); }, 5000);
    child.once("exit", () => { clearTimeout(timeout); resolve(null); });
  })));
  await rm(root, { recursive: true, force: true });
}
