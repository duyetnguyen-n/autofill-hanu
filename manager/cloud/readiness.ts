import type { SqlPool } from './postgres-store';

export class CloudReadinessError extends Error {}

// Read catalog/configuration only. Never claim the coordinator lease, recover
// sessions, create users, or upload anything while checking a live project.
export async function checkCloudDatabase(pool: SqlPool) {
  const tables = ['sessions', 'groups', 'runs', 'locks', 'pairing', 'attachments', 'audit', 'server_lease'];
  const { rows } = await pool.query("SELECT c.relname, c.relrowsecurity FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='hanu' AND c.relkind='r'");
  for (const name of tables) {
    const table = rows.find(row => row.relname === name);
    if (!table) throw new CloudReadinessError(`Thiếu bảng hanu.${name}. Chạy migration trong project HANU riêng.`);
    if (!table.relrowsecurity) throw new CloudReadinessError(`RLS chưa bật cho hanu.${name}. Kiểm tra migration.`);
  }
  const bucket = (await pool.query("SELECT public,file_size_limit,allowed_mime_types FROM storage.buckets WHERE id='hanu-private'")).rows[0];
  if (!bucket) throw new CloudReadinessError('Thiếu bucket hanu-private. Kiểm tra migration.');
  if (bucket.public) throw new CloudReadinessError('Bucket hanu-private đang public. Chuyển về private trước khi dùng.');
  if (Number(bucket.file_size_limit) !== 10485760 || !bucket.allowed_mime_types?.includes('application/octet-stream')) throw new CloudReadinessError('Cấu hình giới hạn/MIME của hanu-private chưa khớp migration.');
}
