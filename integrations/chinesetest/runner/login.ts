import { chromium, type BrowserContext } from "playwright-core";
import { CookieJar } from "tough-cookie";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve, dirname } from "node:path";
import { ORIGIN } from "../protocol";
import { ChineseTestClient, type Session } from "./client";

/** The human completes login/CAPTCHA. No passwords or challenges are read by the app. */
export class LoginWindow {
  private context?: BrowserContext;
  private directory?: string;
  private busy = false;
  get pending() { return this.busy || Boolean(this.context); }
  async open() {
    if (this.pending) throw new Error("Một cửa sổ đăng nhập đang mở. Hoàn tất hoặc hủy trước.");
    this.busy = true;
    try {
      this.directory = await mkdtemp(join(tmpdir(), "chinesetest-login-"));
      this.context = await chromium.launchPersistentContext(this.directory, { channel: "chrome", headless: false, viewport: null, args: ["--no-first-run", "--no-default-browser-check"] });
      await (this.context.pages()[0] || await this.context.newPage()).goto(ORIGIN + "/login?redirect=%2Fpersonal-test", { waitUntil: "domcontentloaded", timeout: 45000 });
    } catch { await this.close(); throw new Error("Không mở được Chrome đăng nhập. Cần cài Google Chrome và cho phép mở cửa sổ đăng nhập."); }
    finally { this.busy = false; }
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
    await this.context?.close().catch(() => {}); this.context = undefined;
    const directory = this.directory; this.directory = undefined;
    // Delete only the exact temporary login profile created by this instance.
    if (directory && dirname(resolve(directory)) === resolve(tmpdir()) && directory.startsWith(join(tmpdir(), "chinesetest-login-"))) await rm(directory, { recursive: true, force: true });
  }
}
