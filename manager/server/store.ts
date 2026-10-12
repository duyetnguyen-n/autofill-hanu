import { DatabaseSync } from 'node:sqlite';
import { randomBytes, createHash } from 'node:crypto';
import type { SessionView, GroupView } from '../../src/protocol';
import type { RunState } from '../../src/shared';

export const digest = (s: string | Buffer) => createHash('sha256').update(s).digest('hex');
export class Store {
  db: DatabaseSync;
  constructor(path: string) {
    this.db = new DatabaseSync(path);
    this.db.exec(`PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL;
      CREATE TABLE IF NOT EXISTS sessions(id TEXT PRIMARY KEY,token TEXT NOT NULL,data TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS groups(id TEXT PRIMARY KEY,data TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS runs(id TEXT,session TEXT,data TEXT NOT NULL,seq INTEGER DEFAULT 0,PRIMARY KEY(id,session));
      CREATE TABLE IF NOT EXISTS locks(session TEXT,form TEXT,run TEXT,resolution TEXT,created TEXT,PRIMARY KEY(session,form,run));
      CREATE TABLE IF NOT EXISTS pairing(code TEXT PRIMARY KEY,expires INTEGER);
      CREATE TABLE IF NOT EXISTS attachments(session TEXT,id TEXT,hash TEXT,data BLOB,PRIMARY KEY(session,id));
      CREATE TABLE IF NOT EXISTS audit(id INTEGER PRIMARY KEY,at TEXT,session TEXT,run TEXT,kind TEXT,message TEXT);`);
    for (const s of this.sessions()) { s.connected = false; if (s.run && !['completed','idle','ready_to_submit'].includes(s.run.status)) { s.run.status = s.run.submitAttempted ? 'submit_uncertain' : 'paused'; s.run.recoveryRequired = true; this.saveRun(s.id,s.run); } this.saveSession(s); }
    for(const group of this.groups())if(this.sessions().some(s=>s.run?.runId===group.id&&s.run.recoveryRequired)){group.paused=true;this.saveGroup(group);}
  }
  transaction<T>(fn: () => T): T { this.db.exec('BEGIN IMMEDIATE'); try { const value = fn(); this.db.exec('COMMIT'); return value; } catch (e) { this.db.exec('ROLLBACK'); throw e; } }
  sessions(): SessionView[] { return (this.db.prepare('SELECT data FROM sessions').all() as {data:string}[]).map(r => JSON.parse(r.data)); }
  session(id: string): SessionView { const r = this.db.prepare('SELECT data FROM sessions WHERE id=?').get(id) as {data:string}|undefined; if (!r) throw new Error('Không tìm thấy profile.'); return JSON.parse(r.data); }
  saveSession(s: SessionView, token?: string) { if (token) this.db.prepare('INSERT INTO sessions VALUES(?,?,?)').run(s.id,digest(token),JSON.stringify(s)); else this.db.prepare('UPDATE sessions SET data=? WHERE id=?').run(JSON.stringify(s),s.id); }
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
  groups(): GroupView[] { return (this.db.prepare('SELECT data FROM groups ORDER BY rowid DESC').all() as {data:string}[]).map(r=>JSON.parse(r.data)); }
  group(id: string) { const r=this.db.prepare('SELECT data FROM groups WHERE id=?').get(id) as {data:string}|undefined; if (!r) throw new Error('Không tìm thấy lượt nhóm.'); return JSON.parse(r.data) as GroupView; }
  saveRun(session: string, run: RunState) { this.db.prepare('INSERT OR REPLACE INTO runs VALUES(?,?,?,?)').run(run.runId!,session,JSON.stringify(run),run.eventSeq ?? 0); }
  history(session: string) { return (this.db.prepare('SELECT data FROM runs WHERE session=? ORDER BY rowid DESC').all(session) as {data:string}[]).map(r=>JSON.parse(r.data) as RunState); }
  blocked(session: string, form: string) { return !!this.db.prepare("SELECT run FROM locks WHERE session=? AND form=? AND resolution!='not_received'").get(session,form); }
  acquireSubmit(session: string, run: string, form: string) { return this.transaction(()=>{
    const s=this.session(session);
    const locks=this.db.prepare("SELECT run,resolution FROM locks WHERE session=? AND form=? AND resolution!='not_received'").all(session,form) as {run:string;resolution:string}[];
    const old=this.db.prepare('SELECT resolution FROM locks WHERE session=? AND form=? AND run=?').get(session,form,run) as {resolution:string}|undefined;
    if (!s.run || s.run.runId !== run || s.run.mode !== 'live' || !['running','submitting'].includes(s.run.status) || this.group(run).paused || old&&old.resolution!=='local_reserved' || locks.some(l=>l.run!==run||l.resolution!=='local_reserved')) throw new Error('Quyền gửi đã bị khóa hoặc lượt không hoạt động.');
    this.db.prepare('INSERT OR REPLACE INTO locks VALUES(?,?,?,?,?)').run(session,form,run,'uncertain',new Date().toISOString());
    s.run.submitAttempted=true; s.run.status='submitting'; this.saveRun(session,s.run); this.saveSession(s); this.audit(session,run,'submit_lock','Đã khóa quyền gửi.');
  }); }
  resolve(session: string, runId: string, result: 'received'|'not_received') {
    const s=this.session(session); if (!s.run || s.run.runId!==runId || !s.run.submitAttempted) throw new Error('Không có kết quả gửi cần xác minh.');
    this.db.prepare('UPDATE locks SET resolution=? WHERE session=? AND run=?').run(result,session,runId);
    s.run.status=result==='received'?'completed':'idle'; s.run.recoveryRequired=false; s.run.blockingIssue=undefined;
    this.saveRun(session,s.run); this.saveSession(s); this.audit(session,runId,'manual_resolution',result==='received'?'User xác minh đã gửi.':'User xác minh chưa gửi; giữ khóa lượt cũ.');
  }
  saveAttachment(session: string,id: string,bytes: Buffer,hash: string) { if (digest(bytes)!==hash) throw new Error('Mã băm ảnh không khớp.'); this.db.prepare('INSERT OR REPLACE INTO attachments VALUES(?,?,?,?)').run(session,id,hash,bytes); }
  attachment(session: string,id: string) { const r=this.db.prepare('SELECT data,hash FROM attachments WHERE session=? AND id=?').get(session,id) as {data:Uint8Array;hash:string}|undefined; if (!r) throw new Error('Chưa đồng bộ ảnh.'); return {data:Buffer.from(r.data),hash:r.hash}; }
  audit(session: string|undefined,run: string|undefined,kind: string,message: string) { this.db.prepare('INSERT INTO audit(at,session,run,kind,message) VALUES(?,?,?,?,?)').run(new Date().toISOString(),session??null,run??null,kind,message); }
  close(){this.db.close();}
}
