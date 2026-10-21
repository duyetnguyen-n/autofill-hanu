/** HCMUE is a separate provider; never reuse Google Forms commands or run state. */
export const HCMUE_ORIGIN = "https://hsk.hcmue.edu.vn";
export const MAX_ACCOUNTS = 20;
export type RunStatus =
  | "draft"
  | "prepared"
  | "armed"
  | "reserved"
  | "sending"
  | "queued"
  | "pending_payment"
  | "failed"
  | "uncertain"
  | "stopped";
export interface Exam {
  ma_cap_thi: string;
  ten_cap_thi: string;
  ngay_mo_dang_ky: string;
  ngay_ket_thuc_dang_ky: string;
  ngay_thi: string;
  hasRegisterCode: number;
  trang_thai: string;
  so_luong: number;
  so_luong_toi_da: number;
  phi: number | string;
  dia_diem_code?: string;
  dia_diem_name?: string;
}
export interface Question {
  ma_cau_hoi: number;
  noi_dung: string;
  cau_tra_loi: { ma_cau_tra_loi: number | string; noi_dung: string }[];
}
export interface Questions {
  success: boolean;
  open_exam: { hasRegisterCode: number };
  questions: Question[];
}
export interface Identity {
  key: string;
  name: string;
  maskedId: string;
  email: string;
  hasPhoto: boolean;
  verified: boolean;
}
export interface HcmueAccount {
  id: string;
  identity: Identity;
  loggedIn: boolean;
}
export interface Attempt {
  sentAt?: string;
  receivedAt?: string;
  elapsedMs?: number;
  latenessMs?: number;
  httpStatus?: number;
  jobId?: string;
  registrationCode?: string;
  paymentDeadline?: string;
  message?: string;
  count: number;
}
export interface Schedule {
  id: string;
  accountKey: string;
  accountId: string;
  exam: Exam;
  targetAt: string;
  answers: Record<string, string>;
  questionSignature: string;
  status: RunStatus;
  version: number;
  attempt: Attempt;
  preparedAt: number;
  expiresAt: number;
  test: boolean;
}
export interface RunnerState {
  deviceId: string;
  name: string;
  platform: string;
  accounts: HcmueAccount[];
  schedules: Schedule[];
  now: string;
  eventLoopLagMs: number;
  awake: boolean;
}
export type Command =
  | "state"
  | "login"
  | "logout"
  | "remove"
  | "exams"
  | "prepare"
  | "arm"
  | "stop"
  | "stop-all"
  | "reconcile";
export const COMMANDS: Command[] = [
  "state",
  "login",
  "logout",
  "remove",
  "exams",
  "prepare",
  "arm",
  "stop",
  "stop-all",
  "reconcile",
];
export interface Limits {
  maxAccounts: number;
  maxConcurrent: number;
  liveEnabled: boolean;
  expiresAt: number;
}
export interface EncryptedBox {
  iv: string;
  data: string;
  key?: string;
}
export interface SecretCommand {
  issuedAt: number;
  commandId: string;
  command: Command;
  args: Record<string, unknown>;
  replyKey: string;
}
export interface CommandReply {
  ok: boolean;
  data?: unknown;
  error?: string;
}
export interface Device {
  id: string;
  name: string;
  platform: string;
  publicKey: JsonWebKey;
  fingerprint: string;
  connected: boolean;
  lastSeen: string;
  createdAt: string;
}
export function examKey(e: Pick<Exam, "ma_cap_thi" | "ngay_mo_dang_ky">) {
  return JSON.stringify([e.ma_cap_thi, e.ngay_mo_dang_ky]);
}
export function schoolTime(value: string) {
  const iso = value.replace(" ", "T");
  return Date.parse(/(?:Z|[+-]\d\d:?\d\d)$/i.test(iso) ? iso : `${iso}+07:00`);
}
export function fingerprintInput(jwk: JsonWebKey) {
  return JSON.stringify({ kty: jwk.kty, n: jwk.n, e: jwk.e });
}
export function questionSignature(q: Questions) {
  if (
    q?.success !== true ||
    !Array.isArray(q.questions) ||
    q.open_exam?.hasRegisterCode !== 0
  )
    throw new Error("Chưa hỗ trợ cấu trúc câu hỏi hoặc diện liên kết này.");
  const ids = new Set<number>();
  for (const item of q.questions) {
    if (
      !Number.isSafeInteger(item.ma_cau_hoi) ||
      ids.has(item.ma_cau_hoi) ||
      typeof item.noi_dung !== "string" ||
      !Array.isArray(item.cau_tra_loi)
    )
      throw new Error("Cấu trúc câu hỏi không hợp lệ.");
    ids.add(item.ma_cau_hoi);
    const choices = new Set<string>();
    for (const a of item.cau_tra_loi) {
      if (
        a.ma_cau_tra_loi == null ||
        typeof a.noi_dung !== "string" ||
        choices.has(String(a.ma_cau_tra_loi))
      )
        throw new Error("Lựa chọn không hợp lệ.");
      choices.add(String(a.ma_cau_tra_loi));
    }
  }
  return JSON.stringify({
    success: true,
    open_exam: { hasRegisterCode: 0 },
    questions: q.questions.map((item) => ({
      ma_cau_hoi: item.ma_cau_hoi,
      noi_dung: item.noi_dung,
      cau_tra_loi: item.cau_tra_loi.map((a) => ({
        ma_cau_tra_loi: a.ma_cau_tra_loi,
        noi_dung: a.noi_dung,
      })),
    })),
  });
}
export function payload(
  exam: Exam,
  q: Questions,
  answers: Record<string, string>,
) {
  questionSignature(q);
  return {
    ma_cap_thi: exam.ma_cap_thi,
    ngay_mo_dang_ky: exam.ngay_mo_dang_ky,
    answers: q.questions.map((item) => {
      const answer = item.cau_tra_loi.find(
        (a) => String(a.ma_cau_tra_loi) === answers[String(item.ma_cau_hoi)],
      );
      if (!answer) throw new Error(`Cần trả lời: ${item.noi_dung}`);
      return { ma_cau_hoi: item.ma_cau_hoi, noi_dung_tra_loi: answer.noi_dung };
    }),
  };
}
export const statusLabel: Record<RunStatus, string> = {
  draft: "Chưa chuẩn bị",
  prepared: "Sẵn sàng",
  armed: "Đã bật lịch",
  reserved: "Sắp gửi",
  sending: "Đang gửi",
  queued: "Trong hàng đợi",
  pending_payment: "Chờ thanh toán",
  failed: "Cần xử lý",
  uncertain: "Chưa rõ kết quả",
  stopped: "Đã dừng",
};
export const activeStatus = (s: RunStatus) =>
  ["armed", "reserved", "sending", "queued"].includes(s);
