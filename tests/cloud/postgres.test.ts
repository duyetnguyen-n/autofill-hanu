import { afterEach, expect, it } from 'vitest';
import { databaseFixture, users, extension } from './fixture';
import { Coordinator } from '../../manager/server/coordinator';
import { digest } from '../../manager/server/store';
import type { RunState } from '../../src/shared';

const cleanups: (() => Promise<void>)[] = [];
afterEach(async () => { for (const close of cleanups.splice(0).reverse()) await close(); });
async function setup() { const f = await databaseFixture(); cleanups.push(f.close); return f; }

it('consumes pair codes once, binds token to extension/profile and rejects expired codes', async () => {
  const f = await setup(), code = await f.repository.pairCode(users[0]);
  const paired = await f.repository.pair(crypto.randomUUID(), extension, code);
  expect(await f.repository.authenticate(paired.sessionId, extension, paired.token)).toBe(users[0]);
  expect(await f.repository.authenticate(paired.sessionId, 'b'.repeat(32), paired.token)).toBeUndefined();
  await expect(f.repository.pair(crypto.randomUUID(), extension, code)).rejects.toThrow('đã dùng');
  const expired = await f.repository.pairCode(users[0]);
  await f.pool.query("UPDATE hanu.pairing SET expires_at=now()-interval '1 minute' WHERE code_hash=$1", [digest(expired)]);
  await expect(f.repository.pair(crypto.randomUUID(), extension, expired)).rejects.toThrow('hết hạn');
}, 20000);

it('isolates sessions, images and groups even when IDs are known by another account', async () => {
  const f = await setup(), a = await f.pair(users[0]), b = await f.pair(users[1]);
  const bytes = Buffer.from('private fixture image');
  await a.store.saveAttachment(a.sessionId, 'same', bytes, digest(bytes));
  await b.store.saveAttachment(b.sessionId, 'same', Buffer.from('other'), digest('other'));
  expect((await a.store.attachment(a.sessionId, 'same')).data).toEqual(bytes);
  await expect(b.store.session(a.sessionId)).rejects.toMatchObject({ status: 404 });
  await expect(b.store.attachment(a.sessionId, 'same')).rejects.toMatchObject({ status: 404 });
  expect((await a.store.sessions()).map(s => s.id)).toEqual([a.sessionId]);
});

it('RLS hides the other owner and token hashes, and denies direct browser writes', async () => {
  const f = await setup(), a = await f.pair(users[0]); await f.pair(users[1]);
  await f.db.exec(`SET ROLE authenticated; SET request.jwt.claim.sub='${users[0]}'`);
  try {
    const rows = await f.db.query('SELECT id,data FROM hanu.sessions');
    expect(rows.rows.map((r: any) => r.id)).toEqual([a.sessionId]);
    await expect(f.db.query('SELECT token_hash FROM hanu.sessions')).rejects.toThrow('permission denied');
    await expect(f.db.query("UPDATE hanu.sessions SET data='{}'")).rejects.toThrow('permission denied');
    await expect(f.db.query('SELECT * FROM hanu.pairing')).rejects.toThrow('permission denied');
  } finally { await f.db.exec('RESET ROLE; RESET request.jwt.claim.sub'); }
});

async function start(f: Awaited<ReturnType<typeof setup>>, count = 1) {
  const members = await Promise.all(Array.from({ length: count }, () => f.pair()));
  const c = new Coordinator(members[0].store, undefined, true), sent: any[] = [];
  for (const m of members) c.peers.set(m.sessionId, {} as any);
  c.command = async (id, kind, payload) => { sent.push({ id, kind, payload }); return {}; };
  const group = await c.start(members.map(m => m.sessionId), 'https://docs.google.com/forms/d/e/fixture-form/viewform', 'live');
  for (const m of members) {
    const s = await m.store.session(m.sessionId); s.run!.formId = 'fixture-form'; await m.store.saveSession(s);
  }
  return { c, sent, members, group };
}

it('starts all profiles and grants submit only once, including two simultaneous requests', async () => {
  const f = await setup(), { members, group } = await start(f, 3), a = members[0];
  const grants = await Promise.allSettled([a.store.acquireSubmit(a.sessionId, group.id, 'fixture-form'), a.store.acquireSubmit(a.sessionId, group.id, 'fixture-form')]);
  expect(grants.filter(r => r.status === 'fulfilled')).toHaveLength(1);
  expect(await a.store.blocked(a.sessionId, 'fixture-form')).toBe(true);
  expect(await members[1].store.blocked(members[1].sessionId, 'fixture-form')).toBe(false);
  await expect(a.store.acquireSubmit(a.sessionId, group.id, 'different-form')).rejects.toThrow('khóa');
});
it('preserves confirmed submissions when a profile-wide Stop is acknowledged',async()=>{
 const f=await setup(),{members,group}=await start(f),a=members[0];
 await a.store.acquireSubmit(a.sessionId,group.id,'fixture-form');await a.store.resolve(a.sessionId,group.id,'received');
 await a.store.acknowledgeStop(a.sessionId,group.id,{execution:null});
 expect((await a.store.session(a.sessionId)).run).toMatchObject({status:'completed',submitAttempted:true});
 expect(await a.store.blocked(a.sessionId,'fixture-form')).toBe(true);
});

it('persists locks and pauses unfinished runs after recovery; relinking preserves the profile ID', async () => {
  const f = await setup(), { members, group } = await start(f), a = members[0];
  await a.store.acquireSubmit(a.sessionId, group.id, 'fixture-form');
  await f.repository.recover();
  expect((await a.store.session(a.sessionId)).run).toMatchObject({ status: 'submit_uncertain', recoveryRequired: true, submitAttempted: true });
  const code = await f.repository.pairCode(users[0], a.sessionId);
  const paired = await f.repository.pair(crypto.randomUUID(), 'b'.repeat(32), code);
  expect(paired.sessionId).toBe(a.sessionId);
  expect(await f.repository.authenticate(a.sessionId, extension, a.token)).toBeUndefined();
  expect(await a.store.blocked(a.sessionId, 'fixture-form')).toBe(true);
  expect((await a.store.history(a.sessionId))).toHaveLength(1);
  await expect(f.repository.pairCode(users[1], a.sessionId)).rejects.toMatchObject({ status: 404 });
});

it('keeps stale runs locked after manual resolution while permitting a fresh run', async () => {
  const f = await setup(), { members, group } = await start(f), a = members[0];
  await a.store.acquireSubmit(a.sessionId, group.id, 'fixture-form');
  await a.store.resolve(a.sessionId, group.id, 'not_received');
  expect(await a.store.blocked(a.sessionId, 'fixture-form')).toBe(false);
  await expect(a.store.acquireSubmit(a.sessionId, group.id, 'fixture-form')).rejects.toThrow('khóa');
  expect((await a.store.history(a.sessionId))[0].submitAttempted).toBe(true);
});

it('fences starts and submit grants after the coordinator lease is lost', async () => {
  const f = await setup(), { members, group } = await start(f), a = members[0];
  await f.pool.query("UPDATE hanu.server_lease SET expires_at=now()-interval '1 second'");
  await expect(a.store.acquireSubmit(a.sessionId, group.id, 'fixture-form')).rejects.toMatchObject({ status: 503 });
  expect(await a.store.blocked(a.sessionId, 'fixture-form')).toBe(false);
  await expect(f.repository.renewLease()).rejects.toMatchObject({ status: 503 });
});

it('merges progress with an independent edit and refuses to overwrite a concurrent profile edit', async () => {
  const f = await setup(), { members } = await start(f), a = members[0];
  const edit = await a.store.session(a.sessionId), before = structuredClone(edit.run!);
  edit.name = 'Tên chỉnh sửa';
  await a.store.acceptProgress(a.sessionId, { ...before, eventSeq: 2, status: 'waiting_manual' });
  await a.store.saveSession(edit);
  expect((await a.store.session(a.sessionId))).toMatchObject({ name: 'Tên chỉnh sửa', run: { eventSeq: 2, status: 'waiting_manual' } });
  const old = await a.store.session(a.sessionId), current = await a.store.session(a.sessionId);
  current.profile!.values.fullName = 'Tên mới'; await a.store.saveSession(current);
  old.synced = true;
  await expect(a.store.saveSession(old)).rejects.toMatchObject({ status: 409 });
});

it('merges a shared answer acknowledgement with its earlier STATE message without losing sequence',async()=>{
  const f=await setup(),{members}=await start(f),a=members[0];
  const s=await a.store.session(a.sessionId);s.run!.status='waiting_manual';await a.store.saveSession(s);
  const before=await a.store.session(a.sessionId);
  before.run!.finalQuestion={label:'Năm?',value:'2026'};
  const event=(await a.store.session(a.sessionId)).run!;
  await a.store.acceptProgress(a.sessionId,{...event,eventSeq:2});
  await a.store.saveSession(before);
  expect((await a.store.session(a.sessionId)).run).toMatchObject({eventSeq:2,finalQuestion:{value:'2026'}});
});

it('orders a slow disconnect before reconnect so the new peer remains connected',async()=>{
  const f=await setup(),a=await f.pair(),c=new Coordinator(a.store),old={} as any,next={} as any;
  await c.connect(a.sessionId,old);
  const connected=a.store.connected.bind(a.store),calls:boolean[]=[];let release!:()=>void;
  a.store.connected=async(id,value)=>{calls.push(value);if(!value)await new Promise<void>(resolve=>{release=resolve;});await connected(id,value);};
  const disconnect=c.disconnect(a.sessionId,old);
  await expect.poll(()=>typeof release).toBe('function');
  const reconnect=c.connect(a.sessionId,next);expect(calls).toEqual([false]);
  release();await Promise.all([disconnect,reconnect]);
  expect(calls).toEqual([false,true]);expect((await a.store.session(a.sessionId)).connected).toBe(true);expect(c.peers.get(a.sessionId)).toBe(next);
});

it('rejects wrong-run, other-session and delayed sequence events, and keeps a shared answer snapshot', async () => {
  const f = await setup(), { members } = await start(f), a = members[0];
  const s = await a.store.session(a.sessionId); s.run!.finalQuestion = { label: 'Năm?', value: '2026' }; await a.store.saveSession(s);
  const run = (await a.store.session(a.sessionId)).run!;
  expect(await a.store.acceptProgress(a.sessionId, { ...run, runId: 'old', eventSeq: 5 })).toBe(false);
  expect(await a.store.acceptProgress(a.sessionId, { ...run, sessionId: crypto.randomUUID(), eventSeq: 5 })).toBe(false);
  expect(await a.store.acceptProgress(a.sessionId,{...run,eventSeq:2**40})).toBe(false);
  expect(await a.store.acceptProgress(a.sessionId,{...run,eventSeq:5,status:'invalid' as any})).toBe(false);
  await a.store.acceptProgress(a.sessionId, { ...run, eventSeq: 2, status: 'paused', finalQuestion: undefined });
  expect(await a.store.acceptProgress(a.sessionId, { ...run, eventSeq: 1, status: 'running' })).toBe(false);
  expect((await a.store.session(a.sessionId)).run?.finalQuestion?.value).toBe('2026');
  await a.store.acceptProgress(a.sessionId,{...run,eventSeq:3,mode:'test',expectedEmail:'spoof@example.test',url:'https://docs.google.com/forms/d/e/other/viewform'});
  expect((await a.store.session(a.sessionId)).run).toMatchObject({mode:'live',expectedEmail:run.expectedEmail,url:run.url});
  await a.store.connected(a.sessionId, false);
  expect(await a.store.acceptProgress(a.sessionId, { ...run, eventSeq: 4, status: 'running' })).toBe(false);
});

it('imports extension-only edits while retaining unsaved manager drafts as conflicts', async () => {
  const f = await setup(), a = await f.pair();
  const c = new Coordinator(a.store, undefined, true);
  const local = structuredClone((await a.store.session(a.sessionId)).profile!);
  local.values.phone = '0900000000';
  c.command = async () => ({ profile: local, revision: 2 });
  await c.receive(a.sessionId, { type: 'PROFILE_CHANGED' });
  const imported = await c.pull(a.sessionId);
  expect(imported).toMatchObject({ synced: true, profile: local });
  expect(imported.conflict).toBeUndefined();
  const draft = structuredClone(local); draft.values.phone = '0911111111';
  await c.edit(a.sessionId, { profile: draft });
  local.values.phone = '0922222222';
  await c.receive(a.sessionId, { type: 'PROFILE_CHANGED' });
  const conflict = await c.pull(a.sessionId);
  expect(conflict).toMatchObject({ synced: false, managerDraft: true, profile: draft, conflict: { profile: local } });
});

it('does not treat PostgreSQL JSON key ordering as a conflict on legacy unsynced profiles', async () => {
  const f = await setup(), a = await f.pair();
  const c = new Coordinator(a.store, undefined, true);
  const legacy = await a.store.session(a.sessionId);
  legacy.synced = false;
  await a.store.saveSession(legacy);
  const reordered = Object.fromEntries(Object.entries(legacy.profile!).reverse());
  expect(JSON.stringify(reordered)).not.toBe(JSON.stringify(legacy.profile));
  c.command = async () => ({ profile: reordered, revision: 4 });
  const imported = await c.pull(a.sessionId);
  expect(imported.synced).toBe(true); expect(imported.conflict).toBeUndefined();
  expect(imported.profile).toEqual(legacy.profile);
});

it('commits Stop atomically against the latest checkpoint and never stops a replacement run',async()=>{
 const f=await setup(),{members,group,c}=await start(f),{store,sessionId:id}=members[0];
 const current=await store.session(id);current.run!.eventSeq=10;current.run!.status='waiting_manual';current.run!.blockingIssue={reason:'network',message:'offline'};await store.saveSession(current);
 const stopped=await store.acknowledgeStop(id,group.id,{run:{...current.run,eventSeq:5},execution:null});
 expect(stopped.run).toMatchObject({status:'idle',eventSeq:10,blockingIssue:undefined});expect(stopped.execution).toBeNull();
 const replacement=await c.start([id],group.url,'test');
 expect((await store.acknowledgeStop(id,group.id,{execution:null})).run).toMatchObject({runId:replacement.id,status:'running'});
});

it('transactionally re-arms a returned form without claiming the earlier response was not received',async()=>{
 const f=await setup(),{members,group}=await start(f),a=members[0],s=await a.store.session(a.sessionId);
 Object.assign(s.run!,{autoContinue:true,retryOnReturn:true,submissionEpoch:'old',contentEpoch:'new'});await a.store.saveSession(s);await a.store.acquireSubmit(a.sessionId,group.id,'fixture-form');
 await a.store.authorizeReturnedRetry(a.sessionId,group.id,'new',0);
 let current=await a.store.session(a.sessionId);expect(current.run).toMatchObject({submitAttempted:false,submissionRetries:1,status:'waiting_manual'});
 expect((await f.pool.query('SELECT resolution FROM hanu.locks WHERE session=$1',[a.sessionId])).rows[0].resolution).toBe('local_reserved');
 await a.store.authorizeReturnedRetry(a.sessionId,group.id,'new',0);expect((await a.store.session(a.sessionId)).run?.submissionRetries).toBe(1);
 current.run!.contentEpoch='newer';await a.store.saveSession(current);await a.store.authorizeReturnedRetry(a.sessionId,group.id,'newer',0);expect((await a.store.session(a.sessionId)).run?.pendingReturnedRetry?.epoch).toBe('newer');
 expect(await a.store.acceptProgress(a.sessionId,{...current.run!,submissionRetries:0,submitAttempted:true,status:'completed',eventSeq:100})).toBe(false);
 current=await a.store.session(a.sessionId);current.run!.status='running';await a.store.saveSession(current);
 const grants=await Promise.allSettled([a.store.acquireSubmit(a.sessionId,group.id,'fixture-form'),a.store.acquireSubmit(a.sessionId,group.id,'fixture-form')]);
 expect(grants.filter(r=>r.status==='fulfilled')).toHaveLength(1);
},20000);
