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
