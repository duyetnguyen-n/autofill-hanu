import {afterEach,expect,it,vi} from 'vitest';
import {Store} from '../manager/server/store';
import {Coordinator} from '../manager/server/coordinator';
import {emptyProfile} from '../src/rules';
import type {Command} from '../src/protocol';
import type {RunState} from '../src/shared';
const cleanup:(()=>Promise<void>)[]=[];
afterEach(async()=>{for(const close of cleanup.splice(0))await close();});
const url='https://docs.google.com/forms/d/e/reliability-fixture/viewform';
function fixture(status:RunState['status']='waiting_manual'){
 const store=new Store(':memory:'),id='profile';store.pair(id,store.pairCode());
 const s=store.session(id);s.expectedEmail='fixture@example.test';s.profile=emptyProfile();s.synced=true;
 s.run={runId:'original',sessionId:id,managed:true,tabId:1,formId:'reliability-fixture',url,mode:'test',status,filled:[],skipped:[],logs:[],submitAttempted:false,updatedAt:new Date().toISOString(),eventSeq:3};
 store.saveGroup({id:'original',url,mode:'test',members:[id],paused:false,createdAt:''});store.saveSession(s);store.saveRun(id,s.run);
 const c=new Coordinator(store),commands:Command[]=[];let stopGate:Promise<void>|undefined;
 const peer={readyState:1,send:(raw:string)=>{
  const command=JSON.parse(raw) as Command;if(command.type!=='COMMAND')return;commands.push(command);
  void (async()=>{
   if(command.kind==='STOP_PROFILE'&&stopGate)await stopGate;
   const run=store.session(id).run!;
   const result=command.kind==='STOP_PROFILE'?{run:{...run,status:'idle',eventSeq:run.eventSeq!+1},execution:null}:command.kind==='READ_PROFILE'?{profile:emptyProfile(),revision:0}:command.kind==='PING'?{execution:store.session(id).execution}:{ok:true};
   await c.receive(id,{type:'RESULT',commandId:command.commandId,ok:true,result});
  })();
 }} as any;c.peers.set(id,peer);
 cleanup.push(async()=>{c.attention.close();await vi.waitFor(()=>expect(c.pending.size).toBe(0));await new Promise(r=>setImmediate(r));store.db.close();});
 return {store,c,id,commands,setStopGate:(gate:Promise<void>|undefined)=>stopGate=gate};
}
it.each(['idle','paused','waiting_manual','failed','ready_to_submit','running'] as const)('restarts a %s run through acknowledged Stop, then creates a fresh run',async status=>{
 const f=fixture(status),group=await f.c.restart(f.id,'original','restart-request-1');
 expect(group.id).not.toBe('original');expect(group.restartOf).toBe('original');
 await vi.waitFor(()=>expect(f.commands.some(c=>c.kind==='START')).toBe(true));
 expect(f.commands.filter(c=>['STOP_PROFILE','START'].includes(c.kind)).map(c=>c.kind)).toEqual(['STOP_PROFILE','START']);
 expect(f.commands.find(c=>c.kind==='STOP_PROFILE')?.runId).toBe('original');
 expect(f.store.session(f.id).run?.runId).toBe(group.id);
});
it('deduplicates a double click and a replay after the coordinator is recreated',async()=>{
 const f=fixture(),[a,b]=await Promise.all([f.c.restart(f.id,'original','request-first'),f.c.restart(f.id,'original','request-second')]);
 expect(a.id).toBe(b.id);await vi.waitFor(()=>expect(f.commands.some(c=>c.kind==='START')).toBe(true));
 const c2=new Coordinator(f.store);c2.peers=f.c.peers;
 expect((await c2.restart(f.id,'original','request-first')).id).toBe(a.id);c2.attention.close();
 expect(f.commands.filter(c=>c.kind==='STOP_PROFILE')).toHaveLength(1);expect(f.commands.filter(c=>c.kind==='START')).toHaveLength(1);
});
it('a later Stop cancels an in-flight Restart before its new Start is dispatched',async()=>{
 const f=fixture();let finish!:()=>void;f.setStopGate(new Promise<void>(r=>finish=r));
 const restarting=f.c.restart(f.id,'original','restart-cancelled');const rejected=expect(restarting).rejects.toThrow('hủy');
 await vi.waitFor(()=>expect(f.commands.some(c=>c.kind==='STOP_PROFILE')).toBe(true));
 const stop=f.c.control(f.id,'STOP','original');finish();await stop;await rejected;
 expect(f.commands.some(c=>c.kind==='START')).toBe(false);expect(f.store.session(f.id).run?.status).toBe('idle');
});
it.each(['completed','submit_uncertain','submitting'] as const)('does not restart a %s submission or clear its lock',async status=>{
 const f=fixture(status),s=f.store.session(f.id);s.run!.submitAttempted=true;f.store.saveSession(s);
 await expect(f.c.restart(f.id,'original','locked-restart')).rejects.toThrow('khóa gửi');expect(f.commands).toEqual([]);expect(f.store.session(f.id).run?.submitAttempted).toBe(true);
});
it('rejects stale controls and surfaces a missing acknowledgement instead of starting again',async()=>{
 const f=fixture();await expect(f.c.restart(f.id,'old','stale-request')).rejects.toThrow('thay đổi');expect(f.commands).toEqual([]);
 f.setStopGate(new Promise(()=>{}));
 const command=f.c.command(f.id,'STOP_PROFILE',{},'original',10);await expect(command).rejects.toThrow('chưa xác nhận');
 expect(f.store.session(f.id).control).toMatchObject({state:'uncertain',kind:'STOP_PROFILE'});
 expect(f.commands.some(c=>c.kind==='START')).toBe(false);
});
it('deduplicates Start by request ID, but rejects reusing the ID with different inputs',async()=>{
 const f=fixture('idle'),a=await f.c.start([f.id],url,'test',undefined,'start-request');
 const b=await f.c.start([f.id],url,'test',undefined,'start-request');expect(b.id).toBe(a.id);
 await expect(f.c.start([f.id],url,'live',undefined,'start-request')).rejects.toThrow('thao tác khác');
});
it('does not dispatch a Resume whose authorization finishes after a later Stop',async()=>{
 const f=fixture('paused');let release!:()=>void;
 (f.store as any).authorizeResume=()=>new Promise<void>(r=>release=r);
 const resuming=f.c.control(f.id,'RESUME','original'),rejected=expect(resuming).rejects.toThrow('Dừng mới');
 await vi.waitFor(()=>expect(release).toBeTypeOf('function'));
 await f.c.control(f.id,'STOP','original');release();await rejected;
 expect(f.commands.some(c=>c.kind==='RESUME')).toBe(false);
 expect(f.store.session(f.id).run?.status).toBe('idle');
});

it('authorizes reconnect only with durable intent and an active group',async()=>{
 const f=fixture('paused'),s=f.store.session(f.id);s.run!.transportRecovery=true;s.run!.autoContinue=true;f.store.saveSession(s);f.store.saveRun(f.id,s.run!);
 await f.c.control(f.id,'RESUME','original','reconnect');
 expect(f.commands.find(c=>c.kind==='RESUME')?.payload).toEqual({reconnect:true});
});
it.each(['manual','stopped_group','submitted','old_run'] as const)('rejects reconnect for %s',async reason=>{
 const f=fixture('paused'),s=f.store.session(f.id);s.run!.transportRecovery=reason!=='manual';s.run!.autoContinue=reason!=='manual';s.run!.submitAttempted=reason==='submitted';f.store.saveSession(s);f.store.saveRun(f.id,s.run!);
 if(reason==='stopped_group'){const g=f.store.group('original');g.paused=true;g.stopped=true;f.store.saveGroup(g);}
 await expect(f.c.control(f.id,'RESUME',reason==='old_run'?'old':'original','reconnect')).rejects.toThrow();
 expect(f.commands.some(c=>c.kind==='RESUME')).toBe(false);
});
