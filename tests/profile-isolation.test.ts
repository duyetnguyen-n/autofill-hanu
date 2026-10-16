import {afterEach,expect,it,vi} from 'vitest';
import {Store} from '../manager/server/store';
import {Coordinator} from '../manager/server/coordinator';
import {emptyProfile} from '../src/rules';
import type {DataStore} from '../manager/server/data-store';
import {databaseFixture,users} from './cloud/fixture';

const url='https://docs.google.com/forms/d/e/isolation/viewform';
const cleanup:(()=>Promise<void>|void)[]=[];
afterEach(async()=>{for(const close of cleanup.splice(0).reverse())await close();});
function controller(store:DataStore,ids:string[]){
  const c=new Coordinator(store),sent:string[]=[];
  for(const id of ids)c.peers.set(id,{} as any);
  c.command=async(id,kind)=>{if(kind==='START')sent.push(id);return {capabilities:['sharedFinalQuestion']};};
  cleanup.push(()=>c.attention.close());return {c,sent};
}
function local(count=10){
  const store=new Store(':memory:');cleanup.push(()=>store.close());
  const ids=Array.from({length:count},(_,i)=>`profile-${i}`);
  for(const id of ids){store.pair(id,store.pairCode());const s=store.session(id);s.profile=emptyProfile();s.synced=true;s.expectedEmail=`${id}@example.test`;store.saveSession(s);}
  return {store,ids,...controller(store,ids)};
}
it('dispatches nine profiles while the tenth is still checking capability, and persists its own failure',async()=>{
  const {store,ids,c,sent}=local();let release!:(r:any)=>void;
  const command=c.command.bind(c);c.command=async(id,kind,...args)=>id===ids[0]&&kind==='PING'?new Promise(r=>release=r):command(id,kind,...args);
  const pending=c.start(ids,url,'test',{label:'Câu cuối',value:'2026'},'independent-start');
  await vi.waitFor(()=>expect(sent).toHaveLength(9));expect(sent).not.toContain(ids[0]);
  const group=store.groups()[0];expect(group.members).toHaveLength(10);
  release({capabilities:[]});const result=await pending;
  expect(result.startResults?.filter(r=>r.ok)).toHaveLength(9);
  expect(store.group(group.id).startResults?.find(r=>r.id===ids[0])).toMatchObject({ok:false,error:expect.stringContaining('Reload')});
  expect(store.session(ids[0]).run).toBeUndefined();
  expect((await c.start(ids,url,'test',{label:'Câu cuối',value:'2026'},'independent-start')).id).toBe(group.id);
  expect(sent).toHaveLength(9);
});
it('cancels only a stopped member during preflight; other members keep their own intents',async()=>{
  const {store,ids,c,sent}=local();let release!:(r:any)=>void;
  const command=c.command.bind(c);c.command=async(id,kind,...args)=>id===ids[0]&&kind==='PING'?new Promise(r=>release=r):command(id,kind,...args);
  const pending=c.start(ids,url,'test',{label:'Câu cuối',value:'2026'});
  await vi.waitFor(()=>expect(sent).toHaveLength(9));await c.control(ids[0],'STOP');
  release({capabilities:['sharedFinalQuestion']});const result=await pending;
  expect(result.startResults?.find(r=>r.id===ids[0])).toMatchObject({ok:false});expect(sent).toHaveLength(9);
  for(const id of ids.slice(1))expect(store.session(id).run?.status).toBe('running');
});
it('a group Stop fences a prepared member even if its capability reply arrives later',async()=>{
  const {store,ids,c,sent}=local(1);let release!:(r:any)=>void;c.command=async()=>new Promise(r=>release=r);
  const pending=c.start(ids,url,'test',{label:'Câu cuối',value:'2026'});const rejected=expect(pending).rejects.toThrow('Nhóm đã dừng');
  await vi.waitFor(()=>expect(release).toBeTypeOf('function'));
  await c.groupControl(store.groups()[0].id,'STOP');release({capabilities:['sharedFinalQuestion']});await rejected;
  expect(sent).toEqual([]);expect(store.session(ids[0]).run).toBeUndefined();
});
it('keeps PostgreSQL capacity, membership and Stop gates transactional during incremental starts',async()=>{
  const f=await databaseFixture();cleanup.push(f.close);
  const members=await Promise.all(Array.from({length:4},()=>f.pair(users[0]))),ids=members.map(m=>m.sessionId),store=members[0].store;
  await f.pool.query('UPDATE hanu.accounts SET max_concurrent=2 WHERE user_id=$1',[users[0]]);
  const {c,sent}=controller(store,ids);const group=await c.start(ids,url,'test');
  expect(group.startResults?.filter(r=>r.ok)).toHaveLength(2);expect(sent).toHaveLength(2);
  expect((await store.group(group.id)).startResults).toHaveLength(4);
  const stopped=await store.group(group.id);stopped.paused=true;stopped.stopped=true;await store.saveGroup(stopped);
  const failed=ids.find(id=>!sent.includes(id))!,s=await store.session(failed);
  s.run={...(await store.session(sent[0])).run!,sessionId:failed};
  await expect(store.beginGroup(group,[s],true)).rejects.toThrow('Nhóm đã dừng');
  expect((await store.session(failed)).run).toBeUndefined();
},20000);
