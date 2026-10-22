import { createHash } from "node:crypto";
import { personalFrom, validatePersonal, validateTarget, type Row, type Target, type Personal } from "../protocol";
import type { ChineseTestClient } from "./client";
const text = (v: unknown) => String(v ?? "").trim();
const same = (a: unknown, b: unknown) => text(a) === text(b);
const normal = (v: unknown) => text(v).normalize("NFKC").replace(/\s+/g, " ").toLowerCase();
export const candidateKey = (accountKey: string, _p: Personal, t: Target) => createHash("sha256").update(JSON.stringify([accountKey, t.kmId, t.ksDate])).digest("hex");
export function centerFrom(rows: Row[], t: Target): Row | undefined {
  const rowsForTarget = rows.filter(r => same(r.kdId, t.center) || normal(r.kdName) === normal(t.center) || normal(r.kdEName) === normal(t.center));
  if (rowsForTarget.length > 1) throw new Error("Điểm thi trùng tên. Dùng mã điểm thi để chọn chính xác.");
  return rowsForTarget[0];
}
export function buildPayload(t: Target, p: Personal, center: Row, linkedId: string) {
  validateTarget(t); validatePersonal(p);
  return { ...personalFrom(p), kmId: t.kmId, ksType: t.ksType, ksDate: t.ksDate, kdId: String(center.kdId), jlKmId: linkedId, willing: 0, remark: "", language: t.language || "", mailInfo: { mid: "", mailSum: 1 } };
}
export interface Inspection { ready: boolean; reason: string; center?: Row; fee?: number; currency?: string; linked?: Row; payload?: Row }
export async function inspectTarget(client: ChineseTestClient, t: Target, personal: Personal, sites: Row[], checkpoint = () => {}): Promise<Inspection> {
  validateTarget(t); validatePersonal(personal); checkpoint();
  const center = centerFrom(sites, t);
  if (!center) return { ready: false, reason: "Điểm thi chưa xuất hiện cho đúng ngày/cấp/hình thức." };
  if (!center.kdId || !center.gjId) throw new Error("Điểm thi thiếu mã/quốc gia; cấu trúc API đã đổi.");
  if (same(center.gjId, 1)) throw new Error("Điểm thi Trung Quốc đại lục cần xác minh riêng; chưa hỗ trợ bản này.");
  if (["13", "16"].includes(t.projectId) && t.ksType !== "4" && String(center.tyFlag || "").split(",").includes("mail_yes")) throw new Error("Điểm thi bắt buộc gửi kết quả qua bưu điện; chưa hỗ trợ bản này.");
  const query = { kmId: t.kmId, kdId: String(center.kdId), ksType: t.ksType };
  // These are independent reads. No POST may be made by an inspection.
  const [full, europe, linked, fees] = await Promise.all([
    client.call("/examinee/enroll/juadgeFullBm", { kdid: center.kdId, kmid: t.kmId, kstime: t.ksDate, kstype: t.ksType }),
    client.call(`/examinee/enroll/getOzKd/${center.kdId}/${t.ksDate}/${t.kmId}`),
    client.call("/examinee/enroll/getJiLianList", { ...query, ksTime: t.ksDate }),
    client.call("/examinee/enroll/getKsFees", { ...query, ksDate: t.ksDate }),
  ]);
  checkpoint();
  if (![true, 1, "1"].includes(full.data)) return { ready: false, reason: "Điểm thi chưa cho đăng ký hoặc đã hết chỗ.", center };
  if ([true, 1, "1"].includes(europe.data)) throw new Error("Điểm thi dùng hệ thống eu.chinesetest.cn riêng.");
  const group = linked.data;
  if (!group || typeof group.jiLian !== "boolean" || (group.jiLian && !Array.isArray(group.jiList))) throw new Error("Cấu trúc môn đi kèm đã đổi.");
  let linkedId = "";
  if (group.jiLian) {
    if (!t.acceptLinked) throw new Error("Kỳ thi yêu cầu môn đi kèm. Cần chấp nhận môn này trước khi bật lịch.");
    if (group.jiList.length !== 1 || !group.jiList[0]?.jlKmId) throw new Error("Cần kiểm tra thủ công danh sách môn đi kèm.");
    linkedId = String(group.jiList[0].jlKmId);
    await client.call("/examinee/enroll/validJiLian", { ...query, jlKmId: linkedId, ksDate: t.ksDate });
  } else if (["16", "24"].includes(t.projectId)) {
    const extra = await client.call("/examinee/enroll/hskJiLian", { ...query, ksTime: t.ksDate });
    if (extra.data && !t.acceptLinked) throw new Error("Có môn/phí bắt buộc đi kèm; cần chấp nhận trước.");
  }
  checkpoint();
  if (t.projectId === "24" || ["60202043", "60202044", "60202045", "60202046"].includes(linkedId)) {
    if (!["0", "1"].includes(personal.isExamHsk)) throw new Error("Cần khai báo đã từng thi HSK hay chưa cho môn Speaking.");
    if (personal.isExamHsk === "1" && (!personal.kmidHis || !personal.fenshuHis || !Number.isFinite(Number(personal.fenshuHis)) || Number(personal.fenshuHis) < 0)) throw new Error("Cần cấp HSK và điểm đã thi trước đây.");
  }
  const fee = fees.data;
  const currency = text(center.mTypeCode).toUpperCase();
  if (!["number", "string"].includes(typeof fee) || fee === "" || !Number.isFinite(Number(fee)) || Number(fee) < 0) throw new Error("API không trả lệ phí hợp lệ.");
  if (currency !== t.currency) throw new Error(`Đơn vị lệ phí là ${currency || "không rõ"}, khác ${t.currency} đã chọn.`);
  if (Number(fee) > t.maxFee) throw new Error(`Phí cuối ${fee} ${currency} vượt mức ${t.maxFee} ${t.currency}.`);
  return { ready: true, reason: "API kiểm tra đạt; chưa gửi đăng ký.", center, fee: Number(fee), currency, linked: group, payload: buildPayload(t, personal, center, linkedId) };
}
export async function existingRegistration(client: ChineseTestClient, t: Target): Promise<Row | undefined> {
  // Read all rows in scope; don't infer "absent" from an unparsed or truncated list.
  const result = await client.records();
  if (!Array.isArray(result.rows) || !Number.isSafeInteger(Number(result.total)) || Number(result.total) < 0 || Number(result.total) !== result.rows.length) throw new Error("Chưa đối chiếu được toàn bộ Test Records; không gửi đăng ký.");
  for (const row of result.rows) {
    const km = row.KSXM_kmid ?? row.kmId;
    const date = text(row.KDZX_kaoshitime ?? row.ksDate).slice(0, 10);
    if (km == null || !/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new Error("Cấu trúc Test Records đã đổi; cần đối chiếu thủ công.");
    if (same(km, t.kmId) && date === t.ksDate) return row;
  }
}
