import { createHash, randomUUID } from "node:crypto";
import { performance } from "node:perf_hooks";
import { identityKeys, fingerprint } from "../../hcmue/crypto";
import { atDeadline } from "../../hcmue/runner/deadline";
import { activeStatus, personalFrom, validatePersonal, validateTarget, MAX_ACCOUNTS, type Row, type Personal, type Target, type AccountView, type Run, type RunnerState, type Command, type Limits, type Plan } from "../protocol";
import { ChineseTestClient, ApiError, type Session } from "./client";
import { LoginWindow } from "./login";
import { candidateKey, inspectTarget, existingRegistration } from "./checks";

interface Account { view: AccountView; session: Session; personal: Personal }
export interface RunnerData { id: string; name: string; keys: Awaited<ReturnType<typeof identityKeys>>; accounts: Account[]; schedules: Run[]; plans: Record<string,Plan>; seen: string[]; cloud?: { origin: string; token: string; owner?: string } }
export const freshData = async (name: string): Promise<RunnerData> => ({ id: randomUUID(), name, keys: await identityKeys(), accounts: [], schedules: [], plans: {}, seen: [] });
type Login = Pick<LoginWindow, "open" | "finish" | "close" | "pending">;
export class Engine {
  private clients = new Map<string, ChineseTestClient>();
  private timers = new Map<string, () => void>();
  private tasks = new Map<string, Promise<void>>();
  private waits = new Map<string, Set<() => void>>();
  private publicClient: ChineseTestClient;
  private discoveries = new Map<string, { at: number; pending: boolean; promise: Promise<Row[]> }>();
  private writes: Promise<void> = Promise.resolve();
  private mutations: Promise<void> = Promise.resolve();
  private closed = false;
  private loginAccountId?: string;
  private lastWall = Date.now(); private lastMono = performance.now(); private lag = 0;
  private health: ReturnType<typeof setInterval>;
  constructor(public data: RunnerData, private vault: { write(value: RunnerData): Promise<void> }, private factory = (s?: Session) => new ChineseTestClient(s), private changed = () => {}, private login: Login = new LoginWindow()) {
    this.publicClient = factory();
    data.plans ||= {};
    for (const s of data.schedules) {
      if (["reserved", "sending", "queued"].includes(s.status)) { s.status = "uncertain"; s.message = "Runner đã khởi động lại; cần đối chiếu, không tự gửi lại."; }
      else if (activeStatus(s.status)) { s.status = "stopped"; s.message = "Runner đã khởi động lại; cần chuẩn bị và bật lịch mới."; }
    }
    this.health = setInterval(() => {
      const wall = Date.now(), mono = performance.now();
      this.lag = Math.max(0, mono - this.lastMono - 1000);
      if (Math.abs((wall - this.lastWall) - (mono - this.lastMono)) > 1000 || this.lag > 5000) {
        for (const s of data.schedules) if (activeStatus(s.status) && s.attempt.count === 0) this.stop(s, "Đồng hồ thay đổi hoặc máy vừa ngủ/treo. Cần chuẩn bị và bật lịch lại.");
        void this.persist().catch(() => {});
      }
      this.lastWall = wall; this.lastMono = mono;
    }, 1000);
    this.health.unref?.();
  }
  async persist() {
    const value = structuredClone(this.data);
    const work = this.writes.then(() => this.vault.write(value));
    this.writes = work.catch(() => {});
    await work; this.changed();
  }
  async identity() { return { id: this.data.id, name: this.data.name, platform: process.platform, publicKey: this.data.keys.publicKey, fingerprint: await fingerprint(this.data.keys.publicKey) }; }
  snapshot(): RunnerState {
    return { protocolVersion: 1, deviceId: this.data.id, name: this.data.name, platform: process.platform,
      accounts: this.data.accounts.map(a => ({ ...a.view })), plans: structuredClone(this.data.plans), schedules: this.data.schedules.map(({ personal: _p, identityHash: _h, accountKey: _k, ...s }) => {
        const { orderKey: _secret, ...attempt } = s.attempt; return structuredClone({ ...s, attempt });
      }), loginPending: this.login.pending, now: new Date().toISOString(), eventLoopLagMs: this.lag };
  }
  private account(id: string) { const a = this.data.accounts.find(a => a.view.id === id); if (!a) throw new Error("Không tìm thấy tài khoản trên máy này."); return a; }
  private client(a: Account) { let c = this.clients.get(a.view.id); if (!c) { c = this.factory(a.session); this.clients.set(a.view.id, c); } return c; }
  private view(a: Account) { a.view.name = a.personal.ksEName || a.session.email; a.view.maskedId = a.personal.idNo ? "•••• " + a.personal.idNo.slice(-4) : "Chưa có giấy tờ"; a.view.hasPhoto = Boolean(a.personal.photo); }
  private run(id: string) { const s = this.data.schedules.find(s => s.id === id); if (!s) throw new Error("Không tìm thấy lượt chạy."); return s; }
  private checkpoint(s: Run, version: number) { if (this.closed || s.version !== version || !activeStatus(s.status)) throw new Error("Lượt đã dừng hoặc thay đổi."); }
  private ensureEditable(a: Account) { if (this.data.schedules.some(s => s.accountKey === a.session.key && activeStatus(s.status))) throw new Error("Dừng lịch của tài khoản trước khi sửa hồ sơ/ảnh hoặc đăng nhập lại."); }
  private stop(s: Run, reason = "Đã dừng theo yêu cầu.") { this.timers.get(s.id)?.(); this.timers.delete(s.id); s.version++; s.status = s.attempt.count > 0 ? "uncertain" : "stopped"; s.message = s.attempt.count > 0 ? reason + " Request đã gửi có thể tiếp tục trên máy chủ; giữ khóa gửi." : reason; s.updatedAt = Date.now(); for (const wake of this.waits.get(s.id) || []) wake(); }
  private async sites(t: Target) {
    const key = JSON.stringify([t.kmId, t.ksType, t.ksDate]);
    const cached = this.discoveries.get(key);
    if (cached && (cached.pending || Date.now() - cached.at < t.intervalMs)) return cached.promise;
    const entry = { at: Date.now(), pending: true, promise: this.publicClient.sites(t.kmId, t.ksType, t.ksDate).then(r => { if (!Array.isArray(r.data)) throw new Error("Cấu trúc danh sách điểm thi đã đổi."); return r.data as Row[]; }).finally(() => { entry.pending = false; entry.at = Date.now(); }) };
    this.discoveries.set(key, entry);
    try { return await entry.promise; } catch (e) { this.discoveries.delete(key); throw e; }
  }
  private async checkIdentity(a: Account) {
    try { const identity = await this.client(a).identity(); if (identity.key !== a.session.key) throw new Error("Tài khoản trong phiên đã đổi."); a.view.loggedIn = true; }
    catch (e) { a.view.loggedIn = false; throw e; }
  }
  private async executeWork(command: Command, args: Row, limits: Limits): Promise<any> {
    if (this.closed) throw new Error("Runner đang dừng.");
    if (command === "state") return this.snapshot();
    if (command === "stop-all") { for (const s of this.data.schedules) if (activeStatus(s.status) || s.status === "prepared") this.stop(s); await this.persist(); return this.snapshot(); }
    if (command === "stop") { const s = this.run(String(args.id)); if (activeStatus(s.status) || s.status === "prepared") this.stop(s); await this.persist(); return this.snapshot(); }
    if (command === "save-plan") {
      const a = this.account(String(args.accountId)); this.ensureEditable(a);
      const target = structuredClone(args.target) as Target; validateTarget(target);
      this.data.plans[a.view.id] = { target, test: args.test === true }; await this.persist(); return { saved: true };
    }
    if (command === "login") {
      if (args.accountId) { const a = this.account(String(args.accountId)); this.ensureEditable(a); this.loginAccountId = a.view.id; }
      else { if (this.data.accounts.length >= Math.min(MAX_ACCOUNTS, limits.maxAccounts)) throw new Error("Đã đạt giới hạn tài khoản trên máy."); this.loginAccountId = undefined; }
      await this.login.open(); this.changed(); return { opened: true };
    }
    if (command === "cancel-login") { await this.login.close(); this.loginAccountId = undefined; this.changed(); return { ok: true }; }
    if (command === "finish-login") {
      const session = await this.login.finish();
      if (this.loginAccountId && this.account(this.loginAccountId).session.key !== session.key) throw new Error("Bạn đăng nhập tài khoản khác. Dùng đúng tài khoản hoặc hủy rồi thêm tài khoản mới.");
      let a = this.data.accounts.find(a => a.session.key === session.key);
      if (a) { this.ensureEditable(a); this.clients.get(a.view.id)?.close(); this.clients.delete(a.view.id); a.session = session; a.view.loggedIn = true; }
      else {
        if (this.data.accounts.length >= Math.min(MAX_ACCOUNTS, limits.maxAccounts)) throw new Error("Đã đạt giới hạn tài khoản.");
        a = { session, view: { id: randomUUID(), email: session.email, name: session.email, maskedId: "", hasPhoto: false, loggedIn: true }, personal: personalFrom({}) }; this.data.accounts.push(a);
      }
      const profile = await this.client(a).profile();
      if (!a.personal.ksEName && profile.data && typeof profile.data === "object") a.personal = personalFrom(profile.data);
      this.view(a); await this.persist(); await this.login.close(); this.loginAccountId = undefined;
      return { account: a.view, personal: a.personal };
    }
    if (command === "catalog") {
      const kind = String(args.kind || "projects");
      if (kind === "projects") return this.publicClient.options();
      if (kind === "subjects") return this.publicClient.subjects(String(args.projectId));
      if (kind === "dates") return this.publicClient.dates(String(args.kmId), String(args.ksType));
      if (kind === "sites") return this.publicClient.sites(String(args.kmId), String(args.ksType), String(args.ksDate));
      const common: Record<string, string> = { countries: "/common/countryList", languages: "/common/firstLanguageList", professions: "/common/getProfessionList", config: "/common/config" };
      if (!common[kind]) throw new Error("Danh mục không được hỗ trợ.");
      return this.publicClient.call(common[kind], kind === "professions" ? { parentId: String(args.parentId || "") } : undefined);
    }
    if (["inspect", "save-profile", "upload-photo", "remove", "prepare"].includes(command)) {
      const a = this.account(String(args.accountId)); const client = this.client(a);
      if (command === "remove") {
        if (this.data.schedules.some(s => s.accountKey === a.session.key && ["uncertain", "reserved", "sending", "queued"].includes(s.status))) throw new Error("Đối chiếu lượt chưa rõ kết quả trước khi gỡ tài khoản.");
        this.ensureEditable(a); client.close(); this.clients.delete(a.view.id);
        this.data.accounts = this.data.accounts.filter(x => x !== a); await this.persist(); return this.snapshot();
      }
      if (command === "save-profile") { this.ensureEditable(a); a.personal = personalFrom(args.personal || {}); this.view(a); await this.persist(); return { personal: a.personal }; }
      if (command === "upload-photo") {
        this.ensureEditable(a); await this.checkIdentity(a);
        if (typeof args.base64 !== "string" || args.base64.length > 1400000) throw new Error("Ảnh quá lớn.");
        a.personal.photo = await client.upload(Buffer.from(args.base64, "base64"), String(args.mimeType)); this.view(a); await this.persist(); return { personal: a.personal };
      }
      await this.checkIdentity(a);
      if (args.refreshProfile === true) { this.ensureEditable(a); const p = await client.profile(); a.personal = personalFrom(p.data || {}); this.view(a); await this.persist(); }
      if (command === "inspect" && !args.target) return { personal: a.personal, account: a.view };
      const target = structuredClone(args.target) as Target; validateTarget(target); validatePersonal(a.personal);
      const projects = await this.publicClient.options();
      if (!projects.data?.projectList?.some((p: Row) => String(p.KMID) === target.projectId)) throw new Error("Loại thi không còn trong danh mục.");
      const subjects = await this.publicClient.subjects(target.projectId);
      if (!Array.isArray(subjects.data) || !subjects.data.some((s: Row) => String(s.KMID) === target.kmId)) throw new Error("Cấp thi không thuộc loại thi đã chọn.");
      const duplicate = await existingRegistration(client, target);
      if (duplicate) throw new Error("Test Records đã có đăng ký cùng cấp/ngày. Không tạo lượt mới.");
      const inspection = await inspectTarget(client, target, a.personal, await this.sites(target));
      if (command === "inspect") { const { payload: _payload, ...publicInspection } = inspection; return { ...publicInspection, personal: a.personal, checkedAt: Date.now() }; }
      const hash = candidateKey(a.session.key, a.personal, target);
      if (this.data.schedules.some(s => s.identityHash === hash && (s.attempt.count > 0 || s.status === "reserved") && !s.verifiedAbsent)) throw new Error("Lượt trước còn khóa gửi. Đối chiếu trước khi chuẩn bị lại.");
      if (this.data.schedules.some(s => s.accountKey === a.session.key && activeStatus(s.status))) throw new Error("Tài khoản đã có lịch đang hoạt động.");
      if (target.targetAt < Date.now() + 6000 || target.targetAt > Date.now() + 7 * 86400000) throw new Error("Giờ mở cần từ 6 giây tới 7 ngày phía trước.");
      if (args.test !== true && !limits.liveEnabled) throw new Error("Tài khoản website chưa được cấp quyền Live.");
      if (args.test !== true && (args.agreeRules !== true || args.agreePrivacy !== true)) throw new Error("Cần đồng ý quy định và gửi hồ sơ cho lượt Live này.");
      for (const s of this.data.schedules) if (s.accountKey === a.session.key && s.status === "prepared") { s.status = "stopped"; s.message = "Đã thay bằng cấu hình mới."; }
      const s: Run = { id: randomUUID(), accountId: a.view.id, accountKey: a.session.key, personal: structuredClone(a.personal), target, test: args.test === true, identityHash: hash, status: "prepared", message: inspection.ready ? "Sẵn sàng; chưa bật lịch." : inspection.reason + " Đã lưu để chờ mở.", version: 1, updatedAt: Date.now(), attempt: { count: 0 } };
      this.data.schedules.push(s); await this.persist(); return { schedule: this.snapshot().schedules.find(x => x.id === s.id), claimKey: hash };
    }
    if (command === "arm") {
      const s = this.run(String(args.id));
      if (s.status !== "prepared") throw new Error("Lượt chưa sẵn sàng hoặc đã được bật trước đó.");
      if (!s.test && !limits.liveEnabled) throw new Error("Chưa được cấp quyền Live.");
      if (s.target.targetAt < Date.now() + 2000 || s.target.targetAt > limits.expiresAt) throw new Error("Giờ mở quá gần/đã qua hoặc vượt hạn quyền sử dụng.");
      if (this.data.schedules.filter(x => activeStatus(x.status)).length >= Math.min(MAX_ACCOUNTS, limits.maxConcurrent)) throw new Error("Đã đạt giới hạn lịch chạy đồng thời.");
      if (!s.test && args.claimKey !== s.identityHash) throw new Error("Thiếu khóa chống trùng từ website.");
      const version = s.version;
      const a = this.account(s.accountId); await this.checkIdentity(a);
      if (this.closed || s.version !== version || s.status !== "prepared") throw new Error("Lượt đã dừng hoặc thay đổi trong khi bật lịch.");
      if (createHash("sha256").update(JSON.stringify(a.personal)).digest("hex") !== createHash("sha256").update(JSON.stringify(s.personal)).digest("hex")) throw new Error("Hồ sơ đã đổi. Chuẩn bị lại trước khi bật lịch.");
      s.status = "armed"; s.updatedAt = Date.now(); s.message = "Lịch đã lưu trên máy; chờ giờ mở.";
      await this.persist();
      const mono = performance.now() + s.target.targetAt - Date.now();
      const cancelDispatch = atDeadline(mono, () => {
        this.timers.delete(s.id);
        const task = this.runLoop(s).finally(() => this.tasks.delete(s.id)); this.tasks.set(s.id, task);
      });
      const prechecks: Array<() => void> = [];
      for (const ahead of [30000, 5000]) if (s.target.targetAt - Date.now() > ahead + 1000) prechecks.push(atDeadline(mono - ahead, () => {
        void this.checkIdentity(a).catch(async () => {
          if (s.status === "armed") { this.stop(s, "Phiên ChineseTest không còn hợp lệ trước giờ mở. Đăng nhập và chuẩn bị lại."); await this.persist(); }
        }).catch(() => {});
      }));
      this.timers.set(s.id, () => { cancelDispatch(); for (const cancel of prechecks) cancel(); });
      return this.snapshot();
    }
    if (command === "reconcile") { const s = this.run(String(args.id)); await this.reconcile(s); return this.snapshot(); }
    if (command === "verify-absent") {
      const s = this.run(String(args.id));
      if (!args.confirm || !["uncertain", "failed"].includes(s.status)) throw new Error("Chỉ xác minh lượt chưa rõ kết quả sau khi kiểm tra Test Records và không còn hàng đợi.");
      const a = this.account(s.accountId); await this.checkIdentity(a);
      if (await existingRegistration(this.client(a), s.target)) throw new Error("Máy chủ vẫn có đăng ký, không mở khóa.");
      s.verifiedAbsent = true; s.message = "Đã ghi nhận xác minh chưa đăng ký; lượt mới cần chuẩn bị và bật lại."; await this.persist(); return this.snapshot();
    }
    throw new Error("Lệnh không được hỗ trợ.");
  }
  execute(command: Command, args: Row = {}, limits: Limits): Promise<any> {
    if (command === "state") return Promise.resolve(this.snapshot());
    // Stop can invalidate an in-flight read immediately, rather than wait behind it.
    if (command === "stop" || command === "stop-all") return this.executeWork(command, args, limits);
    const work = this.mutations.then(() => this.executeWork(command, args, limits));
    this.mutations = work.then(() => {}, () => {}); return work;
  }
  private async runLoop(s: Run) {
    const version = s.version, deadline = s.target.targetAt + s.target.waitMs;
    const check = () => this.checkpoint(s, version);
    const wait = async (ms: number) => {
      const end = Date.now() + ms;
      while (Date.now() < end) {
        check();
        await new Promise<void>(resolve => {
          let timer: ReturnType<typeof setTimeout>;
          const finish = () => { clearTimeout(timer); this.waits.get(s.id)?.delete(finish); resolve(); };
          if (!this.waits.has(s.id)) this.waits.set(s.id, new Set());
          this.waits.get(s.id)!.add(finish); timer = setTimeout(finish, Math.min(250, end - Date.now()));
        });
      }
      check();
    };
    try {
      check();
      if (Date.now() - s.target.targetAt > 2000) throw new Error("Runner thức dậy quá trễ. Không tự gửi lượt này.");
      const a = this.account(s.accountId), client = this.client(a);
      let failures = 0;
      while (Date.now() < deadline) {
        check(); s.status = "waiting_center"; s.message = "Đang chờ đúng điểm thi xuất hiện."; this.changed();
        let sites: Row[];
        try { sites = await this.sites(s.target); failures = 0; }
        catch (e) { if (e instanceof ApiError && (e.code === 429 || e.code === 503) && ++failures <= 3) { await wait(Math.max(s.target.intervalMs, Math.min(e.retryAfterMs || 2000, 60000))); continue; } throw e; }
        check();
        const result = await inspectTarget(client, s.target, s.personal, sites, check); check();
        if (!result.ready) { s.message = result.reason; this.changed(); await wait(s.target.intervalMs); continue; }
        s.status = "checking"; await this.checkIdentity(a); check();
        if (await existingRegistration(client, s.target)) throw new Error("Đã có đăng ký trên Test Records; không gửi trùng.");
        check();
        if (Date.now() >= deadline) throw new Error("Đã hết thời gian chờ trước khi gửi.");
        s.attempt.fee = result.fee; s.attempt.currency = result.currency;
        if (s.test) { s.status = "test_passed"; s.message = `Kiểm tra đạt: ${result.fee} ${result.currency}. Không gọi POST đăng ký.`; await this.persist(); return; }
        if (this.data.schedules.some(x => x !== s && x.identityHash === s.identityHash && (x.attempt.count > 0 || x.status === "reserved") && !x.verifiedAbsent)) throw new Error("Đã có lượt khác giữ khóa gửi.");
        s.status = "reserved"; s.message = "Đã khóa gửi một lần.";
        await this.persist(); check(); // A storage failure MUST prevent the POST.
        if (Date.now() >= deadline) throw new Error("Hết thời gian chờ trước khi gửi.");
        s.status = "sending"; s.attempt.count = 1; s.attempt.sentAt = Date.now(); s.attempt.lateMs = s.attempt.sentAt - s.target.targetAt;
        // 'reserved' is already durable. Any crash from here needs reconciliation.
        let response: Row;
        try { response = await client.submit(result.payload!); }
        catch { s.status = "uncertain"; s.message = "Chưa xác định đã tạo đơn hay chưa. Không gửi lại; đối chiếu Test Records."; await this.persist(); return; }
        s.attempt.receivedAt = Date.now();
        if (!response.orderNo) { s.status = "uncertain"; s.message = "API chưa trả mã đơn. Cần đối chiếu Test Records."; await this.persist(); return; }
        s.attempt.orderNo = String(response.orderNo); s.attempt.jfEndDate = String(response.jfEndDate || "");
        if (Number(response.onlinePay) === 2) { s.status = "accepted"; s.message = "Máy chủ đã tạo đơn. Kiểm tra thông tin và hạn nộp phí."; await this.persist(); return; }
        if (!response.messageKey) { s.status = "uncertain"; s.message = "Có mã đơn nhưng thiếu khóa tra cứu. Đối chiếu Test Records."; await this.persist(); return; }
        s.attempt.orderKey = `${response.orderNo},${response.messageKey}`;
        s.status = "queued"; s.message = "Máy chủ đang xử lý; chưa xác nhận có slot."; await this.persist();
        const pollUntil = Date.now() + 120000;
        while (s.status === "queued" && Date.now() < pollUntil && s.version === version && !this.closed) { await wait(2000); await this.reconcile(s); }
        return;
      }
      s.status = "stopped"; s.message = "Hết thời gian chờ, chưa gửi đăng ký."; await this.persist();
    } catch (e) {
      if (s.version === version && !this.closed) {
        s.status = s.attempt.count > 0 || s.status === "reserved" ? "uncertain" : "failed";
        s.message = (e as Error).message; s.updatedAt = Date.now();
        await this.persist().catch(() => { s.message = "Không lưu được trạng thái; dừng và giữ khóa gửi."; this.changed(); });
      }
    }
  }
  private async reconcile(s: Run) {
    const a = this.account(s.accountId); await this.checkIdentity(a); const client = this.client(a);
    if (s.attempt.orderKey) { const r = await client.order(s.attempt.orderKey); if (r.data?.bmid) { s.attempt.bmid = String(r.data.bmid); s.status = "confirmed"; s.message = "Máy chủ đã trả mã đăng ký. Kiểm tra và đóng phí đúng hạn."; await this.persist(); return; } }
    const row = await existingRegistration(client, s.target);
    if (row) { s.attempt.bmid = String(row.KSBM_bmid ?? row.bmid ?? ""); s.status = "confirmed"; s.message = "Đã đối chiếu thấy đăng ký trên Test Records."; await this.persist(); }
    else { s.message = "Chưa thấy kết quả cuối; giữ khóa gửi. Có thể đối chiếu lại sau."; this.changed(); }
  }
  async revoke() { for (const s of this.data.schedules) { if (activeStatus(s.status)) this.stop(s, "Thiết bị đã bị hủy liên kết."); s.personal = personalFrom({}); } for (const c of this.clients.values()) c.close(); this.clients.clear(); this.data.accounts = []; this.data.cloud = undefined; await this.login.close(); await this.persist(); }
  async close() { this.closed = true; clearInterval(this.health); for (const cancel of this.timers.values()) cancel(); this.timers.clear(); for (const s of this.data.schedules) if (activeStatus(s.status)) this.stop(s, "Runner đã dừng."); await this.login.close(); for (const c of this.clients.values()) c.close(); this.publicClient.close(); await Promise.allSettled(this.tasks.values()); await this.persist(); }
}
