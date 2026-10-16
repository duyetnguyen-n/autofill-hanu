import {afterEach,expect,it,vi} from 'vitest';
import {createNativeClient} from '../../src/native-client';

const disposers:(()=>void)[]=[];
afterEach(()=>{for(const dispose of disposers)dispose();disposers.length=0;vi.unstubAllGlobals();});
function fixture(){
  const storage:Record<string,any>={};const ports:any[]=[];
  const runtime:any={id:'a'.repeat(32),connectNative:vi.fn(()=>{
    const messages:((m:any)=>void)[]=[],disconnects:(()=>void)[]=[];
    const port={messages,disconnects,sent:[] as any[],onMessage:{addListener:(fn:any)=>messages.push(fn)},onDisconnect:{addListener:(fn:any)=>disconnects.push(fn)},postMessage(m:any){this.sent.push(m);},disconnect:vi.fn()};ports.push(port);return port;
  })};
  vi.stubGlobal('chrome',{runtime,storage:{local:{get:async(key:string)=>({[key]:structuredClone(storage[key])}),set:async(data:any)=>Object.assign(storage,structuredClone(data))}}});
  const adapter={start:vi.fn(),control:vi.fn(),focus:vi.fn(),disconnected:vi.fn(async()=>{}),reconcile:vi.fn(async()=>{})};
  const client=createNativeClient(adapter);disposers.push(client.dispose);return {client,ports,storage,runtime,adapter};
}
it('waits for host acknowledgement, persists the token, and ignores an old port disconnect',async()=>{
  const f=fixture();f.client.boot();await vi.waitFor(()=>expect(f.ports).toHaveLength(1));
  let settled=false;const pairing=f.client.pair('ABCDEF123456').then(value=>{settled=true;return value;});
  await vi.waitFor(()=>expect(f.ports).toHaveLength(2));const old=f.ports[0],current=f.ports[1];
  f.runtime.lastError={message:'Native host has exited.'};old.disconnects.forEach((fn:any)=>fn());delete f.runtime.lastError;
  expect(settled).toBe(false);expect(current.sent[0]).toMatchObject({type:'PAIR',code:'ABCDEF123456'});
  current.messages.forEach((fn:any)=>fn({type:'PAIRED',token:'session-token'}));
  expect(await pairing).toMatchObject({connected:true,paired:true,error:''});expect(f.storage.coordinatorIdentity.token).toBe('session-token');expect(f.adapter.disconnected).not.toHaveBeenCalled();
});
it('reports a missing native host as a pairing error instead of claiming success',async()=>{
  const f=fixture();const pairing=f.client.pair('ABCDEF123456');const rejection=expect(pairing).rejects.toThrow('Chrome chưa tìm thấy cầu nối');
  await vi.waitFor(()=>expect(f.ports).toHaveLength(1));f.runtime.lastError={message:'Specified native messaging host not found.'};f.ports[0].disconnects.forEach((fn:any)=>fn());await rejection;
  expect((await f.client.status()).connected).toBe(false);expect(f.storage.coordinatorIdentity.token).toBeUndefined();
});
it('rejects invalid pairing codes before opening a native connection',async()=>{
  const f=fixture();await expect(f.client.pair('123')).rejects.toThrow('12 ký tự');expect(f.runtime.connectNative).not.toHaveBeenCalled();
});
it('halts the page and refuses requests when the coordinator reports a storage failure',async()=>{const f=fixture();const pairing=f.client.pair('ABCDEF123456');await vi.waitFor(()=>expect(f.ports).toHaveLength(1));const port=f.ports[0];port.messages.forEach((fn:any)=>fn({type:'PAIRED',token:'token'}));await pairing;port.messages.forEach((fn:any)=>fn({type:'EMERGENCY_STOP',error:'Ổ đĩa đầy'}));expect(f.client.isConnected()).toBe(false);expect(f.adapter.disconnected).toHaveBeenCalledOnce();await expect(f.client.request('SUBMIT')).rejects.toThrow('App mất kết nối');});
it('reports standalone execution ownership on heartbeat without leaking its profile snapshot',async()=>{
 const f=fixture(),execution={runId:'standalone',tabId:9,mode:'test',status:'running',active:true,managed:false,tabOpen:true,updatedAt:''};Object.assign(f.adapter,{execution:vi.fn(async()=>execution)});
 const pairing=f.client.pair('ABCDEF123456');await vi.waitFor(()=>expect(f.ports).toHaveLength(1));const port=f.ports[0];port.messages.forEach((fn:any)=>fn({type:'PAIRED',token:'token'}));await pairing;
 f.client.heartbeat();await vi.waitFor(()=>expect(port.sent.find((m:any)=>m.type==='EXECUTION')?.execution).toEqual(execution));expect(port.sent.find((m:any)=>m.type==='EXECUTION')).not.toHaveProperty('profile');
});

async function connectedFixture(){
 const f=fixture(),pairing=f.client.pair('ABCDEF123456');await vi.waitFor(()=>expect(f.ports).toHaveLength(1));
 const port=f.ports[0];port.messages.forEach((fn:any)=>fn({type:'PAIRED',token:'token'}));await pairing;
 const deliver=(kind:string,commandId:string)=>port.messages.forEach((fn:any)=>fn({type:'COMMAND',protocol:1,sessionId:f.storage.coordinatorIdentity.sessionId,kind,commandId,runId:'run',payload:{}}));
 return {...f,port,deliver};
}
it('acknowledges Stop while Start is still awaiting a page and preserves both command journal entries',async()=>{
 const f=await connectedFixture();let finish!:()=>void;
 f.adapter.start.mockImplementation(()=>new Promise<void>(r=>finish=r));f.adapter.control.mockResolvedValue({status:'idle'});
 f.deliver('START','slow-start');await vi.waitFor(()=>expect(f.adapter.start).toHaveBeenCalledOnce());
 f.deliver('STOP_PROFILE','stop-now');
 await vi.waitFor(()=>expect(f.port.sent).toContainEqual(expect.objectContaining({type:'RESULT',commandId:'stop-now',ok:true})));
 expect(f.port.sent.some((m:any)=>m.commandId==='slow-start'&&m.type==='RESULT')).toBe(false);
 finish();await vi.waitFor(()=>expect(f.storage.nativeJournal['slow-start']?.done).toBe(true));
 expect(f.storage.nativeJournal['stop-now'].done).toBe(true);
});
it('cancels queued pre-Stop commands and does not interrupt a new run when an acknowledged Stop is replayed',async()=>{
 const f=await connectedFixture();let finish!:()=>void;
 f.adapter.start.mockImplementation(()=>new Promise<void>(r=>finish=r));f.adapter.control.mockResolvedValue({status:'idle'});
 f.deliver('START','slow');await vi.waitFor(()=>expect(f.adapter.start).toHaveBeenCalledOnce());
 f.deliver('START','queued');f.deliver('STOP_PROFILE','stop');
 await vi.waitFor(()=>expect(f.port.sent).toContainEqual(expect.objectContaining({commandId:'stop',ok:true})));
 finish();await vi.waitFor(()=>expect(f.port.sent).toContainEqual(expect.objectContaining({commandId:'queued',ok:false})));
 expect(f.adapter.start).toHaveBeenCalledOnce();const interrupted=f.adapter.disconnected.mock.calls.length;
 f.deliver('STOP_PROFILE','stop');await vi.waitFor(()=>expect(f.port.sent.filter((m:any)=>m.commandId==='stop'&&m.ok)).toHaveLength(2));
 expect(f.adapter.disconnected).toHaveBeenCalledTimes(interrupted);expect(f.adapter.control).toHaveBeenCalledOnce();
});
