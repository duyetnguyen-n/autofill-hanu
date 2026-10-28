import {afterEach,expect,it,vi} from 'vitest';
const captured=vi.hoisted(()=>({adapter:undefined as any}));
vi.mock('../src/native-client',()=>({createNativeClient:(adapter:any)=>{captured.adapter=adapter;return {isConnected:()=>true};}}));
afterEach(()=>{vi.unstubAllGlobals();vi.resetModules();});
async function setup(status='idle'){
  const data:Record<string,any>={googleDirectManagedRun:{engine:'direct',runId:'direct',status,tabId:42,updatedAt:'2026-10-27',eventSeq:2}};
  const create=vi.fn(async()=>({id:99}));
  vi.stubGlobal('chrome',{
    action:{onClicked:{addListener:vi.fn()}},
    runtime:{getURL:(p:string)=>`chrome-extension://test/${p}`,onMessage:{addListener:vi.fn()}},
    tabs:{create,get:vi.fn(async()=>({id:42})),onUpdated:{addListener:vi.fn()},onRemoved:{addListener:vi.fn()}},
    storage:{local:{get:vi.fn(async(key:any)=>key===null?data:{[key]:data[key]}),set:vi.fn(async(value:any)=>Object.assign(data,value))}}
  });
  await import('../src/background');return {create,data,control:captured.adapter.control};
}
it('prepares the shared waiting tab after a Direct run instead of dispatching PREPARE_FORM as a run control',async()=>{
  const f=await setup();
  expect(await f.control({kind:'PREPARE_FORM',payload:{}})).toEqual({tabId:99});
  expect(f.create).toHaveBeenCalledWith({url:'chrome-extension://test/ready.html',active:true});
  expect(f.data.googleDirectManagedRun.status).toBe('idle');
});
it('does not prepare over a Direct run still holding the profile',async()=>{
  const f=await setup('waiting_manual');
  await expect(f.control({kind:'PREPARE_FORM',payload:{}})).rejects.toThrow('thử nghiệm còn giữ profile');
  expect(f.create).not.toHaveBeenCalled();
});
