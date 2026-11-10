import { describe, expect, it, vi } from "vitest";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { answerAssistant, DEFAULT_ASSISTANT_MODEL } from "../../integrations/hcmue/cloud/assistant";
import { retrieveGuides } from "../../integrations/hcmue/cloud/assistant-knowledge";
import { runResultText, summarizeRun } from "../../integrations/hcmue/assistant";
import { scheduleEvents } from "../../integrations/hcmue/runner/diagnostics";
import type { Schedule } from "../../integrations/hcmue/protocol";

describe("HCMUE assistant", () => {
  it("prioritizes the notice and finds Vietnamese queries without accents", () => {
    expect(retrieveGuides("Sao chưa thấy mã đơn?", "HC-PHIEN")[0].id).toBe("login");
    expect(retrieveGuides("em dang ki duoc chua")[0].id).toBe("result");
    expect(retrieveGuides("giúp tôi")[0]).toBeUndefined();
  });

  it("offers local guidance and a typed action when the model is unavailable", async () => {
    const send = vi.fn<typeof fetch>().mockResolvedValue(new Response(null, { status: 429 }));
    const reply = await answerAssistant({ message: "Tạo lịch HSK 5 diễn tập" }, { apiKey: "fixture-key", send });
    expect(reply).toMatchObject({ source: "guide", proposal: { action: "prepare", exam: "HSK 5", test: true } });
    expect(reply.references[0].id).toBe("prepare");
  });

  it("sends only selected diagnostic fields and discards unknown model actions", async () => {
    const send = vi.fn<typeof fetch>().mockResolvedValue(Response.json({
      choices: [{ message: { content: JSON.stringify({ answer: "Xem báo cáo.", proposal: { action: "execute_sql" } }) } }],
    }));
    const reply = await answerAssistant({
      message: "Giải thích. Email an@example.test và mật khẩu: secret-password",
      context: {
        noticeCode: "HC-DOI-CHIEU",
        cccd: "fixture-identity",
        run: { status: "uncertain", targetAt: "2026-11-10T08:00:00.000Z", test: false, outcome: "confirmed", token: "fixture-token", events: [
          { kind: "opening_error", at: "2026-11-10T08:00:00.000Z", httpStatus: 503, raw: "fixture-raw" },
        ] },
      },
    }, { apiKey: "fixture-key", send });
    const request = JSON.parse(String(send.mock.calls[0][1]?.body));
    expect(request).toMatchObject({ model: DEFAULT_ASSISTANT_MODEL, provider: { data_collection: "deny" } });
    const sent = request.messages[1].content as string;
    expect(sent).not.toMatch(/an@example.test|secret-password|fixture-identity|fixture-token|fixture-raw/);
    expect(JSON.parse(sent).context.run).toMatchObject({ outcome: "not_sent", events: [{ kind: "opening_error", httpStatus: 503 }] });
    expect(reply).toMatchObject({ source: "model", answer: "Xem báo cáo." });
    expect(reply.proposal).toBeUndefined();
  });

  it("distinguishes simulated, unconfirmed and confirmed attempts without exposing a registration code", () => {
    const targetAt = "2026-11-10T08:00:00.000Z";
    const schedule = (fields: Pick<Schedule, "status" | "test" | "attempt">) => summarizeRun({ targetAt, ...fields } as Schedule);
    const unsent = schedule({ status: "failed", test: false, attempt: { count: 0 } });
    const uncertain = schedule({ status: "uncertain", test: false, attempt: { count: 1 } });
    const simulated = schedule({ status: "stopped", test: true, attempt: { count: 1, sentAt: targetAt } });
    const confirmed = schedule({ status: "pending_payment", test: false, attempt: { count: 1, registrationCode: "private-registration" } });
    expect(runResultText(unsent)).toContain("Chưa ghi nhận lần gửi");
    expect(runResultText(uncertain)).toContain("Chưa có xác nhận");
    expect(runResultText(simulated)).toContain("diễn tập");
    expect(runResultText(confirmed)).toContain("đã xác nhận đăng ký");
    expect(JSON.stringify(confirmed)).not.toContain("private-registration");
  });

  it("reads only the requested run across both diagnostic files", async () => {
    const dir = await mkdtemp(join(tmpdir(), "hcmue-summary-"));
    const at = "2026-11-10T08:00:00.000Z";
    try {
      await writeFile(join(dir, "diagnostics.jsonl.1"), JSON.stringify({ event: "preflight_ready", scheduleId: "run-a", at }) + "\n");
      await writeFile(join(dir, "diagnostics.jsonl"), [
        { event: "schedule_dispatch", scheduleId: "run-b", at },
        { event: "opening_check", scheduleId: "run-a", at, full: true, raw: "private-school-data" },
        { event: "api_result", scheduleId: "run-a", at, httpStatus: 200 },
      ].map(item => JSON.stringify(item)).join("\n") + "\n{\"scheduleId\":\"run-a\"");
      const events = await scheduleEvents(dir, "run-a");
      expect(events.map(e => e.kind)).toEqual(["preflight_ready", "opening_check"]);
      expect(events[1]).toMatchObject({ full: true });
      expect(JSON.stringify(events)).not.toContain("private-school-data");
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});
