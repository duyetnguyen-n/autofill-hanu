import {returnedSubmissionAllowed} from '../../src/recovery';
import { randomBytes } from 'node:crypto';
import { digest } from '../server/store';
import type { DataStore } from '../server/data-store';
import type { GroupView, SessionView,ControlReceipt } from '../../src/protocol';
import type { RunState } from '../../src/shared';
import { canonicalFormId } from '../../src/protocol';
import { validCloudProgress } from './progress';
import { CloudError } from './errors';
import { requireAccount, assertLive, assertCapacity } from './access-policy';
export { CloudError } from './errors';

export const MAX_ATTACHMENT_BYTES = 10 * 1024 * 1024;
export class LeaseBusyError extends CloudError {
  constructor() { super('Một server quản lý khác đang hoạt động. Chờ tối đa 65 giây sau khi server cũ dừng.', 503); }
}
export interface SqlConnection {
  query(sql: string, values?: any[]): Promise<{ rows: any[]; rowCount: number | null }>;
}
export interface SqlPool extends SqlConnection {
  connect(): Promise<SqlConnection & { release(): void }>;
}
export interface PrivateObjects {
  put(path: string, bytes: Buffer): Promise<void>;
  get(path: string): Promise<Buffer>;
  remove?(path: string): Promise<void>;
}

export async function transaction<T>(pool: SqlPool, fn: (db: SqlConnection) => Promise<T>): Promise<T> {
  const db = await pool.connect();
  try {
    await db.query('BEGIN');
    const result = await fn(db);
    await db.query('COMMIT');
    return result;
  } catch (error) {
    await db.query('ROLLBACK');
    throw error;
  } finally { db.release(); }
}

export class PostgresStore implements DataStore {
  async registrationSchedule():Promise<import('../../src/registration-schedule').RegistrationSchedule|undefined>{return (await this.pool.query('SELECT data FROM hanu.registration_schedules WHERE owner=$1',[this.owner])).rows[0]?.data;}
  async saveRegistrationSchedule(s:import('../../src/registration-schedule').RegistrationSchedule){await transaction(this.pool,async db=>{await this.assertLease(db);await db.query('INSERT INTO hanu.registration_schedules(owner,data) VALUES($1,$2) ON CONFLICT(owner) DO UPDATE SET data=excluded.data',[this.owner,JSON.stringify(s)]);});}
  private versions = new WeakMap<SessionView, number>();
  private baselines = new WeakMap<SessionView, SessionView>();
  constructor(public pool: SqlPool, public owner: string, public objects: PrivateObjects, public instance: string) {}
  private decode(row: any): SessionView {
    if (!row) throw new CloudError('Không tìm thấy profile.', 404);
    const session: SessionView = { ...row.data, linked: !row.revoked };
    this.versions.set(session, row.version);
    this.baselines.set(session, structuredClone(session));
    return session;
  }
  private async read(id: string, db: SqlConnection = this.pool, lock = false) {
    const result = await db.query(`SELECT data,version,revoked FROM hanu.sessions WHERE owner=$1 AND id=$2${lock ? ' FOR UPDATE' : ''}`, [this.owner, id]);
    return this.decode(result.rows[0]);
  }
  private async write(s: SessionView, db: SqlConnection = this.pool, locked?: { data: SessionView; version: number }) {
    const version = this.versions.get(s);
    if (version === undefined) throw new CloudError('Đọc lại hồ sơ trước khi lưu.', 409);
    const original=this.baselines.get(s)!;
    const row=locked??(await db.query('SELECT data,version,revoked FROM hanu.sessions WHERE owner=$1 AND id=$2 FOR UPDATE',[this.owner,s.id])).rows[0];
    if(!row)throw new CloudError('Không tìm thấy profile.',404);
    const current: SessionView = { ...row.data, linked: 'revoked' in row ? !row.revoked : row.data.linked };
    const fields=[...new Set([...Object.keys(original),...Object.keys(s)])] as (keyof SessionView)[];
    const changed=fields.filter(key=>key!=='linked'&&JSON.stringify(s[key])!==JSON.stringify(original[key]));
    let mergeQuestion=false;
    if(changed.includes('run')&&s.run&&original.run&&current.run&&JSON.stringify(current.run)!==JSON.stringify(original.run)){
      const runFields=[...new Set([...Object.keys(original.run),...Object.keys(s.run)])] as (keyof RunState)[];
      const changes=runFields.filter(key=>JSON.stringify(s.run![key])!==JSON.stringify(original.run![key]));
      mergeQuestion=changes.length===1&&changes[0]==='finalQuestion'&&current.run.runId===original.run.runId&&!current.run.submitAttempted&&['paused','waiting_manual','ready_to_submit'].includes(current.run.status);
    }
    // Merge independent execution/heartbeat updates; never mark a changed
    // profile synced or overwrite another edit using a stale snapshot.
    for(const key of new Set([...changed,'profile','revision'] as (keyof SessionView)[])){
      if(key==='lastSeen')continue;
      if(key==='run'&&mergeQuestion)continue;
      if(JSON.stringify(current[key])!==JSON.stringify(original[key]))throw new CloudError('Profile vừa thay đổi. Đọc lại trước khi tiếp tục.',409);
    }
    const merged={...current,...Object.fromEntries(changed.map(key=>[key,s[key]]))} as SessionView;
    if(mergeQuestion)merged.run={...current.run!,finalQuestion:s.run!.finalQuestion};
    const result = await db.query('UPDATE hanu.sessions SET data=$3,version=version+1 WHERE owner=$1 AND id=$2 AND version=$4 RETURNING version', [this.owner, s.id, JSON.stringify({ ...merged, linked: undefined }), row.version]);
    if (!result.rowCount) throw new CloudError('Profile vừa thay đổi. Đọc lại trước khi tiếp tục.', 409);
    for(const key of Object.keys(s))delete (s as any)[key];Object.assign(s,merged);
    this.versions.set(s, result.rows[0].version);
    this.baselines.set(s,structuredClone(s));
  }
  async assertLease(db: SqlConnection = this.pool) {
    const result = await db.query('SELECT instance FROM hanu.server_lease WHERE id=true AND instance=$1 AND expires_at>now() FOR SHARE', [this.instance]);
    if (!result.rowCount) throw new CloudError('Bộ điều phối đã mất quyền chạy. Đã ngừng cấp lệnh.', 503);
  }
  async sessions() {
    return (await this.pool.query('SELECT data,version,revoked FROM hanu.sessions WHERE owner=$1 ORDER BY created_at,id', [this.owner])).rows.map(row => this.decode(row));
  }
  session(id: string) { return this.read(id); }
  async saveSession(s: SessionView) {
    const runChanged = JSON.stringify(s.run) !== JSON.stringify(this.baselines.get(s)?.run);
    await transaction(this.pool, async db => { await this.write(s, db); if (runChanged && s.run?.runId) await this.writeRun(s.id, s.run, db); });
  }
  async touch(id: string) {
    // Heartbeats do not bump the profile version or overwrite concurrent edits.
    const result = await this.pool.query("UPDATE hanu.sessions SET data=jsonb_set(data,'{lastSeen}',to_jsonb($3::text)) WHERE owner=$1 AND id=$2 AND NOT revoked", [this.owner, id, new Date().toISOString()]);
    if (!result.rowCount) throw new CloudError('Profile đã bị ngắt liên kết.', 401);
  }
  async saveControl(id:string,receipt:ControlReceipt,initial:boolean){
    await transaction(this.pool,async db=>{
      await this.assertLease(db);const s=await this.read(id,db,true);
      if(initial&&s.control&&s.control.requestedAt>receipt.requestedAt)return;
    if(!initial&&s.control?.commandId!==receipt.commandId||receipt.runId&&s.run?.runId!==receipt.runId)return;
      s.control=structuredClone(receipt);await this.write(s,db);
      await db.query('INSERT INTO hanu.audit(owner,session,run,kind,message) VALUES($1,$2,$3,$4,$5)',[this.owner,id,receipt.runId,`control_${receipt.state}`,`${receipt.kind} ${receipt.commandId}${receipt.error?`: ${receipt.error}`:''}`]);
    });
  }
  async acknowledgeStop(id:string,runId:string|undefined,result:any){
    return transaction(this.pool,async db=>{
      await this.assertLease(db);const s=await this.read(id,db,true);
      if(s.run?.runId!==runId)return s;
      if(s.run){
        const ack=result?.run??(result?.runId===runId?result:undefined);
        s.run.autoContinue=false;
        s.run.submitAttempted=!!(s.run.submitAttempted||ack?.submitAttempted&&(ack.submissionRetries??0)===(s.run.submissionRetries??0));
        s.run.status=s.run.submitAttempted?'submit_uncertain':'idle';s.run.recoveryRequired=false;s.run.activity=undefined;
        if(s.run.recovery)s.run.recovery.automatic=false;
        if(!s.run.submitAttempted)s.run.blockingIssue=undefined;
        s.run.eventSeq=Math.max(s.run.eventSeq??0,ack?.eventSeq??0);s.run.updatedAt=new Date().toISOString();
        if(s.run.submitAttempted&&s.run.formId)await db.query("INSERT INTO hanu.locks(owner,session,form,run,resolution) VALUES($1,$2,$3,$4,'local_reserved') ON CONFLICT DO NOTHING",[this.owner,id,s.run.formId,runId]);
        await this.writeRun(id,s.run,db);
      }
      s.error=undefined;s.execution=result?.execution??null;await this.write(s,db);return s;
    });
  }
  async connected(id: string, value: boolean) {
    await transaction(this.pool, async db => {
      const s = await this.read(id, db, true);
      s.connected = value;
      if (value) s.lastSeen = new Date().toISOString();
      else {
        s.execution = undefined;
        s.error = 'Mất kết nối. Mở lại profile và đối chiếu trước khi tiếp tục.';
        if (s.run && !['completed', 'idle', 'ready_to_submit'].includes(s.run.status)) {
          s.run.status = s.run.submitAttempted ? 'submit_uncertain' : 'paused';
          s.run.recoveryRequired = true;
          await this.writeRun(id, s.run, db);
        }
      }
      await this.write(s, db);
    });
  }
  async groups(): Promise<GroupView[]> {
    return (await this.pool.query('SELECT data FROM hanu.groups WHERE owner=$1 ORDER BY created_at DESC,id DESC LIMIT 100', [this.owner])).rows.map(r => r.data);
  }
  async groupForRequest(requestId:string):Promise<GroupView|undefined>{return (await this.pool.query("SELECT data FROM hanu.groups WHERE owner=$1 AND data->>'requestId'=$2 LIMIT 1",[this.owner,requestId])).rows[0]?.data;}
  async group(id: string): Promise<GroupView> {
    const row = (await this.pool.query('SELECT data FROM hanu.groups WHERE owner=$1 AND id=$2', [this.owner, id])).rows[0];
    if (!row) throw new CloudError('Không tìm thấy lượt nhóm.', 404);
    return row.data;
  }
  async saveGroup(g: GroupView) {
    const result = await this.pool.query('UPDATE hanu.groups SET data=$3 WHERE owner=$1 AND id=$2', [this.owner, g.id, JSON.stringify(g)]);
    if (!result.rowCount) throw new CloudError('Không tìm thấy lượt nhóm.', 404);
  }
  private async writeRun(session: string, run: RunState, db: SqlConnection) {
    if (!run.runId) throw new CloudError('Lượt chạy thiếu định danh.');
    await db.query('INSERT INTO hanu.runs(owner,session,id,data,seq) VALUES($1,$2,$3,$4,$5) ON CONFLICT(owner,session,id) DO UPDATE SET data=EXCLUDED.data,seq=EXCLUDED.seq WHERE hanu.runs.seq<=EXCLUDED.seq', [this.owner, session, run.runId, JSON.stringify(run), run.eventSeq ?? 0]);
  }
  async saveRun(session: string, run: RunState) {
    await this.read(session);
    await this.writeRun(session, run, this.pool);
  }
  async history(session: string): Promise<RunState[]> {
    await this.read(session);
    return (await this.pool.query('SELECT data FROM hanu.runs WHERE owner=$1 AND session=$2 ORDER BY created_at DESC LIMIT 100', [this.owner, session])).rows.map(r => r.data);
  }
  async beginGroup(g: GroupView, sessions: SessionView[], append=false) {
    await transaction(this.pool, async db => {
      await this.assertLease(db);
      const account = await requireAccount(db, this.owner, true);
      assertLive(account, g.mode);
      if(!append&&g.members.length){const owned=(await db.query('SELECT id FROM hanu.sessions WHERE owner=$1 AND id=ANY($2::text[])',[this.owner,g.members])).rows;if(owned.length!==g.members.length)throw new CloudError('Không tìm thấy profile.',404);}
      if(append){
        const row=(await db.query('SELECT data FROM hanu.groups WHERE owner=$1 AND id=$2 FOR UPDATE',[this.owner,g.id])).rows[0];
        const current=row?.data as GroupView|undefined;
        if(!current||current.paused||current.stopped||current.requestSignature!==g.requestSignature||sessions.some(s=>!current.members.includes(s.id)))throw new CloudError('Nhóm đã dừng hoặc thay đổi; không bắt đầu profile.',409);
      }
      await assertCapacity(db, account, sessions.map(s => s.id));
      // Lock in a stable order to avoid deadlocks between overlapping starts.
      const ids = sessions.map(s => s.id);
      const rows = (await db.query('SELECT id,data,version,revoked FROM hanu.sessions WHERE owner=$1 AND id=ANY($2::text[]) ORDER BY id FOR UPDATE', [this.owner, ids])).rows;
      const locked = new Map(rows.map(row => [row.id, this.decode(row)]));
      const form = canonicalFormId(g.url);
      const blocked = form ? new Set((await db.query("SELECT session FROM hanu.locks WHERE owner=$1 AND session=ANY($2::text[]) AND form=$3 AND resolution!='not_received'", [this.owner, ids, form])).rows.map(row => row.session)) : new Set();
      for (const requested of sessions) {
        const current = locked.get(requested.id);
        if (!current) throw new CloudError('Không tìm thấy profile.', 404);
        if (this.versions.get(current) !== this.versions.get(requested) || !current.connected || !current.synced || current.execution || current.conflict || current.run && !['idle', 'completed', 'ready_to_submit', 'failed', 'submit_uncertain'].includes(current.run.status)) throw new CloudError('Profile vừa thay đổi hoặc đang có lượt chạy. Đọc lại trạng thái.', 409);
        if (blocked.has(current.id)) throw new CloudError('Form đã có khóa gửi. Xác minh trước khi chạy lại.', 409);
        requested.lastSeen = current.lastSeen;
      }
      if(!append)await db.query('INSERT INTO hanu.groups(owner,id,data) VALUES($1,$2,$3)', [this.owner, g.id, JSON.stringify(g)]);
      await db.query(`INSERT INTO hanu.runs(owner,session,id,data,seq)
        SELECT $1,p.session,p.id,p.data,p.seq FROM jsonb_to_recordset($2::jsonb) AS p(session text,id text,data jsonb,seq integer)
        ON CONFLICT(owner,session,id) DO UPDATE SET data=EXCLUDED.data,seq=EXCLUDED.seq WHERE hanu.runs.seq<=EXCLUDED.seq`,
        [this.owner, JSON.stringify(sessions.map(s => ({ session:s.id,id:s.run!.runId,data:s.run,seq:s.run!.eventSeq??0 })))]);
      const updated = (await db.query(`UPDATE hanu.sessions s SET data=p.data,version=s.version+1
        FROM jsonb_to_recordset($2::jsonb) AS p(id text,data jsonb) WHERE s.owner=$1 AND s.id=p.id RETURNING s.id,s.version`,
        [this.owner, JSON.stringify(sessions.map(s => ({id:s.id,data:{...s,linked:undefined}})))])).rows;
      const versions = new Map(updated.map(row => [row.id,row.version]));
      for (const s of sessions) { this.versions.set(s,versions.get(s.id));this.baselines.set(s,structuredClone(s)); }
    });
  }
  async recordStartResult(id:string,result:import('../../src/protocol').StartResult){
    await this.pool.query(`UPDATE hanu.groups SET data=jsonb_set(data,'{startResults}',
      COALESCE((SELECT jsonb_agg(item) FROM jsonb_array_elements(COALESCE(data->'startResults','[]'::jsonb)) item WHERE item->>'id'!=$3),'[]'::jsonb)||$4::jsonb)
      WHERE owner=$1 AND id=$2`,[this.owner,id,result.id,JSON.stringify([result])]);
  }
  async authorizeResume(id: string) {
    await transaction(this.pool, async db => {
      await this.assertLease(db);
      const account = await requireAccount(db, this.owner, true);
      const s = await this.read(id, db, true);
      if (!s.run?.runId || s.run.submitAttempted) throw new CloudError('Lượt chưa sẵn sàng tiếp tục hoặc đã khóa gửi.', 409);
      assertLive(account, s.run.mode);
      await assertCapacity(db, account, [id]);
      // Reserve the slot before another concurrent Start/Resume can check it.
      s.run.status = 'running';
      await this.write(s, db);
      await this.writeRun(id, s.run, db);
    });
  }
  async cancelResume(id: string, runId: string) {
    await transaction(this.pool, async db => {
      const s = await this.read(id, db, true);
      if (s.run?.runId !== runId || s.run.submitAttempted || s.run.status !== 'running') return;
      s.run.status = 'paused'; s.run.recoveryRequired = true;
      await this.write(s, db); await this.writeRun(id, s.run, db);
    });
  }
  async acceptProgress(id: string, run: RunState) {
    if (!validCloudProgress(run)) return false;
    return transaction(this.pool, async db => {
      const s = await this.read(id, db, true);
      if (!s.run || (run.submissionRetries??0)!==(s.run.submissionRetries??0) || !s.connected && run.status==='running' || run.runId !== s.run.runId || run.sessionId !== id || run.eventSeq! <= (s.run.eventSeq ?? 0) || s.run.submitAttempted && !run.submitAttempted) return false;
      const group = (await db.query('SELECT data FROM hanu.groups WHERE owner=$1 AND id=$2', [this.owner, run.runId])).rows[0]?.data;
      if (!group || group.paused && run.status === 'running'||s.run.formId&&run.formId!==s.run.formId||canonicalFormId(group.url)&&run.formId&&run.formId!==canonicalFormId(group.url)) return false;
      s.run = { ...run,mode:s.run.mode,managed:true,retryOnReturn:s.run.retryOnReturn,pendingReturnedRetry:s.run.pendingReturnedRetry,url:s.run.url,expectedEmail:s.run.expectedEmail,profileRevision:s.run.profileRevision,startedAt:s.run.startedAt,profileSnapshot: s.run.profileSnapshot, finalQuestion: s.run.finalQuestion };
      await this.writeRun(id, s.run, db);
      if (run.submitAttempted && run.formId) await db.query("INSERT INTO hanu.locks(owner,session,form,run,resolution) VALUES($1,$2,$3,$4,'local_reserved') ON CONFLICT DO NOTHING", [this.owner, id, run.formId, run.runId]);
      if (run.status === 'completed' && run.submitAttempted) await db.query("UPDATE hanu.locks SET resolution='received' WHERE owner=$1 AND session=$2 AND run=$3", [this.owner, id, run.runId]);
      s.error = run.blockingIssue?.message ?? (run.status === 'failed' ? run.logs.at(-1)?.message : undefined);
      await this.write(s, db);
      return true;
    });
  }
  async blocked(session: string, form: string) {
    await this.read(session);
    return !!(await this.pool.query("SELECT 1 FROM hanu.locks WHERE owner=$1 AND session=$2 AND form=$3 AND resolution!='not_received'", [this.owner, session, form])).rowCount;
  }
  async acquireSubmit(session: string, run: string, form: string, progress?: RunState) {
    if (!form || typeof form !== 'string') throw new CloudError('Form thiếu định danh.');
    await transaction(this.pool, async db => {
      await this.assertLease(db);
      const account = await requireAccount(db, this.owner, true);
      assertLive(account, 'live');
      // Both the group gate and profile are locked until the grant is committed.
      const g = (await db.query('SELECT data FROM hanu.groups WHERE owner=$1 AND id=$2 FOR SHARE', [this.owner, run])).rows[0]?.data as GroupView | undefined;
      const s = await this.read(session, db, true);
      const locked = { data: structuredClone(s), version: this.versions.get(s)! };
      if (progress) {
        const current = s.run;
        if (!validCloudProgress(progress) || !current || (progress.submissionRetries??0)!==(current.submissionRetries??0) || current.runId !== run || progress.runId !== run || progress.sessionId !== session ||
          current.submitAttempted && !progress.submitAttempted || progress.formId !== form ||
          current.formId && current.formId !== form || g && canonicalFormId(g.url) && canonicalFormId(g.url) !== form) throw new CloudError('Tiến độ/form không khớp lượt gửi.', 409);
        if (progress.eventSeq! > (current.eventSeq ?? 0)) {
          s.run = { ...progress, mode:current.mode,managed:true,retryOnReturn:current.retryOnReturn,pendingReturnedRetry:current.pendingReturnedRetry,
            url:current.url,expectedEmail:current.expectedEmail,profileRevision:current.profileRevision,startedAt:current.startedAt,
            profileSnapshot:current.profileSnapshot,finalQuestion:current.finalQuestion };
          s.error = progress.blockingIssue?.message;
        }
      }
      const locks = (await db.query('SELECT run,resolution FROM hanu.locks WHERE owner=$1 AND session=$2 AND form=$3', [this.owner, session, form])).rows;
      const old = locks.find(l => l.run === run);
      if (!g || g.mode!=='live' || g.paused || !g.members.includes(session) || !s.run || s.run.runId !== run || s.run.formId !== form || s.run.mode !== 'live' || !['running', 'submitting'].includes(s.run.status) || old && old.resolution !== 'local_reserved' || locks.some(l => l.resolution !== 'not_received' && (l.run !== run || l.resolution !== 'local_reserved'))) throw new CloudError('Quyền gửi đã bị khóa hoặc lượt không hoạt động.', 409);
      await db.query("INSERT INTO hanu.locks(owner,session,form,run,resolution) VALUES($1,$2,$3,$4,'uncertain') ON CONFLICT(owner,session,form,run) DO UPDATE SET resolution='uncertain'", [this.owner, session, form, run]);
      s.run.pendingReturnedRetry=undefined;
      s.run.submitAttempted = true;
      s.run.status = 'submitting';
      await this.writeRun(session, s.run, db);
      await this.write(s, db, locked);
      await db.query("INSERT INTO hanu.audit(owner,session,run,kind,message) VALUES($1,$2,$3,'submit_lock','Đã khóa quyền gửi.')", [this.owner, session, run]);
    });
  }
  async authorizeReturnedRetry(session:string,runId:string,epoch:string,retries:number){
    await transaction(this.pool,async db=>{
      await this.assertLease(db);const account=await requireAccount(db,this.owner,true);assertLive(account,'live');
      const g=(await db.query('SELECT data FROM hanu.groups WHERE owner=$1 AND id=$2 FOR SHARE',[this.owner,runId])).rows[0]?.data as GroupView|undefined;
      const s=await this.read(session,db,true),run=s.run;
      if(run?.runId===runId&&run.autoContinue&&run.contentEpoch===epoch&&run.pendingReturnedRetry?.fromRetries===retries&&run.submissionRetries===retries+1&&g&&!g.paused&&!g.stopped){if(run.pendingReturnedRetry.epoch!==epoch){run.pendingReturnedRetry.epoch=epoch;await this.writeRun(session,run,db);await this.write(s,db);}return;}
      if(!returnedSubmissionAllowed(run)||run!.runId!==runId||run!.contentEpoch!==epoch||(run!.submissionRetries??0)!==retries||!g||g.paused||g.stopped||!g.members.includes(session))throw new CloudError('Lượt không được phép thử lại sau khi trở về form.',409);
      const locks=(await db.query("SELECT run,resolution FROM hanu.locks WHERE owner=$1 AND session=$2 AND form=$3 AND resolution!='not_received'",[this.owner,session,run!.formId])).rows;
      if(locks.some(l=>l.run!==runId||l.resolution==='received'))throw new CloudError('Form đã có kết quả hoặc thuộc lượt khác.',409);
      await db.query("UPDATE hanu.locks SET resolution='local_reserved' WHERE owner=$1 AND session=$2 AND run=$3",[this.owner,session,runId]);
      run!.pendingReturnedRetry={epoch,fromRetries:retries};run!.submissionRetries=retries+1;run!.submitAttempted=false;run!.status='waiting_manual';run!.blockingIssue={reason:'navigation',message:'Form đã khôi phục; cho phép thử lại, có thể gửi trùng.'};
      await this.writeRun(session,run!,db);await this.write(s,db);
      await db.query("INSERT INTO hanu.audit(owner,session,run,kind,message) VALUES($1,$2,$3,'returned_form_retry','Cho phép thử gửi lại trên form đã khôi phục; kết quả trước vẫn chưa rõ.')",[this.owner,session,runId]);
    });
  }
  async resolve(session: string, run: string, result: 'received' | 'not_received') {
    await transaction(this.pool, async db => {
      const s = await this.read(session, db, true);
      if (!s.run || s.run.runId !== run || !s.run.submitAttempted) throw new CloudError('Không có kết quả gửi cần xác minh.');
      await db.query('UPDATE hanu.locks SET resolution=$4 WHERE owner=$1 AND session=$2 AND run=$3', [this.owner, session, run, result]);
      s.run.status = result === 'received' ? 'completed' : 'idle';
      s.run.recoveryRequired = false;
      s.run.blockingIssue = undefined;
      await this.writeRun(session, s.run, db);
      await this.write(s, db);
      await db.query("INSERT INTO hanu.audit(owner,session,run,kind,message) VALUES($1,$2,$3,'manual_resolution',$4)", [this.owner, session, run, result]);
    });
  }
  async saveAttachment(session: string, id: string, bytes: Buffer, hash: string) {
    await this.read(session);
    if (!/^[a-zA-Z0-9_-]{1,100}$/.test(id) || bytes.length > MAX_ATTACHMENT_BYTES || digest(bytes) !== hash) throw new CloudError('Ảnh không hợp lệ, quá 10 MB hoặc mã băm không khớp.');
    const path = `${this.owner}/${session}/${id}/${hash}`;
    await this.objects.put(path, bytes);
    await this.pool.query('INSERT INTO hanu.attachments(owner,session,id,hash,object_path,size) VALUES($1,$2,$3,$4,$5,$6) ON CONFLICT(owner,session,id) DO UPDATE SET hash=EXCLUDED.hash,object_path=EXCLUDED.object_path,size=EXCLUDED.size', [this.owner, session, id, hash, path, bytes.length]);
  }
  async attachment(session: string, id: string) {
    await this.read(session);
    const row = (await this.pool.query('SELECT hash,object_path,size FROM hanu.attachments WHERE owner=$1 AND session=$2 AND id=$3', [this.owner, session, id])).rows[0];
    if (!row) throw new CloudError('Chưa đồng bộ ảnh.', 404);
    const data = await this.objects.get(row.object_path);
    if (data.length !== row.size || digest(data) !== row.hash) throw new CloudError('Ảnh lưu trên server không khớp mã băm.', 503);
    return { data, hash: row.hash as string };
  }
  async attachmentInfo(session:string,id:string){
    await this.read(session);
    const row=(await this.pool.query('SELECT hash,size FROM hanu.attachments WHERE owner=$1 AND session=$2 AND id=$3',[this.owner,session,id])).rows[0];
    if(!row)throw new CloudError('Chưa đồng bộ ảnh.',404);
    return {hash:row.hash as string,size:row.size as number};
  }
  async audit(session: string | undefined, run: string | undefined, kind: string, message: string) {
    if (session) await this.read(session);
    await this.pool.query('INSERT INTO hanu.audit(owner,session,run,kind,message) VALUES($1,$2,$3,$4,$5)', [this.owner, session, run, kind, message]);
  }
}

export class CloudRepository {
  constructor(public pool: SqlPool, public objects: PrivateObjects, public instance: string) {}
  store(owner: string) { return new PostgresStore(this.pool, owner, this.objects, this.instance); }
  async claimLease() {
    const result = await this.pool.query("INSERT INTO hanu.server_lease(id,instance,expires_at) VALUES(true,$1,now()+interval '65 seconds') ON CONFLICT(id) DO UPDATE SET instance=EXCLUDED.instance,expires_at=EXCLUDED.expires_at WHERE hanu.server_lease.expires_at<now() OR hanu.server_lease.instance=EXCLUDED.instance RETURNING instance", [this.instance]);
    if (!result.rowCount) throw new LeaseBusyError();
  }
  async renewLease() {
    const result = await this.pool.query("UPDATE hanu.server_lease SET expires_at=now()+interval '65 seconds' WHERE id=true AND instance=$1 AND expires_at>now()", [this.instance]);
    if (!result.rowCount) throw new CloudError('Bộ điều phối đã mất quyền chạy.', 503);
  }
  async releaseLease() { await this.pool.query('DELETE FROM hanu.server_lease WHERE id=true AND instance=$1', [this.instance]); }
  async recover() {
    const rows = (await this.pool.query('SELECT owner,id FROM hanu.sessions')).rows;
    for (const row of rows) await this.store(row.owner).connected(row.id, false);
    await this.pool.query("UPDATE hanu.groups SET data=jsonb_set(data,'{paused}','true') WHERE EXISTS(SELECT 1 FROM hanu.sessions s WHERE s.owner=hanu.groups.owner AND s.data#>>'{run,runId}'=hanu.groups.id AND s.data#>>'{run,recoveryRequired}'='true')");
  }
  async pairCode(owner: string, replace?: string) {
    await requireAccount(this.pool, owner);
    if (replace) {
      const s = await this.store(owner).session(replace);
      if (s.connected || s.execution || s.run && ['running', 'submitting'].includes(s.run.status)) throw new CloudError('Dừng và ngắt kết nối profile trước khi liên kết lại.', 409);
    }
    const code = randomBytes(6).toString('hex').toUpperCase();
    await this.pool.query('DELETE FROM hanu.pairing WHERE expires_at<now()');
    await this.pool.query("INSERT INTO hanu.pairing(code_hash,owner,replace_session,expires_at) VALUES($1,$2,$3,now()+interval '5 minutes')", [digest(code), owner, replace ?? null]);
    return code;
  }
  async pair(session: string, extension: string, code: string) {
    if (!/^[A-F0-9]{12}$/.test(code)) throw new CloudError('Mã liên kết không hợp lệ.');
    return transaction(this.pool, async db => {
      const candidate = (await db.query('SELECT owner FROM hanu.pairing WHERE code_hash=$1 AND expires_at>now()', [digest(code)])).rows[0];
      if (!candidate) throw new CloudError('Mã liên kết hết hạn hoặc đã dùng.', 401);
      // Account first, then pairing/session, matching admin updates and quota
      // transactions. Consuming the code first could deadlock with a lock action.
      const account = await requireAccount(db, candidate.owner, true);
      const row = (await db.query('DELETE FROM hanu.pairing WHERE code_hash=$1 AND owner=$2 AND expires_at>now() RETURNING owner,replace_session', [digest(code), candidate.owner])).rows[0];
      if (!row) throw new CloudError('Mã liên kết hết hạn hoặc đã dùng.', 401);
      const token = randomBytes(32).toString('hex');
      const id = row.replace_session ?? session;
      if (row.replace_session) {
        const s = (await db.query('SELECT data FROM hanu.sessions WHERE owner=$1 AND id=$2 FOR UPDATE', [row.owner, id])).rows[0]?.data as SessionView;
        if (s.connected || s.execution || s.run && ['running', 'submitting'].includes(s.run.status)) throw new CloudError('Profile cũ vẫn đang hoạt động.', 409);
        s.synced = false;
        await db.query('UPDATE hanu.sessions SET token_hash=$3,extension_id=$4,revoked=false,data=$5,version=version+1 WHERE owner=$1 AND id=$2', [row.owner, id, digest(token), extension, JSON.stringify(s)]);
      } else {
        const count = (await db.query('SELECT count(*) AS count FROM hanu.sessions WHERE owner=$1', [row.owner])).rows[0].count;
        if (Number(count) >= account.maxProfiles) throw new CloudError(`Tài khoản đạt giới hạn ${account.maxProfiles} profile.`, 409);
        const data: SessionView = { id, name: `Profile ${Number(count) + 1}`, expectedEmail: '', connected: false, lastSeen: new Date().toISOString(), revision: 0, synced: false };
        await db.query('INSERT INTO hanu.sessions(owner,id,token_hash,extension_id,data) VALUES($1,$2,$3,$4,$5)', [row.owner, id, digest(token), extension, JSON.stringify(data)]);
      }
      return { owner: row.owner as string, sessionId: id as string, token };
    });
  }
  async authenticate(id: string, extension: string, token: string) {
    if (!/^[a-f0-9]{64}$/.test(token)) return undefined;
    const row = (await this.pool.query('SELECT owner FROM hanu.sessions WHERE id=$1 AND extension_id=$2 AND token_hash=$3 AND NOT revoked', [id, extension, digest(token)])).rows[0];
    if (row) await requireAccount(this.pool, row.owner);
    return row?.owner as string | undefined;
  }
  async revoke(owner: string, id: string) {
    await this.store(owner).connected(id, false);
    await transaction(this.pool, async db => {
      // Match pairing's lock order, and invalidate pending relink codes too.
      await db.query('SELECT user_id FROM hanu.accounts WHERE user_id=$1 FOR UPDATE', [owner]);
      await db.query('DELETE FROM hanu.pairing WHERE owner=$1 AND replace_session=$2', [owner, id]);
      await db.query('UPDATE hanu.sessions SET revoked=true,token_hash=$3 WHERE owner=$1 AND id=$2', [owner, id, digest(randomBytes(32))]);
    });
  }
}
