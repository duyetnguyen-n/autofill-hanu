import { expect, it, vi } from "vitest";
import { createRunTracker, trackingIntent, type TrackingFeed, type TrackingRun } from "../manager/ui/assistant/tracking";
import { chineseRuns, formRuns, hcmueRuns } from "../manager/ui/assistant/run-observations";
import { currentPageAnswer, readCompanionContext } from "../manager/assistant/context";
import { leaksObservationDetails } from "../manager/assistant/voice";
import { answerSystemAssistant } from "../manager/assistant/answer";

const run = (id = "run-a", phase: TrackingRun["phase"] = "prepared", account = "a"): TrackingRun => ({ id, account, label: "HSK 5 · 18:30", phase, test: false });
const feed = (runs = [run()], other: Partial<TrackingFeed> = {}): TrackingFeed => ({ source: "chinesetest:machine-a", provider: "chinesetest", connected: true, checkedAt: new Date().toISOString(), selected: [], runs, ...other });

it("reports actual milestones and a final result once, without treating submission as success", () => {
  const tracker = createRunTracker(undefined, vi.fn(), () => true);
  tracker.observe(feed()); tracker.start();
  expect(tracker.get().updates[0].text).toContain("chưa bật");
  for (const phase of ["waiting", "checking", "checking", "sending", "pending"] as const) tracker.observe(feed([run("run-a", phase)]));
  expect(tracker.get().updates).toHaveLength(5);
  expect(tracker.get().updates.at(-1)?.text).toContain("chưa thấy xác nhận");
  expect(tracker.get().watch?.active).toBe(true);
  tracker.observe(feed([run("run-a", "confirmed")]));
  for (let i = 0; i < 10; i++) tracker.observe(feed([run("run-a", "confirmed")]));
  expect(tracker.get().updates.filter(item => item.kind === "result")).toHaveLength(1);
  expect(tracker.get().watch?.active).toBe(false);
});

it("requires a choice for multiple schedules and never follows another runner or stale result", () => {
  const tracker = createRunTracker(undefined, vi.fn(), () => false);
  tracker.observe(feed([run("first"), run("second", "prepared", "b")]));
  expect(tracker.start()).toContain("chọn lịch");
  expect(tracker.get().watch).toBeUndefined();
  tracker.start(["second"]);
  tracker.observe(feed([run("first", "confirmed"), run("second", "waiting", "b")]));
  expect(tracker.get().updates.some(item => item.kind === "result")).toBe(false);
  tracker.observe(feed([run("second", "confirmed", "b")], { source: "chinesetest:wrong-machine" }));
  expect(tracker.get().watch?.paused).toBe(true);
  expect(tracker.get().updates.some(item => item.kind === "result")).toBe(false);
  tracker.observe(feed([run("second", "confirmed", "b")], { checkedAt: new Date(Date.now() - 120000).toISOString() }));
  expect(tracker.get().watch?.active).toBe(true);
  const count = tracker.get().updates.length;
  tracker.observe(feed([run("second", "confirmed", "b")], { connected: false }));
  expect(tracker.get().updates).toHaveLength(count);
  tracker.observe(feed([run("second", "confirmed", "b")]));
  expect(tracker.get().watch?.active).toBe(false);
  expect(tracker.get().unread).toBeGreaterThan(0); tracker.read();
  expect(tracker.get().unread).toBe(0);
});

it("restores a watch without repeating old milestones and stop only stops observation", () => {
  const first = createRunTracker(undefined, vi.fn(), () => false);
  first.observe(feed([run("run-a", "sending")])); first.start();
  const saved = JSON.parse(JSON.stringify(first.get()));
  const restored = createRunTracker(saved, vi.fn(), () => false);
  restored.observe(feed([run("run-a", "sending")]));
  expect(restored.get().updates).toHaveLength(first.get().updates.length);
  const state = feed([run("run-a", "pending")]); restored.observe(state);
  expect(restored.stop()).toContain("Lịch trên Runner vẫn giữ nguyên");
  restored.observe(feed([run("run-a", "confirmed")]));
  expect(restored.get().updates.some(item => item.kind === "result")).toBe(false);
  expect(state.runs[0].phase).toBe("pending");
});

it("binds future runs to each selected account without finishing before the rest arrive", () => {
  const tracker = createRunTracker(undefined, vi.fn(), () => true);
  tracker.observe(feed([], { selected: ["a", "b"] })); tracker.start();
  tracker.observe(feed([run("new-a", "confirmed")], { selected: ["a", "b"] }));
  expect(tracker.get().watch?.active).toBe(true);
  tracker.observe(feed([run("new-a", "confirmed"), run("new-b", "waiting", "b")], { selected: ["a", "b"] }));
  expect(tracker.get().watch?.ids).toEqual(["new-a", "new-b"]);
  tracker.observe(feed([run("new-a", "confirmed"), run("new-b", "confirmed", "b")]));
  expect(tracker.get().watch?.active).toBe(false);
  expect(tracker.get().updates.filter(item => item.kind === "result")).toHaveLength(2);
});

it("does not claim monitoring when there is no selected machine or target", () => {
  const tracker = createRunTracker(undefined, vi.fn(), () => true);
  tracker.observe(feed([], { source: "chinesetest:unselected" }));
  expect(tracker.start()).toContain("chọn và kết nối máy");
  tracker.observe(feed([]));
  expect(tracker.start()).toContain("chọn tài khoản");
  expect(tracker.get().watch).toBeUndefined();
  expect(trackingIntent("Sắp đki 18h30 rồi, theo dõi giúp mình nhé")).toBe("start");
  expect(trackingIntent("Làm sao để theo dõi lịch?")).toBeUndefined();
  expect(trackingIntent("Theo dõi Facebook để săn link")).toBeUndefined();
  expect(trackingIntent("Thông báo kết quả ở đâu?")).toBeUndefined();
  expect(trackingIntent("Không cần theo dõi nữa")).toBeUndefined();
  expect(trackingIntent("Dừng theo dõi giúp mình")).toBe("stop");
});

it("requires provider confirmation evidence and keeps raw identities and registration codes out of observations", () => {
  const chinese: any = { schedules: [{ id: "one", accountId: "a", target: { targetAt: Date.now() }, status: "confirmed", test: false, attempt: {}, personal: { idNo: "identity-secret" } }] };
  expect(chineseRuns(chinese)[0].phase).toBe("uncertain");
  chinese.schedules[0].attempt.bmid = "private-registration-code";
  expect(chineseRuns(chinese)[0].phase).toBe("confirmed");
  expect(JSON.stringify(chineseRuns(chinese))).not.toMatch(/identity-secret|private-registration-code/);
  const hcmue: any = { schedules: [{ id: "two", accountId: "b", exam: { ten_cap_thi: "HSK 5" }, targetAt: new Date().toISOString(), status: "pending_payment", test: false, attempt: {} }] };
  expect(hcmueRuns(hcmue)[0].phase).toBe("uncertain");
  hcmue.schedules[0].attempt.registrationCode = "private-code";
  expect(hcmueRuns(hcmue)[0].phase).toBe("confirmed");
  hcmue.schedules[0] = { ...hcmue.schedules[0], test: true, status: "stopped", attempt: { count: 1, receivedAt: new Date().toISOString() } };
  expect(hcmueRuns(hcmue)[0].phase).toBe("simulated");
  const forms: any = [{ id: "profile", run: { runId: "run", status: "completed", mode: "live", submitAttempted: false } }];
  expect(formRuns(forms, false)[0].phase).toBe("uncertain");
  forms[0].run.submitAttempted = true;
  expect(formRuns(forms, false)[0].phase).toBe("confirmed");
});

it("rejects the reported robotic output and points at the actual runner launcher, never navigation", async () => {
  const companion = readCompanionContext({ page: { path: "/chinesetest", capturedAt: new Date().toISOString(), controls: [
    { id: "c-13", label: "Máy chạy", disabled: false, purpose: "navigate" },
    { id: "c-22", label: "Mở runner trên máy này", disabled: false, purpose: "launch-runner" },
  ] } })!;
  const send = vi.fn<typeof fetch>(async () => Response.json({ choices: [{ message: { content: JSON.stringify({ answer: "Bạn nhấn Máy chạy (control ID c-13). capturedAt: 2026-11-14T09:48:32.399Z, disabled: false.", focusControlId: "c-13" }) } }] }));
  const reply = await answerSystemAssistant({ message: "Mở ChineseTest Runner ở đâu?", companion }, { apiKey: "fixture", send });
  expect(reply.source).toBe("context");
  expect(reply.focus?.id).toBe("c-22");
  expect(leaksObservationDetails(reply.answer)).toBe(false);
  expect(reply.answer).toContain("Mở runner trên máy này");
  companion.page.controls = companion.page.controls.filter(item => item.purpose === "navigate");
  expect(currentPageAnswer(companion, "Mở Runner").focus).toBeUndefined();
});
