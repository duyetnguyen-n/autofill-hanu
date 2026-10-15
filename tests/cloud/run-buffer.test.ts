import { afterEach, expect, it, vi } from 'vitest';
import { databaseFixture, users } from './fixture';
import { Coordinator } from '../../manager/server/coordinator';
import { RunBuffer } from '../../manager/server/run-buffer';
import type { ExecutionView } from '../../src/protocol';

const cleanups: (() => Promise<void>)[] = [];
afterEach(async () => { for (const close of cleanups.splice(0).reverse()) await close(); });
async function setup() {
  const f = await databaseFixture(); cleanups.push(f.close);
  const paired = await f.pair(), store = paired.store, buffer = new RunBuffer(store);
  const c = new Coordinator(store, undefined, true, buffer), messages: any[] = [];
  const peer = { send: (raw: string) => messages.push(JSON.parse(raw)), readyState: 1 } as any;
  c.peers.set(paired.sessionId, peer);
  c.command = async () => ({});
  const group = await c.start([paired.sessionId], 'https://docs.google.com/forms/d/e/fixture-fast/viewform', 'live');
  const run = (await store.session(paired.sessionId)).run!;
  const progress = { ...run, formId: 'fixture-fast', eventSeq: 1, logs: [{ at: run.updatedAt, level: 'info' as const, message: 'Synthetic progress' }] };
  const execution: ExecutionView = { runId:run.runId,tabId:1,mode:'live',status:'running',managed:true,tabOpen:true,active:true,updatedAt:run.updatedAt };
  cleanups.push(async () => { c.attention.close(); await buffer.flush(paired.sessionId); });
  return { f, store, buffer, c, group, run, progress, execution, id: paired.sessionId, peer, messages };
}

it('keeps progress, execution, heartbeat, form checks and renderer leases off PostgreSQL while registering', async () => {
  const x = await setup(), query = vi.spyOn(x.f.pool, 'query'), connect = vi.spyOn(x.f.pool, 'connect');
  for (let seq = 1; seq <= 20; seq++) {
    await x.c.receive(x.id, { type:'STATE',run:{...x.progress,eventSeq:seq} });
    await x.c.receive(x.id, { type:'EXECUTION',execution:{...x.execution,updatedAt:String(seq)} });
  }
  await x.c.receive(x.id, { type:'HEARTBEAT' });
  await x.c.receive(x.id, { type:'REQUEST',requestId:'check',kind:'CHECK_FORM',runId:x.run.runId,formId:'fixture-fast' });
  await x.c.receive(x.id, { type:'REQUEST',requestId:'acquire',kind:'ATTENTION_ACQUIRE',runId:x.run.runId,rendering:'background' });
  const token = x.messages.find(m=>m.requestId==='acquire').token;
  await x.c.receive(x.id, { type:'REQUEST',requestId:'renew',kind:'ATTENTION_RENEW',token });
  await x.c.receive(x.id, { type:'REQUEST',requestId:'release',kind:'ATTENTION_RELEASE',token });
  expect(x.messages.find(m=>m.requestId==='check').ok).toBe(true);
  expect(x.messages.find(m=>m.requestId==='renew').renewed).toBe(true);
  expect(query).not.toHaveBeenCalled(); expect(connect).not.toHaveBeenCalled();
  const persisted = await x.store.session(x.id);
  expect(persisted.run?.eventSeq).toBe(0);
  const live = x.buffer.overlay([persisted])[0];
  expect(live.run?.eventSeq).toBe(20); expect(live.execution?.updatedAt).toBe('20');
  await x.c.receive(x.id, {type:'STATE',run:{...x.progress,eventSeq:21,status:'ready_to_submit'}});
  await x.c.receive(x.id, {type:'EXECUTION',execution:null});
  await x.buffer.flush(x.id);
  expect((await x.store.session(x.id)).run).toMatchObject({eventSeq:21,status:'ready_to_submit'});
  expect((await x.store.session(x.id)).execution).toBeNull();
  expect((await x.store.history(x.id))[0].eventSeq).toBe(21);
},20000);

it('rejects stale, foreign and changed-form progress and preserves the server snapshot', async () => {
  const x = await setup();
  expect(x.buffer.stage(x.id,{...x.progress,sessionId:'other'})).toBe(false);
  expect(x.buffer.stage(x.id,{...x.progress,runId:'other'})).toBe(false);
  expect(x.buffer.stage(x.id,{...x.progress,formId:'other'})).toBe(false);
  expect(x.buffer.stage(x.id,{...x.progress,eventSeq:2**40})).toBe(false);
  expect(x.buffer.stage(x.id,{...x.progress,mode:'test',expectedEmail:'spoof@example.test'})).toBe(true);
  expect(x.buffer.stage(x.id,x.progress)).toBe(false);
  const s = x.buffer.overlay([await x.store.session(x.id)])[0];
  expect(s.run).toMatchObject({mode:'live',expectedEmail:x.run.expectedEmail});
  const foreign = {...s,run:{...s.run!,runId:'new-run'}};
  expect(x.buffer.overlay([foreign])[0].run?.runId).toBe('new-run');
});

it('opens the cloud run gate only after a scoped automatic Resume and refuses a paused group',async()=>{
  const x=await setup();
  await x.c.receive(x.id,{type:'STATE',run:{...x.progress,status:'waiting_manual',blockingIssue:{reason:'validation',message:'Sai định dạng'}}});await x.buffer.flush(x.id);
  expect(x.buffer.allowed(x.id,x.run.runId!)).toBe(false);
  const commands:any[]=[];x.c.command=async(id,kind,payload,runId)=>{commands.push({id,kind,payload,runId});return {...x.progress,eventSeq:2,status:'running'};};
  await x.c.receive(x.id,{type:'REQUEST',requestId:'corrected',kind:'AUTO_RESUME',runId:x.run.runId});
  expect(x.messages.find(m=>m.requestId==='corrected').ok).toBe(true);expect(commands).toEqual([{id:x.id,kind:'RESUME',payload:{automatic:true},runId:x.run.runId}]);expect(x.buffer.allowed(x.id,x.run.runId!)).toBe(true);
  await x.c.receive(x.id,{type:'STATE',run:{...x.progress,eventSeq:3,status:'waiting_manual',blockingIssue:{reason:'validation',message:'Sai định dạng'}}});await x.buffer.flush(x.id);
  const g=await x.store.group(x.run.runId!);g.paused=true;await x.store.saveGroup(g);x.buffer.groupGate(g);commands.length=0;
  await x.c.receive(x.id,{type:'REQUEST',requestId:'paused',kind:'AUTO_RESUME',runId:x.run.runId});
  expect(x.messages.find(m=>m.requestId==='paused').ok).toBe(false);expect(commands).toEqual([]);expect(x.buffer.allowed(x.id,x.run.runId!)).toBe(false);expect((await x.store.group(g.id)).paused).toBe(true);
},20000);

it('persists a shared answer before resuming through the cloud buffer and preserves Test mode', async () => {
  const x=await setup(),q={label:'Câu cuối',value:'2026',formId:'fixture-fast'},commands:string[]=[];
  // A real Test run must keep its mode when applying and continuing the answer.
  const session=await x.store.session(x.id);session.run!.mode='test';await x.store.saveSession(session);x.buffer.refresh(x.id,session);
  const blockingIssue={reason:'verification' as const,message:'Cần đáp án',questionLabel:q.label};
  await x.c.receive(x.id,{type:'STATE',run:{...x.progress,mode:'test',eventSeq:2,status:'waiting_manual',blockingIssue}});
  await x.buffer.flush(x.id);
  x.c.command=async(id,kind)=>{
    commands.push(kind);
    if(kind==='SET_FINAL_QUESTION'){
      // Simulate RESULT overtaking the extension's separate waiting STATE.
      await x.c.receive(id,{type:'STATE',run:{...x.progress,mode:'test',eventSeq:3,status:'waiting_manual',blockingIssue,finalQuestion:q}});
    }
    if(kind==='RESUME'){
      expect((await x.store.session(id)).run?.finalQuestion).toEqual(q);
      expect((await x.store.history(id))[0].finalQuestion).toEqual(q);
      expect(x.buffer.allowed(id,x.run.runId!)).toBe(true);
      return {...x.progress,mode:'test',eventSeq:4,status:'ready_to_submit',finalQuestion:q};
    }
    return {};
  };
  expect(await x.c.setFinalQuestion([x.id],q,true)).toEqual([{id:x.id,ok:true}]);
  await x.buffer.flush(x.id);
  expect(commands).toEqual(['SET_FINAL_QUESTION','RESUME']);
  expect((await x.store.session(x.id)).run).toMatchObject({mode:'test',status:'ready_to_submit',submitAttempted:false,eventSeq:4,finalQuestion:q});
},20000);

it('flushes the latest form before granting submit, durably rejects duplicates and survives recovery', async () => {
  const x = await setup();
  await x.c.receive(x.id,{type:'STATE',run:{...x.progress,eventSeq:2,submitAttempted:true,status:'submitting'}});
  expect((await x.store.session(x.id)).run?.formId).toBe('');
  await x.c.receive(x.id,{type:'REQUEST',requestId:'submit',kind:'SUBMIT',runId:x.run.runId,formId:'fixture-fast'});
  expect(x.messages.find(m=>m.requestId==='submit').ok).toBe(true);
  expect((await x.store.session(x.id)).run).toMatchObject({formId:'fixture-fast',submitAttempted:true,status:'submitting'});
  expect(await x.store.blocked(x.id,'fixture-fast')).toBe(true);
  await x.c.receive(x.id,{type:'REQUEST',requestId:'duplicate',kind:'SUBMIT',runId:x.run.runId,formId:'fixture-fast'});
  expect(x.messages.find(m=>m.requestId==='duplicate').ok).toBe(false);
  await x.f.repository.recover();
  expect((await x.store.session(x.id)).run).toMatchObject({submitAttempted:true,status:'submit_uncertain',recoveryRequired:true});
});

it('waits for the combined progress/submit transaction to commit before replying with a grant', async () => {
  const x = await setup();
  x.buffer.stage(x.id,{...x.progress,submitAttempted:true,status:'submitting'});
  const connect=x.f.pool.connect.bind(x.f.pool);let release!:()=>void,transactions=0;
  x.f.pool.connect=async()=>{
    transactions++;const db=await connect();
    return {release:()=>db.release(),async query(sql,values){
      if(sql==='COMMIT')await new Promise<void>(resolve=>release=resolve);
      return db.query(sql,values);
    }};
  };
  cleanups.push(async()=>{x.f.pool.connect=connect;release?.();});
  const granted=x.c.receive(x.id,{type:'REQUEST',requestId:'committed',kind:'SUBMIT',runId:x.run.runId,formId:'fixture-fast'});
  await expect.poll(()=>typeof release).toBe('function');
  expect(x.messages.some(m=>m.requestId==='committed')).toBe(false);
  expect(transactions).toBe(1);
  release();await granted;x.f.pool.connect=connect;
  expect(x.messages.find(m=>m.requestId==='committed').ok).toBe(true);
  expect((await x.store.session(x.id)).run).toMatchObject({eventSeq:1,formId:'fixture-fast',submitAttempted:true});
});

it('blocks renderer work immediately on Stop even while persistence is pending', async () => {
  const x = await setup();
  x.buffer.stage(x.id,x.progress);
  const accept = x.store.acceptProgress.bind(x.store); let release!:()=>void;
  x.store.acceptProgress = async (id,run) => { await new Promise<void>(r=>release=r);return accept(id,run); };
  const stopped = x.c.control(x.id,'STOP');
  await expect.poll(()=>typeof release).toBe('function');
  await x.c.receive(x.id,{type:'REQUEST',requestId:'late',kind:'ATTENTION_ACQUIRE',runId:x.run.runId,rendering:'background'});
  expect(x.messages.find(m=>m.requestId==='late').ok).toBe(false);
  expect(x.buffer.stage(x.id,{...x.progress,eventSeq:2})).toBe(false);
  await x.c.receive(x.id,{type:'REQUEST',requestId:'late-submit',kind:'SUBMIT',runId:x.run.runId,formId:'fixture-fast'});
  expect(x.messages.find(m=>m.requestId==='late-submit').ok).toBe(false);
  release(); await stopped;
  x.store.acceptProgress = accept;
  expect((await x.store.session(x.id)).run?.status).toBe('idle');
});

it('flushes on disconnect, and explicitly resumed runs after reconnect get a new memory gate', async () => {
  const x = await setup();
  x.buffer.stage(x.id,x.progress);
  await x.c.disconnect(x.id,x.peer);
  expect(x.buffer.has(x.id)).toBe(false);
  expect((await x.store.session(x.id)).run).toMatchObject({eventSeq:1,formId:'fixture-fast',status:'paused',recoveryRequired:true});
  await x.c.connect(x.id,x.peer);
  await x.c.control(x.id,'RESUME');
  expect(x.buffer.allowed(x.id,x.run.runId!)).toBe(true);
  x.c.attention.close();
});

it('continues to fence submit grants when the server lease has expired', async () => {
  const x = await setup();
  x.buffer.stage(x.id,{...x.progress,submitAttempted:true,status:'submitting'});
  await x.f.pool.query("UPDATE hanu.server_lease SET expires_at=now()-interval '1 second'");
  await x.c.receive(x.id,{type:'REQUEST',requestId:'expired',kind:'SUBMIT',runId:x.run.runId,formId:'fixture-fast'});
  expect(x.messages.find(m=>m.requestId==='expired').ok).toBe(false);
  const locks = await x.f.pool.query('SELECT resolution FROM hanu.locks WHERE owner=$1 AND session=$2',[users[0],x.id]);
  expect(locks.rows).toEqual([]);
});

it('ignores a delayed waiting STATE during Resume, but retains a newer blocking event', async () => {
  const x = await setup();
  await x.c.acceptState(x.id,{...x.progress,status:'waiting_manual'});await x.buffer.flush(x.id);
  let release!:(value:any)=>void;
  x.c.command=async()=>new Promise(resolve=>release=resolve);
  const resumed=x.c.control(x.id,'RESUME');
  await expect.poll(()=>typeof release).toBe('function');
  await x.c.receive(x.id,{type:'STATE',run:{...x.progress,eventSeq:2,status:'waiting_manual'}});
  expect(x.buffer.allowed(x.id,x.run.runId!)).toBe(true);
  release({...x.progress,eventSeq:3,status:'running'});await resumed;
  expect(x.buffer.allowed(x.id,x.run.runId!)).toBe(true);
  expect(x.buffer.overlay([await x.store.session(x.id)])[0].run?.eventSeq).toBe(3);
  await x.c.acceptState(x.id,{...x.progress,eventSeq:4,status:'waiting_manual'});await x.buffer.flush(x.id);
  const again=x.c.control(x.id,'RESUME');
  const previous=release;
  await expect.poll(()=>release!==previous).toBe(true);
  await x.c.receive(x.id,{type:'STATE',run:{...x.progress,eventSeq:6,status:'waiting_manual'}});
  release({...x.progress,eventSeq:5,status:'running'});await again;await x.buffer.flush(x.id);
  expect(x.buffer.allowed(x.id,x.run.runId!)).toBe(false);
  expect((await x.store.session(x.id)).run).toMatchObject({status:'waiting_manual',eventSeq:6});
});

it('recovers an interrupted registration from its durable start without automatically resuming it', async () => {
  const x = await setup();
  x.buffer.stage(x.id,{...x.progress,eventSeq:10});
  // Simulate a crash: discard volatile progress without flushing it.
  x.buffer.forget(x.id);
  await x.f.repository.recover();
  expect((await x.store.session(x.id)).run).toMatchObject({eventSeq:0,status:'paused',recoveryRequired:true,submitAttempted:false});
  await x.c.receive(x.id,{type:'REQUEST',requestId:'after-crash',kind:'ATTENTION_ACQUIRE',runId:x.run.runId,rendering:'background'});
  expect(x.messages.find(m=>m.requestId==='after-crash').ok).toBe(false);
});
