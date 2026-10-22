import type { WebUser } from './auth';
import { randomBytes } from 'node:crypto';
import { digest } from '../server/store';
import { CloudError, transaction, type SqlConnection, type SqlPool } from './postgres-store';
import { accountView, assertAccess } from './access-policy';
import type { Account, AccessGrant, AdminEvent, ManagedAccount } from '../../src/account';

function text(value: unknown, label: string, max: number, min = 0) {
  if (typeof value !== 'string' || value.trim().length < min || value.trim().length > max || /[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(value)) throw new CloudError(`${label} không hợp lệ.`);
  return value.trim();
}
function keys(value: Record<string, unknown>, allowed: string[]) {
  if (Object.keys(value).some(key => !allowed.includes(key))) throw new CloudError('Có trường thông tin không được phép thay đổi.');
}
export function grantInput(value: Record<string, unknown>) {
  const maxProfiles = value.maxProfiles, maxConcurrent = value.maxConcurrent;
  if (!Number.isInteger(maxProfiles) || Number(maxProfiles) < 1 || Number(maxProfiles) > 100 || !Number.isInteger(maxConcurrent) || Number(maxConcurrent) < 1 || Number(maxConcurrent) > Number(maxProfiles) || typeof value.liveEnabled !== 'boolean') throw new CloudError('Giới hạn profile phải từ 1 đến 100; số chạy đồng thời không vượt số profile.');
  let expiresAt: string | null = null;
  if (value.expiresAt !== null) {
    if (typeof value.expiresAt !== 'string' || !/^\d{4}-\d{2}-\d{2}T/.test(value.expiresAt) || !Number.isFinite(Date.parse(value.expiresAt))) throw new CloudError('Ngày hết hạn không hợp lệ.');
    expiresAt = new Date(value.expiresAt).toISOString();
  }
  return { maxProfiles: Number(maxProfiles), maxConcurrent: Number(maxConcurrent), liveEnabled: value.liveEnabled, expiresAt };
}
function emailInput(value: unknown) {
  const email = text(value, 'Email', 254, 3).toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new CloudError('Email không hợp lệ.');
  return email;
}
const iso = (value: unknown) => value ? new Date(String(value)).toISOString() : null;
function managed(row: any): ManagedAccount {
  return { ...accountView(row), adminNote: row.admin_note, version: row.version,
    profileCount: Number(row.profile_count ?? 0), connectedCount: Number(row.connected_count ?? 0),
    testRuns: Number(row.test_runs ?? 0), liveRuns: Number(row.live_runs ?? 0) };
}
function grantView(row: any): AccessGrant {
  return { email: row.email, maxProfiles: row.max_profiles, maxConcurrent: row.max_concurrent,
    liveEnabled: row.live_enabled, expiresAt: iso(row.expires_at), createdAt: iso(row.created_at)! };
}

export class Accounts {
  constructor(public pool: SqlPool, private bootstrapEmail?: string) {}
  async get(id: string, db: SqlConnection = this.pool, lock = false): Promise<Account | undefined> {
    const row = (await db.query(`SELECT * FROM hanu.accounts WHERE user_id=$1${lock ? ' FOR UPDATE' : ''}`, [id])).rows[0];
    return row ? accountView(row) : undefined;
  }
  async identify(user: WebUser) {
    const existing = (await this.pool.query('SELECT * FROM hanu.accounts WHERE user_id=$1', [user.id])).rows[0];
    const email = user.email.toLowerCase(), verified = user.emailVerified === true;
    const changed = !existing || existing.email !== email || existing.email_verified !== verified || existing.name !== user.name || existing.avatar_url !== (user.avatarUrl ?? '') || existing.last_session_key !== user.sessionKey;
    if (!changed && Date.now() - new Date(existing.last_seen_at).getTime() < 60000) return accountView(existing);
    return transaction(this.pool, async db => {
      // Only the explicitly configured, verified email can bootstrap the FIRST
      // administrator. Table lock prevents two first logins granting two admins.
      const bootstrap = verified && !!this.bootstrapEmail && email === this.bootstrapEmail;
      if (bootstrap) await db.query('LOCK TABLE hanu.accounts IN SHARE ROW EXCLUSIVE MODE');
      const result = await db.query(`INSERT INTO hanu.accounts(user_id,email,email_verified,name,avatar_url,google_sub,last_session_key)
        VALUES($1,$2,$3,$4,$5,$6,$7) ON CONFLICT(user_id) DO UPDATE SET
        email=EXCLUDED.email,email_verified=EXCLUDED.email_verified,name=EXCLUDED.name,avatar_url=EXCLUDED.avatar_url,google_sub=EXCLUDED.google_sub,
        last_seen_at=now(),last_login_at=CASE WHEN hanu.accounts.last_session_key<>EXCLUDED.last_session_key THEN now() ELSE hanu.accounts.last_login_at END,
        last_session_key=EXCLUDED.last_session_key RETURNING *`,
        [user.id, email, verified, user.name.slice(0, 200), user.avatarUrl ?? '', user.googleSub ?? '', user.sessionKey]);
      let row = result.rows[0];
      if (bootstrap && row.role !== 'admin') {
        const updated = await db.query(`UPDATE hanu.accounts SET role='admin',status='active',live_enabled=true,max_profiles=100,max_concurrent=100,version=version+1
          WHERE user_id=$1 AND NOT EXISTS(SELECT 1 FROM hanu.accounts WHERE role='admin') RETURNING *`, [user.id]);
        if (updated.rows[0]) {
          row = updated.rows[0];
          await this.audit(db, user.id, email, user.id, email, 'bootstrap_admin', {});
        }
      }
      // A pre-approval is consumed once, by the first verified login. It cannot
      // reactivate an account that an administrator later blocks or rejects.
      if ((!existing || !existing.email_verified) && verified && row.role !== 'admin' && row.status === 'pending') {
        const grant = (await db.query('DELETE FROM hanu.access_grants WHERE email=$1 RETURNING *', [email])).rows[0];
        if (grant) {
          row = (await db.query(`UPDATE hanu.accounts SET status='active',max_profiles=$2,max_concurrent=$3,live_enabled=$4,expires_at=$5,version=version+1 WHERE user_id=$1 AND status='pending' RETURNING *`,
            [user.id, grant.max_profiles, grant.max_concurrent, grant.live_enabled, grant.expires_at])).rows[0] ?? row;
          await this.audit(db, null, 'system', user.id, email, 'claim_grant', {});
        }
      }
      return accountView(row);
    });
  }
  async profile(id: string, value: Record<string, unknown>) {
    keys(value, ['contactName', 'phone', 'purpose', 'consent']);
    const name = text(value.contactName, 'Tên liên hệ', 120, 2), purpose = text(value.purpose, 'Mục đích sử dụng', 500, 5);
    const phone = text(value.phone, 'Số điện thoại/Zalo', 30, 8);
    if (!/^\+?[\d\s().-]+$/.test(phone) || phone.replace(/\D/g, '').length < 8 || phone.replace(/\D/g, '').length > 15) throw new CloudError('Số điện thoại/Zalo cần từ 8 đến 15 chữ số.');
    if (value.consent !== true) throw new CloudError('Cần xác nhận thông tin và mục đích thu thập.');
    const row = (await this.pool.query(`UPDATE hanu.accounts SET contact_name=$2,phone=$3,purpose=$4,consent_at=coalesce(consent_at,now()),version=version+1 WHERE user_id=$1 RETURNING *`, [id, name, phone, purpose])).rows[0];
    if (!row) throw new CloudError('Không tìm thấy tài khoản.', 404);
    return accountView(row);
  }
  async requireAdmin(id: string, db: SqlConnection = this.pool) {
    const account = await this.get(id, db);
    assertAccess(account);
    if (account.role !== 'admin') throw new CloudError('Chỉ quản trị viên được thực hiện thao tác này.', 403);
    return account;
  }
  private audit(db: SqlConnection, actor: string | null, actorEmail: string, target: string | null, targetEmail: string, action: string, details: object) {
    return db.query('INSERT INTO hanu.admin_events(actor,actor_email,target,target_email,action,details) VALUES($1,$2,$3,$4,$5,$6)', [actor, actorEmail, target, targetEmail, action, JSON.stringify(details)]);
  }
  async list(params: URLSearchParams) {
    const query = (params.get('q') ?? '').trim().slice(0, 200), status = params.get('status') ?? 'all';
    const page = Number(params.get('page') ?? 1);
    if (!Number.isInteger(page) || page < 1 || page > 100000 || !['all', 'pending', 'active', 'blocked', 'rejected', 'expired'].includes(status)) throw new CloudError('Bộ lọc không hợp lệ.');
    const condition = `($1='' OR strpos(lower(a.email||' '||a.name||' '||a.contact_name||' '||a.phone),lower($1))>0)
      AND ($2='all' OR CASE WHEN a.status='active' AND a.expires_at<=now() THEN 'expired' ELSE a.status END=$2)`;
    const [total, rows, summary] = await Promise.all([
      this.pool.query(`SELECT count(*) AS total FROM hanu.accounts a WHERE ${condition}`, [query, status]),
      this.pool.query(`SELECT a.*,
        (SELECT count(*) FROM hanu.sessions s WHERE s.owner=a.user_id) AS profile_count,
        (SELECT count(*) FROM hanu.sessions s WHERE s.owner=a.user_id AND NOT s.revoked AND s.data->>'connected'='true') AS connected_count,
        (SELECT count(*) FROM hanu.runs r WHERE r.owner=a.user_id AND r.data->>'mode'='test') AS test_runs,
        (SELECT count(*) FROM hanu.runs r WHERE r.owner=a.user_id AND r.data->>'mode'='live') AS live_runs
        FROM hanu.accounts a WHERE ${condition} ORDER BY a.created_at DESC,a.user_id LIMIT 25 OFFSET $3`, [query, status, (page - 1) * 25]),
      this.pool.query(`SELECT count(*)::int AS total,
        count(*) FILTER(WHERE status='pending')::int AS pending,
        count(*) FILTER(WHERE status='active' AND (expires_at IS NULL OR expires_at>now()))::int AS active,
        count(*) FILTER(WHERE status='blocked')::int AS blocked,
        count(*) FILTER(WHERE status='active' AND expires_at<=now())::int AS expired FROM hanu.accounts`)
    ]);
    return { accounts: rows.rows.map(managed), total: Number(total.rows[0].total), page, pageSize: 25, summary: summary.rows[0] };
  }
  async detail(id: string) {
    const row = (await this.pool.query('SELECT * FROM hanu.accounts WHERE user_id=$1', [id])).rows[0];
    if (!row) throw new CloudError('Không tìm thấy tài khoản.', 404);
    const sessions = (await this.pool.query(`SELECT id,extension_id,revoked,data->>'name' AS name,data->>'lastSeen' AS last_seen,
      data->>'connected' AS connected,data#>>'{run,status}' AS run_status FROM hanu.sessions WHERE owner=$1 ORDER BY created_at,id LIMIT 100`, [id])).rows;
    const counts = (await this.pool.query(`SELECT count(*) FILTER(WHERE data->>'mode'='test')::int AS test_runs,count(*) FILTER(WHERE data->>'mode'='live')::int AS live_runs FROM hanu.runs WHERE owner=$1`, [id])).rows[0];
    return { account: managed({ ...row, ...counts, profile_count: sessions.length, connected_count: sessions.filter(s => s.connected === 'true' && !s.revoked).length }),
      sessions: sessions.map(s => ({ id: s.id, name: s.name, extensionId: s.extension_id, revoked: s.revoked, connected: s.connected === 'true', lastSeenAt: s.last_seen || null, runStatus: s.run_status })) };
  }
  async update(actorId: string, id: string, value: Record<string, unknown>) {
    keys(value, ['status', 'maxProfiles', 'maxConcurrent', 'liveEnabled', 'expiresAt', 'adminNote', 'version']);
    const grant = grantInput(value), note = text(value.adminNote, 'Ghi chú quản trị', 2000);
    if (!['pending', 'active', 'blocked', 'rejected'].includes(String(value.status)) || !Number.isInteger(value.version)) throw new CloudError('Trạng thái hoặc phiên bản không hợp lệ.');
    return transaction(this.pool, async db => {
      const actor = await this.requireAdmin(actorId, db);
      const old = (await db.query('SELECT * FROM hanu.accounts WHERE user_id=$1 FOR UPDATE', [id])).rows[0];
      if (!old) throw new CloudError('Không tìm thấy tài khoản.', 404);
      if (old.role === 'admin') throw new CloudError('Không thay đổi quyền tài khoản quản trị tại đây.', 403);
      if (old.version !== value.version) throw new CloudError('Thông tin vừa thay đổi. Tải lại trước khi lưu.', 409);
      if (value.status === 'active' && !old.email_verified) throw new CloudError('Email chưa được xác minh.');
      const row = (await db.query(`UPDATE hanu.accounts SET status=$2,max_profiles=$3,max_concurrent=$4,live_enabled=$5,expires_at=$6,admin_note=$7,version=version+1 WHERE user_id=$1 RETURNING *`,
        [id, value.status, grant.maxProfiles, grant.maxConcurrent, grant.liveEnabled, grant.expiresAt, note])).rows[0];
      await db.query('DELETE FROM hanu.pairing WHERE owner=$1', [id]);
      await this.audit(db, actorId, actor.email, id, old.email, 'update_access', {
        before: { status: old.status, maxProfiles: old.max_profiles, maxConcurrent: old.max_concurrent, liveEnabled: old.live_enabled, expiresAt: iso(old.expires_at), adminNote: old.admin_note },
        after: { status: value.status, ...grant, adminNote: note }
      });
      const interrupt = (value.status !== 'active' && old.status === 'active') ||
        (grant.expiresAt !== null && Date.parse(grant.expiresAt) <= Date.now()) ||
        (old.live_enabled && !grant.liveEnabled) || grant.maxConcurrent < old.max_concurrent;
      return { account: managed(row), interrupt };
    });
  }
  async promoteAdmin(actorId: string, id: string, value: Record<string, unknown>) {
    keys(value, ['version']);
    if (!Number.isInteger(value.version)) throw new CloudError('Phiên bản tài khoản không hợp lệ.');
    return transaction(this.pool, async db => {
      const actor = await this.requireAdmin(actorId, db);
      const old = (await db.query('SELECT * FROM hanu.accounts WHERE user_id=$1 FOR UPDATE', [id])).rows[0];
      if (!old) throw new CloudError('Không tìm thấy tài khoản.', 404);
      if (old.version !== value.version) throw new CloudError('Thông tin vừa thay đổi. Tải lại trước khi cấp quyền.', 409);
      if (old.role === 'admin') throw new CloudError('Tài khoản đã là quản trị viên.', 409);
      // A role change does not approve a blocked, pending, expired or unverified account.
      assertAccess(accountView(old));
      const row = (await db.query("UPDATE hanu.accounts SET role='admin',expires_at=NULL,version=version+1 WHERE user_id=$1 RETURNING *", [id])).rows[0];
      await this.audit(db, actorId, actor.email, id, old.email, 'promote_admin', { before: { role: old.role, expiresAt: iso(old.expires_at) }, after: { role: 'admin', expiresAt: null } });
      return managed(row);
    });
  }
  async grants() { return (await this.pool.query('SELECT * FROM hanu.access_grants ORDER BY created_at DESC LIMIT 200')).rows.map(grantView); }
  async createGrant(actorId: string, value: Record<string, unknown>) {
    keys(value, ['email', 'maxProfiles', 'maxConcurrent', 'liveEnabled', 'expiresAt']);
    const email = emailInput(value.email), grant = grantInput(value);
    if (grant.expiresAt && Date.parse(grant.expiresAt) <= Date.now()) throw new CloudError('Ngày hết hạn của quyền cấp trước phải ở tương lai.');
    return transaction(this.pool, async db => {
      const actor = await this.requireAdmin(actorId, db);
      // Serialize with first login/claim without granting privileges to email alone.
      await db.query('LOCK TABLE hanu.accounts IN SHARE ROW EXCLUSIVE MODE');
      if ((await db.query('SELECT 1 FROM hanu.accounts WHERE lower(email)=$1', [email])).rowCount) throw new CloudError('Email đã có tài khoản. Hãy cấp quyền trong danh sách người dùng.', 409);
      const row = (await db.query(`INSERT INTO hanu.access_grants(email,max_profiles,max_concurrent,live_enabled,expires_at,created_by) VALUES($1,$2,$3,$4,$5,$6)
        ON CONFLICT(email) DO UPDATE SET max_profiles=EXCLUDED.max_profiles,max_concurrent=EXCLUDED.max_concurrent,live_enabled=EXCLUDED.live_enabled,expires_at=EXCLUDED.expires_at,created_by=EXCLUDED.created_by,created_at=now() RETURNING *`,
        [email, grant.maxProfiles, grant.maxConcurrent, grant.liveEnabled, grant.expiresAt, actorId])).rows[0];
      await this.audit(db, actorId, actor.email, null, email, 'create_grant', grant);
      return grantView(row);
    });
  }
  async deleteGrant(actorId: string, email: string) {
    return transaction(this.pool, async db => {
      const actor = await this.requireAdmin(actorId, db), normalized = emailInput(email);
      await db.query('DELETE FROM hanu.access_grants WHERE email=$1', [normalized]);
      await this.audit(db, actorId, actor.email, null, normalized, 'delete_grant', {});
    });
  }
  async revokeExtension(actorId: string, target: string, session: string) {
    await transaction(this.pool, async db => {
      const actor = await this.requireAdmin(actorId, db), account = await this.get(target, db);
      if (!account) throw new CloudError('Không tìm thấy tài khoản.', 404);
      const result = await db.query('UPDATE hanu.sessions SET revoked=true,token_hash=$3 WHERE owner=$1 AND id=$2 RETURNING id', [target, session, digest(randomBytes(32))]);
      if (!result.rowCount) throw new CloudError('Không tìm thấy profile.', 404);
      await this.audit(db, actorId, actor.email, target, account.email, 'revoke_extension', { session });
    });
  }
  async events(target?: string): Promise<AdminEvent[]> {
    return (await this.pool.query(`SELECT * FROM hanu.admin_events ${target ? 'WHERE target=$1' : ''} ORDER BY at DESC,id DESC LIMIT 100`, target ? [target] : [])).rows.map(row => ({ id: String(row.id), at: iso(row.at)!, actorEmail: row.actor_email, targetEmail: row.target_email, action: row.action, details: row.details }));
  }
}
