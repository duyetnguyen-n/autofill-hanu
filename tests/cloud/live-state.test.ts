import { afterEach, expect, it, vi } from 'vitest';
import { WebSocket } from 'ws';
import { httpFixture, users, extension } from './fixture';

const cleanup: (()=>Promise<void>)[] = [];
afterEach(async()=>{for(const close of cleanup.splice(0).reverse())await close();});

it('serves live dashboard progress and page permission over WebSocket without querying the database',async()=>{
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
  send({type:'HELLO',transport:'cloud',extensionId:extension,token:paired.token});
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
  expect(query).not.toHaveBeenCalled();expect(connect).not.toHaveBeenCalled();
  send({type:'STATE',run:{...live.run,eventSeq:11,status:'ready_to_submit'}});
  await expect.poll(async()=>(await paired.store.session(paired.sessionId)).run?.status).toBe('ready_to_submit');
  expect((await paired.store.history(paired.sessionId))[0].eventSeq).toBe(11);
},20000);
