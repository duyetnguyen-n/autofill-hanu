import { chromium, expect } from "@playwright/test";
import { mkdir } from "node:fs/promises";
import { resolve } from "node:path";
import { httpFixture } from "../tests/cloud/fixture";
import { connectRunner } from "../tests/chinesetest/relay-fixture";
import { fixtureEngine } from "../tests/chinesetest/support";

const app = await httpFixture(resolve("build/cloud-ui"), false, true);
const runner = await connectRunner(app, async () => {
  const fixture = await fixtureEngine(1);
  await fixture.prepare(false, "account-0", Date.now() + 3600000);
  return fixture;
});
const browser = await chromium.launch({ channel: process.platform === "win32" ? "msedge" : "chrome", headless: true });
await mkdir("test-results/assistant", { recursive: true });
try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 1050 } });
  const errors: string[] = [], chatRequests: string[] = [];
  page.on("pageerror", error => errors.push(error.message));
  page.on("request", request => { if (request.url().includes("/assistant/chat")) chatRequests.push(request.url()); });
  await page.goto(app.config.origin + "/chinesetest");
  await page.getByRole("button", { name: "Tiếp tục với Google", exact: true }).click();
  await page.goto(app.config.origin + "/chinesetest");
  await page.getByRole("button", { name: "Liên kết máy", exact: true }).click();
  await page.getByLabel("Mã liên kết", { exact: true }).fill(runner.code);
  await page.getByRole("dialog").getByRole("button", { name: "Liên kết", exact: true }).click();
  await page.getByRole("button", { name: "Đã đối chiếu, đúng máy", exact: true }).click();
  await expect(page.locator(".ct-account")).toHaveCount(1);
  await page.getByRole("button", { name: "Trợ lý AI", exact: true }).click();
  const panel = page.getByRole("dialog", { name: "Trợ lý HANU", exact: true });
  await panel.getByRole("textbox").fill("Sắp đki rồi, theo dõi và báo kết quả giúp mình nhé");
  await panel.getByRole("button", { name: "Gửi câu hỏi", exact: true }).click();
  const updates = panel.getByRole("region", { name: "Cập nhật đăng ký", exact: true });
  await expect(updates).toContainText("nhưng chưa bật");
  expect(chatRequests).toEqual([]);
  const simulated = runner.data.schedules[0];
  // Exercise actual encrypted state reads through the relay with controlled fixture transitions.
  simulated.status = "armed";
  await expect(updates).toContainText("Runner đang chờ giờ chạy", { timeout: 12000 });
  simulated.status = "checking";
  await expect(updates).toContainText("Runner đang kiểm tra điều kiện", { timeout: 10000 });
  simulated.status = "sending";
  await expect(updates).toContainText("Runner đang gửi yêu cầu", { timeout: 10000 });
  await expect(updates).not.toContainText("Đã có xác nhận đăng ký");
  const count = await updates.locator("article").count();
  await page.waitForTimeout(3000);
  expect(await updates.locator("article").count()).toBe(count);
  await page.screenshot({ path: "test-results/assistant/tracking-desktop.png" });
  await page.setViewportSize({ width: 390, height: 844 });
  expect((await panel.locator(".ai-companion-bar").boundingBox())!.height).toBeLessThanOrEqual(44);
  expect((await panel.getByRole("log").boundingBox())!.height).toBeGreaterThan(250);
  await page.screenshot({ path: "test-results/assistant/tracking-mobile.png" });
  await panel.getByRole("button", { name: "Đóng trợ lý", exact: true }).click();
  simulated.status = "confirmed"; simulated.attempt.bmid = "fixture-confirmation";
  await expect(page.locator(".ai-unread")).toBeVisible({ timeout: 10000 });
  await page.getByRole("button", { name: "Trợ lý AI", exact: true }).click();
  await expect(updates).toContainText("Đã có xác nhận đăng ký");
  await expect(page.locator(".ai-unread")).toHaveCount(0);
  expect(await updates.locator('[data-kind="result"]').count()).toBe(1);
  expect(await updates.innerText()).not.toMatch(/capturedAt|control ID|c-\d+|disabled:|fixture-confirmation/);
  await page.screenshot({ path: "test-results/assistant/tracking-result-mobile.png" });
  expect(chatRequests).toEqual([]);
  expect(runner.shared.submits).toHaveLength(0);
  expect(errors).toEqual([]);
  console.log("PASS tracking UI: encrypted runner state produces proactive chat milestones, no repeated polling messages, no success before proof, unread result and compact desktop/mobile layout. No model calls or real submissions.");
} finally {
  await browser.close(); await runner.close(); await app.close();
}
