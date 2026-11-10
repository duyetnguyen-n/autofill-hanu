import { Agent, request } from "node:https";
import { createHash, randomUUID } from "node:crypto";
import { performance } from "node:perf_hooks";
import { schoolCertificateAuthorities } from "./tls";
import { schoolErrorKind, type ReportDiagnostic } from "./diagnostics";
import { CookieJar } from "tough-cookie";
import {
  HCMUE_ORIGIN,
  type Exam,
  type Questions,
  type Identity,
} from "../protocol";
export class ApiFailure extends Error {
  constructor(
    message: string,
    public mayHaveSent = true,
    public status?: number,
    public response?: any,
    public retryAfterMs?: number,
  ) {
    super(message);
  }
}
export interface Session {
  token: string;
  deviceId: string;
  cookies: string;
  identity: Identity;
}
export class HcmueClient {
  private agent = new Agent({
    keepAlive: true,
    maxSockets: 5,
    maxFreeSockets: 5,
    timeout: 60000,
    rejectUnauthorized: true,
    ca: schoolCertificateAuthorities(),
  });
  private jar: CookieJar;
  constructor(
    private session?: Session,
    private origin = HCMUE_ORIGIN,
    fixtureCa?: string,
    private report?: ReportDiagnostic,
  ) {
    if (
      origin !== HCMUE_ORIGIN &&
      (!process.env.HCMUE_FIXTURE || !/^https:\/\/localhost:\d+$/.test(origin))
    )
      throw new Error("API chỉ hỗ trợ máy chủ HCMUE.");
    if (fixtureCa) {
      if (origin === HCMUE_ORIGIN)
        throw new Error("Không thay đổi TLS máy chủ trường.");
      this.agent = new Agent({
        keepAlive: true,
        maxSockets: 5,
        maxFreeSockets: 5,
        ca: fixtureCa,
      });
    }
    this.jar = session
      ? CookieJar.deserializeSync(session.cookies)
      : new CookieJar();
  }
  async call(
    path: string,
    method = "GET",
    body?: unknown,
    timeout = 15000,
    onServerTime?: (timestamp: number) => void,
  ): Promise<any> {
    if (!path.startsWith("/") || path.startsWith("//") || path.includes(".."))
      throw new Error("Đường dẫn API không hợp lệ.");
    const url = new URL("/v1/api" + path, this.origin);
    const text = body === undefined ? undefined : JSON.stringify(body);
    const headers: Record<string, string> = {
      Accept: "application/json",
      "X-Device-Id": this.session?.deviceId ?? this.loginDevice,
      Origin: HCMUE_ORIGIN,
      Referer: HCMUE_ORIGIN + "/sign-in",
    };
    if (this.session) headers.Authorization = `Bearer ${this.session.token}`;
    const cookie = await this.jar.getCookieString(url.href);
    if (cookie) headers.Cookie = cookie;
    if (text) {
      headers["Content-Type"] = "application/json";
      headers["Content-Length"] = String(Buffer.byteLength(text));
    }
    const endpoint = diagnosticEndpoint(url.pathname);
    const requestId = this.report ? randomUUID() : undefined;
    const started = performance.now();
    this.report?.({ event: "api_start", endpoint, requestId, method, timeoutMs: timeout });
    return new Promise((resolve, reject) => {
      let connected = false,
        settled = false,
        httpStatus: number | undefined,
        schoolDate: string | undefined;
      const finish = (result: string, data?: any, transport?: string, retryAfterMs?: number) => {
        const message = data?.message;
        const businessCode = typeof data?.code === "string" && /^[A-Z][A-Z0-9_]{2,48}$/.test(data.code) ? data.code : undefined;
        const envelope = typeof data?.status === "string" && ["success", "error", "queued", "failed", "email_not_verified"].includes(data.status)
          ? data.status : typeof data?.success === "boolean" ? String(data.success) : undefined;
        this.report?.({
          event: "api_result", endpoint, requestId, method, result, httpStatus, connected, schoolDate,
          elapsedMs: Math.round(performance.now() - started),
          businessCode, envelope, transport, retryAfterMs,
          reason: result === "http_ok" ? undefined : schoolErrorKind(message),
        });
      };
      const fail = (e: ApiFailure, result: string, transport?: string) => {
        if (!settled) {
          settled = true;
          finish(result, e.response, transport, e.retryAfterMs);
          reject(e);
        }
      };
      const req = request(
        url,
        { agent: this.agent, method, headers },
        (res) => {
          httpStatus = res.statusCode;
          const serverTime = Date.parse(res.headers.date ?? "");
          if (Number.isFinite(serverTime)) schoolDate = new Date(serverTime).toISOString();
          const chunks: Buffer[] = [];
          let size = 0;
          for (const cookie of res.headers["set-cookie"] ?? [])
            void this.jar.setCookie(cookie, url.href).catch(() => {});
          res.on("data", (chunk) => {
            size += chunk.length;
            if (size > 2 * 1024 * 1024) {
              req.destroy();
              fail(new ApiFailure("Phản hồi quá lớn."), "response_too_large");
            } else chunks.push(chunk);
          });
          res.on("aborted", () =>
            fail(new ApiFailure("Phản hồi bị ngắt.", true), "response_aborted"),
          );
          res.on("error", () =>
            fail(new ApiFailure("Mất kết nối khi đọc phản hồi.", true), "response_error"),
          );
          res.on("end", () => {
            if (settled) return;
            let data: any;
            try {
              data = JSON.parse(Buffer.concat(chunks).toString("utf8"));
            } catch {
              fail(
                new ApiFailure(
                  `Trường trả phản hồi không hợp lệ (${res.statusCode}).`,
                  true,
                  res.statusCode,
                ),
                "invalid_json",
              );
              return;
            }
            if ((res.statusCode ?? 500) >= 300) {
              const retry = res.headers["retry-after"];
              const delay = retry
                ? Number.isFinite(Number(retry))
                  ? Number(retry) * 1000
                  : Math.max(0, Date.parse(String(retry)) - Date.now())
                : undefined;
              fail(
                new ApiFailure(
                  apiMessage(
                    data,
                    res.statusCode === 401
                      ? path === "/auth/login"
                        ? "CCCD hoặc mật khẩu không đúng."
                        : "Phiên đăng nhập đã hết hạn. Đăng nhập lại tài khoản HCMUE."
                      : `Trường trả HTTP ${res.statusCode}.`,
                  ),
                  true,
                  res.statusCode,
                  data,
                  delay,
                ),
                "http_error",
              );
              return;
            }
            settled = true;
            if (Number.isFinite(serverTime)) onServerTime?.(serverTime);
            const rejected = ["error", "failed", "email_not_verified"].includes(data?.status) || data?.success === false;
            finish(rejected ? "business_error" : "http_ok", data);
            resolve(data);
          });
        },
      );
      const timer = setTimeout(
        () => {
          fail(new ApiFailure(transportMessage(undefined, connected), connected), "timeout", "ETIMEDOUT");
          req.destroy();
        },
        timeout,
      );
      req.on("socket", (socket) => {
        if (!socket.connecting) connected = true;
        else
          socket.once("secureConnect", () => {
            connected = true;
          });
      });
      req.on("close", () => clearTimeout(timer));
      req.on("error", (error: NodeJS.ErrnoException) => {
        const code = error.code && /^[A-Z][A-Z0-9_]{2,48}$/.test(error.code) ? error.code : undefined;
        fail(new ApiFailure(transportMessage(error.code, connected), connected), "transport_error", code);
      });
      req.end(text);
    });
  }
  private loginDevice = randomUUID();
  async login(cccd: string, password: string) {
    const response = await this.call(
      "/auth/login",
      "POST",
      { cccd, password },
      20000,
    );
    if (String(response?.status).toLowerCase() !== "success")
      throw new Error(
        apiMessage(
          response,
          "Đăng nhập không thành công. Kiểm tra tài khoản hoặc email xác thực trên trang trường.",
        ),
      );
    if (typeof response.token !== "string" || !response.token.trim())
      throw new Error(
        "API đăng nhập báo thành công nhưng thiếu token. Cần cập nhật Runner.",
      );
    this.session = {
      token: response.token,
      deviceId: this.loginDevice,
      cookies: JSON.stringify(await this.jar.serialize()),
      identity: {
        key: "",
        name: "",
        email: "",
        hasPhoto: false,
        verified: false,
        maskedId: "",
      },
    };
    this.session.identity = await this.profile();
    return this.export();
  }
  async profile(): Promise<Identity> {
    const response = await this.call("/me/profile");
    const { user, cccd } = response?.data ?? {};
    if (
      response?.success !== true ||
      typeof user?.cccd !== "string" ||
      !user.cccd.trim()
    )
      throw new Error("Không đọc được hồ sơ HCMUE.");
    return {
      key: createHash("sha256").update(String(user.cccd)).digest("hex"),
      name:
        typeof cccd?.ho_ten === "string" && cccd.ho_ten.trim()
          ? cccd.ho_ten
          : "Thí sinh " + String(user.cccd).slice(-4),
      maskedId: "•••• " + String(user.cccd).slice(-4),
      email: user.email ?? "",
      hasPhoto:
        typeof cccd?.anh_the === "string" && cccd.anh_the.trim().length > 0,
      verified:
        [user.isVerified, user.is_verified].some(
          (v) => v === true || v === 1 || v === "1",
        ) ||
        (typeof user.email_verified_at === "string" &&
          Number.isFinite(Date.parse(user.email_verified_at))),
    };
  }
  async exams(
    date = "",
    location = "HCMUE",
    timeout?: number,
    onServerTime?: (timestamp: number) => void,
  ): Promise<Exam[]> {
    const query = new URLSearchParams({
      limit: "1000",
      dia_diem_code: location,
      hasRegisterCode: "0",
    });
    if (date) query.set("ngay_thi", date);
    const r = await this.call(
      "/ky-thi-mo/comming-exam?" + query,
      "GET",
      undefined,
      timeout,
      onServerTime,
    );
    if (r?.success !== true || !Array.isArray(r.data))
      throw new Error("Không đọc được kỳ thi.");
    return r.data;
  }
  questions(exam: Exam): Promise<Questions> {
    return this.call(
      `/ky-thi-mo/${encodeURIComponent(exam.ma_cap_thi)}/${encodeURIComponent(exam.ngay_mo_dang_ky)}/cau-hoi-va-tra-loi`,
    );
  }
  private query(exam: Exam) {
    return new URLSearchParams({
      ma_cap_thi: exam.ma_cap_thi,
      ngay_mo_dang_ky: exam.ngay_mo_dang_ky,
    });
  }
  async registration(exam: Exam) {
    const r = await this.call(
      "/dang-ky-thi/check-registration?" + this.query(exam),
    );
    if (r?.status !== "success" || typeof r.data?.isRegistered !== "boolean")
      throw new Error("Không xác định được đăng ký cũ.");
    return r.data as { isRegistered: boolean; registration?: any };
  }
  async conflict(exam: Exam) {
    const r = await this.call(
      "/dang-ky-thi/check-schedule-conflict?" + this.query(exam),
    );
    if (r?.status !== "success" || typeof r.data?.hasConflict !== "boolean")
      throw new Error("Không kiểm tra được trùng lịch.");
    return r.data;
  }
  submit(body: unknown) {
    return this.call("/dang-ky-thi", "POST", body, 30000);
  }
  async job(id: string) {
    const r = await this.call("/dang-ky-thi/jobs/" + encodeURIComponent(id));
    if (typeof r?.data?.jobStatus !== "string")
      throw new Error(
        "API hàng đợi thiếu data.jobStatus. Chưa xác định được kết quả đăng ký.",
      );
    return r;
  }
  async export(): Promise<Session> {
    if (!this.session) throw new Error("Chưa đăng nhập.");
    return {
      ...this.session,
      cookies: JSON.stringify(await this.jar.serialize()),
    };
  }
  close() {
    this.agent.destroy();
  }
}

function diagnosticEndpoint(path: string) {
  switch (path) {
    case "/v1/api/auth/login": return "login";
    case "/v1/api/me/profile": return "profile";
    case "/v1/api/ky-thi-mo/comming-exam": return "exams";
    case "/v1/api/dang-ky-thi/check-registration": return "registration_check";
    case "/v1/api/dang-ky-thi/check-schedule-conflict": return "conflict_check";
    case "/v1/api/dang-ky-thi": return "submit";
  }
  if (path.startsWith("/v1/api/dang-ky-thi/jobs/")) return "queue";
  if (path.endsWith("/cau-hoi-va-tra-loi")) return "questions";
  return "other";
}

function apiMessage(data: any, fallback: string) {
  if (
    data?.status === "email_not_verified" ||
    data?.requiresEmailVerification === true
  )
    return "Tài khoản HCMUE chưa xác thực email. Mở trang trường để xác thực rồi đăng nhập lại.";
  const message = typeof data?.message === "string" ? data.message.trim() : "";
  // Forward the school's short explanation, never HTML, echoed credentials or tokens.
  if (
    !message ||
    message.length > 350 ||
    /[<>]|\bBearer\b|eyJ[A-Za-z0-9_-]{15}|\d{9,12}/.test(message)
  )
    return fallback;
  return message;
}
export function transportMessage(code: string | undefined, connected: boolean) {
  if (
    code &&
    [
      "UNABLE_TO_VERIFY_LEAF_SIGNATURE",
      "UNABLE_TO_GET_ISSUER_CERT_LOCALLY",
      "CERT_HAS_EXPIRED",
      "SELF_SIGNED_CERT_IN_CHAIN",
      "DEPTH_ZERO_SELF_SIGNED_CERT",
      "ERR_TLS_CERT_ALTNAME_INVALID",
    ].includes(code)
  )
    return `Không xác minh được chứng chỉ HTTPS của HCMUE (${code}). Cập nhật Runner; không tắt xác minh HTTPS.`;
  if (code === "ENOTFOUND" || code === "EAI_AGAIN")
    return "Không tìm được máy chủ HCMUE. Kiểm tra DNS và kết nối mạng.";
  if (!connected)
    return "Chưa kết nối được tới máy chủ HCMUE. Kiểm tra mạng và thử đăng nhập lại.";
  return "Kết nối HCMUE bị ngắt hoặc hết thời gian chờ. Nếu đã gửi đơn, kiểm tra kết quả trước khi gửi lại.";
}
