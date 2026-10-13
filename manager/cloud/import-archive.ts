import { randomBytes } from 'node:crypto';
import { validateArchive, type DataArchive } from '../server/archive';
import { digest } from '../server/store';
import { CloudError, transaction, type CloudRepository } from './postgres-store';
import type { RunState } from '../../src/shared';
import type { SessionView } from '../../src/protocol';

function parked(run: RunState): RunState {
  const copy = structuredClone(run);
  copy.recoveryRequired = true;
  if (copy.status !== 'completed') copy.status = copy.submitAttempted ? 'submit_uncertain' : 'paused';
  copy.tabId = -1;
  return copy;
}
export async function importArchive(repository: CloudRepository, owner: string, value: unknown) {
  validateArchive(value); const archive: DataArchive = value;
  // Upload immutable objects before the DB transaction. A failed import may
  // leave unreferenced objects, but never partially imported sessions or locks.
  const paths = new Map<string, string>();
  for (const image of archive.attachments) {
    const path = `${owner}/${image.session}/${image.id}/${image.hash}`;
    await repository.objects.put(path, Buffer.from(image.base64, 'base64'));
    paths.set(`${image.session}:${image.id}`, path);
  }
  await transaction(repository.pool, async db => {
    await repository.store(owner).assertLease(db);
    if (Number((await db.query('SELECT count(*) AS count FROM hanu.sessions WHERE owner=$1', [owner])).rows[0].count) + archive.sessions.length > 100) throw new CloudError('Nhập dữ liệu sẽ vượt giới hạn 100 profile.');
    const duplicate = await db.query('SELECT 1 FROM hanu.sessions WHERE id=ANY($1::text[])', [archive.sessions.map(s => s.id)]);
    if (duplicate.rowCount) throw new CloudError('Bản dữ liệu này đã được nhập hoặc trùng profile. Dữ liệu hiện tại được giữ nguyên.', 409);
    for (const source of archive.sessions) {
      const data: SessionView = { id: source.id, name: source.name, expectedEmail: source.expectedEmail,
        profile: source.profile, revision: source.revision, connected: false, lastSeen: '', synced: false,
        error: 'Đã nhập dữ liệu local. Liên kết lại Chrome profile và đối chiếu trước khi chạy.',
        run: source.run ? parked(source.run) : undefined };
      await db.query('INSERT INTO hanu.sessions(owner,id,token_hash,extension_id,revoked,data) VALUES($1,$2,$3,$4,true,$5)', [owner, data.id, digest(randomBytes(32)), '', JSON.stringify(data)]);
    }
    for (const source of archive.groups) {
      const g = { id: source.id, url: source.url, mode: source.mode, members: source.members, paused: true, stopped: true, createdAt: source.createdAt };
      await db.query('INSERT INTO hanu.groups(owner,id,data) VALUES($1,$2,$3)', [owner, g.id, JSON.stringify(g)]);
    }
    for (const source of archive.runs) {
      const run = parked(source.data);
      await db.query('INSERT INTO hanu.runs(owner,session,id,data,seq) VALUES($1,$2,$3,$4,$5)', [owner, source.session, run.runId, JSON.stringify(run), run.eventSeq ?? 0]);
    }
    for (const lock of archive.locks) await db.query('INSERT INTO hanu.locks(owner,session,form,run,resolution) VALUES($1,$2,$3,$4,$5)', [owner, lock.session, lock.form, lock.run, lock.resolution === 'local_reserved' ? 'uncertain' : lock.resolution]);
    for (const image of archive.attachments) await db.query('INSERT INTO hanu.attachments(owner,session,id,hash,object_path,size) VALUES($1,$2,$3,$4,$5,$6)', [owner, image.session, image.id, image.hash, paths.get(`${image.session}:${image.id}`), Buffer.from(image.base64, 'base64').length]);
    await db.query("INSERT INTO hanu.audit(owner,kind,message) VALUES($1,'local_import',$2)", [owner, `Đã nhập ${archive.sessions.length} profile local và giữ các khóa gửi.`]);
  });
  return { imported: archive.sessions.length };
}
