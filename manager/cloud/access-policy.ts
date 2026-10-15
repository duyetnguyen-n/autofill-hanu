import type { SqlConnection } from './postgres-store';
import { CloudError } from './errors';
import type { Account } from '../../src/account';

const date = (value: unknown) => value ? new Date(String(value)).toISOString() : null;
export function accountView(row: any): Account {
  return {
    id: row.user_id, email: row.email, name: row.name, avatarUrl: row.avatar_url,
    emailVerified: row.email_verified, role: row.role,
    status: row.status === 'active' && row.expires_at && new Date(row.expires_at).getTime() <= Date.now() ? 'expired' : row.status,
    profileComplete: !!(row.contact_name && row.phone && row.purpose && row.consent_at),
    contactName: row.contact_name, phone: row.phone, purpose: row.purpose,
    maxProfiles: row.max_profiles, maxConcurrent: row.max_concurrent, liveEnabled: row.live_enabled,
    expiresAt: date(row.expires_at), createdAt: date(row.created_at)!,
    lastLoginAt: date(row.last_login_at)!, lastSeenAt: date(row.last_seen_at)!
  };
}
export function assertAccess(account?: Account): asserts account is Account {
  if (!account) throw new CloudError('Tài khoản chưa được cấp quyền.', 403, 'ACCESS_DENIED');
  if (!account.emailVerified) throw new CloudError('Email Google chưa được xác minh.', 403, 'ACCESS_DENIED');
  const messages = { pending: 'Tài khoản đang chờ quản trị viên duyệt.', blocked: 'Tài khoản đã bị khóa.', rejected: 'Yêu cầu sử dụng chưa được chấp thuận.', expired: 'Quyền sử dụng đã hết hạn. Liên hệ quản trị viên để gia hạn.' };
  if (account.status !== 'active') throw new CloudError(messages[account.status], 403, 'ACCESS_DENIED');
  if (account.role !== 'admin' && !account.profileComplete) throw new CloudError('Hoàn tất thông tin liên hệ trước khi sử dụng.', 403, 'ACCESS_DENIED');
}
export async function requireAccount(db: SqlConnection, owner: string, lock = false) {
  const row = (await db.query(`SELECT * FROM hanu.accounts WHERE user_id=$1${lock ? ' FOR UPDATE' : ''}`, [owner])).rows[0];
  const account = row ? accountView(row) : undefined;
  assertAccess(account);
  return account;
}
export function assertLive(account: Account, mode: string) {
  if (mode === 'live' && !account.liveEnabled) throw new CloudError('Tài khoản chưa được cấp quyền chạy Live.', 403);
}
export async function assertCapacity(db: SqlConnection, account: Account, ids: string[]) {
  const count = Number((await db.query(`SELECT count(*) AS count FROM hanu.sessions
    WHERE owner=$1 AND NOT (id=ANY($2::text[])) AND
    (data#>>'{run,status}' IN ('running','submitting') OR data#>>'{execution,status}' IN ('running','submitting'))`, [account.id, ids])).rows[0].count);
  if (count + ids.length > account.maxConcurrent) throw new CloudError(`Chỉ được chạy đồng thời ${account.maxConcurrent} profile. Dừng lượt khác hoặc liên hệ quản trị viên.`, 409);
}
