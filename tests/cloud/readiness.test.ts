import { expect, it, vi } from 'vitest';
import { checkCloudDatabase, CloudReadinessError, cloudStartupError } from '../../manager/cloud/readiness';
import { CloudError } from '../../manager/cloud/errors';
import { serveCloud } from '../../manager/cloud/main';
import { databaseFixture } from './fixture';

it('checks the migration without modifying sessions or the existing server lease', async () => {
  const f = await databaseFixture();
  try {
    await f.pair();
    const before = (await f.pool.query('SELECT * FROM hanu.server_lease')).rows;
    const sessions = (await f.pool.query('SELECT data FROM hanu.sessions')).rows;
    await checkCloudDatabase(f.pool);
    expect((await f.pool.query('SELECT * FROM hanu.server_lease')).rows).toEqual(before);
    expect((await f.pool.query('SELECT data FROM hanu.sessions')).rows).toEqual(sessions);
    await f.pool.query('ALTER TABLE hanu.sessions DISABLE ROW LEVEL SECURITY');
    await expect(checkCloudDatabase(f.pool)).rejects.toThrow('RLS chưa bật');
    await f.pool.query('ALTER TABLE hanu.sessions ENABLE ROW LEVEL SECURITY');
    await f.pool.query("UPDATE storage.buckets SET public=true WHERE id='hanu-private'");
    await expect(checkCloudDatabase(f.pool)).rejects.toThrow('đang public');
    await f.pool.query("DELETE FROM storage.buckets WHERE id='hanu-private'");
    await expect(checkCloudDatabase(f.pool)).rejects.toThrow('Thiếu bucket');
    await f.pool.query('DROP TABLE hanu.audit');
    await expect(checkCloudDatabase(f.pool)).rejects.toThrow('Thiếu bảng hanu.audit');
  } finally { await f.close(); }
}, 20000);

it('reports the missing access migration before claiming a lease or recovering sessions', async () => {
  const f = await databaseFixture();
  try {
    await f.pool.query('DROP TABLE hanu.admin_events');
    const claim = vi.spyOn(f.repository, 'claimLease'), recover = vi.spyOn(f.repository, 'recover');
    const config = { origin: 'http://127.0.0.1:0', host: '127.0.0.1', port: 0, development: true,
      supabaseUrl: 'http://127.0.0.1:54321', publishableKey: 'fixture', secretKey: 'fixture', databaseUrl: 'fixture' };
    await expect(serveCloud({ config, repository: f.repository })).rejects.toThrow('202610150001_user_access.sql');
    expect(claim).not.toHaveBeenCalled(); expect(recover).not.toHaveBeenCalled();
  } finally { await f.close(); }
}, 20000);

it('prints controlled startup diagnostics while hiding raw database credentials', () => {
  const message = 'Thiếu bảng hanu.accounts. Chạy migration supabase/migrations/202610150001_user_access.sql trước khi deploy backend mới.';
  expect(cloudStartupError(new CloudReadinessError(message))).toBe(message);
  expect(cloudStartupError(new CloudError('Bộ điều phối đã mất quyền chạy.', 503))).toBe('Bộ điều phối đã mất quyền chạy.');
  expect(cloudStartupError(new Error('password=synthetic-secret postgres://private-database'))).not.toMatch(/synthetic-secret|private-database/);
});
