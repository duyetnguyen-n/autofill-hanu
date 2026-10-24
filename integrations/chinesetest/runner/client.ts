import { Agent, request } from "node:https";
import { createHash, randomUUID } from "node:crypto";
import { CookieJar } from "tough-cookie";
import { ORIGIN, type Row, type Portrait } from "../protocol";

export interface Session { token: string; cookies: string; email: string; key: string }
export type ApiFailure = "auth" | "identity" | "transient" | "protocol" | "api";
export class ApiError extends Error {
  constructor(message: string, public code?: number, public retryAfterMs?: number, public kind: ApiFailure = code === 401 ? "auth" : code === 429 || code != null && code >= 500 ? "transient" : "api", public stage?: "clock" | "identity" | "registration" | "order" | "upload" | "read") { super(message); }
}
export const invalidSession = (e: unknown) => e instanceof ApiError && ["auth", "identity"].includes(e.kind);
export const transientFailure = (e: unknown) => e instanceof ApiError && e.kind === "transient";
const requestStage = (path:string):ApiError["stage"] => path === "/common/get_safe_stamp" ? "clock" : path === "/userInfo/getInfo" ? "identity" : path.includes("submitPersonalInfo") ? "registration" : path.includes("selectOrder/") ? "order" : path === "/common/upload" ? "upload" : "read";
const transportMessage = (path:string, timeout=false) => {
  const stage=requestStage(path),reason=timeout?"quá thời gian chờ":"kết nối bị gián đoạn";
  if(stage==="registration")return `Gửi đăng ký ${reason}. Cần đối chiếu kết quả; không gửi lại đơn tự động.`;
  if(stage==="clock")return `Chưa lấy được giờ máy chủ ChineseTest (${reason}). Chưa thực hiện bước tiếp theo.`;
  if(stage==="identity")return `Chưa kiểm tra được phiên đăng nhập ChineseTest (${reason}). Thử lại khi kết nối ổn định.`;
  if(stage==="upload")return `ChineseTest chưa xác nhận tải ảnh (${reason}). Chưa báo tải ảnh thành công; bạn có thể thử lại.`;
  return `Chưa đọc được dữ liệu ChineseTest (${reason}). Thử lại khi kết nối ổn định.`;
};
export interface ClientTiming { readTimeoutMs:number; uploadTimeoutMs:number; retryDelayMs:number }
const DEFAULT_TIMING:ClientTiming={readTimeoutMs:20000,uploadTimeoutMs:60000,retryDelayMs:500};
export const requestSignature = (stamp: number) => createHash("md5").update("http://new.chinesetest.cn752f03ca0ef1b621fa4e" + stamp).digest("hex").toUpperCase();
export class ChineseTestClient {
  private agent: Agent;
  private jar: CookieJar;
  private timing:ClientTiming;
  constructor(private session?: Session, private origin = ORIGIN, fixtureCa?: string, fixtureTiming?: Partial<ClientTiming>) {
    if (origin !== ORIGIN && !(process.env.CHINESETEST_FIXTURE === "1" && /^https:\/\/localhost:\d+$/.test(origin))) throw new Error("API chỉ cho phép máy chủ ChineseTest.");
    if (fixtureCa && origin === ORIGIN) throw new Error("Không thay đổi TLS ChineseTest.");
    if(fixtureTiming&&origin===ORIGIN)throw new Error("Chỉ thay thời gian chờ trong kiểm thử cục bộ.");
    this.timing={...DEFAULT_TIMING,...fixtureTiming};
    this.agent = new Agent({ keepAlive: true, maxSockets: 6, maxFreeSockets: 4, rejectUnauthorized: true, ...(fixtureCa ? { ca: fixtureCa } : {}) });
    this.jar = session ? CookieJar.deserializeSync(session.cookies) : new CookieJar();
  }
  async call(path: string, params?: Row, body?: Row | Buffer, contentType = "application/json"): Promise<Row> {
    if (!/^\/[a-zA-Z0-9_/?=&.,-]+$/.test(path) || path.includes("..") || path.startsWith("//")) throw new Error("Đường dẫn API không hợp lệ.");
    const stamp = await this.read("/common/get_safe_stamp", undefined, Date.now());
    if (Number(stamp.code) !== 200) throw new ApiError("API thời gian ChineseTest từ chối yêu cầu (mã " + stamp.code + ").", Number(stamp.code), undefined, [401,403].includes(Number(stamp.code)) ? "auth" : undefined, "clock");
    if (!Number.isFinite(stamp.data) || Math.abs(stamp.data - Date.now()) > 60000) throw new ApiError("Không xác minh được thời gian máy chủ. Kiểm tra đồng hồ máy và kết nối.", undefined, undefined, "protocol", "clock");
    const result = body===undefined?await this.read(path,params,stamp.data):await this.raw(path, params, body, stamp.data, contentType);
    const message = String(result.msg || result.message || "request không được chấp nhận").slice(0, 400);
    const safe = /token|password|authorization|cookie|bearer|eyJ/i.test(message) ? "Request bị từ chối; kiểm tra trong ChineseTest" : message;
    // This upload error can occur while getInfo still verifies the same session.
    // Keep it scoped to the upload; do not invalidate the account or retry a POST.
    if (path === "/common/upload" && Number(result.code) === 500 && message.includes("认证失败")) throw new ApiError("ChineseTest từ chối xác thực yêu cầu tải ảnh (mã 500). Chưa xác nhận tải ảnh thành công. Thử lại; nếu lỗi tiếp diễn, đăng nhập lại tài khoản trên runner.", 500, undefined, "api", "upload");
    if (Number(result.code) !== 200) throw new ApiError([401, 403].includes(Number(result.code)) ? `ChineseTest từ chối phiên đăng nhập (mã ${result.code}). Đăng nhập lại trước khi chạy.` : `ChineseTest: ${safe} (${result.code ?? "không có mã"}).`, Number(result.code), undefined, [401,403].includes(Number(result.code)) ? "auth" : undefined, requestStage(path));
    return result;
  }
  private async read(path:string,params:Row|undefined,stamp:number):Promise<Row>{
    try{return await this.raw(path,params,undefined,stamp,"application/json");}
    catch(e){
      // Only GETs are retried. An upload or registration POST is never repeated here.
      if(!transientFailure(e) || (e instanceof ApiError && (e.retryAfterMs || 0)>5000))throw e;
      const delay=e instanceof ApiError?Math.max(this.timing.retryDelayMs,e.retryAfterMs || 0):this.timing.retryDelayMs;
      await new Promise(resolve=>setTimeout(resolve,delay));
      return this.raw(path,params,undefined,path==="/common/get_safe_stamp"?Date.now():stamp,"application/json");
    }
  }
  private async raw(path: string, params: Row | undefined, body: Row | Buffer | undefined, stamp: number, contentType = "application/json"): Promise<Row> {
    const url = new URL("/chinesetestwebapi" + path, this.origin);
    for (const [k, v] of Object.entries(params || {})) if (v !== undefined && v !== null && v !== "") url.searchParams.set(k, String(v));
    const bytes = body === undefined ? undefined : Buffer.isBuffer(body) ? body : Buffer.from(JSON.stringify(body));
    const timeout=path==="/common/upload"?this.timing.uploadTimeoutMs:this.timing.readTimeoutMs;
    const headers: Record<string, string> = { Accept: "application/json, text/plain, */*", "Content-Type": contentType, "User-Language": "en", Origin: ORIGIN, Referer: ORIGIN + "/kaoshibaoming", "Access-Ch-Ref-Stamp": String(stamp), "Access-Ch-Ref-Site": requestSignature(stamp) };
    if (this.session) headers.Authorization = `Bearer ${this.session.token}`;
    const cookie = await this.jar.getCookieString(url.href); if (cookie) headers.Cookie = cookie;
    if (bytes) headers["Content-Length"] = String(bytes.length);
    return new Promise((resolve, reject) => {
      let settled = false;
      let deadline: ReturnType<typeof setTimeout>;
      const fail = (error: ApiError) => { if (!settled) { settled = true; clearTimeout(deadline); error.stage ??= requestStage(path); reject(error); } };
      const req = request(url, { method: bytes ? "POST" : "GET", agent: this.agent, headers }, res => {
        const chunks: Buffer[] = []; let size = 0;
        const cookies = Promise.all((res.headers["set-cookie"] || []).map(c => this.jar.setCookie(c, url.href)));
        void cookies.catch(() => {});
        res.on("data", chunk => { size += chunk.length; if (size > 4 * 1024 * 1024) { fail(new ApiError("Phản hồi ChineseTest quá lớn.")); req.destroy(); } else chunks.push(chunk); });
        res.on("aborted", () => fail(new ApiError(transportMessage(path), undefined, undefined, "transient")));
        res.on("error", () => fail(new ApiError(transportMessage(path), undefined, undefined, "transient")));
        res.on("end", () => { void (async () => {
          if (settled) return;
          await cookies;
          const retry = res.headers["retry-after"];
          const retryAfter = retry ? (/^\d+$/.test(String(retry)) ? Number(retry) * 1000 : Math.max(0, Date.parse(String(retry)) - Date.now())) : undefined;
          if ((res.statusCode || 500) >= 300) { fail(new ApiError(`ChineseTest HTTP ${res.statusCode}.`, res.statusCode, retryAfter)); return; }
          let data: Row; try { data = JSON.parse(Buffer.concat(chunks).toString("utf8")); } catch { fail(new ApiError("ChineseTest không trả JSON hợp lệ.", undefined, undefined, "protocol")); return; }
          if (!data || typeof data !== "object" || Array.isArray(data)) { fail(new ApiError("Cấu trúc API đã đổi.", undefined, undefined, "protocol")); return; }
          settled = true; clearTimeout(deadline); resolve(data);
        })().catch(() => fail(new ApiError("Không lưu được phiên phản hồi."))); });
      });
      deadline = setTimeout(() => { fail(new ApiError(transportMessage(path,true), undefined, undefined, "transient")); req.destroy(); }, timeout);
      req.setTimeout(timeout, () => { fail(new ApiError(transportMessage(path,true), undefined, undefined, "transient")); req.destroy(); });
      req.on("error", () => fail(new ApiError(transportMessage(path), undefined, undefined, "transient")));
      if (bytes) req.end(bytes); else req.end();
    });
  }
  async identity() {
    const r = await this.call("/userInfo/getInfo");
    const d = r.data;
    if (!d || typeof d !== "object") throw new ApiError("Chưa đọc được danh tính tài khoản.", undefined, undefined, "protocol", "identity");
    const email = String(d.userEmail || d.email || d.userInfo?.userEmail || "").trim().toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new ApiError("Không xác định được email tài khoản.", undefined, undefined, "protocol", "identity");
    if (this.session?.email && email !== this.session.email.toLowerCase()) throw new ApiError("Phiên không khớp tài khoản đã chọn.", undefined, undefined, "identity", "identity");
    return { email, key: createHash("sha256").update(email).digest("hex") };
  }
  profile() { return this.call("/examinee/enroll/getLastBm"); }
  /** Read only an official portrait, into memory. Never follow redirects or store bytes. */
  async photo(path: string): Promise<Portrait> {
    if (typeof path !== "string" || path.length > 2048 || !/^\/?[a-zA-Z0-9_.\-/]+\.(?:jpe?g|png)$/i.test(path) || path.includes("..") || path.startsWith("//")) throw new ApiError("Đường dẫn ảnh ChineseTest không hợp lệ.", undefined, undefined, "protocol", "read");
    const url = new URL("/" + path.replace(/^\/+/, ""), this.origin);
    const headers:Record<string,string>={Accept:"image/jpeg,image/png",Referer:ORIGIN+"/", "Cache-Control":"no-cache"};
    const cookie=await this.jar.getCookieString(url.href);if(cookie)headers.Cookie=cookie;
    if(this.session)headers.Authorization=`Bearer ${this.session.token}`;
    return new Promise((resolve,reject)=>{
      let settled=false;let deadline:ReturnType<typeof setTimeout>;
      const fail=(message:string,kind:ApiFailure="protocol",code?:number)=>{if(settled)return;settled=true;clearTimeout(deadline);reject(new ApiError(message,code,undefined,kind,"read"));};
      const req=request(url,{agent:this.agent,headers},res=>{
        // 401/403 for one image is not proof that the session itself expired.
        if(res.statusCode!==200){fail(`Chưa đọc được ảnh từ ChineseTest (HTTP ${res.statusCode}).`,(res.statusCode || 500)>=500?"transient":"api",res.statusCode);res.destroy();return;}
        const mime=String(res.headers["content-type"] || "").split(";")[0].trim().toLowerCase();
        if(!["image/jpeg","image/png"].includes(mime)){fail("ChineseTest chưa trả về nội dung ảnh JPG/PNG.");res.destroy();return;}
        const chunks:Buffer[]=[];let size=0;
        res.on("data",chunk=>{size+=chunk.length;if(size>=1024*1024){fail("Ảnh từ ChineseTest vượt giới hạn 1 MB.");req.destroy();}else chunks.push(Buffer.from(chunk));});
        res.on("aborted",()=>fail("Kết nối đọc ảnh ChineseTest bị gián đoạn.","transient"));
        res.on("error",()=>fail("Kết nối đọc ảnh ChineseTest bị gián đoạn.","transient"));
        res.on("end",()=>{if(settled)return;const bytes=Buffer.concat(chunks);const valid=mime==="image/jpeg"?bytes[0]===255&&bytes[1]===216:bytes.subarray(0,8).equals(Buffer.from("89504e470d0a1a0a","hex"));if(!valid){fail("Nội dung trả về không phải ảnh JPG/PNG hợp lệ.");return;}settled=true;clearTimeout(deadline);resolve({path,mimeType:mime as Portrait["mimeType"],base64:bytes.toString("base64")});});
      });
      deadline=setTimeout(()=>{fail("Đọc ảnh ChineseTest quá thời gian chờ. Thử lại khi kết nối ổn định.","transient");req.destroy();},this.timing.readTimeoutMs);
      req.on("error",()=>fail("Kết nối đọc ảnh ChineseTest bị gián đoạn.","transient"));req.end();
    });
  }
  options() { return this.call("/portal/index/getOptionList"); }
  subjects(projectId: string) { return this.call("/portal/index/getSubjectList", { projectId }); }
  dates(kmId: string, ksType: string) { return this.call("/examinee/enroll/getExamTimeList", { kmId, ksType }); }
  sites(kmId: string, ksType: string, ksDate: string) { return this.call("/examinee/enroll/getExamSiteList", { kmId, ksType, ksDate, gjId: "180" }); }
  async directory(ksType: string): Promise<Row[]> {
    if (!["1", "2", "4"].includes(ksType)) throw new Error("Hình thức thi không hợp lệ.");
    const rows: Row[] = [], ids = new Set<string>();
    let total: number | undefined;
    for (let pageNum = 1; ; pageNum++) {
      const r = await this.call("/portal/index/getExamSiteList", { countryId: "180", type: ksType, pageNum, pageSize: 100 });
      const count = Number(r.total);
      if (!Array.isArray(r.rows) || !Number.isSafeInteger(count) || count < 0 || count > 10000 || total !== undefined && count !== total) throw new ApiError("Chưa đọc được toàn bộ danh mục điểm thi Việt Nam.");
      total = count;
      for (const row of r.rows) {
        const id = String(row.kdId ?? "");
        if (!/^\d+$/.test(id) || ids.has(id) || !(row.siteName || row.siteEName)) throw new ApiError("Cấu trúc danh mục điểm thi đã đổi.");
        ids.add(id); rows.push({ ...row, kdId: id, kdName: row.siteName, kdEName: row.siteEName });
      }
      if (rows.length === total) return rows;
      if (!r.rows.length || rows.length > total) throw new ApiError("Danh mục điểm thi chưa đầy đủ.");
    }
  }
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
