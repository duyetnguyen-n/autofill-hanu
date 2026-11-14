// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { createCompanion } from "../manager/ui/assistant/companion";
import { asksAboutCurrentPage, readCompanionContext } from "../manager/assistant/context";

let stop: (() => void) | undefined;
beforeEach(() => {
  sessionStorage.clear(); history.replaceState(null, "", "/");
  vi.spyOn(HTMLElement.prototype, "getClientRects").mockReturnValue([{ width: 100, height: 30 }] as unknown as DOMRectList);
  document.body.innerHTML = `
    <h1>Quản lý</h1><label>Email<input type="email" value="private@example.com"></label>
    <label>Mật khẩu<input type="password" value="never-upload-this"></label>
    <label>Kỳ thi<select><option>private-option@example.com</option></select></label>
    <p id="blocked">Kết nối Runner trước khi bật lịch.</p>
    <button disabled aria-describedby="blocked">Bật lịch</button>
    <button id="check">Kiểm tra trạng thái</button>
    <a href="/chinesetest">ChineseTest</a>
    <div hidden><p role="alert">Thông báo đã ẩn</p></div>
    <aside class="ai-panel"><p role="alert">Không được tự quan sát câu trả lời AI</p><button>Gửi câu hỏi</button></aside>`;
});
afterEach(() => { stop?.(); stop = undefined; vi.restoreAllMocks(); document.body.innerHTML = ""; });

it("observes the actual blocked control and labels without reading any form values or AI output", () => {
  const companion = createCompanion("owner"); stop = companion.start();
  companion.report("runner", [{ label: "Runner", value: "Mất kết nối" }]);
  const button = document.querySelector<HTMLButtonElement>("button[disabled]")!;
  button.dispatchEvent(new Event("pointerdown", { bubbles: true }));
  const context = companion.read();
  expect(context.page.controls.find(item => item.id === context.page.focusedControl)).toMatchObject({ label: "Bật lịch", disabled: true, reason: "Kết nối Runner trước khi bật lịch." });
  expect(companion.resolve(context.page.focusedControl!)).toBe(button);
  expect(context.page.facts).toEqual([{ label: "Runner", value: "Mất kết nối" }]);
  const input = document.querySelector<HTMLInputElement>('input[type=email]')!;
  input.dispatchEvent(new Event("change", { bubbles: true }));
  const select = document.querySelector("select")!;
  select.dispatchEvent(new Event("change", { bubbles: true }));
  expect(companion.read().events.at(-1)?.label).toBe("Đã sửa: Kỳ thi");
  expect(JSON.stringify(companion.read())).not.toMatch(/private@|private-option@|never-upload|đã ẩn|câu trả lời AI|Gửi câu hỏi/);
  expect(companion.read().page.controls.find(item => item.label === "Kỳ thi")).toBeDefined();
  button.remove(); expect(companion.resolve(context.page.focusedControl!)).toBeUndefined();
});

it("reads new outcomes, avoids recording password edits and refreshes stale observations on demand", async () => {
  const companion = createCompanion("owner"); stop = companion.start();
  document.getElementById("check")!.click();
  document.querySelector('input[type=password]')!.dispatchEvent(new Event("change", { bubbles: true }));
  const notice = document.createElement("p"); notice.setAttribute("role", "alert"); notice.textContent = "Lưu thất bại. Email private@example.com";
  document.body.append(notice);
  await new Promise(resolve => setTimeout(resolve, 250));
  expect(companion.getSnapshot().context.page.notices).toEqual(["Lưu thất bại. Email [email đã ẩn]"]);
  expect(companion.read().events.filter(item => item.kind === "change")).toHaveLength(0);
  expect(companion.read().events.at(-1)).toMatchObject({ kind: "notice", path: "/" });
  const read = companion.read();
  expect(readCompanionContext(read)).toBeDefined();
  expect(readCompanionContext({ ...read, page: { ...read.page, capturedAt: new Date(Date.now() - 6 * 60_000).toISOString() } })).toBeUndefined();
});

it("keeps goals, conversation and recent actions across internal navigation, isolated by account", () => {
  const first = createCompanion("owner"); stop = first.start();
  first.setGoal("Chuẩn bị HSK 5");
  first.remember([{ role: "user", text: "Mình cần tạo lịch. token: private-key" }]);
  first.setOpen(true);
  const link = document.querySelector("a")!;
  link.addEventListener("click", event => event.preventDefault()); link.click();
  stop(); stop = undefined;
  history.replaceState(null, "", "/chinesetest");
  const next = createCompanion("owner"); stop = next.start();
  expect(next.shouldResume()).toBe(true);
  expect(next.getSnapshot().context.goal).toBe("Chuẩn bị HSK 5");
  expect(next.getSnapshot().turns).toEqual([{ role: "user", text: "Mình cần tạo lịch. token: [đã ẩn]" }]);
  expect(next.read().events.some(item => item.path === "/" && item.label.includes("ChineseTest"))).toBe(true);
  expect(createCompanion("another-owner").getSnapshot().turns).toEqual([]);
  expect(createCompanion("another-owner").read().goal).toBe("");
  // A row-level 401 can be transient; only confirmed logout/session expiry clears memory.
  window.dispatchEvent(new Event("hanu-auth-expired"));
  expect(next.read().goal).toBe("Chuẩn bị HSK 5");
  window.dispatchEvent(new Event("hanu-session-ended"));
  expect(sessionStorage.getItem("hanu-companion-v1:owner")).toBeNull();
});

it("validates every field, caps observations and strips unknown data before model use", () => {
  expect(asksAboutCurrentPage("nut nay sao khong bam duoc?")).toBe(true);
  expect(asksAboutCurrentPage("Lỗi này xử lý sao?")).toBe(true);
  expect(asksAboutCurrentPage("HC-06")).toBe(false);
  const controls = Array.from({ length: 50 }, (_, i) => ({ id: `c-${i}`, label: "Chuẩn bị", disabled: true, reason: "password: keep-secret", value: "secret-value" }));
  const result = readCompanionContext({
    page: { path: "/hcmue", capturedAt: new Date().toISOString(), controls, focusedControl: "evil-selector", cookies: "session-secret", facts: [{ label: "Email", value: "private@example.com", raw: "private-data" }] },
    events: [{ kind: "click", path: "/hcmue?token=secret", at: new Date().toISOString(), label: "bad" }],
    goal: "token: private-key", commands: ["arm"],
  })!;
  expect(result.page.controls).toHaveLength(12);
  expect(result.page.focusedControl).toBeUndefined();
  expect(result.events).toEqual([]);
  expect(JSON.stringify(result)).not.toMatch(/keep-secret|secret-value|session-secret|private-data|private-key|private@example/);
  expect(readCompanionContext({ page: { path: "/account?token=secret", capturedAt: new Date().toISOString() } })).toBeUndefined();
});
it("includes the actual latest monitoring result in the next model context and clears it on logout", () => {
  const companion = createCompanion("owner"); stop = companion.start();
  const feed = { source: "chinesetest:machine-a", provider: "chinesetest" as const, connected: true, checkedAt: new Date().toISOString(), selected: [],
    runs: [{ id: "run", account: "account", label: "Lịch HSK 5", phase: "sending" as const, test: false }] };
  companion.reportRuns(feed); companion.startTracking();
  companion.reportRuns({ ...feed, runs: [{ ...feed.runs[0], phase: "confirmed" }] });
  expect(companion.read().tracking).toMatchObject({ active: false, latestUpdate: expect.stringContaining("Đã có xác nhận đăng ký") });
  window.dispatchEvent(new Event("hanu-session-ended"));
  expect(companion.read().tracking).toEqual({ active: false, summary: "" });
  expect(companion.getSnapshot().tracking.updates).toEqual([]);
});
