import { createHash, randomUUID } from "node:crypto";
import { performance } from "node:perf_hooks";
import { identityKeys, fingerprint } from "../../hcmue/crypto";
import { atDeadline } from "../../hcmue/runner/deadline";
import { activeStatus, personalFrom, validatePersonal, validateTarget, MAX_ACCOUNTS, type ProfileSyncStatus, type Row, type Personal, type Target, type AccountView, type Run, type RunnerState, type Command, type Limits, type Plan } from "../protocol";
import { ChineseTestClient, ApiError, invalidSession, transientFailure, type Session } from "./client";
import { LoginWindow } from "./login";
import { candidateKey, inspectTarget, existingRegistration, centerFrom, readFeeQuote } from "./checks";

interface Account { view: AccountView; session: Session; personal: Personal; photoVersion?: string; syncedPhotoVersion?: string; pendingPortrait?: {path:string;version:string} }
export interface RunnerData { id: string; name: string; keys: Awaited<ReturnType<typeof identityKeys>>; accounts: Account[]; schedules: Run[]; plans: Record<string,Plan>; seen: string[]; cloud?: { origin: string; token: string; owner?: string } }
export const freshData = async (name: string): Promise<RunnerData> => ({ id: randomUUID(), name, keys: await identityKeys(), accounts: [], schedules: [], plans: {}, seen: [] });
type Login = Pick<LoginWindow, "open" | "finish" | "close" | "pending">;
export class Engine {
  private clients = new Map<string, ChineseTestClient>();
  private identityChecks = new Map<string, Promise<void>>();
  private timers = new Map<string, () => void>();
  private sessionTimers = new Map<string, () => void>();
  private tasks = new Map<string, Promise<void>>();
  private waits = new Map<string, Set<() => void>>();
  private publicClient: ChineseTestClient;
  private discoveries = new Map<string, { at: number; pending: boolean; promise: Promise<Row[]> }>();
  private writes: Promise<void> = Promise.resolve();
  private commands: Array<{command:Command;args:Row;limits:Limits;resolve(value:any):void;reject(error:unknown):void}>=[];
  private draining=false;
  private syncJobs=new Map<string,ProfileSyncStatus & {signature:string;createdAt:number}>();
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
    return { protocolVersion: 1, profileSyncVersion: 1, profileSyncJobsVersion: 1, photoFlowVersion:2, enrollmentChecksVersion:1, deviceId: this.data.id, name: this.data.name, platform: process.platform,
      accounts: this.data.accounts.map(a => ({ ...a.view })), plans: structuredClone(this.data.plans), schedules: this.data.schedules.map(({ personal: _p, identityHash: _h, accountKey: _k, ...s }) => {
        const { orderKey: _secret, ...attempt } = s.attempt; return structuredClone({ ...s, attempt });
      }), loginPending: this.login.pending, now: new Date().toISOString(), eventLoopLagMs: this.lag };
  }
  private account(id: string) { const a = this.data.accounts.find(a => a.view.id === id); if (!a) throw new Error("Không tìm thấy tài khoản trên máy này."); return a; }
  private client(a: Account) { let c = this.clients.get(a.view.id); if (!c) { c = this.factory(a.session); this.clients.set(a.view.id, c); } return c; }
  private view(a: Account) { a.view.name = a.personal.ksEName || a.session.email; a.view.maskedId = a.personal.idNo ? "•••• " + a.personal.idNo.slice(-4) : "Chưa có giấy tờ"; a.view.hasPhoto = Boolean(a.personal.photo) && !a.pendingPortrait && (!a.photoVersion || a.photoVersion === a.syncedPhotoVersion); }
  private photoReady(a: Account) { if (a.pendingPortrait || a.photoVersion && a.photoVersion !== a.syncedPhotoVersion) throw new Error("Ảnh mới chưa được đọc lại từ ChineseTest. Mở Hồ sơ / ảnh để kiểm tra ảnh trước khi tiếp tục."); }
  private async readPortrait(a: Account, path: string) {
    try { return await this.client(a).photo(path); }
    catch(e) { if(e instanceof ApiError && [401,403].includes(e.code || 0))await this.checkIdentity(a); throw e; }
  }
  private run(id: string) { const s = this.data.schedules.find(s => s.id === id); if (!s) throw new Error("Không tìm thấy lượt chạy."); return s; }
  private checkpoint(s: Run, version: number) { if (this.closed || s.version !== version || !activeStatus(s.status)) throw new Error("Lượt đã dừng hoặc thay đổi."); }
  private ensureEditable(a: Account) { if (this.data.schedules.some(s => s.accountKey === a.session.key && activeStatus(s.status))) throw new Error("Dừng lịch của tài khoản trước khi sửa hồ sơ/ảnh hoặc đăng nhập lại."); }
  private stop(s: Run, reason = "Đã dừng theo yêu cầu.") { this.timers.get(s.id)?.(); this.timers.delete(s.id); this.sessionTimers.get(s.id)?.(); s.version++; s.status = s.attempt.count > 0 ? "uncertain" : "stopped"; s.message = s.attempt.count > 0 ? reason + " Request đã gửi có thể tiếp tục trên máy chủ; giữ khóa gửi." : reason; s.updatedAt = Date.now(); for (const wake of this.waits.get(s.id) || []) wake(); }
  private maintainSession(s: Run, a: Account) {
    const version=s.version, session=a.session;
    let timer: ReturnType<typeof setTimeout>, cancelled=false;
    const cancel=()=>{cancelled=true;clearTimeout(timer);if(this.sessionTimers.get(s.id)===cancel)this.sessionTimers.delete(s.id);};
    const current=()=>!cancelled&&!this.closed&&s.version===version&&a.session===session&&s.attempt.count===0&&["armed","waiting_center","checking"].includes(s.status);
    const schedule=(delay:number)=>{timer=setTimeout(()=>{void tick();},delay);timer.unref?.();};
    const tick=async()=>{
      if(!current()){cancel();return;}
      let delay=5*60000;
      try{await this.checkIdentity(a);if(!current())return;await this.persist();}
      catch(e){
        if(!current())return;
        if(transientFailure(e)){
          delay=Math.max(delay,e instanceof ApiError?e.retryAfterMs || 0:0);
          s.message=`Chưa kiểm tra được phiên do lỗi tạm thời: ${(e as Error).message} Sẽ kiểm tra lại trước khi gửi; chưa gửi đăng ký.`;s.updatedAt=Date.now();
        }else this.stop(s,`Kiểm tra phiên định kỳ thất bại: ${(e as Error).message} Chưa gửi đăng ký; xử lý nguyên nhân rồi chuẩn bị lại.`);
        await this.persist().catch(()=>{});
      }finally{if(current())schedule(delay);else cancel();}
    };
    this.sessionTimers.get(s.id)?.();this.sessionTimers.set(s.id,cancel);schedule(5*60000);
  }
  private async sites(t: Target) {
    const key = JSON.stringify([t.kmId, t.ksType, t.ksDate]);
    const cached = this.discoveries.get(key);
    if (cached && (cached.pending || Date.now() - cached.at < t.intervalMs)) return cached.promise;
    const entry = { at: Date.now(), pending: true, promise: this.publicClient.sites(t.kmId, t.ksType, t.ksDate).then(r => { if (!Array.isArray(r.data)) throw new Error("Cấu trúc danh sách điểm thi đã đổi."); return r.data as Row[]; }).finally(() => { entry.pending = false; entry.at = Date.now(); }) };
    this.discoveries.set(key, entry);
    try { return await entry.promise; } catch (e) { this.discoveries.delete(key); throw e; }
  }
  private checkIdentity(a: Account): Promise<void> {
    const pending = this.identityChecks.get(a.view.id); if (pending) return pending;
    const session = a.session;
    const work = (async () => {
      try { const identity = await this.client(a).identity(); if (a.session !== session) throw new ApiError("Phiên đã được thay mới trong khi kiểm tra.", undefined, undefined, "identity", "identity"); if (identity.key !== session.key) throw new ApiError("Tài khoản trong phiên đã đổi.", undefined, undefined, "identity", "identity"); a.view.loggedIn = true; }
      catch (e) { if (a.session === session && invalidSession(e)) a.view.loggedIn = false; throw e; }
    })().finally(() => { if (this.identityChecks.get(a.view.id) === work) this.identityChecks.delete(a.view.id); });
    this.identityChecks.set(a.view.id, work); return work;
  }
  private async executeWork(command: Command, args: Row, limits: Limits): Promise<any> {
    if (this.closed) throw new Error("Runner đang dừng.");
    if (command === "state") return this.snapshot();
    if(command==="profile-sync-status"){
      const job=this.syncJobs.get(String(args.id));
      if(!job || job.accountId!==args.accountId)throw new Error("Runner đã khởi động lại hoặc không còn lượt đồng bộ này. Mở lại hồ sơ và bấm Lưu hồ sơ để tiếp tục.");
      const {signature:_signature,createdAt:_created,...status}=job;return structuredClone(status);
    }
    if(command==="start-profile-sync" || command==="start-photo-upload" || command==="start-photo-read"){
      const a=this.account(String(args.accountId));this.ensureEditable(a);
      for(const [id,job] of this.syncJobs)if(["done","failed"].includes(job.phase)&&Date.now()-job.createdAt>10*60000)this.syncJobs.delete(id);
      const personal=personalFrom(args.personal || {});
      const signature=createHash("sha256").update(JSON.stringify({command,...personal,photo:"",photoVersion:args.photoVersion || null,bytes:command==="start-photo-upload"?createHash("sha256").update(String(args.base64 || "")).digest("hex"):undefined})).digest("hex");
      const pending=[...this.syncJobs.values()].find(j=>j.accountId===a.view.id&&!["done","failed"].includes(j.phase));
      if(pending){if(pending.signature!==signature && command!=="start-photo-read")throw new Error("Máy đang đồng bộ một bản hồ sơ khác của tài khoản này. Chờ hoàn tất rồi lưu bản mới.");return {id:pending.id};}
      for(const [id,job] of this.syncJobs)if(job.accountId===a.view.id)this.syncJobs.delete(id);
      if(this.syncJobs.size>=MAX_ACCOUNTS)throw new Error("Máy đang đồng bộ nhiều hồ sơ. Chờ hoàn tất rồi thử lại.");
      if(typeof args.base64==="string"&&args.base64.length>1_400_000)throw new Error("Ảnh quá lớn.");
      const job:ProfileSyncStatus & {signature:string;createdAt:number}={id:randomUUID(),accountId:a.view.id,phase:"queued",signature,createdAt:Date.now()};
      this.syncJobs.set(job.id,job);
      void this.execute(command==="start-photo-read"?"read-photo":command==="start-photo-upload"?"upload-photo":"save-profile",{...args,personal,syncJobId:job.id},limits).then(result=>{job.result=result;job.phase="done";},error=>{job.error=(error as Error).message;job.phase="failed";}).finally(()=>{
        // Read-back bytes are for the active UI only, never durable photo storage.
        const timer=setTimeout(()=>{if(this.syncJobs.get(job.id)===job)this.syncJobs.delete(job.id);},10*60000);timer.unref?.();
      });
      return {id:job.id};
    }
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
      if (a) { this.ensureEditable(a); this.clients.get(a.view.id)?.close(); this.clients.delete(a.view.id); this.identityChecks.delete(a.view.id); a.session = session; a.view.loggedIn = true; }
      else {
        if (this.data.accounts.length >= Math.min(MAX_ACCOUNTS, limits.maxAccounts)) throw new Error("Đã đạt giới hạn tài khoản.");
        a = { session, view: { id: randomUUID(), email: session.email, name: session.email, maskedId: "", hasPhoto: false, loggedIn: true }, personal: personalFrom({}) }; this.data.accounts.push(a);
      }
      const profile = await this.client(a).profile();
      if (!a.personal.ksEName && profile.data && typeof profile.data === "object") a.personal = personalFrom({...profile.data,...Object.fromEntries(Object.entries(a.personal).filter(([,v])=>v!==""))});
      this.view(a); await this.persist(); await this.login.close(); this.loginAccountId = undefined;
      return { account: a.view, personal: a.personal };
    }
    if (command === "catalog") {
      const kind = String(args.kind || "projects");
      if (kind === "projects") return this.publicClient.options();
      if (kind === "subjects") return this.publicClient.subjects(String(args.projectId));
      if (kind === "dates") return this.publicClient.dates(String(args.kmId), String(args.ksType));
      if (kind === "directory") return { code: 200, data: await this.publicClient.directory(String(args.ksType)) };
      if (kind === "sites") return this.publicClient.sites(String(args.kmId), String(args.ksType), String(args.ksDate));
      const common: Record<string, string> = { countries: "/common/countryList", languages: "/common/firstLanguageList", professions: "/common/getProfessionList", config: "/common/config" };
      if (!common[kind]) throw new Error("Danh mục không được hỗ trợ.");
      return this.publicClient.call(common[kind], kind === "professions" ? { parentId: String(args.parentId || "") } : undefined);
    }
    if (["read-profile", "read-photo", "stage-profile", "quote-fee", "inspect", "save-profile", "upload-photo", "remove", "prepare"].includes(command)) {
      const a = this.account(String(args.accountId)); const client = this.client(a);
      if (command === "read-profile") return { personal: structuredClone(a.personal), photoVersion: a.photoVersion, syncedPhotoVersion: a.syncedPhotoVersion, pendingPhoto:Boolean(a.pendingPortrait),profileSyncJobsVersion:1,photoFlowVersion:2 };
      if (command === "read-photo") {
        const job=this.syncJobs.get(String(args.syncJobId));if(job)job.phase="checking-session";
        await this.checkIdentity(a);
        const pending=a.pendingPortrait;
        if(pending || !a.syncedPhotoVersion || a.photoVersion!==a.syncedPhotoVersion)this.ensureEditable(a);
        if(job)job.phase="reading-photo";
        const image=await this.readPortrait(a,pending?.path || a.personal.photo);
        if(pending || !a.syncedPhotoVersion || a.photoVersion!==a.syncedPhotoVersion){
          const previous=structuredClone(a);
          a.personal.photo=image.path;a.photoVersion=a.syncedPhotoVersion=pending?.version || a.syncedPhotoVersion || randomUUID();delete a.pendingPortrait;this.view(a);
          try{await this.persist();}catch(e){Object.assign(a,previous);throw e;}
        }
        return {personal:structuredClone(a.personal),photoVersion:a.syncedPhotoVersion || null,image};
      }
      if (command === "stage-profile") {
        this.ensureEditable(a);
        if (typeof args.photoVersion !== "string" || !/^[a-f0-9-]{36}$/.test(args.photoVersion)) throw new Error("Phiên bản ảnh không hợp lệ.");
        a.photoVersion=args.photoVersion; this.view(a); await this.persist(); return { staged:true };
      }
      if (command === "quote-fee") {
        const t=args.target as Target;
        validateTarget({...t,feeQuote:undefined,maxFee:undefined,currency:undefined});
        await this.checkIdentity(a);
        const sites=await this.sites(t);
        const center=centerFrom(sites,t) || centerFrom(await this.publicClient.directory(t.ksType),t);
        if (!center) throw new Error("Chưa tìm thấy điểm thi để lấy lệ phí. Chọn điểm thi trong danh mục.");
        return readFeeQuote(client,t,center);
      }
      if (command === "remove") {
        if (this.data.schedules.some(s => s.accountKey === a.session.key && ["uncertain", "reserved", "sending", "queued"].includes(s.status))) throw new Error("Đối chiếu lượt chưa rõ kết quả trước khi gỡ tài khoản.");
        this.ensureEditable(a); client.close(); this.clients.delete(a.view.id);
        this.data.accounts = this.data.accounts.filter(x => x !== a); await this.persist(); return this.snapshot();
      }
      if (command === "save-profile") {
        this.ensureEditable(a);
        const job=this.syncJobs.get(String(args.syncJobId));
        const previousPersonal=structuredClone(a.personal), previousSynced=a.syncedPhotoVersion;
        const personal=personalFrom(args.personal || {});
        // Photo paths are owned by the upload, not the caller's possibly stale form.
        personal.photo=a.personal.photo;
        const version=args.photoVersion;
        if(args.photoFlowVersion===2)this.photoReady(a);
        if (a.photoVersion && version !== a.photoVersion) throw new Error("Ảnh đã thay đổi. Mở lại hồ sơ để lưu phiên bản mới nhất.");
        if (version && (typeof version !== "string" || !/^[a-f0-9-]{36}$/.test(version))) throw new Error("Phiên bản ảnh không hợp lệ.");
        validatePersonal({...personal,photo:personal.photo || "/pending/portrait"});
        if (version && (a.syncedPhotoVersion !== version || !personal.photo)) {
          a.photoVersion=version; this.view(a); await this.persist();
          if (typeof args.base64 !== "string" || args.base64.length > 1_400_000) throw new Error("Cần chọn lại ảnh để tải lên ChineseTest.");
          if(job)job.phase="checking-session";
          await this.checkIdentity(a);
          if(job)job.phase="uploading";
          const path=await client.upload(Buffer.from(args.base64,"base64"),String(args.mimeType));
          if(job)job.phase="reading-photo";
          await this.readPortrait(a,path);
          a.personal.photo=path; a.syncedPhotoVersion=version; personal.photo=path;
        }
        validatePersonal(personal);
        if(job)job.phase="saving";
        a.personal=personal; this.view(a);
        try { await this.persist(); }
        catch(e) { a.personal=previousPersonal; a.syncedPhotoVersion=previousSynced; this.view(a); throw e; }
        return { personal:structuredClone(a.personal), photoVersion:a.syncedPhotoVersion || null };
      }
      if (command === "upload-photo") {
        this.ensureEditable(a);
        const job=this.syncJobs.get(String(args.syncJobId));
        if(job)job.phase="checking-session";
        await this.checkIdentity(a);
        if (typeof args.base64 !== "string" || args.base64.length > 1400000) throw new Error("Ảnh quá lớn.");
        const version=String(args.photoVersion || "");
        if(!/^[a-f0-9-]{36}$/.test(version))throw new Error("Phiên bản ảnh không hợp lệ.");
        if(a.syncedPhotoVersion===version&&!a.pendingPortrait){const image=await this.readPortrait(a,a.personal.photo);return {personal:structuredClone(a.personal),photoVersion:version,image};}
        if(a.pendingPortrait?.version!==version){
          if(job)job.phase="uploading";
          const path=await client.upload(Buffer.from(args.base64, "base64"), String(args.mimeType));
          a.pendingPortrait={path,version};this.view(a);await this.persist();
        }
        if(job)job.phase="reading-photo";
        const image=await this.readPortrait(a,a.pendingPortrait!.path);
        const previous={personal:structuredClone(a.personal),version:a.photoVersion,synced:a.syncedPhotoVersion,pending:a.pendingPortrait};
        a.personal.photo=a.pendingPortrait!.path;a.photoVersion=a.syncedPhotoVersion=version;delete a.pendingPortrait;
        this.view(a);
        try{await this.persist();}catch(e){a.personal=previous.personal;a.photoVersion=previous.version;a.syncedPhotoVersion=previous.synced;a.pendingPortrait=previous.pending;this.view(a);throw e;}
        return { personal: structuredClone(a.personal), photoVersion:version,image };
      }
      await this.checkIdentity(a);
      if (args.refreshProfile === true) { this.ensureEditable(a); const p = await client.profile(); a.personal = personalFrom({...p.data,photo:a.personal.photo || p.data?.photo}); this.view(a); await this.persist(); }
      if (command === "inspect" && !args.target) return { personal: a.personal, account: a.view };
      this.photoReady(a);
      const target = structuredClone(args.target) as Target; validateTarget(target); validatePersonal(a.personal);
      if (command === "prepare" && !target.feeQuote && target.maxFee === undefined) throw new Error("Chờ lấy lệ phí ChineseTest rồi chuẩn bị lại.");
      const projects = await this.publicClient.options();
      if (!projects.data?.projectList?.some((p: Row) => String(p.KMID) === target.projectId)) throw new Error("Loại thi không còn trong danh mục.");
      const subjects = await this.publicClient.subjects(target.projectId);
      if (!Array.isArray(subjects.data) || !subjects.data.some((s: Row) => String(s.KMID) === target.kmId)) throw new Error("Cấp thi không thuộc loại thi đã chọn.");
      const duplicate = await existingRegistration(client, target);
      if (duplicate) throw new Error("Test Records đã có đăng ký cùng cấp/ngày. Không tạo lượt mới.");
      const inspection = await inspectTarget(client, target, a.personal, await this.sites(target));
      this.photoReady(a);
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
      const a = this.account(s.accountId); this.photoReady(a); await this.checkIdentity(a);
      this.photoReady(a);
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
        void this.checkIdentity(a).then(async () => {
          if (s.status === "armed" && s.version === version && !this.closed) { s.message = "Đã kiểm tra phiên trước giờ mở; tiếp tục chờ lịch."; s.updatedAt = Date.now(); await this.persist(); }
        }).catch(async e => {
          if (s.status !== "armed" || s.version !== version || this.closed) return;
          const reason = (e as Error).message;
          if (transientFailure(e)) { s.message = `Chưa kiểm tra được phiên do lỗi tạm thời: ${reason} Sẽ kiểm tra lại trước khi gửi; chưa gửi đăng ký.`; s.updatedAt = Date.now(); }
          else this.stop(s, `Kiểm tra phiên trước giờ mở thất bại: ${reason} Chưa gửi đăng ký; xử lý nguyên nhân rồi chuẩn bị lại.`);
          await this.persist();
        }).catch(() => {});
      }));
      this.timers.set(s.id, () => { cancelDispatch(); for (const cancel of prechecks) cancel(); });
      this.maintainSession(s,a);
      return this.snapshot();
    }
    if (command === "reconcile") { const s = this.run(String(args.id)); await this.reconcile(s); return this.snapshot(); }
    if (command === "verify-absent") {
      const s = this.run(String(args.id));
      if (s.verifiedAbsent) return this.snapshot();
      if (args.confirm !== true || !["uncertain", "failed", "accepted", "confirmed"].includes(s.status)) throw new Error("Chỉ xác minh lượt chưa rõ kết quả hoặc đã hủy sau khi kiểm tra Test Records và không còn hàng đợi.");
      if (this.tasks.has(s.id)) throw new Error("Lượt vẫn đang gửi hoặc đối chiếu. Dừng lượt và chờ xử lý hoàn tất trước khi mở khóa.");
      const a = this.account(s.accountId); await this.checkIdentity(a);
      if (await existingRegistration(this.client(a), s.target)) throw new Error("Máy chủ vẫn có đăng ký, không mở khóa.");
      const previous = { status: s.status, message: s.message, updatedAt: s.updatedAt, version: s.version };
      s.verifiedAbsent = true; s.verifiedAbsentAt = Date.now(); s.version++; s.updatedAt = Date.now(); s.status = "released";
      s.message = "Đã xác minh Test Records không còn đăng ký cùng cấp/ngày và ghi nhận xác nhận của bạn. Đã mở khóa; chuẩn bị và bật lượt mới để đăng ký lại.";
      try { await this.persist(); } catch (e) { Object.assign(s, previous); delete s.verifiedAbsent; delete s.verifiedAbsentAt; throw e; }
      return this.snapshot();
    }
    throw new Error("Lệnh không được hỗ trợ.");
  }
  execute(command: Command, args: Row = {}, limits: Limits): Promise<any> {
    if (command === "state") return Promise.resolve(this.snapshot());
    // Stop can invalidate an in-flight read immediately, rather than wait behind it.
    if (["read-profile","stage-profile","start-profile-sync","start-photo-upload","start-photo-read","profile-sync-status","stop","stop-all"].includes(command)) return this.executeWork(command,args,limits);
    return new Promise((resolve,reject)=>{
      this.commands.push({command,args,limits,resolve,reject});
      void this.drainCommands();
    });
  }
  private async drainCommands(){
    if(this.draining)return;this.draining=true;
    try{while(this.commands.length){
      // Finish the current read, then prioritize saves/login over queued catalogs.
      const priority=this.commands.findIndex(item=>!["catalog","quote-fee"].includes(item.command));
      const [item]=this.commands.splice(priority<0?0:priority,1);
      try{item.resolve(await this.executeWork(item.command,item.args,item.limits));}catch(e){item.reject(e);}
    }}finally{this.draining=false;}
  }
  private async runLoop(s: Run) {
    const version = s.version, deadline = s.target.targetAt + s.target.waitMs;
    const check = () => this.checkpoint(s, version);
    const wait = async (ms: number) => {
      // Yield even with zero delay so stop/IO can run; never overlap discovery calls.
      if (ms === 0) { await new Promise<void>(resolve => setImmediate(resolve)); check(); return; }
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
        s.status = "checking";
        for (let attempt = 0; ; attempt++) {
          try { await this.checkIdentity(a); check(); break; }
          catch (e) {
            check();
            const backoff = Math.max(1000, Math.min(e instanceof ApiError ? e.retryAfterMs || 1000 : 1000, 60000));
            if (attempt > 0 || !transientFailure(e) || Date.now() + backoff >= deadline) throw new Error(`Không xác minh được phiên trước khi gửi: ${(e as Error).message} Chưa gửi đăng ký.`);
            s.message = `Kiểm tra phiên gặp lỗi tạm thời: ${(e as Error).message} Đang kiểm tra lại, chưa gửi đăng ký.`; this.changed(); await wait(backoff);
          }
        }
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
    } finally { this.sessionTimers.get(s.id)?.(); }
  }
  private async reconcile(s: Run) {
    if (s.verifiedAbsent) return;
    const version = s.version;
    const a = this.account(s.accountId); await this.checkIdentity(a); const client = this.client(a);
    const row = await existingRegistration(client, s.target);
    if (s.verifiedAbsent || s.version !== version) return;
    if (row) { s.attempt.bmid = String(row.KSBM_bmid ?? row.bmid ?? ""); s.status = "confirmed"; s.message = "Đã đối chiếu thấy đăng ký trên Test Records."; await this.persist(); }
    else if (["accepted", "confirmed"].includes(s.status)) {
      s.message = "Test Records không còn đăng ký cùng cấp/ngày. Nếu bạn đã hủy trên ChineseTest và không còn đơn xử lý, chọn Xác minh đã hủy / đăng ký lại để mở khóa."; await this.persist();
    } else if (s.attempt.orderKey) {
      const r = await client.order(s.attempt.orderKey);
      if (s.verifiedAbsent || s.version !== version) return;
      if (r.data?.bmid) { s.attempt.bmid = String(r.data.bmid); s.status = "confirmed"; s.message = "Máy chủ đã trả mã đăng ký. Kiểm tra Test Records và đóng phí đúng hạn."; await this.persist(); }
      else { s.message = "Chưa thấy kết quả cuối; giữ khóa gửi. Có thể đối chiếu lại sau."; this.changed(); }
    } else { s.message = "Chưa thấy kết quả cuối; giữ khóa gửi. Có thể đối chiếu lại sau."; this.changed(); }
  }
  async revoke() { for (const s of this.data.schedules) { if (activeStatus(s.status)) this.stop(s, "Thiết bị đã bị hủy liên kết."); s.personal = personalFrom({}); } for (const c of this.clients.values()) c.close(); this.clients.clear(); this.data.accounts = []; this.data.cloud = undefined; await this.login.close(); await this.persist(); }
  async close() { this.closed = true; clearInterval(this.health); for (const cancel of this.timers.values()) cancel(); this.timers.clear(); for (const s of this.data.schedules) if (activeStatus(s.status)) this.stop(s, "Runner đã dừng."); await this.login.close(); for (const c of this.clients.values()) c.close(); this.publicClient.close(); await Promise.allSettled(this.tasks.values()); await this.persist(); }
}
