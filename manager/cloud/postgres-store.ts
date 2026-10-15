import { randomBytes } from 'node:crypto';
import { digest } from '../server/store';
import type { DataStore } from '../server/data-store';
import type { GroupView, SessionView } from '../../src/protocol';
import type { RunState } from '../../src/shared';
import { canonicalFormId } from '../../src/protocol';
import { validCloudProgress } from './progress';

export const MAX_ATTACHMENT_BYTES = 10 * 1024 * 1024;
export class CloudError extends Error {
  constructor(message: string, public status = 400) { super(message); }
}
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
  private versions = new WeakMap<SessionView, number>();
  private baselines = new WeakMap<SessionView, SessionView>();
  constructor(public pool: SqlPool, public owner: string, public objects: PrivateObjects, public instance: string) {}
  private decode(row: any): SessionView {
    if (!row) throw new CloudError('Không tìm thấy profile.', 404);
    const session = row.data as SessionView;
    this.versions.set(session, row.version);
    this.baselines.set(session, structuredClone(session));
    return session;
  }
  private async read(id: string, db: SqlConnection = this.pool, lock = false) {
    const result = await db.query(`SELECT data,version FROM hanu.sessions WHERE owner=$1 AND id=$2${lock ? ' FOR UPDATE' : ''}`, [this.owner, id]);
    return this.decode(result.rows[0]);
  }
  private async write(s: SessionView, db: SqlConnection = this.pool, locked?: { data: SessionView; version: number }) {
    const version = this.versions.get(s);
    if (version === undefined) throw new CloudError('Đọc lại hồ sơ trước khi lưu.', 409);
    const original=this.baselines.get(s)!;
    const row=locked??(await db.query('SELECT data,version FROM hanu.sessions WHERE owner=$1 AND id=$2 FOR UPDATE',[this.owner,s.id])).rows[0];
    if(!row)throw new CloudError('Không tìm thấy profile.',404);
    const current=row.data as SessionView;
    const fields=[...new Set([...Object.keys(original),...Object.keys(s)])] as (keyof SessionView)[];
    const changed=fields.filter(key=>JSON.stringify(s[key])!==JSON.stringify(original[key]));
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
    const result = await db.query('UPDATE hanu.sessions SET data=$3,version=version+1 WHERE owner=$1 AND id=$2 AND version=$4 RETURNING version', [this.owner, s.id, JSON.stringify(merged), row.version]);
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
    return (await this.pool.query('SELECT data,version FROM hanu.sessions WHERE owner=$1 ORDER BY created_at,id', [this.owner])).rows.map(row => this.decode(row));
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
  async beginGroup(g: GroupView, sessions: SessionView[]) {
    await transaction(this.pool, async db => {
      await this.assertLease(db);
      // Lock in a stable order to avoid deadlocks between overlapping starts.
      const ids = sessions.map(s => s.id);
      const rows = (await db.query('SELECT id,data,version FROM hanu.sessions WHERE owner=$1 AND id=ANY($2::text[]) ORDER BY id FOR UPDATE', [this.owner, ids])).rows;
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
      await db.query('INSERT INTO hanu.groups(owner,id,data) VALUES($1,$2,$3)', [this.owner, g.id, JSON.stringify(g)]);
      await db.query(`INSERT INTO hanu.runs(owner,session,id,data,seq)
        SELECT $1,p.session,p.id,p.data,p.seq FROM jsonb_to_recordset($2::jsonb) AS p(session text,id text,data jsonb,seq integer)
        ON CONFLICT(owner,session,id) DO UPDATE SET data=EXCLUDED.data,seq=EXCLUDED.seq WHERE hanu.runs.seq<=EXCLUDED.seq`,
        [this.owner, JSON.stringify(sessions.map(s => ({ session:s.id,id:s.run!.runId,data:s.run,seq:s.run!.eventSeq??0 })))]);
      const updated = (await db.query(`UPDATE hanu.sessions s SET data=p.data,version=s.version+1
        FROM jsonb_to_recordset($2::jsonb) AS p(id text,data jsonb) WHERE s.owner=$1 AND s.id=p.id RETURNING s.id,s.version`,
        [this.owner, JSON.stringify(sessions.map(s => ({id:s.id,data:s})))])).rows;
      const versions = new Map(updated.map(row => [row.id,row.version]));
      for (const s of sessions) { this.versions.set(s,versions.get(s.id));this.baselines.set(s,structuredClone(s)); }
    });
  }
  async acceptProgress(id: string, run: RunState) {
    if (!validCloudProgress(run)) return false;
    return transaction(this.pool, async db => {
      const s = await this.read(id, db, true);
      if (!s.run || !s.connected && run.status==='running' || run.runId !== s.run.runId || run.sessionId !== id || run.eventSeq! <= (s.run.eventSeq ?? 0) || s.run.submitAttempted && !run.submitAttempted) return false;
      const group = (await db.query('SELECT data FROM hanu.groups WHERE owner=$1 AND id=$2', [this.owner, run.runId])).rows[0]?.data;
      if (!group || group.paused && run.status === 'running'||s.run.formId&&run.formId!==s.run.formId||canonicalFormId(group.url)&&run.formId&&run.formId!==canonicalFormId(group.url)) return false;
      s.run = { ...run,mode:s.run.mode,managed:true,url:s.run.url,expectedEmail:s.run.expectedEmail,profileRevision:s.run.profileRevision,startedAt:s.run.startedAt,profileSnapshot: s.run.profileSnapshot, finalQuestion: s.run.finalQuestion };
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
      // Both the group gate and profile are locked until the grant is committed.
      const g = (await db.query('SELECT data FROM hanu.groups WHERE owner=$1 AND id=$2 FOR SHARE', [this.owner, run])).rows[0]?.data as GroupView | undefined;
      const s = await this.read(session, db, true);
      const locked = { data: structuredClone(s), version: this.versions.get(s)! };
      if (progress) {
        const current = s.run;
        if (!validCloudProgress(progress) || !current || current.runId !== run || progress.runId !== run || progress.sessionId !== session ||
          current.submitAttempted && !progress.submitAttempted || progress.formId !== form ||
          current.formId && current.formId !== form || g && canonicalFormId(g.url) && canonicalFormId(g.url) !== form) throw new CloudError('Tiến độ/form không khớp lượt gửi.', 409);
        if (progress.eventSeq! > (current.eventSeq ?? 0)) {
          s.run = { ...progress, mode:current.mode,managed:true,
            url:current.url,expectedEmail:current.expectedEmail,profileRevision:current.profileRevision,startedAt:current.startedAt,
            profileSnapshot:current.profileSnapshot,finalQuestion:current.finalQuestion };
          s.error = progress.blockingIssue?.message;
        }
      }
      const locks = (await db.query('SELECT run,resolution FROM hanu.locks WHERE owner=$1 AND session=$2 AND form=$3', [this.owner, session, form])).rows;
      const old = locks.find(l => l.run === run);
      if (!g || g.mode!=='live' || g.paused || !g.members.includes(session) || !s.run || s.run.runId !== run || s.run.formId !== form || s.run.mode !== 'live' || !['running', 'submitting'].includes(s.run.status) || old && old.resolution !== 'local_reserved' || locks.some(l => l.resolution !== 'not_received' && (l.run !== run || l.resolution !== 'local_reserved'))) throw new CloudError('Quyền gửi đã bị khóa hoặc lượt không hoạt động.', 409);
      await db.query("INSERT INTO hanu.locks(owner,session,form,run,resolution) VALUES($1,$2,$3,$4,'uncertain') ON CONFLICT(owner,session,form,run) DO UPDATE SET resolution='uncertain'", [this.owner, session, form, run]);
      s.run.submitAttempted = true;
      s.run.status = 'submitting';
      await this.writeRun(session, s.run, db);
      await this.write(s, db, locked);
      await db.query("INSERT INTO hanu.audit(owner,session,run,kind,message) VALUES($1,$2,$3,'submit_lock','Đã khóa quyền gửi.')", [this.owner, session, run]);
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
      const row = (await db.query('DELETE FROM hanu.pairing WHERE code_hash=$1 AND expires_at>now() RETURNING owner,replace_session', [digest(code)])).rows[0];
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
        if (Number(count) >= 100) throw new CloudError('Tài khoản đạt giới hạn 100 profile.');
        const data: SessionView = { id, name: `Profile ${Number(count) + 1}`, expectedEmail: '', connected: false, lastSeen: new Date().toISOString(), revision: 0, synced: false };
        await db.query('INSERT INTO hanu.sessions(owner,id,token_hash,extension_id,data) VALUES($1,$2,$3,$4,$5)', [row.owner, id, digest(token), extension, JSON.stringify(data)]);
      }
      return { owner: row.owner as string, sessionId: id as string, token };
    });
  }
  async authenticate(id: string, extension: string, token: string) {
    if (!/^[a-f0-9]{64}$/.test(token)) return undefined;
    const row = (await this.pool.query('SELECT owner FROM hanu.sessions WHERE id=$1 AND extension_id=$2 AND token_hash=$3 AND NOT revoked', [id, extension, digest(token)])).rows[0];
    return row?.owner as string | undefined;
  }
  async revoke(owner: string, id: string) {
    await this.store(owner).connected(id, false);
    await this.pool.query('UPDATE hanu.sessions SET revoked=true,token_hash=$3 WHERE owner=$1 AND id=$2', [owner, id, digest(randomBytes(32))]);
  }
}
