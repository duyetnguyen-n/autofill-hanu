import { chromium, expect } from "@playwright/test";
import { mkdir } from "node:fs/promises";
import { resolve } from "node:path";
import { httpFixture } from "../tests/cloud/fixture";

const requests: any[] = [];
let modelAvailable = true;
const app = await httpFixture(resolve("build/cloud-ui"), true, true, false, async (url, init) => {
  if (!String(url).endsWith("/chat/completions")) return new Response(null, { status: 429 });
  const body = JSON.parse(String(init?.body)), input = JSON.parse(body.messages[1].content);
  requests.push(input);
  if (!modelAvailable) return new Response(null, { status: 429 });
  return Response.json({ choices: [{ message: { content: JSON.stringify({ answer: `Đang cùng bạn ở ${input.companion?.page.title}. Mục tiêu: ${input.companion?.goal}.`, referenceIds: [] }) } }] });
});
const browser = await chromium.launch({ channel: process.platform === "win32" ? "msedge" : "chrome", headless: true });
try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 1050 } });
  const errors: string[] = [];
  page.on("pageerror", error => errors.push(error.message));
  await page.goto(app.config.origin);
  await page.getByRole("button", { name: "Tiếp tục với Google", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Quản lý các phiên", exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Trợ lý AI", exact: true }).click();
  const panel = page.getByRole("dialog", { name: "Trợ lý HANU", exact: true });
  await panel.getByText("Ngữ cảnh đang theo", { exact: true }).click();
  await panel.getByLabel("Mục tiêu đang làm").fill("Chuẩn bị HSK 5");
  await panel.getByRole("button", { name: "Lưu mục tiêu", exact: true }).click();
  // Observing and setting a goal must not invoke the model.
  expect(requests).toHaveLength(0);
  await panel.getByRole("button", { name: "Mình nên làm gì tiếp?", exact: true }).click();
  await expect(panel.getByRole("log")).toContainText("Mục tiêu: Chuẩn bị HSK 5");
  expect(requests.at(-1).companion.page.facts).toContainEqual({ label: "Chế độ chạy", value: "Diễn tập, không gửi đơn thật" });

  await page.getByRole("navigation", { name: "Ứng dụng đăng ký", exact: true }).getByRole("link", { name: "ChineseTest", exact: true }).click();
  await expect(page).toHaveURL(/\/chinesetest$/);
  await expect(panel).toBeVisible();
  await expect(panel.getByRole("log")).toContainText("Mục tiêu: Chuẩn bị HSK 5");
  await page.getByRole("button", { name: "Nhập mã liên kết", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "Liên kết ChineseTest Runner", exact: true });
  await expect(dialog).toHaveAttribute("aria-modal", "false");
  await dialog.getByLabel("Mã liên kết").fill("secret-pair-value");
  await panel.getByRole("textbox", { name: "Câu hỏi của bạn" }).fill("Màn hình này đang chờ gì?");
  await panel.getByRole("button", { name: "Gửi câu hỏi", exact: true }).click();
  await expect(panel.getByRole("log")).toContainText("Đang cùng bạn ở ChineseTest");
  expect(requests.at(-1).companion.page.dialogs).toContain("Liên kết ChineseTest Runner");
  expect(requests.at(-1).companion.page.facts).toContainEqual({ label: "ChineseTest Runner", value: "Chưa chọn máy" });
  expect(JSON.stringify(requests)).not.toContain("secret-pair-value");
  expect(requests.at(-1).history.some((turn: any) => turn.text.includes("Chuẩn bị HSK 5"))).toBe(true);
  await dialog.getByRole("button", { name: "Đóng", exact: true }).click();
  await panel.getByRole("button", { name: "Đóng trợ lý", exact: true }).click();
  await page.getByRole("button", { name: "Trợ lý AI", exact: true }).click();
  await expect(panel.getByRole("log")).toContainText("Màn hình này đang chờ gì?");
  modelAvailable = false;
  await panel.getByRole("button", { name: "Mình nên làm gì tiếp?", exact: true }).click();
  await expect(panel.getByRole("log")).toContainText("Bước tiếp theo: Mở ChineseTest Runner");
  await expect(panel.getByText("Từ màn hình", { exact: true })).toBeVisible();
  await page.setViewportSize({ width: 390, height: 844 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
  await mkdir("test-results/assistant", { recursive: true });
  await page.screenshot({ path: "test-results/assistant/companion-mobile.png" });
  await page.setViewportSize({ width: 1440, height: 1050 });
  await page.screenshot({ path: "test-results/assistant/companion-desktop.png" });

  // Dedicated HCMUE chat receives the same goal and page context, plus its existing diagnostics.
  await panel.getByRole("button", { name: "Đóng trợ lý", exact: true }).click();
  await page.goto(app.config.origin + "/hcmue");
  await page.getByRole("button", { name: "Trợ lý HCMUE", exact: true }).click();
  const hcmue = page.getByRole("dialog", { name: "Trợ lý HCMUE", exact: true });
  await hcmue.getByRole("button", { name: "Mình nên làm gì tiếp?", exact: true }).click();
  await expect(hcmue.getByRole("log")).toContainText("Mục tiêu đang theo: Chuẩn bị HSK 5");
  expect(requests.at(-1).companion.page.path).toBe("/hcmue");
  expect(requests.at(-1).companion.page.facts.some((fact: any) => fact.label === "HCMUE Runner")).toBe(true);
  expect(requests.at(-1).context).toBeDefined();
  await page.getByRole("button", { name: "Liên kết máy", exact: true }).click();
  const pair = page.getByRole("dialog", { name: "Liên kết máy chạy", exact: true });
  await expect(pair).toBeVisible();
  await expect(hcmue).toBeVisible();
  const blocked = pair.getByRole("button", { name: "Liên kết", exact: true });
  await expect(blocked).toBeDisabled();
  await blocked.dispatchEvent("pointerdown");
  await expect(hcmue.getByRole("region", { name: "Đồng hành trên trang" })).toContainText("Chưa nhập mã liên kết");
  await hcmue.getByRole("button", { name: "Chỉ vị trí", exact: true }).click();
  await expect(page.locator('.guide-spotlight[data-companion-focus=true] .guide-halo')).toBeVisible();
  await page.setViewportSize({ width: 390, height: 844 });
  const [pairBox, chatBox] = await Promise.all([pair.boundingBox(), hcmue.boundingBox()]);
  expect(pairBox!.y + pairBox!.height).toBeLessThan(chatBox!.y);
  await page.screenshot({ path: "test-results/assistant/companion-dialog-mobile.png" });
  await pair.getByRole("button", { name: "Đóng", exact: true }).click();
  await page.goto(app.config.origin + "/account");
  await page.getByRole("button", { name: "Đăng xuất", exact: true }).first().click();
  await expect(page.getByRole("button", { name: "Tiếp tục với Google", exact: true })).toBeVisible();
  expect(await page.evaluate(() => Object.keys(sessionStorage).filter(key => key.startsWith("hanu-companion-v1:")))).toEqual([]);
  expect(errors).toEqual([]);
  console.log("PASS companion UI: live context, shared goal, navigation and reopen memory, dialog access, sensitive input exclusion, offline model fallback, HCMUE and mobile.");
} finally {
  await browser.close(); await app.close();
}
