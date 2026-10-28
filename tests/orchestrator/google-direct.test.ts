import {afterEach,expect,it,vi} from 'vitest';
import {Store} from '../../manager/server/store';
import {Coordinator} from '../../manager/server/coordinator';
import {emptyProfile} from '../../src/rules';
import {DIRECT_LAB_URL,DIRECT_LAB_FORM_ID} from '../../src/google-direct/schema';
const stores:Store[]=[];
afterEach(()=>{for(const s of stores.splice(0))s.close();});
function fixture(direct=true){
 const store=new Store(':memory:');stores.push(store);const c=new Coordinator(store);
 for(const id of ['one','two']){store.pair(id,store.pairCode());const s=store.session(id);Object.assign(s,{hskLevel:'4',expectedEmail:`${id}@example.test`,profile:emptyProfile(),synced:true,connected:true});store.saveSession(s);c.peers.set(id,{readyState:1} as any);}
 const command=vi.fn(async(id:string,kind:string,payload:any={},runId?:string)=>{
   if(kind==='PING')return {capabilities:direct?['googleDirect','scheduledHskLinks','preparedFormTab']:['scheduledHskLinks'],execution:null};
   if(kind==='STOP_PROFILE')return {execution:null};
   return {};
 });c.command=command;return {store,c,command};
}
it('dispatches the experimental engine for every selected profile while preserving the saved profile',async()=>{
 const f=fixture(),before=f.store.session('one').profile;
 const g=await f.c.start(['one','two'],DIRECT_LAB_URL,'test',undefined,'direct-request',undefined,undefined,'direct');
 expect(g.engine).toBe('direct');expect(f.store.session('one').profile).toEqual(before);
 for(const id of ['one','two'])expect(f.command).toHaveBeenCalledWith(id,'START',expect.objectContaining({engine:'direct',mode:'test',url:DIRECT_LAB_URL}),g.id,120000);
 expect(f.store.session('one').run?.engine).toBe('direct');
});
it('keeps the original Start payload and run schema when no experimental engine is selected',async()=>{
 const f=fixture(),url='https://docs.google.com/forms/d/e/production-fixture/viewform';
 const g=await f.c.start(['one'],url,'test');
 expect(g).not.toHaveProperty('engine');expect(f.store.session('one').run).not.toHaveProperty('engine');
 expect(f.command).toHaveBeenCalledWith('one','START',expect.not.objectContaining({engine:'direct'}),g.id,120000);
 expect(f.command.mock.calls.some(c=>c[1]==='PING')).toBe(false);
});
it('does not downgrade Direct to the classic engine on an older extension',async()=>{
 const f=fixture(false);await expect(f.c.start(['one'],DIRECT_LAB_URL,'test',undefined,undefined,undefined,undefined,'direct')).rejects.toThrow('Cập nhật');
 expect(f.command.mock.calls.some(c=>c[1]==='START')).toBe(false);expect(f.store.session('one').run).toBeUndefined();
});
it('rejects non-LAB experimental URLs before persisting a group or dispatching commands',async()=>{
 const f=fixture();await expect(f.c.start(['one'],'https://docs.google.com/forms/d/e/real-form/viewform','live',undefined,undefined,undefined,undefined,'direct')).rejects.toThrow('LAB');
 expect(f.store.groups()).toEqual([]);expect(f.command).not.toHaveBeenCalled();
});
it('retains the chosen engine through a scheduled manual link and group Stop',async()=>{
 const f=fixture();const s=await f.c.scheduler.arm({ids:['one','two'],mode:'test',manualOnly:true,engine:'direct',links:{'4':DIRECT_LAB_URL}});
 expect(s.engine).toBe('direct');await f.c.scheduler.tick();
 await vi.waitFor(()=>expect(f.command.mock.calls.filter(c=>c[1]==='START')).toHaveLength(2));
 expect(f.command.mock.calls.filter(c=>c[1]==='START').every(c=>c[2].engine==='direct')).toBe(true);
 const result=await f.c.stopScheduledRuns(s.id);expect(result.every(r=>r.ok)).toBe(true);
 expect(f.command.mock.calls.filter(c=>c[1]==='STOP_PROFILE')).toHaveLength(2);expect(f.store.session('one').run?.status).toBe('idle');
});
it('does not reuse the same request ID to silently change engines',async()=>{
 const f=fixture();await f.c.start(['one'],DIRECT_LAB_URL,'test',undefined,'same-request-id');
 await expect(f.c.start(['one'],DIRECT_LAB_URL,'test',undefined,'same-request-id',undefined,undefined,'direct')).rejects.toThrow('thao tác khác');
});
it('allows fresh and restarted Direct LAB runs after confirmed receipt, preserving old results',async()=>{
 const f=fixture();
 const first=await f.c.start(['one'],DIRECT_LAB_URL,'live',undefined,undefined,undefined,undefined,'direct');
 const s=f.store.session('one');s.run!.formId=DIRECT_LAB_FORM_ID;f.store.saveSession(s);
 f.store.acquireSubmit('one',first.id,DIRECT_LAB_FORM_ID);f.store.resolve('one',first.id,'received');
 expect(f.store.blocked('one',DIRECT_LAB_FORM_ID)).toBe(true);
 expect(f.store.blocked('one',DIRECT_LAB_FORM_ID,'direct')).toBe(false);
 const second=await f.c.restart('one',first.id,'restart-lab-received');
 expect(second.id).not.toBe(first.id);expect(second.engine).toBe('direct');
 const next=f.store.session('one');next.run!.formId=DIRECT_LAB_FORM_ID;f.store.saveSession(next);
 f.store.acquireSubmit('one',second.id,DIRECT_LAB_FORM_ID);
 expect(f.store.history('one').find(r=>r.runId===first.id)).toMatchObject({status:'completed',submitAttempted:true});
 expect(()=>f.store.acquireSubmit('one',second.id,DIRECT_LAB_FORM_ID)).toThrow();
 expect(f.store.blocked('one',DIRECT_LAB_FORM_ID,'direct')).toBe(true);
});
it('keeps unresolved LAB submissions blocked and never applies repeat rules to classic',async()=>{
 const f=fixture();const first=await f.c.start(['one'],DIRECT_LAB_URL,'live',undefined,undefined,undefined,undefined,'direct');
 const s=f.store.session('one');s.run!.formId=DIRECT_LAB_FORM_ID;f.store.saveSession(s);
 f.store.acquireSubmit('one',first.id,DIRECT_LAB_FORM_ID);
 await expect(f.c.start(['one'],DIRECT_LAB_URL,'test',undefined,undefined,undefined,undefined,'direct')).rejects.toThrow();
 f.store.resolve('one',first.id,'received');
 await expect(f.c.start(['one'],DIRECT_LAB_URL,'test')).rejects.toThrow('khóa');
});
it('changes/repeats a scheduled LAB link after a completed Live run without asking for manual resolution',async()=>{
 const f=fixture();await f.c.scheduler.arm({ids:['one'],mode:'live',manualOnly:true,engine:'direct',links:{'4':DIRECT_LAB_URL}});
 await f.c.scheduler.tick();await vi.waitFor(()=>expect(f.c.scheduler.value?.members[0].status).toBe('started'));
 const s=f.store.session('one'),first=s.run!.runId!;s.run!.formId=DIRECT_LAB_FORM_ID;f.store.saveSession(s);
 f.store.acquireSubmit('one',first,DIRECT_LAB_FORM_ID);f.store.resolve('one',first,'received');
 expect(await f.c.scheduler.replace('4',DIRECT_LAB_URL)).toEqual([{id:'one',ok:true}]);
 await vi.waitFor(()=>expect(f.store.session('one').run?.runId).not.toBe(first));
 expect(f.store.session('one').run).toMatchObject({engine:'direct',mode:'live',status:'running',submitAttempted:false});
});
