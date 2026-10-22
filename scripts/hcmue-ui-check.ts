import { chromium, expect } from "@playwright/test";
import { mkdir } from "node:fs/promises";
import { resolve } from "node:path";
import { httpFixture } from "../tests/cloud/fixture";
import { connectRunner } from "../tests/hcmue/relay-fixture";
const app = await httpFixture(resolve("build/cloud-ui"), true),
  runner = await connectRunner(app);
const browser = await chromium.launch({
  channel: process.platform === "win32" ? "msedge" : "chrome",
  headless: true,
});
await mkdir("test-results/hcmue", { recursive: true });
try {
  const context = await browser.newContext({
      viewport: { width: 1440, height: 1100 },
      colorScheme: "light",
    }),
    page = await context.newPage(),
    errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto(app.config.origin + "/hcmue");
  await page
    .getByRole("button", { name: "Tiếp tục với Google", exact: true })
    .click();
  await expect(
    page.getByText("an@example.test", { exact: true }).first(),
  ).toBeVisible();
  await page.goto(app.config.origin + "/hcmue");
  await expect(
    page.getByRole("heading", { name: "Sẵn sàng trước giờ mở." }),
  ).toBeVisible();
  await page.screenshot({
    path: "test-results/hcmue/onboarding-light.png",
    fullPage: true,
  });
  await page.getByRole("button", { name: "Liên kết máy", exact: true }).click();
  await page.getByLabel("Mã liên kết", { exact: true }).fill(runner.code);
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "Liên kết", exact: true })
    .click();
  await expect(page.locator(".hc-fingerprint")).toHaveText(
    runner.identity.fingerprint,
  );
  await page
    .getByRole("button", { name: "Đã đối chiếu, đúng máy", exact: true })
    .click();
  await expect(page.locator(".hc-table")).toContainText("Nguyễn Minh An");
  await page
    .getByRole("checkbox", { name: "Chọn Nguyễn Minh An", exact: true })
    .check();
  await page.getByRole("button", { name: "Tải kỳ thi", exact: true }).click();
  await page
    .getByLabel("Kỳ thi cho Nguyễn Minh An", { exact: true })
    .selectOption({ index: 1 });
  const target = Date.now() + 15000;
  await page
    .getByLabel("Giờ gửi cho Nguyễn Minh An", { exact: true })
    .fill(new Date(target + 7 * 3600000).toISOString().slice(0, 19));
  await page
    .getByRole("button", { name: "Chuẩn bị 1 tài khoản", exact: true })
    .click();
  await expect(page.locator(".hc-runs")).toContainText("Sẵn sàng");
  await page
    .getByRole("button", { name: "Bật 1 lịch gửi", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Xác nhận bật lịch", exact: true })
    .click();
  await expect(page.locator(".hc-runs")).toContainText("Đã bật lịch");
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await page.evaluate(async () => {
    await document.fonts.ready;
    window.scrollTo(0, 0);
  });
  await page.waitForTimeout(250);
  await page.screenshot({
    path: "test-results/hcmue/desktop-light.png",
    fullPage: true,
  });
  await page
    .getByRole("button", { name: "Đổi giao diện", exact: true })
    .click();
  await page.waitForTimeout(200);
  await page.screenshot({
    path: "test-results/hcmue/desktop-dark.png",
    fullPage: true,
  });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({
    path: "test-results/hcmue/mobile-dark.png",
    fullPage: true,
  });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await page
    .getByRole("button", { name: "Đổi giao diện", exact: true })
    .click();
  await page.screenshot({
    path: "test-results/hcmue/mobile-light.png",
    fullPage: true,
  });
  await expect(page.locator(".hc-runs")).toContainText("Kiểm tra hoàn tất.", {
    timeout: 25000,
  });
  expect(runner.client.submits).toHaveLength(0);
  // Round trip to the original provider must remain usable.
  await page.getByRole("link", { name: "Google Forms", exact: true }).click();
  await expect(
    page.getByLabel("Link Google Form", { exact: true }),
  ).toBeVisible();
  expect(errors).toEqual([]);
  console.log(
    "PASS HCMUE: real encrypted relay, one-time pairing, fingerprint, prepare/arm/deadline dry-run (0 school POSTs), light/dark/mobile, return to Google Forms.",
  );
} finally {
  await browser.close();
  await runner.close();
  await app.close();
}
