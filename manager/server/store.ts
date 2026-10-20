import {returnedSubmissionAllowed} from '../../src/recovery';
import { DatabaseSync } from 'node:sqlite';
import { randomBytes, createHash } from 'node:crypto';
import {isDeepStrictEqual} from 'node:util';
import {canonicalFormId} from '../../src/protocol';
import type { SessionView, GroupView,ControlReceipt } from '../../src/protocol';
import type { RunState } from '../../src/shared';
import type { DataStore } from './data-store';

export const digest = (s: string | Buffer) => createHash('sha256').update(s).digest('hex');
export class Store implements DataStore {
  db: DatabaseSync;
  private sessionCache = new Map<string, SessionView>();
  private sessionCacheDirty = true;
  constructor(path: string) {
    this.db = new DatabaseSync(path);
    this.db.exec(`PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL;
      CREATE TABLE IF NOT EXISTS sessions(id TEXT PRIMARY KEY,token TEXT NOT NULL,data TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS groups(id TEXT PRIMARY KEY,data TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS registration_schedule(id INTEGER PRIMARY KEY CHECK(id=1),data TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS runs(id TEXT,session TEXT,data TEXT NOT NULL,seq INTEGER DEFAULT 0,PRIMARY KEY(id,session));
      CREATE TABLE IF NOT EXISTS locks(session TEXT,form TEXT,run TEXT,resolution TEXT,created TEXT,PRIMARY KEY(session,form,run));
      CREATE TABLE IF NOT EXISTS pairing(code TEXT PRIMARY KEY,expires INTEGER);
      CREATE TABLE IF NOT EXISTS attachments(session TEXT,id TEXT,hash TEXT,data BLOB,PRIMARY KEY(session,id));
      CREATE TABLE IF NOT EXISTS audit(id INTEGER PRIMARY KEY,at TEXT,session TEXT,run TEXT,kind TEXT,message TEXT);`);
    for (const s of this.sessions()) { s.connected = false; s.execution=undefined; if (s.run && !['completed','idle','ready_to_submit'].includes(s.run.status)) { s.run.status = s.run.submitAttempted ? 'submit_uncertain' : 'paused'; s.run.recoveryRequired = true; this.saveRun(s.id,s.run); } this.saveSession(s); }
    for(const group of this.groups())if(this.sessions().some(s=>s.run?.runId===group.id&&s.run.recoveryRequired)){group.paused=true;this.saveGroup(group);}
  }
  transaction<T>(fn: () => T): T { this.db.exec('BEGIN IMMEDIATE'); try { const value = fn(); this.db.exec('COMMIT'); return value; } catch (e) { this.db.exec('ROLLBACK');this.sessionCache.clear();this.sessionCacheDirty=true;throw e; } }
  private loadSessions(): SessionView[] { return (this.db.prepare('SELECT data FROM sessions').all() as {data:string}[]).map(r => JSON.parse(r.data)); }
  private rebuildCache() { if (!this.sessionCacheDirty) return; this.sessionCache.clear(); for (const s of this.loadSessions()) this.sessionCache.set(s.id, s); this.sessionCacheDirty = false; }
  sessions(): SessionView[] { this.rebuildCache(); return structuredClone([...this.sessionCache.values()]); }
  session(id: string): SessionView { this.rebuildCache(); const cached = this.sessionCache.get(id); if (cached) return structuredClone(cached); const r = this.db.prepare('SELECT data FROM sessions WHERE id=?').get(id) as {data:string}|undefined; if (!r) throw new Error('Không tìm thấy profile.'); const parsed = JSON.parse(r.data); this.sessionCache.set(id, parsed); return structuredClone(parsed); }
  saveSession(s: SessionView, token?: string) { if (token) this.db.prepare('INSERT INTO sessions VALUES(?,?,?)').run(s.id,digest(token),JSON.stringify(s)); else this.db.prepare('UPDATE sessions SET data=? WHERE id=?').run(JSON.stringify(s),s.id);this.sessionCache.set(s.id,structuredClone(s)); }
  saveControl(id:string,receipt:ControlReceipt,initial:boolean){
    const s=this.session(id);if(initial&&s.control&&s.control.requestedAt>receipt.requestedAt)return;
    if(!initial&&s.control?.commandId!==receipt.commandId||receipt.runId&&s.run?.runId!==receipt.runId)return;
    s.control=structuredClone(receipt);this.saveSession(s);
    this.audit(id,receipt.runId,`control_${receipt.state}`,`${receipt.kind} ${receipt.commandId}${receipt.error?`: ${receipt.error}`:''}`);
  }
  authenticate(id: string, token: string): boolean { const row = this.db.prepare('SELECT token FROM sessions WHERE id=?').get(id) as {token:string}|undefined; return !!row && row.token === digest(token); }
  pairCode() { const code = randomBytes(6).toString('hex').toUpperCase(); this.db.prepare('INSERT INTO pairing VALUES(?,?)').run(digest(code),Date.now()+300000); return code; }
  pair(id: string, code: string) { return this.transaction(() => {
    const row = this.db.prepare('SELECT expires FROM pairing WHERE code=?').get(digest(code.toUpperCase())) as {expires:number}|undefined;
    if (!row || row.expires < Date.now()) throw new Error('Mã liên kết hết hạn hoặc đã dùng.');
    this.db.prepare('DELETE FROM pairing WHERE code=?').run(digest(code.toUpperCase()));
    if (this.db.prepare('SELECT id FROM sessions WHERE id=?').get(id)) throw new Error('Profile đã liên kết.');
    const token = randomBytes(32).toString('hex');
    this.saveSession({id,name:`Profile ${this.sessions().length+1}`,expectedEmail:'',connected:true,lastSeen:new Date().toISOString(),revision:0,synced:false},token);
    this.audit(id,undefined,'pair','Đã liên kết profile.'); return token;
  }); }
  saveGroup(g: GroupView) { this.db.prepare('INSERT OR REPLACE INTO groups VALUES(?,?)').run(g.id,JSON.stringify(g)); }
  registrationSchedule():import('../../src/registration-schedule').RegistrationSchedule|undefined {const row=this.db.prepare('SELECT data FROM registration_schedule WHERE id=1').get() as {data:string}|undefined;return row?JSON.parse(row.data):undefined;}
  saveRegistrationSchedule(s:import('../../src/registration-schedule').RegistrationSchedule){this.db.prepare('INSERT OR REPLACE INTO registration_schedule VALUES(1,?)').run(JSON.stringify(s));}
  groups(): GroupView[] { return (this.db.prepare('SELECT data FROM groups ORDER BY rowid DESC').all() as {data:string}[]).map(r=>JSON.parse(r.data)); }
  group(id: string) { const r=this.db.prepare('SELECT data FROM groups WHERE id=?').get(id) as {data:string}|undefined; if (!r) throw new Error('Không tìm thấy lượt nhóm.'); return JSON.parse(r.data) as GroupView; }
  groupForRequest(requestId:string){const row=this.db.prepare("SELECT data FROM groups WHERE json_extract(data,'$.requestId')=? LIMIT 1").get(requestId) as {data:string}|undefined;return row?JSON.parse(row.data) as GroupView:undefined;}
  saveRun(session: string, run: RunState) { this.db.prepare('INSERT OR REPLACE INTO runs VALUES(?,?,?,?)').run(run.runId!,session,JSON.stringify(run),run.eventSeq ?? 0); }
  history(session: string) { return (this.db.prepare('SELECT data FROM runs WHERE session=? ORDER BY rowid DESC').all(session) as {data:string}[]).map(r=>JSON.parse(r.data) as RunState); }
  blocked(session: string, form: string) { return !!this.db.prepare("SELECT run FROM locks WHERE session=? AND form=? AND resolution!='not_received'").get(session,form); }
  acquireSubmit(session: string, run: string, form: string) { return this.transaction(()=>{
    const s=this.session(session);
    const locks=this.db.prepare("SELECT run,resolution FROM locks WHERE session=? AND form=? AND resolution!='not_received'").all(session,form) as {run:string;resolution:string}[];
    const old=this.db.prepare('SELECT resolution FROM locks WHERE session=? AND form=? AND run=?').get(session,form,run) as {resolution:string}|undefined;
    if (!s.run || s.run.runId !== run || s.run.mode !== 'live' || !['running','submitting'].includes(s.run.status) || this.group(run).paused || old&&old.resolution!=='local_reserved' || locks.some(l=>l.run!==run||l.resolution!=='local_reserved')) throw new Error('Quyền gửi đã bị khóa hoặc lượt không hoạt động.');
    this.db.prepare('INSERT OR REPLACE INTO locks VALUES(?,?,?,?,?)').run(session,form,run,'uncertain',new Date().toISOString());
    s.run.pendingReturnedRetry=undefined;s.run.submitAttempted=true; s.run.status='submitting'; this.saveRun(session,s.run); this.saveSession(s); this.audit(session,run,'submit_lock','Đã khóa quyền gửi.');
  }); }
  authorizeReturnedRetry(session:string,runId:string,epoch:string,retries:number){return this.transaction(()=>{
    const s=this.session(session),run=s.run,g=this.group(runId);
    if(run?.runId===runId&&run.autoContinue&&run.contentEpoch===epoch&&run.pendingReturnedRetry?.fromRetries===retries&&run.submissionRetries===retries+1&&!g.paused&&!g.stopped){run.pendingReturnedRetry.epoch=epoch;this.saveRun(session,run);this.saveSession(s);return;}
    if(!returnedSubmissionAllowed(run)||run!.runId!==runId||run!.contentEpoch!==epoch||(run!.submissionRetries??0)!==retries||g.paused||g.stopped||!g.members.includes(session))throw new Error('Lượt không được phép thử lại sau khi trở về form.');
    const locks=this.db.prepare("SELECT run,resolution FROM locks WHERE session=? AND form=? AND resolution!='not_received'").all(session,run!.formId) as {run:string;resolution:string}[];
    if(locks.some(l=>l.run!==runId||l.resolution==='received'))throw new Error('Form đã có kết quả hoặc thuộc lượt khác.');
    this.db.prepare("UPDATE locks SET resolution='local_reserved' WHERE session=? AND run=?").run(session,runId);
    run!.pendingReturnedRetry={epoch,fromRetries:retries};run!.submissionRetries=retries+1;run!.submitAttempted=false;run!.status='waiting_manual';run!.blockingIssue={reason:'navigation',message:'Form đã khôi phục; cho phép thử lại, có thể gửi trùng.'};
    this.saveRun(session,run!);this.saveSession(s);this.audit(session,runId,'returned_form_retry','Cho phép thử gửi lại trên form đã khôi phục; kết quả trước vẫn chưa rõ.');
  });}
  resolve(session: string, runId: string, result: 'received'|'not_received') {
    const s=this.session(session); if (!s.run || s.run.runId!==runId || !s.run.submitAttempted) throw new Error('Không có kết quả gửi cần xác minh.');
    this.db.prepare('UPDATE locks SET resolution=? WHERE session=? AND run=?').run(result,session,runId);
    s.run.status=result==='received'?'completed':'idle'; s.run.recoveryRequired=false; s.run.blockingIssue=undefined;
    this.saveRun(session,s.run); this.saveSession(s); this.audit(session,runId,'manual_resolution',result==='received'?'User xác minh đã gửi.':'User xác minh chưa gửi; giữ khóa lượt cũ.');
  }
  saveAttachment(session: string,id: string,bytes: Buffer,hash: string) { if (digest(bytes)!==hash) throw new Error('Mã băm ảnh không khớp.'); this.db.prepare('INSERT OR REPLACE INTO attachments VALUES(?,?,?,?)').run(session,id,hash,bytes); }
  attachment(session: string,id: string) { const r=this.db.prepare('SELECT data,hash FROM attachments WHERE session=? AND id=?').get(session,id) as {data:Uint8Array;hash:string}|undefined; if (!r) throw new Error('Chưa đồng bộ ảnh.'); return {data:Buffer.from(r.data),hash:r.hash}; }
  attachmentInfo(session:string,id:string){const a=this.attachment(session,id);return {size:a.data.length,hash:a.hash};}
  audit(session: string|undefined,run: string|undefined,kind: string,message: string) { this.db.prepare('INSERT INTO audit(at,session,run,kind,message) VALUES(?,?,?,?,?)').run(new Date().toISOString(),session??null,run??null,kind,message); }
  close(){this.db.close();}
  touch(id:string){const s=this.session(id);s.lastSeen=new Date().toISOString();this.saveSession(s);}
  connected(id:string,value:boolean){this.transaction(()=>{
    const s=this.session(id);s.connected=value;
    if(value)s.lastSeen=new Date().toISOString();
    else {s.execution=undefined;s.error='Mất kết nối. Mở lại profile và đối chiếu trước khi tiếp tục.';if(s.run&&!['completed','idle','ready_to_submit'].includes(s.run.status)){s.run.status=s.run.submitAttempted?'submit_uncertain':'paused';s.run.recoveryRequired=true;this.saveRun(id,s.run);}}
    this.saveSession(s);
  });}
  beginGroup(group:GroupView,sessions:SessionView[],append=false){this.transaction(()=>{
    if(append){const current=this.group(group.id);if(current.paused||current.stopped||current.requestSignature!==group.requestSignature||sessions.some(s=>!current.members.includes(s.id)))throw new Error('Nhóm đã dừng hoặc thay đổi; không bắt đầu profile.');}
    for(const requested of sessions){const current=this.session(requested.id);
      if(!current.connected||!current.synced||current.execution||current.conflict||current.revision!==requested.revision||!isDeepStrictEqual(current.profile,requested.profile)||current.run&&!['idle','completed','ready_to_submit','failed','submit_uncertain'].includes(current.run.status))throw new Error('Profile vừa thay đổi hoặc đang có lượt chạy. Đọc lại trạng thái.');
      const form=canonicalFormId(group.url);if(form&&this.blocked(current.id,form))throw new Error('Form có khóa gửi. Xác minh trước khi chạy lại.');
    }
    if(!append)this.saveGroup(group);for(const s of sessions){this.saveRun(s.id,s.run!);this.saveSession(s);}
  });}
  recordStartResult(id:string,result:import('../../src/protocol').StartResult){this.transaction(()=>{const g=this.group(id);g.startResults=[...(g.startResults??[]).filter(r=>r.id!==result.id),result];this.saveGroup(g);});}
  acceptProgress(id:string,run:RunState){return this.transaction(()=>{
    const s=this.session(id);
    if(!run||!s.run||(run.submissionRetries??0)!==(s.run.submissionRetries??0)||run.runId!==s.run.runId||run.sessionId!==id||!Number.isSafeInteger(run.eventSeq)||(run.eventSeq??0)<=(s.run.eventSeq??0)||s.run.submitAttempted&&!run.submitAttempted)return false;
    if(this.group(run.runId!).paused&&run.status==='running')return false;
    if(s.run.formId&&run.formId!==s.run.formId)return false;
    s.run={...run,mode:s.run.mode,managed:true,retryOnReturn:s.run.retryOnReturn,pendingReturnedRetry:s.run.pendingReturnedRetry,url:s.run.url,expectedEmail:s.run.expectedEmail,profileRevision:s.run.profileRevision,startedAt:s.run.startedAt,profileSnapshot:s.run.profileSnapshot,finalQuestion:s.run.finalQuestion};
    if(run.submitAttempted&&run.formId)this.db.prepare('INSERT OR IGNORE INTO locks VALUES(?,?,?,?,?)').run(id,run.formId,run.runId!,'local_reserved',new Date().toISOString());
    if(run.status==='completed'&&run.submitAttempted)this.db.prepare("UPDATE locks SET resolution='received' WHERE session=? AND run=?").run(id,run.runId!);
    s.error=run.blockingIssue?.message??(run.status==='failed'?run.logs.at(-1)?.message:undefined);
    this.saveRun(id,s.run);this.saveSession(s);return true;
  });}
}
