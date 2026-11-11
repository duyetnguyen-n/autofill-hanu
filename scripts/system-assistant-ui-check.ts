import { chromium, expect, type Page } from "@playwright/test";
import { mkdir } from "node:fs/promises";
import { resolve } from "node:path";
import { PerspectiveCamera, Vector3 } from "three";
import { httpFixture, users } from "../tests/cloud/fixture";
import { projectVectors } from "../integrations/hcmue/ui/vector-layout";
import type { KnowledgeMapPoint } from "../integrations/hcmue/knowledge/documents";

const app = await httpFixture(resolve("build/cloud-ui"), true, true, true, async (url, init) => {
  if (!String(url).endsWith("/embeddings")) return new Response(null, { status: 429 });
  const body = JSON.parse(String(init?.body)) as { input: string[] };
  return Response.json({ data: body.input.map((_, index) => ({
    index, embedding: Array.from({ length: 12 }, (_, dimension) => Math.sin((index + 1) * 2.399 + dimension * (index % 5 + .5)) + .12 * (dimension % 4)),
  })) });
});
await app.pool.query("UPDATE hanu.accounts SET role='admin' WHERE user_id=$1", [users[0]]);
const browser = await chromium.launch({
  channel: process.platform === "win32" ? "msedge" : "chrome", headless: true,
  args: ["--use-angle=swiftshader", "--enable-unsafe-swiftshader"],
});
await mkdir("test-results/assistant", { recursive: true });
try {
  const context = await browser.newContext({ viewport: { width: 1440, height: 1050 }, reducedMotion: "reduce", colorScheme: "light" });
  const page = await context.newPage(), errors: string[] = [];
  page.on("pageerror", error => errors.push(error.message));
  await page.goto(app.config.origin);
  await page.getByRole("button", { name: "Tiếp tục với Google", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Quản lý các phiên", exact: true })).toBeVisible();
  async function openChat(p: Page, path: string, heading: string, question: string, answer: string) {
    await p.goto(app.config.origin + path);
    const background = p.getByRole("heading", { name: heading, exact: true });
    await expect(background).toBeVisible();
    await p.getByRole("button", { name: "Trợ lý AI", exact: true }).click();
    const panel = p.getByRole("dialog", { name: "Trợ lý HANU", exact: true });
    await expect(panel).toHaveAttribute("aria-modal", "false");
    await expect(background).toBeVisible();
    await expect(p.locator("#root")).not.toHaveAttribute("aria-hidden", "true");
    await panel.getByRole("textbox", { name: "Câu hỏi của bạn" }).fill(question);
    await panel.getByRole("button", { name: "Gửi câu hỏi" }).click();
    await expect(panel.getByRole("log")).toContainText(answer);
    await expect(panel.getByRole("navigation", { name: "Nguồn tham khảo" }).getByRole("link").first()).toBeVisible();
    return panel;
  }
  let panel = await openChat(page, "/", "Quản lý các phiên", "Chuẩn bị profile", "Chuẩn bị profile Google Forms");
  await page.screenshot({ path: "test-results/assistant/chat-desktop.png", animations: "disabled" });
  await panel.getByRole("button", { name: "Mở rộng trợ lý" }).click();
  await expect(panel).toHaveAttribute("data-expanded", "true");
  await page.keyboard.press("Escape");
  await expect(page.getByRole("button", { name: "Trợ lý AI", exact: true })).toBeFocused();
  await openChat(page, "/google-direct", "Quản lý các phiên", "Google Forms Direct dùng thế nào?", "Google Forms Direct");
  await openChat(page, "/chinesetest", "Chuẩn bị trước giờ mở.", "Kết nối ChineseTest", "Kết nối và chuẩn bị ChineseTest");
  await openChat(page, "/admin", "Người dùng", "Xem bản đồ vector ở đâu?", "Kho tri thức và bản đồ vector");
  await openChat(page, "/account", "Không gian của bạn đã sẵn sàng.", "Quyền sử dụng", "Tài khoản, quyền truy cập và quyền Live");
  await page.goto(app.config.origin + "/hcmue");
  await expect(page.getByRole("heading", { name: "Sẵn sàng trước giờ mở." })).toBeVisible();
  await page.getByRole("button", { name: "Trợ lý HCMUE", exact: true }).click();
  const hcmue = page.getByRole("dialog", { name: "Trợ lý HCMUE" });
  await expect(hcmue).toHaveAttribute("aria-modal", "false");
  await expect(page.locator(".hc-app")).toHaveCount(1);
  await expect(page.getByRole("heading", { name: "Sẵn sàng trước giờ mở." })).toBeVisible();
  await hcmue.getByRole("textbox").fill("Google Forms Direct");
  await hcmue.getByRole("button", { name: "Gửi câu hỏi" }).click();
  await expect(hcmue.getByRole("log")).toContainText("Google Forms Direct");
  await hcmue.getByRole("button", { name: "Đóng trợ lý" }).click();
  await page.getByRole("link", { name: "Kho tri thức & vector", exact: true }).first().click();
  await expect(page).toHaveURL(/\/knowledge$/);
  await expect(page.getByRole("heading", { name: "Không gian tri thức.", exact: true })).toBeVisible();
  await expect(page.getByText("Chờ những điểm tri thức đầu tiên")).toBeVisible();
  await page.getByRole("button", { name: "Lập chỉ mục bài có sẵn", exact: true }).click();
  await expect(page.getByText(/Đã lập chỉ mục các bài/)).toBeVisible();
  const canvas = page.locator("canvas[aria-label='Bản đồ vector 3D']");
  await expect(canvas).toBeVisible();
  const raw = await (await app.api("knowledge/map")).json() as KnowledgeMapPoint[];
  expect(raw.length).toBeGreaterThan(10);
  const projected = projectVectors(raw), box = (await canvas.boundingBox())!;
  const camera = new PerspectiveCamera(40, box.width / box.height, .1, 100);
  camera.position.set(6, 4.4, 8); camera.lookAt(0, 0, 0); camera.updateMatrixWorld();
  const selectedPoint = projected[3], position = new Vector3(...selectedPoint.position).project(camera);
  await page.mouse.click(box.x + (position.x + 1) * box.width / 2, box.y + (1 - position.y) * box.height / 2);
  await expect(page.getByLabel("Đoạn đang xem")).toHaveValue(selectedPoint.id);
  await page.mouse.move(box.x + box.width * .5, box.y + box.height * .52);
  await page.mouse.down(); await page.mouse.move(box.x + box.width * .6, box.y + box.height * .4, { steps: 6 }); await page.mouse.up();
  await page.getByRole("button", { name: "Đặt lại góc nhìn" }).click();
  await page.screenshot({ path: "test-results/assistant/vector-desktop.png", fullPage: true, animations: "disabled" });
  await page.getByRole("button", { name: "2D", exact: true }).click();
  await expect(canvas).toHaveCount(0);
  await page.getByLabel("Lọc phạm vi").selectOption("forms");
  await expect(page.getByRole("group", { name: "Bản đồ vector tài liệu" }).getByRole("button")).toHaveCount(3);
  await page.getByLabel("Lọc phạm vi").selectOption("all");
  await page.getByRole("button", { name: "Thử truy xuất", exact: true }).click();
  await page.getByLabel("Câu hỏi thử").fill("Google Forms Direct");
  await page.getByRole("button", { name: "So sánh kết quả" }).click();
  await expect(page.getByText(/Thời gian truy xuất/)).toBeVisible();
  await expect(page.getByRole("heading", { name: /Vector/ }).last()).toBeVisible();

  // Simulate browsers with no WebGL and invalid response bodies from a partial deployment.
  const mobile = await context.newPage();
  mobile.on("pageerror", error => errors.push(error.message));
  await mobile.setViewportSize({ width: 390, height: 844 });
  await mobile.addInitScript(() => {
    const original = HTMLCanvasElement.prototype.getContext;
    HTMLCanvasElement.prototype.getContext = function (type: string, ...args: unknown[]) {
      return type.startsWith("webgl") ? null : Reflect.apply(original, this, [type, ...args]);
    } as typeof original;
  });
  await mobile.goto(app.config.origin + "/knowledge");
  await expect(mobile.getByText(/Thiết bị không hỗ trợ WebGL/)).toBeVisible();
  expect(await mobile.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
  await mobile.screenshot({ path: "test-results/assistant/vector-mobile.png", fullPage: true, animations: "disabled" });
  panel = await openChat(mobile, "/", "Quản lý các phiên", "Xem bản đồ vector", "Kho tri thức và bản đồ vector");
  await mobile.route("**/api/assistant/chat", route => route.fulfill({ status: 200, json: { answer: "Câu trả lời không có danh sách nguồn" } }), { times: 1 });
  await panel.getByRole("textbox").fill("Test dữ liệu thiếu nguồn");
  await panel.getByRole("button", { name: "Gửi câu hỏi" }).click();
  await expect(panel.getByRole("log")).toContainText("Câu trả lời không có danh sách nguồn");
  await mobile.route("**/api/assistant/chat", route => route.fulfill({ status: 502, body: "<html>502</html>" }), { times: 1 });
  await panel.getByRole("textbox").fill("Test khi API lỗi");
  await panel.getByRole("button", { name: "Gửi câu hỏi" }).click();
  await expect(panel.getByRole("alert")).toContainText("Máy chủ chưa trả câu trả lời hợp lệ");
  await expect(mobile.getByRole("heading", { name: "Quản lý các phiên" })).toBeVisible();
  expect(await mobile.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
  expect(errors).toEqual([]);
  console.log("PASS system AI across all workspaces, intact HCMUE background, 3D picking and camera, 2D fallback, upload index, comparison and broken API responses.");
} finally {
  await browser.close();
  await app.close();
}
