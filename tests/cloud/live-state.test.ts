import { afterEach, expect, it, vi } from 'vitest';
import { WebSocket } from 'ws';
import { httpFixture, users, extension } from './fixture';

const cleanup: (()=>Promise<void>)[] = [];
afterEach(async()=>{for(const close of cleanup.splice(0).reverse())await close();});

it('serves live dashboard progress and page permission over WebSocket without querying progress tables; account access is still verified',async()=>{
  const f=await httpFixture();cleanup.push(f.close);
  const paired=await f.pair();
  const ws=new WebSocket(f.config.origin.replace('http:','ws:')+'/extensions',{headers:{Origin:`chrome-extension://${extension}`}});
  cleanup.push(async()=>{ws.terminate();});
  const messages:any[]=[];
  const send=(message:any)=>ws.send(JSON.stringify({protocol:1,sessionId:paired.sessionId,...message}));
  ws.on('message',raw=>{
    const m=JSON.parse(raw.toString());messages.push(m);
    if(m.type==='COMMAND')send({type:'RESULT',commandId:m.commandId,ok:true,result:m.kind==='READ_PROFILE'?{profile:{values:{},customFields:[],mappings:{},attachments:{}},revision:0}:{}});
  });
  await new Promise<void>((resolve,reject)=>{ws.once('open',resolve);ws.once('error',reject);});
  send({type:'HELLO',transport:'cloud',accessPolicy:1,extensionId:extension,token:paired.token});
  await expect.poll(()=>messages.some(m=>m.type==='WELCOME')).toBe(true);
  await expect.poll(async()=>(await paired.store.session(paired.sessionId)).synced).toBe(true);
  // Wait for the asynchronous profile import to finish before starting.
  const runtime=f.app.runtimes.get(users[0])!;
  await expect.poll(()=>runtime.coordinator.pending.size).toBe(0);
  await runtime.coordinator.edit(paired.sessionId,{expectedEmail:'an@example.test'});
  await runtime.coordinator.start([paired.sessionId],'https://docs.google.com/forms/d/e/fixture-live-state/viewform','test');
  await expect.poll(()=>messages.some(m=>m.type==='COMMAND'&&m.kind==='START')).toBe(true);
  const initial=(await(await f.api('state')).json()).sessions[0];
  const query=vi.spyOn(f.pool,'query'),connect=vi.spyOn(f.pool,'connect');
  for(let seq=1;seq<=10;seq++){
    send({type:'STATE',run:{...initial.run,formId:'fixture-live-state',eventSeq:seq}});
    send({type:'EXECUTION',execution:{runId:initial.run.runId,tabId:1,mode:'test',status:'running',managed:true,tabOpen:true,active:true,updatedAt:String(seq)}});
  }
  send({type:'REQUEST',requestId:'page',kind:'ATTENTION_ACQUIRE',runId:initial.run.runId,rendering:'background'});
  send({type:'REQUEST',requestId:'check',kind:'CHECK_FORM',runId:initial.run.runId,formId:'fixture-live-state'});
  await expect.poll(()=>messages.some(m=>m.requestId==='check')).toBe(true);
  expect(messages.find(m=>m.requestId==='page').ok).toBe(true);
  expect(messages.find(m=>m.requestId==='check').ok).toBe(true);
  const live=(await(await f.api('state')).json()).sessions[0];
  expect(live.run.eventSeq).toBe(10);expect(live.execution.updatedAt).toBe('10');
  expect(query.mock.calls.every(([sql])=>sql==='SELECT * FROM hanu.accounts WHERE user_id=$1')).toBe(true);expect(connect).not.toHaveBeenCalled();
  send({type:'STATE',run:{...live.run,eventSeq:11,status:'ready_to_submit'}});
  await expect.poll(async()=>(await paired.store.session(paired.sessionId)).run?.status).toBe('ready_to_submit');
  expect((await paired.store.history(paired.sessionId))[0].eventSeq).toBe(11);
},20000);

it.each(['CONTROL', 'AUTO_RESUME'])('acknowledges nested CHECK_FORM while %s waits for the extension Resume result', async kind => {
  const f = await httpFixture(); cleanup.push(f.close);
  const paired = await f.pair(users[1]);
  const ws = new WebSocket(f.config.origin.replace('http:', 'ws:') + '/extensions', { headers: { Origin: `chrome-extension://${extension}` } });
  cleanup.push(async () => { ws.terminate(); });
  const messages: any[] = [];
  let resumed: any, resumeCommand: any;
  const send = (m: any) => ws.send(JSON.stringify({ protocol: 1, sessionId: paired.sessionId, ...m }));
  ws.on('message', raw => {
    const m = JSON.parse(raw.toString()); messages.push(m);
    if (m.type === 'COMMAND' && m.kind === 'RESUME') {
      resumeCommand = m;
      // These requests bypass scheduling only; run/form authorization still applies.
      send({ type: 'REQUEST', requestId: 'wrong-form', kind: 'CHECK_FORM', runId: m.runId, formId: 'other-form' });
      send({ type: 'REQUEST', requestId: 'old-run', kind: 'CHECK_FORM', runId: 'old-run', formId: 'nested-resume' });
      // The real extension checks its form before acknowledging RESUME.
      send({ type: 'REQUEST', requestId: 'nested-form', kind: 'CHECK_FORM', runId: m.runId, formId: 'nested-resume' });
    } else if (m.type === 'REPLY' && m.requestId === 'nested-form') {
      send({ type: 'RESULT', commandId: resumeCommand.commandId, ok: m.ok, result: resumed, error: m.error });
    } else if (m.type === 'COMMAND') {
      send({ type: 'RESULT', commandId: m.commandId, ok: true, result: m.kind === 'READ_PROFILE' ? { profile: { values: {}, customFields: [], mappings: {}, attachments: {} }, revision: 0 } : {} });
    }
  });
  await new Promise<void>((resolve, reject) => { ws.once('open', resolve); ws.once('error', reject); });
  send({ type: 'HELLO', transport: 'cloud', accessPolicy: 1, extensionId: extension, token: paired.token });
  await expect.poll(() => messages.some(m => m.type === 'WELCOME')).toBe(true);
  await expect.poll(async () => (await paired.store.session(paired.sessionId)).synced).toBe(true);
  const c = f.app.runtimes.get(users[1])!.coordinator;
  await expect.poll(() => c.pending.size).toBe(0);
  await c.edit(paired.sessionId, { expectedEmail: 'binh@example.test' });
  await c.start([paired.sessionId], 'https://docs.google.com/forms/d/e/nested-resume/viewform', 'test');
  await expect.poll(() => c.pending.size).toBe(0);
  const initial = (await paired.store.session(paired.sessionId)).run!;
  const waiting = { ...initial, formId: 'nested-resume', eventSeq: 1, status: 'waiting_manual' as const, recoveryRequired: false, blockingIssue: { reason: 'validation' as const, message: 'Đợi sửa dữ liệu' } };
  await c.acceptState(paired.sessionId, waiting); await c.runBuffer!.flush(paired.sessionId);
  resumed = { ...waiting, eventSeq: 2, status: 'running', blockingIssue: undefined };
  send({ type: 'REQUEST', requestId: 'resume', kind, action: 'RESUME', runId: initial.runId });
  await expect.poll(() => messages.find(m => m.requestId === 'resume'), { timeout: 1500 }).toMatchObject({ ok: true });
  expect(messages.find(m => m.requestId === 'nested-form')).toMatchObject({ ok: true });
  expect(messages.find(m => m.requestId === 'wrong-form')).toMatchObject({ ok: false });
  expect(messages.find(m => m.requestId === 'old-run')).toMatchObject({ ok: false });
  expect((await paired.store.session(paired.sessionId)).run).toMatchObject({ status: 'running', submitAttempted: false });
  expect((await f.pool.query('SELECT * FROM hanu.locks')).rows).toEqual([]);
}, 15000);
