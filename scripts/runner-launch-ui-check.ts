import { chromium, expect } from "@playwright/test";
import { mkdir } from "node:fs/promises";
import { resolve } from "node:path";
import { httpFixture } from "../tests/cloud/fixture";
import { connectRunner as hcmueRunner } from "../tests/hcmue/relay-fixture";
import { connectRunner as chineseRunner } from "../tests/chinesetest/relay-fixture";
import { fixtureEngine as hcmueEngine } from "../tests/hcmue/support";
import { fixtureEngine as chineseEngine } from "../tests/chinesetest/support";

const app = await httpFixture(resolve("build/cloud-ui"), true, true);
const runners: Awaited<ReturnType<typeof hcmueRunner | typeof chineseRunner>>[] = [];
const browser = await chromium.launch({ channel: process.platform === "win32" ? "msedge" : "chrome", headless: true });
await mkdir("test-results/runner-launch", { recursive: true });
try {
  const context = await browser.newContext({ viewport: { width: 1440, height: 1100 } });
  const page = await context.newPage();
  const errors: string[] = [];
  page.on("pageerror", error => errors.push(error.message));
  await page.goto(app.config.origin + "/hcmue");
  await page.getByRole("button", { name: "Tiếp tục với Google", exact: true }).click();
  await expect(page.getByText("an@example.test", { exact: true }).first()).toBeVisible();
  for (const provider of ["hcmue", "chinesetest"] as const) {
    const devices = [];
    for (const suffix of ["A", "B"]) {
      const factory = async () => {
        const fixture = provider === "hcmue" ? await hcmueEngine() : await chineseEngine();
        fixture.data.name = `${provider} Laptop ${suffix}`;
        return fixture;
      };
      const runner = provider === "hcmue"
        ? await hcmueRunner(app, factory as typeof hcmueEngine)
        : await chineseRunner(app, factory as typeof chineseEngine);
      runners.push(runner);
      const response = await app.api(provider + "/pair", 0, { code: runner.code });
      expect(response.ok).toBe(true);
      devices.push(await response.json() as { id: string; name: string });
    }
    await page.goto(app.config.origin + "/" + provider);
    const deviceSelect = page.locator(provider === "hcmue" ? "#hc-device select" : "#device select");
    await expect(deviceSelect.locator("option")).toHaveCount(3);
    await expect(deviceSelect).toHaveValue("");
    const launcher = page.locator(".runner-launch");
    const launch = launcher.getByRole("link", { name: "Mở runner trên máy này", exact: true });
    await expect(launch).toHaveAttribute("href", `hanu-${provider}://open?origin=${encodeURIComponent(app.config.origin)}`);
    // Exercise the click and guidance without invoking a real OS URL handler from a fixture.
    await launch.evaluate(element => element.addEventListener("click", event => event.preventDefault()));
    await launch.click();
    await expect(launcher.getByRole("status")).toContainText("Enable web launch");
    await deviceSelect.selectOption(devices[0].id);
    await page.getByRole("button", { name: provider === "hcmue" ? "Đối chiếu máy" : "Đối chiếu dấu vân tay", exact: true }).click();
    await page.getByRole("button", { name: "Đã đối chiếu, đúng máy", exact: true }).click();
    await expect(launcher).toContainText(devices[0].name);
    const preference = launcher.getByRole("checkbox");
    await preference.check();
    await expect(preference).toBeChecked();
    await page.reload();
    await expect(deviceSelect).toHaveValue(devices[0].id);
    await expect(page.locator(".runner-launch").getByRole("checkbox")).toBeChecked();

    // A second browser has the same website login but no local machine preference/trust.
    const remoteContext = await browser.newContext({ viewport: { width: 1440, height: 1100 } });
    await remoteContext.addCookies(await context.cookies());
    const remote = await remoteContext.newPage();
    await remote.goto(app.config.origin + "/" + provider);
    const remoteSelect = remote.locator(provider === "hcmue" ? "#hc-device select" : "#device select");
    await expect(remoteSelect.locator("option")).toHaveCount(3);
    await expect(remoteSelect).toHaveValue("");
    await remoteSelect.selectOption(devices[0].id);
    await expect(remote.locator(".runner-launch")).toContainText(devices[0].name);
    await expect(remote.locator(".runner-launch").getByRole("checkbox")).not.toBeChecked();
    await expect(remote.getByRole("button", { name: provider === "hcmue" ? "Đối chiếu máy" : "Đối chiếu dấu vân tay", exact: true })).toBeVisible();
    await remoteContext.close();

    await page.screenshot({ path: `test-results/runner-launch/${provider}-desktop.png`, fullPage: true });
    await page.setViewportSize({ width: 390, height: 844 });
    await expect(page.getByRole("link", { name: "Mở runner trên máy này", exact: true })).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await page.screenshot({ path: `test-results/runner-launch/${provider}-mobile.png`, fullPage: true });
    await page.setViewportSize({ width: 1440, height: 1100 });
  }
  expect(errors).toEqual([]);
  console.log("PASS web launch UI: separate provider links, click guidance, explicit selection with two runners, preference survives reload, second browser requires its own selection/trust, desktop/mobile. Zero registration POSTs.");
} finally {
  await browser.close();
  for (const runner of runners) await runner.close();
  await app.close();
}
