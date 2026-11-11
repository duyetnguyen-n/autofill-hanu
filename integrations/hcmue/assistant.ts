import type { RunStatus, Schedule } from "./protocol";

export const assistantActions = ["prepare", "edit", "arm", "reconcile"] as const;
export type AssistantAction = typeof assistantActions[number];
export interface AssistantProposal {
  action: AssistantAction;
  exam?: string;
  target?: string;
  test?: boolean;
}
export interface RunSummary {
  status: RunStatus;
  test: boolean;
  outcome: "not_sent" | "attempted" | "confirmed";
  targetAt: string;
  sentAt?: string;
  httpStatus?: number;
  events?: { kind: string; at: string; reason?: string; httpStatus?: number; catalogStatus?: string; open?: boolean; full?: boolean; schoolTime?: string }[];
}
export interface AssistantContext {
  noticeCode?: string;
  runnerConnected?: boolean;
  liveEnabled?: boolean;
  run?: RunSummary;
  inspection?: { checkedAt: string; passed: number; total: number; issues?: { check: string; code: string }[] };
}
export interface AssistantReply {
  answer: string;
  source: "model" | "guide";
  references: { id: string; title: string; href?: string }[];
  proposal?: AssistantProposal;
}

export function summarizeRun(s: Schedule): RunSummary {
  const { attempt } = s;
  return {
    status: s.status,
    test: s.test,
    outcome: !s.test && s.status === "pending_payment" && attempt.registrationCode
      ? "confirmed"
      : !s.test && (attempt.sentAt || attempt.count > 0) ? "attempted" : "not_sent",
    targetAt: s.targetAt,
    sentAt: s.test ? undefined : attempt.sentAt,
    httpStatus: s.test ? undefined : attempt.httpStatus,
  };
}

export function runResultText(run: RunSummary) {
  if (run.test) return "Đây là lịch diễn tập. Runner không gửi đơn đăng ký thật.";
  if (run.outcome === "confirmed") return "HCMUE đã xác nhận đăng ký. Xem mã đơn và hạn thanh toán trong mục Lịch gửi và kết quả.";
  if (run.outcome === "attempted") return "Runner đã thử gửi. Chưa có xác nhận đăng ký. Hãy kiểm tra kết quả trên HCMUE trước khi gửi lại.";
  if (run.status === "uncertain" || run.status === "sending" || run.status === "queued")
    return "Dữ liệu hiện có chưa đủ để xác định yêu cầu đã gửi hay chưa.";
  return "Chưa ghi nhận lần gửi yêu cầu đăng ký thật.";
}

export function runObservation(run: RunSummary) {
  const opening = run.events?.find(event => event.kind === "opening_check");
  if (!opening) return;
  const at = opening.schoolTime
    ? ` (giờ máy chủ HCMUE ${new Date(opening.schoolTime).toLocaleTimeString("vi-VN", { timeZone: "Asia/Ho_Chi_Minh", hour12: false })})`
    : "";
  if (opening.full) return `Ở lần kiểm tra gần nhất, HCMUE báo đợt thi đã đủ chỗ${at}.`;
  if (opening.open === false) return `Ở lần kiểm tra gần nhất, đợt thi chưa đủ điều kiện mở${at}.`;
}
