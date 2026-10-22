import { Agent, request } from "node:https";
import { createHash, randomUUID } from "node:crypto";
import { CookieJar } from "tough-cookie";
import { ORIGIN, type Row } from "../protocol";

export interface Session { token: string; cookies: string; email: string; key: string }
export class ApiError extends Error { constructor(message: string, public code?: number, public retryAfterMs?: number) { super(message); } }
export const requestSignature = (stamp: number) => createHash("md5").update("http://new.chinesetest.cn752f03ca0ef1b621fa4e" + stamp).digest("hex").toUpperCase();
export class ChineseTestClient {
  private agent: Agent;
  private jar: CookieJar;
  constructor(private session?: Session, private origin = ORIGIN, fixtureCa?: string) {
    if (origin !== ORIGIN && !(process.env.CHINESETEST_FIXTURE === "1" && /^https:\/\/localhost:\d+$/.test(origin))) throw new Error("API chỉ cho phép máy chủ ChineseTest.");
    if (fixtureCa && origin === ORIGIN) throw new Error("Không thay đổi TLS ChineseTest.");
    this.agent = new Agent({ keepAlive: true, maxSockets: 6, maxFreeSockets: 4, rejectUnauthorized: true, ...(fixtureCa ? { ca: fixtureCa } : {}) });
    this.jar = session ? CookieJar.deserializeSync(session.cookies) : new CookieJar();
  }
  async call(path: string, params?: Row, body?: Row | Buffer, contentType = "application/json"): Promise<Row> {
    if (!/^\/[a-zA-Z0-9_/?=&.,-]+$/.test(path) || path.includes("..") || path.startsWith("//")) throw new Error("Đường dẫn API không hợp lệ.");
    const stamp = await this.raw("/common/get_safe_stamp", undefined, undefined, Date.now());
    if (Number(stamp.code) !== 200 || !Number.isFinite(stamp.data) || Math.abs(stamp.data - Date.now()) > 60000) throw new ApiError("Không xác minh được thời gian máy chủ. Kiểm tra đồng hồ máy và kết nối.", Number(stamp.code));
    const result = await this.raw(path, params, body, stamp.data, contentType);
    const message = String(result.msg || result.message || "request không được chấp nhận").slice(0, 400);
    const safe = /token|password|authorization|cookie|bearer|eyJ/i.test(message) ? "Request bị từ chối; kiểm tra trong ChineseTest" : message;
    if (Number(result.code) !== 200) throw new ApiError([401, 403].includes(Number(result.code)) ? "Phiên ChineseTest hết hạn. Đăng nhập lại trước khi chạy." : `ChineseTest: ${safe} (${result.code ?? "không có mã"}).`, Number(result.code));
    return result;
  }
  private async raw(path: string, params: Row | undefined, body: Row | Buffer | undefined, stamp: number, contentType = "application/json"): Promise<Row> {
    const url = new URL("/chinesetestwebapi" + path, this.origin);
    for (const [k, v] of Object.entries(params || {})) if (v !== undefined && v !== null && v !== "") url.searchParams.set(k, String(v));
    const bytes = body === undefined ? undefined : Buffer.isBuffer(body) ? body : Buffer.from(JSON.stringify(body));
    const headers: Record<string, string> = { Accept: "application/json, text/plain, */*", "Content-Type": contentType, "User-Language": "en", Origin: ORIGIN, Referer: ORIGIN + "/kaoshibaoming", "Access-Ch-Ref-Stamp": String(stamp), "Access-Ch-Ref-Site": requestSignature(stamp) };
    if (this.session) headers.Authorization = `Bearer ${this.session.token}`;
    const cookie = await this.jar.getCookieString(url.href); if (cookie) headers.Cookie = cookie;
    if (bytes) headers["Content-Length"] = String(bytes.length);
    return new Promise((resolve, reject) => {
      let settled = false;
      let deadline: ReturnType<typeof setTimeout>;
      const fail = (error: ApiError) => { if (!settled) { settled = true; clearTimeout(deadline); reject(error); } };
      const req = request(url, { method: bytes ? "POST" : "GET", agent: this.agent, headers }, res => {
        const chunks: Buffer[] = []; let size = 0;
        const cookies = Promise.all((res.headers["set-cookie"] || []).map(c => this.jar.setCookie(c, url.href)));
        void cookies.catch(() => {});
        res.on("data", chunk => { size += chunk.length; if (size > 4 * 1024 * 1024) { fail(new ApiError("Phản hồi ChineseTest quá lớn.")); req.destroy(); } else chunks.push(chunk); });
        res.on("aborted", () => fail(new ApiError("Phản hồi bị ngắt; cần đối chiếu nếu đã gửi đơn.")));
        res.on("error", () => fail(new ApiError("Mất kết nối khi đọc phản hồi.")));
        res.on("end", () => { void (async () => {
          if (settled) return;
          await cookies;
          const retry = res.headers["retry-after"];
          const retryAfter = retry ? (/^\d+$/.test(String(retry)) ? Number(retry) * 1000 : Math.max(0, Date.parse(String(retry)) - Date.now())) : undefined;
          if ((res.statusCode || 500) >= 300) { fail(new ApiError(`ChineseTest HTTP ${res.statusCode}.`, res.statusCode, retryAfter)); return; }
          let data: Row; try { data = JSON.parse(Buffer.concat(chunks).toString("utf8")); } catch { fail(new ApiError("ChineseTest không trả JSON hợp lệ.")); return; }
          if (!data || typeof data !== "object" || Array.isArray(data)) { fail(new ApiError("Cấu trúc API đã đổi.")); return; }
          settled = true; clearTimeout(deadline); resolve(data);
        })().catch(() => fail(new ApiError("Không lưu được phiên phản hồi."))); });
      });
      deadline = setTimeout(() => { fail(new ApiError("API quá thời gian chờ; cần đối chiếu nếu đã gửi đơn.")); req.destroy(); }, 15000);
      req.setTimeout(15000, () => { fail(new ApiError("API quá thời gian chờ; không gửi lại đơn tự động.")); req.destroy(); });
      req.on("error", () => fail(new ApiError("Không kết nối được ChineseTest; kiểm tra trạng thái trước khi gửi lại.")));
      if (bytes) req.end(bytes); else req.end();
    });
  }
  async identity() {
    const r = await this.call("/userInfo/getInfo");
    const d = r.data;
    if (!d || typeof d !== "object") throw new ApiError("Chưa đọc được danh tính tài khoản.");
    const email = String(d.userEmail || d.email || d.userInfo?.userEmail || "").trim().toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new ApiError("Không xác định được email tài khoản.");
    if (this.session?.email && email !== this.session.email.toLowerCase()) throw new ApiError("Phiên không khớp tài khoản đã chọn.");
    return { email, key: createHash("sha256").update(email).digest("hex") };
  }
  profile() { return this.call("/examinee/enroll/getLastBm"); }
  options() { return this.call("/portal/index/getOptionList"); }
  subjects(projectId: string) { return this.call("/portal/index/getSubjectList", { projectId }); }
  dates(kmId: string, ksType: string) { return this.call("/examinee/enroll/getExamTimeList", { kmId, ksType }); }
  sites(kmId: string, ksType: string, ksDate: string) { return this.call("/examinee/enroll/getExamSiteList", { kmId, ksType, ksDate }); }
  records() { return this.call("/userInfo/examRecord/list", { pageNum: 1, pageSize: 100 }); }
  submit(payload: Row) { return this.call("/examinee/enroll/submitPersonalInfo", undefined, payload); }
  order(key: string) { if (!/^[A-Za-z0-9_,.-]+$/.test(key)) throw new Error("Khóa tra cứu không hợp lệ."); return this.call("/examinee/enroll/selectOrder/" + key); }
  async upload(bytes: Buffer, type: string) {
    if (bytes.length <= 15 * 1024 || bytes.length >= 1024 * 1024 || !["image/jpeg", "image/png"].includes(type)) throw new Error("Ảnh cần là JPG/PNG lớn hơn 15 KB và nhỏ hơn 1 MB theo giao diện ChineseTest.");
    const jpeg = bytes[0] === 0xff && bytes[1] === 0xd8;
    const png = bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
    if ((type === "image/jpeg" && !jpeg) || (type === "image/png" && !png)) throw new Error("Nội dung ảnh không đúng định dạng.");
    const boundary = "ChineseTest" + randomUUID().replaceAll("-", "");
    const body = Buffer.concat([Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="photo.${jpeg ? "jpg" : "png"}"\r\nContent-Type: ${type}\r\n\r\n`), bytes, Buffer.from(`\r\n--${boundary}--\r\n`)]);
    const r = await this.call("/common/upload", undefined, body, `multipart/form-data; boundary=${boundary}`);
    if (typeof r.data !== "string" || !r.data || /^(?:[a-z]+:|\/\/)/i.test(r.data) || r.data.includes("..")) throw new ApiError("Upload không trả đường dẫn ảnh hợp lệ.");
    return r.data;
  }
  async exportSession() { if (!this.session) throw new Error("Chưa có phiên."); return { ...this.session, cookies: JSON.stringify(await this.jar.serialize()) }; }
  close() { this.agent.destroy(); }
}
