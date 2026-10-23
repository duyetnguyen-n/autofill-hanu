import { chromium, expect } from "@playwright/test";
import { mkdir } from "node:fs/promises";
import { resolve } from "node:path";
import { httpFixture } from "../tests/cloud/fixture";
import { connectRunner } from "../tests/chinesetest/relay-fixture";
import { fixtureEngine } from "../tests/chinesetest/support";

const app = await httpFixture(resolve("build/cloud-ui"), false, true);
const payload = '<img src=x onerror="window.__storedXss=true">';
const runner = await connectRunner(app, async () => {
  const fixture = await fixtureEngine();
  fixture.data.name = payload;
  fixture.data.accounts[0].view.name = payload;
  return fixture;
});
const browser = await chromium.launch({ channel: process.platform === "win32" ? "msedge" : "chrome", headless: true });
try {
  const paired = await app.api("chinesetest/pair", 0, { code: runner.code });
  expect(paired.status).toBe(200);
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  await page.goto(app.config.origin + "/chinesetest");
  await page.getByRole("button", { name: "Tiếp tục với Google", exact: true }).click();
  await expect(page.getByText("an@example.test", { exact: true }).first()).toBeVisible();
  await page.goto(app.config.origin + "/chinesetest");
  const launcher = page.locator(".runner-launch");
  await expect(launcher.getByText(payload, { exact: true })).toBeVisible();
  expect(await launcher.locator("img,script").count()).toBe(0);
  expect(await page.evaluate(() => (window as any).__storedXss)).toBeUndefined();
  await page.evaluate(() => {
    const script = document.createElement("script");
    script.textContent = "window.__inlineXss = true";
    document.body.appendChild(script);
  });
  expect(await page.evaluate(() => (window as any).__inlineXss)).toBeUndefined();
  await mkdir("test-results/web-security", { recursive: true });
  await launcher.screenshot({ path: "test-results/web-security/inert-runner-name.png" });
  console.log("PASS real browser: hostile runner name renders as literal text, no injected image/script; CSP blocks inline JavaScript. Fixture data only.");
} finally { await browser.close(); await runner.close(); await app.close(); }
