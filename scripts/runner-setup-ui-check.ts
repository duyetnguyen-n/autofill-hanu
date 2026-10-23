import { chromium, expect } from "@playwright/test";
import { mkdir } from "node:fs/promises";
import { createWebsiteSetup } from "../integrations/runner/setup";

const browser = await chromium.launch({ channel: process.platform === "win32" ? "msedge" : "chrome", headless: true });
await mkdir("test-results/runner-setup", { recursive: true });
try {
  for (const provider of ["chinesetest", "hcmue"] as const) {
    const setup = await createWebsiteSetup(provider);
    const context = await browser.newContext({ viewport: { width: 1280, height: 800 } });
    try {
      await context.grantPermissions(["clipboard-read", "clipboard-write"], { origin: new URL(setup.url).origin });
      const page = await context.newPage();
      await page.goto(setup.url);
      await expect(page).toHaveURL(new URL(setup.url).origin + "/");
      const input = page.getByLabel("Địa chỉ website HANU", { exact: true });
      await input.fill("http://example.test");
      await page.getByRole("button", { name: "Kết nối runner" }).click();
      await expect(page.getByRole("alert")).toContainText("Địa chỉ chưa đúng");
      await page.screenshot({ path: `test-results/runner-setup/${provider}-desktop.png` });
      await page.setViewportSize({ width: 390, height: 844 });
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
      const pasted = `https://example.test/${provider}#runs`;
      await page.evaluate(value => navigator.clipboard.writeText(value), pasted);
      await input.focus();
      await input.press("ControlOrMeta+A");
      await input.press("ControlOrMeta+V");
      await expect(input).toHaveValue(pasted);
      await page.screenshot({ path: `test-results/runner-setup/${provider}-paste-mobile.png` });
      await page.getByRole("button", { name: "Kết nối runner" }).click();
      await expect(page.getByRole("heading", { name: "Đang mở runner" })).toBeVisible();
      expect(await setup.result).toBe("https://example.test");
    } finally { setup.close(); await context.close(); }
  }
  console.log("PASS website setup: real clipboard Ctrl+V, copied page URL, invalid URL retry, desktop/mobile, both providers. No school API calls.");
} finally { await browser.close(); }
