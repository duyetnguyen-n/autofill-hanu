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
  const unauthorized = await context.request.post(app.config.origin + "/api/hcmue/assistant/chat", {
    headers: { Origin: app.config.origin }, data: { message: "Hướng dẫn tạo lịch" },
  });
  expect(unauthorized.status()).toBe(401);
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
  await expect(page.getByRole("dialog").getByText("Chưa nhập mã liên kết")).toBeVisible();
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
  await expect(page.getByRole("button", { name: "Kiểm tra hồ sơ/API", exact: true })).toBeDisabled();
  await expect(page.locator("#hc-account-reason")).toContainText("Chưa chọn tài khoản");
  await expect(page.getByRole("button", { name: "Bật lịch gửi", exact: true })).toBeDisabled();
  await expect(page.locator("#hc-arm-reason")).toContainText("Chưa có lịch sẵn sàng để bật");
  await page
    .getByRole("checkbox", { name: "Chọn Nguyễn Minh An", exact: true })
    .check();
  const loadExams = runner.client.exams.bind(runner.client);
  runner.client.exams = async () => { throw new Error("Trường trả HTTP 500."); };
  await page.getByRole("button", { name: "Tải kỳ thi", exact: true }).click();
  const errorNotice = page.locator(".hc-alert-events").getByRole("alert");
  await expect(errorNotice).toContainText("HCMUE chưa phản hồi");
  await expect(errorNotice).toContainText("Cách xử lý");
  await expect(errorNotice).toContainText("HC-KET-NOI");
  await errorNotice.getByText("Chi tiết", { exact: true }).click();
  await expect(errorNotice.getByText("Trường trả HTTP 500.")).toBeVisible();
  await errorNotice.screenshot({ path: "test-results/hcmue/error-notice.png" });
  await errorNotice.getByRole("button", { name: "Hỏi AI", exact: true }).click();
  const assistant = page.getByRole("dialog", { name: "Trợ lý HCMUE" });
  await assistant.getByRole("button", { name: "Giải thích thông báo" }).click();
  await expect(assistant.getByRole("log")).toContainText("Khi HCMUE phản hồi chậm hoặc lỗi");
  await assistant.getByRole("button", { name: "Đóng trợ lý" }).click();
  runner.client.exams = loadExams;
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
  await expect(page.locator(".hc-alert-events")).toContainText("Máy đã nhận và lưu lịch");
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

  await page.setViewportSize({ width: 1440, height: 1100 });
  const ask = async (question: string) => {
    await assistant.getByLabel("Câu hỏi của bạn").fill(question);
    await assistant.getByRole("button", { name: "Gửi câu hỏi" }).click();
  };
  await page.getByRole("button", { name: "Trợ lý HCMUE", exact: true }).click();
  await ask("Tạo lịch diễn tập");
  await assistant.getByRole("button", { name: "Xem trước lịch nháp" }).click();
  const newTarget = (offset: number) => new Date(Date.now() + 7 * 3600000 + offset).toISOString().slice(0, 19);
  await assistant.getByLabel("Đợt thi", { exact: true }).selectOption({ index: 1 });
  await assistant.getByLabel("Ngày và giờ gửi (giờ Việt Nam)").fill(newTarget(120000));
  expect(runner.data.schedules.filter(s => s.status === "prepared")).toHaveLength(0);
  await assistant.getByRole("button", { name: "Xác nhận chuẩn bị nháp" }).click();
  await expect(page.locator(".hc-runs")).toContainText("Sẵn sàng");
  const originalDraft = runner.data.schedules.find(s => s.status === "prepared")!;
  const firstRun = page.locator(".hc-runs .hc-run").first();
  await firstRun.getByRole("button", { name: "Hỏi AI về lịch" }).click();
  await ask("Đổi giờ lịch nháp");
  await assistant.getByRole("button", { name: "Xem trước thay đổi" }).click();
  await assistant.getByLabel("Ngày và giờ gửi (giờ Việt Nam)").fill(newTarget(180000));
  await assistant.getByRole("button", { name: "Xác nhận chuẩn bị nháp" }).click();
  await expect.poll(() => runner.data.schedules.find(s => s.status === "prepared")?.id).not.toBe(originalDraft.id);
  await expect(firstRun).toContainText("Sẵn sàng");
  await firstRun.getByRole("button", { name: "Hỏi AI về lịch" }).click();
  await assistant.getByRole("button", { name: "Giải thích lần chạy" }).click();
  await expect(assistant.getByRole("log")).toContainText("Đây là lịch diễn tập");
  await ask("Bật lịch");
  await assistant.getByRole("button", { name: "Mở xác nhận bật lịch" }).click();
  await expect(page.getByRole("dialog").getByRole("button", { name: "Xác nhận bật lịch" })).toBeVisible();
  expect(runner.data.schedules.some(s => s.status === "armed")).toBe(false);
  await page.getByRole("button", { name: "Xác nhận bật lịch" }).click();
  await expect(firstRun).toContainText("Đã bật lịch");
  expect(runner.client.submits).toHaveLength(0);

  // Round trip to the original provider must remain usable.
  await page.getByRole("link", { name: "Google Forms", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "Quản lý các phiên", exact: true }),
  ).toBeVisible();
  expect(errors).toEqual([]);
  console.log(
    "PASS HCMUE: encrypted relay, scheduled dry-run, assistant guidance and draft create/edit/arm confirmation (0 school POSTs), mobile, return to Google Forms.",
  );
} finally {
  await browser.close();
  await runner.close();
  await app.close();
}
