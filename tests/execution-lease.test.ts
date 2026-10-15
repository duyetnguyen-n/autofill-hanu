import {afterEach,it,expect,vi} from 'vitest';
import {emptyProfile} from '../src/rules';
import type {Command} from '../src/protocol';
import type {ExtensionMessage,RunState} from '../src/shared';
let nativeRequest: ReturnType<typeof vi.fn>;
let adapter:{start:(c:Command,s:string)=>Promise<any>;control:(c:Command)=>Promise<any>;execution:()=>Promise<any>;disconnected:()=>Promise<any>};
vi.mock('../src/native-client',()=>({createNativeClient:(a:typeof adapter)=>{adapter=a;nativeRequest=vi.fn(async()=>({}));return {boot:vi.fn(),state:vi.fn(),request:nativeRequest,isConnected:()=>true};}}));
afterEach(()=>{vi.unstubAllGlobals();vi.resetModules();});
const url='https://docs.google.com/forms/d/e/lease-fixture/viewform';
async function fixture(){
 const data:Record<string,any>={profile:emptyProfile(),profileRevision:1};let listener:any,removed:any;
 const tabs=new Map<number,any>([[1,{id:1,url,status:'complete',windowId:1}],[2,{id:2,url,status:'complete',windowId:1}]]);
 const sendMessage=vi.fn(async(_id:number,msg:any)=>msg.type==='PAGE_ACCOUNT'?{email:'fixture@example.test'}:{ok:true});
 const create=vi.fn(async(options:any)=>{const tab={id:55,url:options.url,status:'complete',windowId:1};tabs.set(55,tab);return tab;});
 vi.stubGlobal('chrome',{runtime:{getURL:(p:string)=>p,onMessage:{addListener:(fn:any)=>listener=fn},sendMessage:vi.fn(async()=>({}))},action:{onClicked:{addListener:vi.fn()}},tabs:{get:vi.fn(async(id:number)=>{const tab=tabs.get(id);if(!tab)throw new Error('closed');return tab;}),query:vi.fn(async()=>[...tabs.values()]),create,sendMessage,onUpdated:{addListener:vi.fn()},onRemoved:{addListener:(fn:any)=>removed=fn}},windows:{create:vi.fn()},storage:{local:{get:vi.fn(async(key:string|null)=>key===null?structuredClone(data):{[key]:structuredClone(data[key])}),set:vi.fn(async(value:any)=>Object.assign(data,structuredClone(value))),remove:vi.fn(async(key:string)=>delete data[key])}}});
 await import('../src/background');const ask=(msg:ExtensionMessage,sender:object={})=>new Promise<any>(resolve=>listener(msg,sender,resolve));
 return {data,tabs,create,sendMessage,ask,removed:(id:number)=>removed(id)};
}
function command(kind:Command['kind'],runId='new-managed'):Command{return {type:'COMMAND',protocol:1,sessionId:'session',commandId:crypto.randomUUID(),kind,runId,payload:{url,mode:'test',revision:1,expectedEmail:'fixture@example.test'}};}
it('requires server-managed runs in cloud builds, including legacy local Resume and Submit paths',async()=>{
 vi.useFakeTimers();
 try{
  vi.stubGlobal('__HANU_CLOUD_ORIGIN__','https://fixture.example');
  const f=await fixture();
  nativeRequest.mockResolvedValueOnce({run:{runId:'server-run',managed:true,status:'running'}});
  expect(await f.ask({type:'START_RUN',tabId:1,mode:'test'})).toMatchObject({runId:'server-run',managed:true,status:'running'});
  expect(nativeRequest).toHaveBeenCalledWith('START',undefined,{url,mode:'test'});
  expect(f.data['run:1']).toBeUndefined();
  const legacy:RunState={runId:'legacy-local',tabId:1,formId:'lease-fixture',mode:'live',status:'paused',contentEpoch:'old-page',filled:[],skipped:[],logs:[],submitAttempted:false,updatedAt:''};
  f.data['run:1']=legacy;
  expect(await f.ask({type:'RESUME_RUN',tabId:1})).toMatchObject({ok:false,error:expect.stringContaining('website')});
  f.data['run:1'].status='running';
  expect(await f.ask({type:'REQUEST_SUBMIT',runId:'legacy-local',epoch:'old-page'},{tab:{id:1,url},url,frameId:0})).toMatchObject({ok:false,error:expect.stringContaining('cấp quyền gửi')});
  expect(await f.ask({type:'GET_RUN_FOR_TAB'},{tab:{id:1,url},url,frameId:0})).toMatchObject({recoveryRequired:true});
  expect(await f.ask({type:'CLAIM_DOCUMENT',epoch:'new-page'},{tab:{id:1,url},url,frameId:0})).toMatchObject({ok:true,run:{status:'paused',recoveryRequired:true}});
  expect(f.data.submissionLocks).toBeUndefined();expect(f.sendMessage).not.toHaveBeenCalledWith(1,expect.objectContaining({type:'RUN_CURRENT_PAGE'}));
 }finally{vi.useRealTimers();}
});
it('carries the shared final question in the immutable managed run and every Resume command to content',async()=>{
 const f=await fixture(),q={label:'Câu hỏi cuối',value:'2026'};const start=command('START');start.payload.finalQuestion=q;await adapter.start(start,'session');
 expect(f.data.managedRun.finalQuestion).toEqual(q);expect(f.data.profile.customFields).toEqual([]);expect(f.sendMessage).toHaveBeenCalledWith(55,expect.objectContaining({type:'RUN_CURRENT_PAGE',finalQuestion:q}));
 await expect(adapter.control({...command('SET_FINAL_QUESTION'),payload:{finalQuestion:q}})).rejects.toThrow('đang chờ');
 f.data.managedRun.status='waiting_manual';f.data['run:55'].status='waiting_manual';const next={label:q.label,value:'2027'};
 await adapter.control({...command('SET_FINAL_QUESTION'),payload:{finalQuestion:next}});expect(f.data['run:55'].finalQuestion).toEqual(next);
 await adapter.control(command('RESUME'));expect(f.sendMessage).toHaveBeenLastCalledWith(55,expect.objectContaining({type:'RUN_CURRENT_PAGE',finalQuestion:next}));
 f.data.managedRun.submitAttempted=true;await expect(adapter.control({...command('SET_FINAL_QUESTION'),payload:{finalQuestion:next}})).rejects.toThrow('chưa gửi');
});
it('reclaims a lease with no owner record instead of reporting phantom activity',async()=>{
 const f=await fixture();f.data.executionLease={runId:'missing',active:true};expect(await adapter.execution()).toBeNull();expect((await f.ask({type:'START_RUN',tabId:1,mode:'test'})).status).toBe('running');
});
it.each(['idle','completed','failed','ready_to_submit'] as const)('reclaims a stale active lease whose owner is %s',async status=>{
 const f=await fixture();const old=await f.ask({type:'START_RUN',tabId:1,mode:'test'});f.data['run:1'].status=status;f.data.executionLease={runId:old.runId,active:true};expect((await f.ask({type:'START_RUN',tabId:2,mode:'test'})).status).toBe('running');
});
it('reports a real standalone owner, rejects a second run, then stops it from the manager despite a different managed run ID',async()=>{
 const f=await fixture();const old=await f.ask({type:'START_RUN',tabId:1,mode:'test'});
 expect(await adapter.execution()).toMatchObject({runId:old.runId,tabId:1,status:'running',managed:false,tabOpen:true});
 await expect(adapter.start(command('START'),'session')).rejects.toThrow('Profile đang có lượt chạy');expect(f.data.managedRunLedger?.['new-managed']).toBeUndefined();
 const result=await adapter.control(command('STOP_PROFILE','wrong-coordinator-id'));expect(result.execution).toBeNull();expect(f.data['run:1'].status).toBe('idle');expect(f.sendMessage).toHaveBeenCalledWith(1,{type:'HALT_RUN'});
 expect((await adapter.start(command('START'),'session')).status).toBe('running');expect(f.data.executionLease.runId).toBe('new-managed');
});
it('closing a standalone tab releases the lease and permits a managed run',async()=>{
 const f=await fixture();await f.ask({type:'START_RUN',tabId:1,mode:'test'});f.tabs.delete(1);f.removed(1);
 await vi.waitFor(()=>expect(f.data['run:1'].status).toBe('idle'));expect(f.data.executionLease.active).toBe(false);expect((await adapter.start(command('START'),'session')).status).toBe('running');
});
it('reconciles a closed tab even when its removal event was missed across worker restart',async()=>{
 const f=await fixture();await f.ask({type:'START_RUN',tabId:1,mode:'test'});f.tabs.delete(1);expect(await adapter.execution()).toBeNull();expect(f.data['run:1'].status).toBe('idle');
});
it('failed managed runs stay failed when reconnecting, with no active lease',async()=>{
 const f=await fixture();await adapter.start(command('START'),'session');f.data.managedRun.status='failed';f.data['run:55'].status='failed';await adapter.disconnected();expect(f.data.managedRun.status).toBe('failed');expect(await adapter.execution()).toBeNull();
});
it('an old managed tab closing cannot overwrite a newer managed run',async()=>{
 const f=await fixture();await adapter.start(command('START'),'session');const old=structuredClone(f.data.managedRun);old.tabId=1;old.runId='old-managed';f.data['run:1']=old;f.tabs.delete(1);f.removed(1);
 await vi.waitFor(()=>expect(f.data['run:1'].status).toBe('idle'));expect(f.data.managedRun.runId).toBe('new-managed');expect(f.data.executionLease.runId).toBe('new-managed');expect(f.data.executionLease.active).toBe(true);
});
it('a failure to create the managed tab releases the lease instead of leaving an invisible running job',async()=>{
 const f=await fixture();f.create.mockRejectedValueOnce(new Error('Cannot create tab'));await expect(adapter.start(command('START'),'session')).rejects.toThrow('Cannot create tab');expect(f.data.managedRun.status).toBe('failed');expect(f.data.executionLease.active).toBe(false);
});
it('profile Stop preserves a Live submission lock while releasing execution ownership',async()=>{
 const f=await fixture();const run=await f.ask({type:'START_RUN',tabId:1,mode:'live'});f.data['run:1'].submitAttempted=true;f.data['run:1'].status='submitting';f.data.submissionLocks={[run.runId]:{formId:'lease-fixture',resolution:'uncertain'}};
 await adapter.control(command('STOP_PROFILE'));expect(f.data.submissionLocks[run.runId].resolution).toBe('uncertain');expect(f.data['run:1'].submitAttempted).toBe(true);expect(f.data['run:1'].status).toBe('submit_uncertain');expect(f.data.executionLease.active).toBe(false);
 expect(await f.ask({type:'START_RUN',tabId:1,mode:'live'})).toMatchObject({ok:false,error:expect.stringContaining('khóa gửi')});
});
it('serializes concurrent standalone and managed starts before either run record is written',async()=>{
 const f=await fixture();const results=await Promise.allSettled([f.ask({type:'START_RUN',tabId:1,mode:'test'}),adapter.start(command('START'),'session')]);
 expect(results.filter(r=>r.status==='fulfilled'&&r.value?.status==='running')).toHaveLength(1);
 expect(results.some(r=>r.status==='rejected'||r.status==='fulfilled'&&r.value?.ok===false)).toBe(true);
});
