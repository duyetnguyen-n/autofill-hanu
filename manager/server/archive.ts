import type { GroupView, SessionView } from '../../src/protocol';
import { validateProfile, allowedFormUrl } from '../../src/protocol';
import type { RunState } from '../../src/shared';
import { Store, digest } from './store';

export const MAX_ARCHIVE_BYTES = 64 * 1024 * 1024;
export interface DataArchive {
  format: 'hanu-local-v1'; exportedAt: string;
  sessions: SessionView[]; groups: GroupView[];
  runs: { session: string; data: RunState }[];
  locks: { session: string; form: string; run: string; resolution: 'local_reserved' | 'uncertain' | 'received' | 'not_received'; created: string }[];
  attachments: { session: string; id: string; hash: string; base64: string }[];
}
export function exportArchive(store: Store): DataArchive {
  return store.transaction(() => {
    const sessions = store.sessions();
    if (sessions.some(s => s.execution || s.run && ['running', 'submitting'].includes(s.run.status))) throw new Error('Dừng các lượt đang hoạt động trước khi xuất dữ liệu.');
    const groups = store.groups(), runs = sessions.flatMap(s => store.history(s.id).map(data => ({ session: s.id, data })));
    const locks = store.db.prepare('SELECT session,form,run,resolution,created FROM locks').all() as DataArchive['locks'];
    const attachments = (store.db.prepare('SELECT session,id,hash,data FROM attachments').all() as { session: string; id: string; hash: string; data: Uint8Array }[]).map(row => ({ session: row.session, id: row.id, hash: row.hash, base64: Buffer.from(row.data).toString('base64') }));
    const archive: DataArchive = { format: 'hanu-local-v1', exportedAt: new Date().toISOString(), sessions: sessions.map(s => ({ ...s, connected: false, execution: undefined })), groups, runs, locks, attachments };
    if (Buffer.byteLength(JSON.stringify(archive)) > MAX_ARCHIVE_BYTES) throw new Error('Bản xuất vượt 64 MB. Giảm các ảnh không dùng trước khi chuyển dữ liệu.');
    return archive;
  });
}
export function validateArchive(value: unknown): asserts value is DataArchive {
  const a = value as DataArchive;
  if (!a || a.format !== 'hanu-local-v1' || !Array.isArray(a.sessions) || !Array.isArray(a.groups) || !Array.isArray(a.runs) || !Array.isArray(a.locks) || !Array.isArray(a.attachments) || !a.sessions.length || a.sessions.length > 100 || a.groups.length > 10000 || a.runs.length > 10000 || a.attachments.length > 1000 || a.locks.length > 10000) throw new Error('Bản xuất local không hợp lệ hoặc vượt giới hạn.');
  const sessions = new Set<string>(), groups = new Set<string>(), runs = new Set<string>(), images = new Set<string>();
  for (const s of a.sessions) {
    if (!s || !/^[a-zA-Z0-9-]{20,80}$/.test(s.id) || sessions.has(s.id) || typeof s.name !== 'string' || s.name.length > 100 || typeof s.expectedEmail !== 'string' || s.expectedEmail.length > 254 || !Number.isSafeInteger(s.revision) || s.revision < 0) throw new Error('Profile trong bản xuất không hợp lệ.');
    if (s.profile) validateProfile(s.profile); sessions.add(s.id);
  }
  for (const g of a.groups) {
    if (!g || typeof g.id !== 'string' || g.id.length > 100 || groups.has(g.id) || !allowedFormUrl(g.url) || !['live', 'test'].includes(g.mode) || !Array.isArray(g.members) || g.members.some(id => !sessions.has(id))) throw new Error('Nhóm trong bản xuất không hợp lệ.');
    groups.add(g.id);
  }
  for (const r of a.runs) {
    const run = r?.data, key = `${r?.session}:${run?.runId}`;
    if (!run || !sessions.has(r.session) || !groups.has(run.runId!) || run.sessionId !== r.session || runs.has(key) || !['live', 'test'].includes(run.mode) || typeof run.formId !== 'string' || !Array.isArray(run.logs) || !Number.isSafeInteger(run.eventSeq ?? 0)) throw new Error('Lịch sử trong bản xuất không hợp lệ.');
    runs.add(key);
  }
  for (const lock of a.locks) if (!lock || !runs.has(`${lock.session}:${lock.run}`) || typeof lock.form !== 'string' || !lock.form || !['local_reserved', 'uncertain', 'received', 'not_received'].includes(lock.resolution)) throw new Error('Khóa gửi trong bản xuất không hợp lệ.');
  for (const s of a.sessions) {
    if (s.run && !runs.has(`${s.id}:${s.run.runId}`)) throw new Error('Bản xuất thiếu lịch sử lượt hiện tại.');
  }
  for (const r of a.runs) if (r.data.submitAttempted && !a.locks.some(l => l.session === r.session && l.run === r.data.runId)) throw new Error('Bản xuất thiếu khóa của lượt đã cấp quyền Gửi.');
  for (const image of a.attachments) {
    const key = `${image?.session}:${image?.id}`;
    if (!image || !sessions.has(image.session) || !/^[a-zA-Z0-9_-]{1,100}$/.test(image.id) || images.has(key) || typeof image.base64 !== 'string' || !/^[a-f0-9]{64}$/.test(image.hash) || !/^[A-Za-z0-9+/]*={0,2}$/.test(image.base64)) throw new Error('Ảnh trong bản xuất không hợp lệ.');
    const bytes = Buffer.from(image.base64, 'base64');
    if (bytes.length > 10 * 1024 * 1024 || digest(bytes) !== image.hash) throw new Error('Ảnh trong bản xuất quá 10 MB hoặc mã băm không khớp.');
    images.add(key);
  }
  for (const s of a.sessions) for (const attachment of Object.values(s.profile?.attachments ?? {})) if (attachment && (!images.has(`${s.id}:${attachment.id}`) || Buffer.from(a.attachments.find(i => i.session === s.id && i.id === attachment.id)!.base64, 'base64').length !== attachment.size)) throw new Error('Bản xuất thiếu ảnh được dùng trong hồ sơ.');
}
