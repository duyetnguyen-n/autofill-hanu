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
export interface Inspection {
  checkedAt: string;
  exam: Exam;
  checks: { label: string; ok: boolean; message: string }[];
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
  protocolVersion?: number;
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
  | "inspect"
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
  "inspect",
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
export function schoolDate(value: string) {
  const ms = schoolTime(value);
  return Number.isFinite(ms)
    ? new Date(ms).toLocaleString("vi-VN", { timeZone: "Asia/Ho_Chi_Minh", hour12: false })
    : value;
}
/** Local interpretation only; never replace or filter the school's fields. */
export function examObservation(exam: Exam, now: number) {
  const opens = schoolTime(exam.ngay_mo_dang_ky), closes = schoolTime(exam.ngay_ket_thuc_dang_ky);
  const notes: string[] = [];
  if (!Number.isFinite(opens) || !Number.isFinite(closes) || closes <= opens)
    notes.push("Chưa đọc được khoảng thời gian đăng ký");
  else if (now >= closes) notes.push("Đã quá hạn theo thời gian");
  else if (now < opens) notes.push("Chưa đến giờ mở");
  else notes.push("Đang trong khoảng thời gian đăng ký");
  if (Number(exam.so_luong) >= Number(exam.so_luong_toi_da)) notes.push("Số chỗ đã đủ theo API");
  return notes.join(" · ");
}
export function scheduleProblem(exam: Exam, target: number, now: number, test: boolean) {
  if (!test) {
    const opens = schoolTime(exam.ngay_mo_dang_ky), closes = schoolTime(exam.ngay_ket_thuc_dang_ky);
    if (!Number.isFinite(opens) || !Number.isFinite(closes) || closes <= opens)
      return "Trường trả thời gian mở/đóng không hợp lệ. Vẫn có thể xem và kiểm tra API.";
    if (now >= closes) return `Đợt này đã đóng lúc ${schoolDate(exam.ngay_ket_thuc_dang_ky)}. Chọn đợt khác để đăng ký thật.`;
    if (target < opens) return `Giờ gửi phải từ ${schoolDate(exam.ngay_mo_dang_ky)} khi trường mở đăng ký.`;
    if (target >= closes) return `Giờ gửi phải trước ${schoolDate(exam.ngay_ket_thuc_dang_ky)} khi trường đóng đăng ký.`;
    if (Number(exam.so_luong) >= Number(exam.so_luong_toi_da)) return "Trường đang trả số chỗ đã đủ. Tải lại kỳ thi để kiểm tra trước khi chuẩn bị đăng ký thật.";
    if (exam.hasRegisterCode !== 0 || !["open", "upcoming"].includes(exam.trang_thai))
      return `Trạng thái trường trả về: ${exam.trang_thai}. Đợt này chưa đủ điều kiện đăng ký thật theo luồng thí sinh tự do.`;
  }
  if (!Number.isFinite(target)) return "Chọn ngày và giờ gửi hợp lệ theo giờ Việt Nam.";
  if (target < now + 6000) return "Giờ gửi đã qua hoặc còn dưới 6 giây. Chọn giờ mới để đủ thời gian chuẩn bị và bật lịch.";
  if (target > now + 7 * 86400000) return "Chỉ bật lịch trong 7 ngày tới. Bạn vẫn có thể xem kỳ thi và kiểm tra API ngay.";
  return undefined;
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
