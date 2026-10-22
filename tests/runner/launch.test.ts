import { describe, expect, it } from "vitest";
import { runnerLaunchUrl, parseRunnerLaunch, websiteOrigin } from "../../integrations/runner/launch";
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
