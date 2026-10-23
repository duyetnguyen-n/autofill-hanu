import { describe, expect, it } from "vitest";
import { runnerLaunchUrl, parseRunnerLaunch, websiteOrigin } from "../../integrations/runner/launch";
import { startupOrigin } from "../../integrations/runner/startup";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
// @ts-expect-error packaging helper is a native ES module
import { writeRunnerLauncher } from "../../scripts/write-runner-launcher.mjs";

describe("provider-specific web launch", () => {
  it("round trips HTTPS and rejects the other provider", () => {
    const h = runnerLaunchUrl("hcmue", "https://example.test");
    const c = runnerLaunchUrl("chinesetest", "https://example.test");
    expect(h).not.toBe(c);
    expect(parseRunnerLaunch("hcmue", h)).toBe("https://example.test");
    expect(parseRunnerLaunch("chinesetest", c)).toBe("https://example.test");
    expect(() => parseRunnerLaunch("hcmue", c)).toThrow();
  });
  it.each([
    "hanu-hcmue://open?origin=http%3A%2F%2Fexample.test",
    "hanu-hcmue://open?origin=https%3A%2F%2Fuser%3Apass%40example.test",
    "hanu-hcmue://open?origin=https%3A%2F%2Fexample.test%2Fpath",
    "hanu-hcmue://open?origin=https%3A%2F%2Fexample.test&command=arm",
    "hanu-hcmue://open?origin=https%3A%2F%2Fexample.test&origin=https%3A%2F%2Fother.test",
    "hanu-hcmue://user@open?origin=https%3A%2F%2Fexample.test",
    "hanu-hcmue://open?origin=https%3A%2F%2Fexample.test#arm",
  ])("rejects untrusted launch arguments: %s", value => {
    expect(() => parseRunnerLaunch("hcmue", value)).toThrow();
  });
  it("does not enable HTTP native deep links even in fixture mode", () => {
    expect(websiteOrigin("http://127.0.0.1:1234", true)).toBe("http://127.0.0.1:1234");
    expect(() => parseRunnerLaunch("hcmue", runnerLaunchUrl("hcmue", "http://127.0.0.1:1234"))).toThrow();
  });
  it("remembers the website on manual reopen while still rejecting foreign deep links", async () => {
    const { writeFile } = await import("node:fs/promises");
    const dir = await mkdtemp(join(tmpdir(), "hanu-saved-website-"));
    const argv = process.argv;
    const origin = process.env.HCMUE_CLOUD_ORIGIN;
    try {
      delete process.env.HCMUE_CLOUD_ORIGIN;
      await writeFile(join(dir, "website.json"), JSON.stringify({ origin: "https://example.test" }));
      process.argv = [process.execPath, "main.mjs"];
      expect(await startupOrigin("hcmue", dir, false)).toBe("https://example.test");
      process.argv.push("--origin=https://other.test");
      expect(await startupOrigin("hcmue", dir, false)).toBe("https://other.test");
      process.argv = [process.execPath, "main.mjs", "--launch-url=" + runnerLaunchUrl("hcmue", "https://other.test")];
      await expect(startupOrigin("hcmue", dir, false)).rejects.toThrow("đúng website");
    } finally {
      process.argv = argv;
      if (origin === undefined) delete process.env.HCMUE_CLOUD_ORIGIN;
      else process.env.HCMUE_CLOUD_ORIGIN = origin;
      await rm(dir, { recursive: true, force: true });
    }
  });
  it("manual Start sets up web launch, keeps working if setup fails, and forwards arguments", async () => {
    const { mkdir, writeFile } = await import("node:fs/promises");
    const { execFileSync } = await import("node:child_process");
    const dir = await mkdtemp(join(tmpdir(), "hanu-start & "));
    try {
      await mkdir(join(dir, "runner"));
      await writeRunnerLauncher(dir, "chinesetest", false);
      const entry = join(dir, "runner/start.mjs");
      const installer = join(dir, "runner/install-web-launch.mjs");
      await writeFile(installer, "console.log('SETUP');");
      await writeFile(join(dir, "runner/main.mjs"), "console.log(JSON.stringify(process.argv.slice(2))); process.exitCode = process.argv.includes('--fail') ? 7 : 0;");
      const run = (...args: string[]) => execFileSync(process.execPath, [entry, ...args], { encoding: "utf8", stdio: "pipe" });
      expect(run("--origin=https://example.test")).toContain('SETUP\n["--origin=https://example.test"]');
      const launch = "--launch-url=" + runnerLaunchUrl("chinesetest", "https://example.test");
      expect(run(launch).trim()).toBe(JSON.stringify([launch]));
      await writeFile(installer, "throw new Error('fixture installation failure');");
      expect(run("--no-open").trim()).toBe('["--no-open"]');
      expect(() => run("--fail")).toThrow();
    } finally { await rm(dir, { recursive: true, force: true }); }
  });
  it("ships separate installers with quoted URL arguments and no autostart", async () => {
    const dir = await mkdtemp(join(tmpdir(), "hanu-web-launch-"));
    try {
      for (const provider of ["hcmue", "chinesetest"] as const) {
        const root = join(dir, provider);
        const { mkdir } = await import("node:fs/promises");
        await mkdir(join(root, "runner"), { recursive: true });
        await writeRunnerLauncher(root, provider, true);
        await writeRunnerLauncher(root, provider, false);
        const source = await readFile(join(root, "runner/install-web-launch.mjs"), "utf8");
        const start = await readFile(join(root, "runner/start.mjs"), "utf8");
        expect(start).toContain("await import('./install-web-launch.mjs')");
        expect(start).toContain("arg.startsWith('--launch-url=')");
        const label = provider === "hcmue" ? "HCMUE" : "ChineseTest";
        expect(await readFile(join(root, `Start ${label}.cmd`), "utf8")).toContain('runner\\start.mjs');
        expect(await readFile(join(root, `Start ${label}.command`), "utf8")).toContain('runner/start.mjs');
        expect(source).toContain(`const provider = "${provider}"`);
        expect(source).toContain('\\\\shell\\\\open\\\\command');
        expect(source).toContain('--launch-url="%1"');
        expect(source).toContain('quoted form of launchURL');
        expect(source).not.toMatch(/schtasks|LaunchAgents|CurrentVersion\\\\Run/);
        const { execFileSync } = await import("node:child_process");
        execFileSync(process.execPath, ["--check", join(root, "runner/install-web-launch.mjs")]);
      }
    } finally { await rm(dir, { recursive: true, force: true }); }
  });
  it.skipIf(process.platform !== "darwin")("compiles both macOS URL handlers in a temporary directory", async () => {
    const { mkdir } = await import("node:fs/promises");
    const { execFileSync } = await import("node:child_process");
    const dir = await mkdtemp(join(tmpdir(), "hanu-launcher-mac-"));
    try {
      for (const provider of ["hcmue", "chinesetest"] as const) {
        const root = join(dir, provider);
        await mkdir(join(root, "runner"), { recursive: true });
        await writeRunnerLauncher(root, provider, true);
        const file = join(root, "runner/install-web-launch.mjs");
        let source = await readFile(file, "utf8");
        source = source.replace("join(homedir(), 'Applications')", JSON.stringify(join(dir, "Applications")));
        // Exercise the real compiler and plist tools, without registering anything on this Mac.
        source = source.replace("execFileSync('/System/Library/Frameworks/CoreServices.framework/Frameworks/LaunchServices.framework/Support/lsregister', ['-f', app]);", "");
        const { writeFile } = await import("node:fs/promises");
        await writeFile(file, source);
        execFileSync(process.execPath, [file], { stdio: "pipe" });
        const label = provider === "hcmue" ? "HCMUE" : "ChineseTest";
        const plist = join(dir, "Applications", `HANU ${label} Launcher.app`, "Contents/Info.plist");
        expect(execFileSync("/usr/libexec/PlistBuddy", ["-c", "Print :CFBundleURLTypes:0:CFBundleURLSchemes:0", plist], { encoding: "utf8" }).trim()).toBe(`hanu-${provider}`);
        execFileSync("/bin/sh", ["-n", join(root, "Enable web launch.command")]);
        execFileSync("/usr/bin/codesign", ["--verify", "--deep", "--strict", join(dir, "Applications", `HANU ${label} Launcher.app`)]);
      }
    } finally { await rm(dir, { recursive: true, force: true }); }
  });

  it("generates isolated per-user Windows protocol registrations", async () => {
    const { mkdir, writeFile, realpath } = await import("node:fs/promises");
    const { execFileSync } = await import("node:child_process");
    const dir = await mkdtemp(join(tmpdir(), "hanu windows launch & "));
    try {
      for (const provider of ["hcmue", "chinesetest"] as const) {
        const root = join(dir, provider);
        await mkdir(join(root, "runner"), { recursive: true });
        await writeRunnerLauncher(root, provider, false);
        const file = join(root, "runner/install-web-launch.mjs");
        const source = (await readFile(file, "utf8"))
          .replace("import { execFileSync } from 'node:child_process';", "const execFileSync = (name, args) => console.log(JSON.stringify({name, args}));")
          .replace("process.platform === 'win32'", "true");
        await writeFile(file, source);
        const output = execFileSync(process.execPath, [file], { encoding: "utf8" });
        const calls = output.split("\n").filter(line => line.startsWith("{")).map(line => JSON.parse(line));
        expect(calls).toHaveLength(3);
        expect(calls[0].args[1]).toBe(`HKCU\\Software\\Classes\\hanu-${provider}`);
        expect(calls[2].args[1]).toBe(`HKCU\\Software\\Classes\\hanu-${provider}\\shell\\open\\command`);
        expect(calls[2].args.at(-2)).toContain('" --launch-url="%1"');
        expect(calls[2].args.at(-2)).toContain('"' + join(await realpath(root), 'runner/main.mjs') + '"');
      }
    } finally { await rm(dir, { recursive: true, force: true }); }
  });

});
