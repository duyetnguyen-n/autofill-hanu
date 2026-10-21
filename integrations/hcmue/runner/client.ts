import { Agent, request } from "node:https";
import { createHash, randomUUID } from "node:crypto";
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
  });
  private jar: CookieJar;
  constructor(
    private session?: Session,
    private origin = HCMUE_ORIGIN,
    fixtureCa?: string,
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
  ): Promise<any> {
    if (!path.startsWith("/") || path.startsWith("//") || path.includes(".."))
      throw new Error("Đường dẫn API không hợp lệ.");
    const url = new URL("/v1/api" + path, this.origin);
    const text = body === undefined ? undefined : JSON.stringify(body);
    const headers: Record<string, string> = {
      Accept: "application/json",
      "X-Device-Id": this.session?.deviceId ?? this.loginDevice,
    };
    if (this.session) headers.Authorization = `Bearer ${this.session.token}`;
    const cookie = await this.jar.getCookieString(url.href);
    if (cookie) headers.Cookie = cookie;
    if (text) {
      headers["Content-Type"] = "application/json";
      headers["Content-Length"] = String(Buffer.byteLength(text));
    }
    return new Promise((resolve, reject) => {
      let connected = false,
        settled = false;
      const fail = (e: ApiFailure) => {
        if (!settled) {
          settled = true;
          reject(e);
        }
      };
      const req = request(
        url,
        { agent: this.agent, method, headers },
        (res) => {
          const chunks: Buffer[] = [];
          let size = 0;
          for (const cookie of res.headers["set-cookie"] ?? [])
            void this.jar.setCookie(cookie, url.href).catch(() => {});
          res.on("data", (chunk) => {
            size += chunk.length;
            if (size > 2 * 1024 * 1024) {
              req.destroy();
              fail(new ApiFailure("Phản hồi quá lớn."));
            } else chunks.push(chunk);
          });
          res.on("aborted", () =>
            fail(new ApiFailure("Phản hồi bị ngắt.", true)),
          );
          res.on("error", () =>
            fail(new ApiFailure("Mất kết nối khi đọc phản hồi.", true)),
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
                  res.statusCode === 401
                    ? "Phiên đăng nhập đã hết hạn."
                    : `Trường trả HTTP ${res.statusCode}.`,
                  true,
                  res.statusCode,
                  data,
                  delay,
                ),
              );
              return;
            }
            settled = true;
            resolve(data);
          });
        },
      );
      const timer = setTimeout(
        () => req.destroy(new Error("timeout")),
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
      req.on("error", () =>
        fail(
          new ApiFailure(
            "Không nhận được phản hồi. Cần đối chiếu kết quả.",
            connected,
          ),
        ),
      );
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
    if (
      String(response.status).toLowerCase() !== "success" ||
      typeof response.token !== "string" ||
      !response.token
    )
      throw new Error(
        "Đăng nhập không thành công. Kiểm tra tài khoản hoặc email xác thực trên trang trường.",
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
    const { user, cccd } = response.data ?? {};
    if (response.success !== true || !user?.cccd || !cccd?.ho_ten)
      throw new Error("Không đọc được hồ sơ HCMUE.");
    return {
      key: createHash("sha256").update(String(user.cccd)).digest("hex"),
      name: cccd.ho_ten,
      maskedId: "•••• " + String(user.cccd).slice(-4),
      email: user.email ?? "",
      hasPhoto: !!cccd.anh_the,
      verified: !!(
        user.isVerified ||
        user.is_verified ||
        user.email_verified_at
      ),
    };
  }
  async exams(date = "", location = "HCMUE"): Promise<Exam[]> {
    const query = new URLSearchParams({
      limit: "1000",
      dia_diem_code: location,
      hasRegisterCode: "0",
    });
    if (date) query.set("ngay_thi", date);
    const r = await this.call("/ky-thi-mo/comming-exam?" + query);
    if (r.success !== true || !Array.isArray(r.data))
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
    if (r.status !== "success" || typeof r.data?.isRegistered !== "boolean")
      throw new Error("Không xác định được đăng ký cũ.");
    return r.data as { isRegistered: boolean; registration?: any };
  }
  async conflict(exam: Exam) {
    const r = await this.call(
      "/dang-ky-thi/check-schedule-conflict?" + this.query(exam),
    );
    if (typeof r.data?.hasConflict !== "boolean")
      throw new Error("Không kiểm tra được trùng lịch.");
    return r.data;
  }
  submit(body: unknown) {
    return this.call("/dang-ky-thi", "POST", body, 30000);
  }
  job(id: string) {
    return this.call("/dang-ky-thi/jobs/" + encodeURIComponent(id));
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
