import type { RunnerState as ChineseState } from "../../../integrations/chinesetest/protocol";
import type { RunnerState as HcmueState } from "../../../integrations/hcmue/protocol";
import type { SessionView } from "../../../src/protocol";
import { safeCompanionText } from "../../assistant/context";
import type { TrackingRun, TrackingPhase } from "./tracking";

const clock = (at: string | number) => Number.isFinite(new Date(at).getTime()) ? new Date(at).toLocaleTimeString("vi-VN", { timeZone: "Asia/Ho_Chi_Minh", hour: "2-digit", minute: "2-digit", hour12: false }) : "chưa rõ giờ";
export function chineseRuns(state: ChineseState | undefined): TrackingRun[] {
  return (state?.schedules ?? []).slice(-100).map((run, index) => {
    let phase: TrackingPhase = ({ prepared: "prepared", armed: "waiting", waiting_center: "checking", checking: "checking", reserved: "checking", sending: "sending", queued: "pending", accepted: "pending", confirmed: "uncertain", uncertain: "uncertain", failed: "failed", stopped: "stopped", test_passed: "simulated", released: "stopped" } as const)[run.status];
    if (run.status === "confirmed" && !run.test && run.attempt.bmid) phase = "confirmed";
    if (run.test && phase === "confirmed") phase = "uncertain";
    const account = safeCompanionText(state?.accounts?.find(item => item.id === run.accountId)?.name, 60) || `Lịch ${index + 1}`;
    return { id: run.id, account: run.accountId, label: `${account} · ${clock(run.target.targetAt)}${run.test ? " · diễn tập" : ""}`, phase, test: run.test, detail: phase === "failed" ? safeCompanionText(run.message, 180) : undefined };
  });
}
export function hcmueRuns(state: HcmueState | undefined): TrackingRun[] {
  return (state?.schedules ?? []).slice(-100).map(run => {
    let phase: TrackingPhase = ({ draft: "prepared", prepared: "prepared", armed: "waiting", reserved: "checking", sending: "sending", queued: "pending", pending_payment: "uncertain", uncertain: "uncertain", failed: "failed", stopped: "stopped" } as const)[run.status];
    if (!run.test && run.status === "pending_payment" && run.attempt.registrationCode) phase = "confirmed";
    if (run.test && run.status === "stopped" && run.attempt.receivedAt && run.attempt.count > 0) phase = "simulated";
    const account = safeCompanionText(state?.accounts?.find(item => item.id === run.accountId)?.identity.name, 50);
    return { id: run.id, account: run.accountId, label: `${account ? account + " · " : ""}${safeCompanionText(run.exam.ten_cap_thi, 40)} · ${clock(run.targetAt)}${run.test ? " · diễn tập" : ""}`, phase, test: run.test, detail: phase === "failed" ? safeCompanionText(run.attempt.message, 180) : undefined };
  });
}
export function formRuns(sessions: SessionView[], direct: boolean): TrackingRun[] {
  return sessions.flatMap((session, index) => {
    const run = session.run;
    if (!run?.runId || (run.engine === "direct") !== direct) return [];
    let phase: TrackingPhase = ({ idle: "stopped", running: "checking", paused: "manual", waiting_manual: "manual", ready_to_submit: "simulated", submitting: "sending", completed: "uncertain", submit_uncertain: "uncertain", failed: "failed" } as const)[run.status];
    if (run.status === "completed" && run.mode === "live" && run.submitAttempted) phase = "confirmed";
    if (run.status === "ready_to_submit" && run.mode !== "test") phase = "manual";
    if (run.status === "completed" && run.mode === "test") phase = "simulated";
    return [{ id: run.runId, account: session.id, label: `${safeCompanionText(session.name, 60) || `Profile ${index + 1}`}${session.hskLevel ? ` · HSK ${session.hskLevel}` : ""}${run.mode === "test" ? " · diễn tập" : ""}`, phase, test: run.mode === "test", detail: phase === "manual" || phase === "failed" ? safeCompanionText(run.blockingIssue?.message ?? session.error, 180) : undefined }];
  });
}
