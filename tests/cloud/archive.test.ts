import { afterEach, expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Store, digest } from '../../manager/server/store';
import { exportArchive, validateArchive } from '../../manager/server/archive';
import { importArchive } from '../../manager/cloud/import-archive';
import { databaseFixture, users } from './fixture';
import { emptyProfile } from '../../src/rules';

const cleanups: (() => Promise<void> | void)[] = [];
afterEach(async () => { for (const close of cleanups.splice(0).reverse()) await close(); });
function archiveFixture() {
  const dir = mkdtempSync(join(tmpdir(), 'hanu-archive-')), store = new Store(join(dir, 'db.sqlite'));
  cleanups.push(() => { store.close(); rmSync(dir, { recursive: true, force: true }); });
  const id = crypto.randomUUID(); store.pair(id, store.pairCode()); const s = store.session(id);
  s.profile = emptyProfile(); s.profile.values.fullName = 'Hồ sơ chuyển thử';
  const bytes = Buffer.from('private archive fixture'); store.saveAttachment(id, 'image', bytes, digest(bytes));
  s.profile.attachments.identityDocument = { id: 'image', name: 'fixture.png', type: 'image/png', size: bytes.length, updatedAt: '' };
  s.expectedEmail = 'migration@example.test'; s.synced = true;
  s.run = { runId: 'archive-group', sessionId: id, managed: true, mode: 'live', formId: 'archive-form', tabId: 1, status: 'running', filled: [], skipped: [], logs: [], updatedAt: '', eventSeq: 0, submitAttempted: false };
  store.saveSession(s); store.saveGroup({ id: 'archive-group', mode: 'live', url: 'https://docs.google.com/forms/d/e/archive-form/viewform', members: [id], paused: false, createdAt: '' });
  store.acquireSubmit(id, 'archive-group', 'archive-form');
  const paused = store.session(id); paused.run!.status = 'submit_uncertain'; store.saveSession(paused);
  return { store, id, bytes };
}

it('exports without credentials and imports profile/image/history/locks into the authenticated owner', async () => {
  const f = archiveFixture(), archive = exportArchive(f.store), cloud = await databaseFixture(); cleanups.push(cloud.close);
  validateArchive(archive); expect(JSON.stringify(archive)).not.toContain('token');
  expect(await importArchive(cloud.repository, users[0], archive)).toEqual({ imported: 1 });
  const store = cloud.repository.store(users[0]), s = await store.session(f.id);
  expect(s).toMatchObject({ connected: false, synced: false, profile: { values: { fullName: 'Hồ sơ chuyển thử' } }, run: { status: 'submit_uncertain', submitAttempted: true } });
  expect(await store.blocked(f.id, 'archive-form')).toBe(true);
  expect((await store.attachment(f.id, 'image')).data).toEqual(f.bytes);
  expect((await store.history(f.id))[0].submitAttempted).toBe(true);
  await expect(cloud.repository.store(users[1]).session(f.id)).rejects.toMatchObject({ status: 404 });
  await expect(importArchive(cloud.repository, users[0], archive)).rejects.toMatchObject({ status: 409 });
}, 20000);

it('rejects missing submit locks, corrupt image hashes and exports while a form is still running', () => {
  const f = archiveFixture(), archive = exportArchive(f.store);
  const missing = structuredClone(archive); missing.locks = []; expect(() => validateArchive(missing)).toThrow('thiếu khóa');
  const corrupt = structuredClone(archive); corrupt.attachments[0].base64 = Buffer.from('tampered').toString('base64'); expect(() => validateArchive(corrupt)).toThrow('mã băm');
  const s = f.store.session(f.id); s.run!.status = 'running'; f.store.saveSession(s); expect(() => exportArchive(f.store)).toThrow('Dừng');
});
