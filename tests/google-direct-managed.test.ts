// @vitest-environment jsdom
import {afterEach,beforeEach,expect,it,vi} from 'vitest';
import {readFileSync} from 'node:fs';
import {emptyProfile} from '../src/rules';
import {canApplyFinalQuestion} from '../src/shared';
import {ManagedDirect} from '../src/google-direct/managed';
import {DIRECT_LAB_FORM_ID,DIRECT_LAB_URL} from '../src/google-direct/schema';
import type {Command} from '../src/protocol';
import {readExecutionPage} from '../src/google-direct/execute-page';
import type {DirectRunInput} from '../src/google-direct/executor';
const mocks=vi.hoisted(()=>({run:vi.fn(),resolve:vi.fn(),profile:vi.fn()}));
vi.mock('../src/google-direct/executor',()=>({DirectExecutor:class {run=mocks.run;resolveNotReceived=mocks.resolve;}}));
vi.mock('../src/storage',()=>({getProfile:()=>mocks.profile(),getProfileRevision:async()=>1,getAttachment:vi.fn()}));
beforeEach(()=>{mocks.run.mockReset();mocks.resolve.mockReset();mocks.profile.mockReturnValue(emptyProfile());});
afterEach(()=>{vi.unstubAllGlobals();vi.restoreAllMocks();});
function fixture(){
  const data:Record<string,any>={profile:{keep:'classic profile'},'run:7':{keep:'classic run'},submissionLocks:{keep:'classic lock'}};
  const writes:Record<string,any>[]=[];
  vi.stubGlobal('chrome',{storage:{local:{get:async(key:string|string[])=>Array.isArray(key)?Object.fromEntries(key.map(k=>[k,structuredClone(data[k])])):({[key]:structuredClone(data[key])}),set:async(value:any)=>{writes.push(structuredClone(value));Object.assign(data,structuredClone(value));}}},tabs:{get:async()=>({id:42}),update:async()=>({id:42,windowId:1})},windows:{update:vi.fn()},scripting:{executeScript:vi.fn(async()=>[{result:undefined}])}});
  Object.defineProperty(navigator,'locks',{configurable:true,value:{request:async(_name:any,fn:any)=>fn()}});
  const bridge={connected:()=>true,state:vi.fn(),request:vi.fn(async(_kind?:string,..._rest:unknown[]):Promise<unknown>=>({ok:true}))};
  const direct=new ManagedDirect(bridge);
  const command=(kind:Command['kind'],runId='direct-one',payload:Record<string,unknown>={}):Command=>({type:'COMMAND',protocol:1,sessionId:'profile-one',commandId:crypto.randomUUID(),kind,runId,payload});
  const start=(extra:Record<string,unknown>={})=>direct.start(command('START','direct-one',{engine:'direct',url:DIRECT_LAB_URL,mode:'test',revision:1,expectedEmail:'fixture@example.test',...extra}),'profile-one');
  return {data,writes,bridge,direct,command,start};
}
it('uses separate run/lease storage and completes Test without granting submit or touching classic state',async()=>{
  const f=fixture(),before=structuredClone(f.data);
  mocks.run.mockImplementation(async(input:DirectRunInput)=>{expect(input.mode).toBe('test');await input.onTab?.(42);await input.onProgress('prepared');return {status:'ready',message:'Xong Test',postCount:6};});
  await f.start();await vi.waitFor(()=>expect(f.data.googleDirectManagedRun?.status).toBe('ready_to_submit'));
  for(const key of Object.keys(before))expect(f.data[key]).toEqual(before[key]);
  expect(f.writes.every(w=>Object.keys(w).every(k=>['googleDirectManagedRun','googleDirectLease'].includes(k)))).toBe(true);
  expect(f.bridge.request).not.toHaveBeenCalled();expect(f.data.googleDirectLease.active).toBe(false);
  const seq=f.bridge.state.mock.calls.map(([r])=>r.eventSeq);
  expect(seq).toEqual([1,2,3,4]);
});
it('routes an unfamiliar form to the separate executor in Test mode',async()=>{
  const f=fixture(),url='https://docs.google.com/forms/d/e/new-registration-form/formResponse?pli=1';
  mocks.run.mockResolvedValue({status:'ready',message:'Ready',postCount:2});await f.start({url});
  await vi.waitFor(()=>expect(f.data.googleDirectManagedRun?.status).toBe('ready_to_submit'));
  expect(mocks.run).toHaveBeenCalledWith(expect.objectContaining({url,mode:'test',managed:true}));expect(f.data.googleDirectManagedRun.formId).toBe('new-registration-form');expect(f.bridge.request).not.toHaveBeenCalled();
});
it('Stop aborts the running executor, awaits cancellation, releases the profile and rejects a stale Resume',async()=>{
  const f=fixture();let input!:DirectRunInput;
  mocks.run.mockImplementation((value:DirectRunInput)=>{input=value;return new Promise(resolve=>value.signal.addEventListener('abort',()=>resolve({status:'stopped',message:'Stopped',postCount:0}),{once:true}));});
  await f.start();expect(await f.direct.execution()).toMatchObject({active:true});
  const stopped=await f.direct.control(f.command('STOP_PROFILE'));
  expect(input.signal.aborted).toBe(true);expect(stopped).toMatchObject({run:{status:'idle'},execution:null});expect(f.data.googleDirectLease.active).toBe(false);
  await expect(f.direct.control(f.command('RESUME','other-run'))).rejects.toThrow('cũ');
});
it('a Stop that arrives before Start permanently fences that exact run ID',async()=>{
  const f=fixture();await f.direct.interrupt(f.command('STOP_PROFILE'));await expect(f.start()).rejects.toThrow('Dừng');expect(mocks.run).not.toHaveBeenCalled();
});
it('refuses to start over an active classic lease, preserving it',async()=>{
  const f=fixture();f.data.executionLease={active:true,runId:'classic'};
  await expect(f.start()).rejects.toThrow('cũ');expect(mocks.run).not.toHaveBeenCalled();expect(f.data.executionLease).toEqual({active:true,runId:'classic'});expect(f.data.googleDirectManagedRun).toBeUndefined();
});
it('persists a backend submit grant as uncertain when Stop races the grant acknowledgement',async()=>{
  const f=fixture();let grant!:(value:any)=>void;
  f.bridge.request.mockImplementation(()=>new Promise(resolve=>grant=resolve));
  mocks.run.mockImplementation(async(input:DirectRunInput)=>{try{await input.beforeSubmit?.();return {status:'received',message:'received',postCount:1};}catch{return {status:'stopped',message:'stopped before final dispatch',postCount:0};}});
  await f.start();await vi.waitFor(()=>expect(f.bridge.request).toHaveBeenCalledOnce());
  const stopping=f.direct.control(f.command('STOP_PROFILE'));grant({ok:true});
  expect(await stopping).toMatchObject({run:{status:'submit_uncertain',submitAttempted:true},execution:null});
  await expect(f.direct.control(f.command('RESUME'))).rejects.toThrow('khóa gửi');
});
it('does not downgrade a confirmed response when Stop arrives afterward',async()=>{
  const f=fixture();mocks.run.mockImplementation(async(input:DirectRunInput)=>{await input.beforeSubmit?.();return {status:'received',message:'confirmed',postCount:1};});
  await f.start();await vi.waitFor(()=>expect(f.data.googleDirectManagedRun.status).toBe('completed'));
  expect(await f.direct.control(f.command('STOP_PROFILE'))).toMatchObject({run:{status:'completed',submitAttempted:true},execution:null});
});
it('recovers a worker restart as paused or uncertain and never auto-resubmits',async()=>{
  const f=fixture();f.data.googleDirectManagedRun={runId:'direct-one',engine:'direct',managed:true,mode:'live',formId:DIRECT_LAB_FORM_ID,tabId:42,status:'submitting',submitAttempted:true,logs:[],filled:[],skipped:[],updatedAt:'',eventSeq:4};
  expect(await f.direct.reconcile()).toMatchObject({run:{status:'submit_uncertain',recoveryRequired:true}});expect(mocks.run).not.toHaveBeenCalled();
});

async function waitingLive(){
  const f=fixture();mocks.run.mockImplementation(async(input:DirectRunInput)=>{await input.onTab?.(42);return {status:'waiting',message:'Nhập đáp án',issue:{reason:'verification',message:'Nhập đáp án',questionLabel:'Fee'},postCount:3};});
  await f.start();await vi.waitFor(()=>expect(f.data.googleDirectManagedRun?.status).toBe('waiting_manual'));f.data.googleDirectManagedRun.mode='live';
  vi.mocked(chrome.scripting.executeScript).mockImplementation(async({func}:any)=>[{result:func===readExecutionPage?{url:DIRECT_LAB_URL,account:'fixture@example.test',documentKey:'real-final',hasNext:false,hasSubmit:true}:undefined}] as any);
  return f;
}
it('takeover durably disables automatic answer application and resume, retaining the same run/profile',async()=>{
  const f=await waitingLive();expect(canApplyFinalQuestion(f.data.googleDirectManagedRun,{label:'Fee'})).toBe(true);expect(await f.direct.manual('takeover','direct-one','real-final',42)).toEqual({ok:true});
  expect(f.data.googleDirectManagedRun).toMatchObject({runId:'direct-one',status:'paused',manualTakeover:true,autoContinue:false,submitAttempted:false});expect(f.data.googleDirectLease.active).toBe(true);expect(canApplyFinalQuestion(f.data.googleDirectManagedRun,{label:'Fee'})).toBe(false);
  await expect(f.direct.control(f.command('RESUME','direct-one',{automatic:true}))).rejects.toThrow('tiếp quản');
  await expect(f.direct.control(f.command('SET_FINAL_QUESTION','direct-one',{finalQuestion:{label:'Fee',value:'stale'}}))).rejects.toThrow();
  await f.direct.control(f.command('RESUME'));expect(f.data.googleDirectManagedRun.manualTakeover).toBe(false);
});
it('manual Send goes through coordinator Resume and the same durable final grant exactly once',async()=>{
  const f=await waitingLive();
  mocks.run.mockImplementation(async(input:DirectRunInput)=>{expect(input.manualFinal).toBe('real-final');await input.beforeSubmit?.();return {status:'received',message:'confirmed',postCount:1};});
  f.bridge.request.mockImplementation(async(kind:any)=>kind==='CONTROL'?f.direct.control(f.command('RESUME')):{ok:true});
  expect(await f.direct.manual('submit','direct-one','real-final',42)).toEqual({ok:true});await vi.waitFor(()=>expect(f.data.googleDirectManagedRun.status).toBe('completed'));
  expect(f.bridge.request.mock.calls.map(args=>args[0])).toEqual(['CONTROL','SUBMIT']);expect(f.data.googleDirectManagedRun.submitAttempted).toBe(true);
  await expect(f.direct.manual('submit','direct-one','real-final',42)).rejects.toThrow('khóa gửi');expect(f.bridge.request).toHaveBeenCalledTimes(2);
});
it('rejects stale document/account/run and classic ownership before allowing manual submit',async()=>{
  const f=await waitingLive();await expect(f.direct.manual('submit','direct-one','old-document',42)).rejects.toThrow('thay đổi');
  await expect(f.direct.manual('submit','other','real-final',42)).rejects.toThrow();f.data.executionLease={active:true};await expect(f.direct.manual('takeover','direct-one','real-final',42)).rejects.toThrow('giữ profile');expect(f.bridge.request).not.toHaveBeenCalled();expect(f.data.googleDirectManagedRun.submitAttempted).toBe(false);
});
it('binds a value-only scheduled answer from the actual initial schema before the executor builds its plan',async()=>{
  const f=fixture(),script=`var FB_PUBLIC_LOAD_DATA_ = ${readFileSync('tests/fixtures/google-direct-lab.json','utf8')};`;
  vi.mocked(chrome.scripting.executeScript).mockResolvedValue([{result:{script}}] as any);
  mocks.run.mockImplementation(async(input:DirectRunInput)=>{
    expect(input.fastSubmit).toBe(true);expect(await input.onSchema?.(42)).toEqual({'982814777':'2026'});
    return {status:'ready',message:'Prepared',postCount:0};
  });
  await f.start({preparedFinalAnswer:'2026'});await vi.waitFor(()=>expect(f.data.googleDirectManagedRun?.status).toBe('ready_to_submit'));
  expect(f.data.googleDirectManagedRun.finalQuestion).toMatchObject({value:'2026',questionId:'entry.1045827748',formId:DIRECT_LAB_FORM_ID});expect(f.bridge.request).not.toHaveBeenCalled();
});
it('does not guess which verification receives a value-only answer when the schema is ambiguous',async()=>{
  const f=fixture(),source=readFileSync('tests/fixtures/google-direct-lab.json','utf8'),script=`var FB_PUBLIC_LOAD_DATA_ = ${source.replace('GIỚI TÍNH | 性别','Câu hỏi xác thực thứ hai')};`;
  expect(script).toContain('Câu hỏi xác thực thứ hai');vi.mocked(chrome.scripting.executeScript).mockResolvedValue([{result:{script}}] as any);
  mocks.run.mockImplementation(async(input:DirectRunInput)=>{expect(await input.onSchema?.(42)).toEqual({});return {status:'waiting',message:'Cần xác nhận câu hỏi',postCount:0};});
  await f.start({preparedFinalAnswer:'2026'});await vi.waitFor(()=>expect(f.data.googleDirectManagedRun?.status).toBe('waiting_manual'));expect(f.data.googleDirectManagedRun.finalQuestion).toBeUndefined();
});
