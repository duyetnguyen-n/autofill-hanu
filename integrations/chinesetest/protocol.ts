export const ORIGIN = "https://www.chinesetest.cn";
export const MAX_ACCOUNTS = 20;
export const COMMANDS = ["state", "login", "finish-login", "cancel-login", "remove", "catalog", "read-profile", "stage-profile", "start-profile-sync", "profile-sync-status", "quote-fee", "inspect", "save-profile", "save-plan", "upload-photo", "prepare", "arm", "stop", "stop-all", "reconcile", "verify-absent"] as const;
export type Command = typeof COMMANDS[number];
export type Row = Record<string, any>;
export type { Device, Limits, EncryptedBox, CommandReply } from "../hcmue/protocol";
export interface SecretCommand { issuedAt: number; commandId: string; command: Command; args: Row; replyKey: string }
export interface Target {
  projectId: string; kmId: string; ksType: string; ksDate: string;
  center: string; centerName?: string; targetAt: number; waitMs: number;
  intervalMs: number; maxFee?: number; currency?: string; acceptLinked: boolean; language: string;
  feeQuote?: FeeQuote;
}
export interface FeeQuote { key: string; amount: number; currency: string; linked: string[] }
export const feeKey = (t: Pick<Target,"projectId"|"kmId"|"ksType"|"ksDate"|"center">) => JSON.stringify([t.projectId,t.kmId,t.ksType,t.ksDate,t.center]);
export interface CloudProfile {
  personal: Personal; revision: number; photoKey: string | null; photoVersion: string | null;
  photoMime: string | null; syncedPhotoVersion: string | null; chineseTestPhoto: string;
  status: "draft" | "synced"; updatedAt: string;
}
export type ProfileSyncPhase="queued"|"checking-session"|"uploading"|"saving"|"done"|"failed";
export interface ProfileSyncStatus { id:string; accountId:string; phase:ProfileSyncPhase; error?:string; result?:{personal:Personal;photoVersion:string|null} }
export interface Personal {
  ksEName: string; ksName: string; birthday: string; ksSex: string; gjId: string;
  ksCountry: string; ksNation: string; idType: string; idNo: string; phone: string;
  photo: string; fid: string; firstLanguage: string; studyYear: string; pfId: string;
  address: string; isExamHsk: "" | "0" | "1"; kmidHis: string; fenshuHis: string;
}
export interface AccountView { id: string; email: string; name: string; maskedId: string; hasPhoto: boolean; loggedIn: boolean }
export type Status = "prepared" | "armed" | "waiting_center" | "checking" | "reserved" | "sending" | "queued" | "accepted" | "confirmed" | "uncertain" | "failed" | "stopped" | "test_passed" | "released";
export interface Run {
  id: string; accountId: string; accountKey: string; target: Target; personal: Personal;
  test: boolean; status: Status; message: string; version: number; updatedAt: number;
  attempt: { sentAt?: number; receivedAt?: number; lateMs?: number; orderNo?: string; orderKey?: string; bmid?: string; jfEndDate?: string; count: number; fee?: number; currency?: string };
  identityHash: string; verifiedAbsent?: boolean; verifiedAbsentAt?: number;
}
export interface Plan { target: Target; test: boolean }
export interface RunnerState { protocolVersion: number; profileSyncVersion?: number; profileSyncJobsVersion?:number; deviceId: string; name: string; platform: string; accounts: AccountView[]; schedules: Omit<Run, "personal" | "identityHash" | "accountKey">[]; plans: Record<string,Plan>; loginPending: boolean; now: string; eventLoopLagMs: number }
export const activeStatus = (s: Status) => ["armed", "waiting_center", "checking", "reserved", "sending", "queued"].includes(s);
export const statusLabel: Record<Status, string> = { prepared: "Sẵn sàng", armed: "Đã bật lịch", waiting_center: "Chờ điểm thi mở", checking: "Đang kiểm tra", reserved: "Đã khóa gửi", sending: "Đang gửi", queued: "Máy chủ đang xử lý", accepted: "Đã tạo đơn", confirmed: "Đã có mã đăng ký", uncertain: "Chưa rõ kết quả", failed: "Cần xử lý", stopped: "Đã dừng", test_passed: "Test đạt, không gửi đơn", released: "Đã xác minh và mở khóa" };
export const personalFields = ["ksEName", "ksName", "birthday", "ksSex", "gjId", "ksCountry", "ksNation", "idType", "idNo", "phone", "photo", "fid", "firstLanguage", "studyYear", "pfId", "address", "isExamHsk", "kmidHis", "fenshuHis"] as const;
export function personalFrom(input: Row): Personal {
  const result = Object.fromEntries(personalFields.map(k => [k, String(input[k] ?? (k === "pfId" ? input.pfid : "") ?? "").trim()])) as unknown as Personal;
  if (!["", "0", "1"].includes(result.isExamHsk)) throw new Error("Lịch sử HSK không hợp lệ.");
  return result;
}
export function validatePersonal(p: Personal) {
  const labels: Partial<Record<keyof Personal, string>> = { ksEName: "họ tên", birthday: "ngày sinh", ksSex: "giới tính", gjId: "quốc tịch", ksCountry: "tên quốc tịch", idType: "loại giấy tờ", idNo: "số giấy tờ", phone: "điện thoại", fid: "tiếng mẹ đẻ", firstLanguage: "tên tiếng mẹ đẻ" };
  const missing = Object.entries(labels).filter(([k]) => !p[k as keyof Personal]).map(([, label]) => label);
  if (missing.length) throw new Error(`Hồ sơ thiếu: ${missing.join(", ")}.`);
  if (!validDate(p.birthday)) throw new Error("Ngày sinh không hợp lệ.");
  if (!validPhotoPath(p.photo)) throw new Error("Ảnh chưa đồng bộ sang ChineseTest. Mở Hồ sơ / ảnh và bấm Lưu hồ sơ để đồng bộ.");
}
export const validPhotoPath = (value: unknown): value is string => typeof value === "string" && Boolean(value.trim()) && !/^(?:[a-z]+:|\/\/)/i.test(value) && !value.includes("..");
export function validDate(value: string) { const d = new Date(`${value}T00:00:00Z`); return /^\d{4}-\d{2}-\d{2}$/.test(value) && Number.isFinite(d.getTime()) && d.toISOString().slice(0, 10) === value; }
export function validateTarget(t: Target) {
  if (!/^\d+$/.test(t.projectId) || !/^\d+$/.test(t.kmId) || !["1", "2", "4"].includes(t.ksType)) throw new Error("Chọn đúng loại, cấp và hình thức thi.");
  if (!validDate(t.ksDate) || !t.center?.trim()) throw new Error("Cần ngày thi và đúng tên/mã điểm thi.");
  if (!Number.isFinite(t.targetAt) || !Number.isFinite(t.waitMs) || t.waitMs < 1000 || t.waitMs > 120 * 60000 || !Number.isFinite(t.intervalMs) || t.intervalMs < 0 || t.intervalMs > 60000) throw new Error("Giờ mở hoặc khoảng chờ không hợp lệ (kiểm tra 0–60 giây, chờ tối đa 120 phút).");
  if (t.feeQuote && (t.feeQuote.key !== feeKey(t) || !Number.isFinite(t.feeQuote.amount) || t.feeQuote.amount < 0 || !/^[A-Z]{3}$/.test(t.feeQuote.currency))) throw new Error("Cấu hình kỳ thi đã đổi. Chờ lấy lại lệ phí trước khi tiếp tục.");
  // Accept older saved plans until they are replaced by a server fee quote.
  if (t.maxFee !== undefined && (!Number.isFinite(t.maxFee) || t.maxFee < 0 || !/^[A-Z]{3}$/.test(t.currency || ""))) throw new Error("Lệ phí của cấu hình cũ không hợp lệ. Tải lại lệ phí.");
}
export const DONG_A: Target = { projectId: "13", kmId: "828636", ksType: "2", ksDate: "2026-12-13", center: "46750135", centerName: "Dong A University（IBT）", targetAt: 0, waitMs: 600000, intervalMs: 1000, maxFee: 60, currency: "USD", acceptLinked: true, language: "" };
export const fingerprintInput = (jwk: JsonWebKey) => JSON.stringify({ kty: jwk.kty, n: jwk.n, e: jwk.e });
