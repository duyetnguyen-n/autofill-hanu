import { chromium, type BrowserContext } from "playwright-core";
import { CookieJar } from "tough-cookie";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve, dirname } from "node:path";
import { ORIGIN } from "../protocol";
import { ChineseTestClient, type Session } from "./client";

async function removeLoginProfile(directory?: string) {
  // Delete only a temporary profile created for this login, including on Windows
  // where Chrome can briefly retain file handles after its window has closed.
  if (directory && dirname(resolve(directory)) === resolve(tmpdir()) && directory.startsWith(join(tmpdir(), "chinesetest-login-"))) {
    await rm(directory, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
  }
}
function startupError(error: unknown) {
  const message = error instanceof Error ? error.message : "";
  if (/executable.*(?:exist|found)|distribution.*not found|ENOENT/i.test(message)) return "Không tìm thấy Google Chrome. Cài Google Chrome rồi mở lại cửa sổ đăng nhập.";
  if (/timeout/i.test(message)) return "Chrome chưa khởi động xong trong thời gian cho phép. Kiểm tra cửa sổ cảnh báo của hệ điều hành rồi thử lại.";
  return "Không khởi động được Chrome đăng nhập. Kiểm tra Google Chrome và quyền mở ứng dụng trên máy.";
}
function navigationError(error: unknown) {
  const message = error instanceof Error ? error.message : "";
  const reason = /timeout/i.test(message) ? "Trang đăng nhập ChineseTest phản hồi chậm"
    : /ERR_CERT|certificate/i.test(message) ? "Không xác minh được chứng chỉ HTTPS của trang đăng nhập"
    : "Chưa tải được trang đăng nhập ChineseTest";
  return `${reason}. Chrome vẫn mở; bạn có thể tải lại trang hoặc tự mở https://www.chinesetest.cn/login?redirect=%2Fpersonal-test trong cửa sổ này, đăng nhập rồi bấm Hoàn tất đăng nhập.`;
}

/** The human completes login/CAPTCHA. No passwords or challenges are read by the app. */
export class LoginWindow {
  private context?: BrowserContext;
  private directory?: string;
  private busy = false;
  private generation = 0;
  get pending() { return this.busy || Boolean(this.context); }
  async open() {
    if (this.pending) throw new Error("Một cửa sổ đăng nhập đang mở. Hoàn tất hoặc hủy trước.");
    const generation = ++this.generation;
    this.busy = true;
    try {
      const directory = await mkdtemp(join(tmpdir(), "chinesetest-login-"));
      if (generation !== this.generation) { await removeLoginProfile(directory); throw new Error("Đã hủy mở cửa sổ đăng nhập."); }
      let context: BrowserContext;
      try {
        context = await chromium.launchPersistentContext(directory, { channel: "chrome", headless: false, viewport: null, args: ["--no-first-run", "--no-default-browser-check"] });
      } catch (error) {
        await removeLoginProfile(directory);
        if (generation !== this.generation) throw new Error("Đã hủy mở cửa sổ đăng nhập.");
        throw new Error(startupError(error));
      }
      if (generation !== this.generation) {
        await context.close().catch(() => {}); await removeLoginProfile(directory);
        throw new Error("Đã hủy mở cửa sổ đăng nhập.");
      }
      this.context = context; this.directory = directory;
      context.once("close", () => { if (this.context === context) void this.close().catch(() => {}); });
      try {
        // A human can already be typing before DOMContentLoaded (slow scripts,
        // redirects or challenges). Navigation failure must never close that window.
        await (context.pages()[0] || await context.newPage()).goto(ORIGIN + "/login?redirect=%2Fpersonal-test", { waitUntil: "commit", timeout: 45000 });
      } catch (error) {
        if (this.context !== context) throw new Error("Cửa sổ Chrome đăng nhập đã đóng hoặc đã hủy. Bấm Thêm tài khoản / Đăng nhập lại để mở lại.");
        throw new Error(navigationError(error));
      }
    } finally { if (generation === this.generation) this.busy = false; }
  }
  async finish(): Promise<Session> {
    if (!this.context) throw new Error("Chưa mở cửa sổ đăng nhập trên máy chạy.");
    const cookies = await this.context.cookies(ORIGIN);
    const tokenCookie = cookies.find(c => c.name === "token" && (c.domain === "www.chinesetest.cn" || c.domain === ".chinesetest.cn"));
    if (!tokenCookie?.value) throw new Error("Chưa đăng nhập xong. Hoàn tất đăng nhập/xác minh trong Chrome trước.");
    let info: any;
    try { info = JSON.parse(cookies.find(c => c.name === "userInfo")?.value || "{}"); }
    catch { try { info = JSON.parse(decodeURIComponent(cookies.find(c => c.name === "userInfo")?.value || "{}")); } catch { info = {}; } }
    const email = String(info.name || info.userEmail || "").trim().toLowerCase();
    if (!email) throw new Error("Chưa đọc được tài khoản vừa đăng nhập. Mở My Account trong cửa sổ Chrome rồi thử lại.");
    const jar = new CookieJar();
    for (const c of cookies) {
      const domain = c.domain.replace(/^\./, "");
      if (domain !== "chinesetest.cn" && domain !== "www.chinesetest.cn") continue;
      await jar.setCookie(`${c.name}=${c.value}; Domain=${c.domain}; Path=${c.path}; ${c.secure ? "Secure;" : ""} ${c.httpOnly ? "HttpOnly;" : ""}`, ORIGIN);
    }
    const session: Session = { token: tokenCookie.value, cookies: JSON.stringify(await jar.serialize()), email, key: "" };
    const client = new ChineseTestClient(session);
    try { const identity = await client.identity(); session.key = identity.key; return await client.exportSession().then(s => ({ ...s, key: identity.key })); }
    finally { client.close(); }
  }
  async close() {
    this.generation++; this.busy = false;
    const context = this.context; this.context = undefined;
    const directory = this.directory; this.directory = undefined;
    await context?.close().catch(() => {});
    await removeLoginProfile(directory);
  }
}
