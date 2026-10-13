import { expect, it } from 'vitest';
import { checkCloudDatabase } from '../../manager/cloud/readiness';
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
