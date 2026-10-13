import {afterEach,it,expect,vi} from 'vitest';
import type {ExtensionMessage} from '../src/shared';
let native:any,adapter:any,cleanup:(()=>Promise<any>)|undefined;
vi.mock('../src/native-client',()=>({createNativeClient:(a:any)=>{adapter=a;native={boot:vi.fn(),state:vi.fn(),isConnected:()=>true,request:vi.fn(async(kind:string)=>kind==='ATTENTION_ACQUIRE'?{token:'lease'}:kind==='ATTENTION_FOCUSED'?{focused:true}:{renewed:true})};return native;}}));
afterEach(async()=>{await cleanup?.();cleanup=undefined;vi.unstubAllGlobals();vi.resetModules();});
async function fixture(){
 const url='https://docs.google.com/forms/d/e/attention-fixture/viewform';
 const run={runId:'run',sessionId:'session',managed:true,tabId:7,formId:'attention-fixture',status:'running',mode:'test',contentEpoch:'document',logs:[],filled:[],skipped:[],submitAttempted:false,updatedAt:''};
 const data:any={'run:7':run,managedRun:run};let listener:any;
 const window={id:1,state:'minimized'};const update=vi.fn(async(_id:number,values:any)=>Object.assign(window,values));
 vi.stubGlobal('chrome',{runtime:{getURL:(s:string)=>s,onMessage:{addListener:(fn:any)=>listener=fn},sendMessage:vi.fn(async()=>({}))},action:{onClicked:{addListener:vi.fn()}},windows:{get:vi.fn(async()=>window),update,create:vi.fn()},tabs:{get:vi.fn(async()=>({id:7,windowId:1,url})),update:vi.fn(async()=>({})),sendMessage:vi.fn(async()=>({})),onUpdated:{addListener:vi.fn()},onRemoved:{addListener:vi.fn()}},storage:{local:{get:vi.fn(async(key:string)=>({[key]:structuredClone(data[key])})),set:vi.fn(async(value:any)=>Object.assign(data,structuredClone(value)))}}});
 await import('../src/background');
 const sender={tab:{id:7,url},url,frameId:0};const ask=(m:ExtensionMessage,s=sender)=>new Promise<any>(resolve=>listener(m,s,resolve));
 cleanup=()=>ask({type:'PAGE_ATTENTION_RELEASE',token:'lease'});
 return {data,ask,sender,update,acquire:{type:'PAGE_ATTENTION_ACQUIRE' as const,runId:'run',epoch:'document',purpose:'Chọn đáp án'}};
}
it('restores a minimized window, selects the form, and acquires/releases the shared attention lease without a controller popup',async()=>{const f=await fixture();expect(await f.ask(f.acquire)).toMatchObject({ok:true,token:'lease'});expect(f.update).toHaveBeenCalledWith(1,{state:'normal',focused:false});expect(f.update).toHaveBeenCalledWith(1,{focused:true});expect(chrome.tabs.update).toHaveBeenCalledWith(7,{active:true});expect(chrome.windows.create).not.toHaveBeenCalled();await f.ask({type:'PAGE_ATTENTION_RELEASE',token:'lease'});expect(native.request).toHaveBeenCalledWith('ATTENTION_RELEASE',expect.objectContaining({runId:'run'}),{token:'lease'});});
it('rejects old-run, old-document and subframe requests before focusing',async()=>{const f=await fixture();for(const m of [{...f.acquire,runId:'old'},{...f.acquire,epoch:'old'}])expect(await f.ask(m)).toMatchObject({ok:false});expect(await f.ask(f.acquire,{...f.sender,frameId:1})).toMatchObject({ok:false});expect(f.update).not.toHaveBeenCalled();});
it('does not focus a run stopped while its request is waiting in the shared queue',async()=>{const f=await fixture();let grant!:(v:any)=>void;native.request.mockImplementationOnce(()=>new Promise(r=>grant=r));const pending=f.ask(f.acquire);await vi.waitFor(()=>expect(grant).toBeTypeOf('function'));f.data['run:7'].status='idle';grant({token:'lease'});expect(await pending).toMatchObject({ok:false});expect(f.update).not.toHaveBeenCalled();expect(native.request).toHaveBeenCalledWith('ATTENTION_RELEASE',expect.anything(),{token:'lease'});});
it('a fresh document releases its predecessor’s lease before claiming the run',async()=>{const f=await fixture();await f.ask(f.acquire);expect(await f.ask({type:'CLAIM_DOCUMENT',epoch:'new'})).toMatchObject({ok:true,run:{contentEpoch:'new'}});expect(native.request).toHaveBeenCalledWith('ATTENTION_RELEASE',expect.anything(),{token:'lease'});});
it('keeps rendering enabled through trusted input, then resets and detaches on release',async()=>{
 const f=await fixture();const attach=vi.fn(async()=>{}),detach=vi.fn(async()=>{}),sendCommand=vi.fn(async()=>{});Object.assign(chrome,{debugger:{attach,detach,sendCommand}});
 await f.ask(f.acquire);expect(sendCommand).toHaveBeenCalledWith({tabId:7},'Emulation.setFocusEmulationEnabled',{enabled:true});
 expect(await f.ask({type:'TRUSTED_CLICK',x:10,y:10})).toMatchObject({dispatched:true});expect(attach).toHaveBeenCalledOnce();expect(detach).not.toHaveBeenCalled();
 await f.ask({type:'PAGE_ATTENTION_RELEASE',token:'lease'});expect(sendCommand).toHaveBeenCalledWith({tabId:7},'Emulation.setFocusEmulationEnabled',{enabled:false});expect(detach).toHaveBeenCalledOnce();
});
it('cleans up a debugger attachment if Chromium rejects the rendering command',async()=>{
 const f=await fixture();const detach=vi.fn(async()=>{});Object.assign(chrome,{debugger:{attach:vi.fn(),detach,sendCommand:vi.fn(async()=>{throw new Error('Rendering unavailable');})}});
 expect(await f.ask(f.acquire)).toMatchObject({ok:false,error:'Rendering unavailable'});expect(detach).toHaveBeenCalledOnce();expect(native.request).toHaveBeenCalledWith('ATTENTION_RELEASE',expect.anything(),{token:'lease'});
});
it('requests an independent renderer lease and does not focus the Chrome window',async()=>{
 const f=await fixture();const sendCommand=vi.fn(async()=>{});Object.assign(chrome,{debugger:{attach:vi.fn(async()=>{}),detach:vi.fn(async()=>{}),sendCommand}});
 native.request.mockImplementation(async(kind:string)=>kind==='ATTENTION_ACQUIRE'?{token:'lease',mode:'background'}:{renewed:true});
 await f.ask(f.acquire);expect(native.request).toHaveBeenCalledWith('ATTENTION_ACQUIRE',expect.anything(),{rendering:'background'});
 expect(f.update).not.toHaveBeenCalledWith(1,{focused:true});expect(sendCommand).not.toHaveBeenCalledWith({tabId:7},'Page.bringToFront');expect(native.request).not.toHaveBeenCalledWith('ATTENTION_FOCUSED',expect.anything(),expect.anything());
 expect(sendCommand).toHaveBeenCalledWith({tabId:7},'Emulation.setFocusEmulationEnabled',{enabled:true});
});
it('repairs a zero-size viewport without serializing the subsequent controls',async()=>{
 const f=await fixture(),sendCommand=vi.fn(async(_target:any,method:string)=>method==='Page.getLayoutMetrics'?{cssLayoutViewport:{clientWidth:0,clientHeight:0}}:{});
 Object.assign(chrome,{debugger:{attach:vi.fn(async()=>{}),detach:vi.fn(async()=>{}),sendCommand}});native.request.mockImplementation(async(kind:string)=>kind==='ATTENTION_ACQUIRE'?{token:'lease',mode:'background'}:{renewed:true});
 expect(await f.ask(f.acquire)).toMatchObject({ok:true});expect(f.update).toHaveBeenCalledWith(1,{focused:true});expect(sendCommand).toHaveBeenCalledWith({tabId:7},'Page.bringToFront');
 expect(native.request).toHaveBeenCalledWith('ATTENTION_ACQUIRE',expect.anything(),{rendering:'background'});expect(native.request).not.toHaveBeenCalledWith('ATTENTION_FOCUSED',expect.anything(),expect.anything());
});
it('Stop during renderer setup detaches the pending debugger and prevents a late focus repair',async()=>{
 const f=await fixture();let resolve!:(v:any)=>void;const detach=vi.fn(async()=>{}),sendCommand=vi.fn(async(_t:any,method:string)=>method==='Page.getLayoutMetrics'?await new Promise(r=>resolve=r):{});
 Object.assign(chrome,{debugger:{attach:vi.fn(async()=>{}),detach,sendCommand}});native.request.mockImplementation(async(kind:string)=>kind==='ATTENTION_ACQUIRE'?{token:'lease',mode:'background'}:{renewed:true});
 const acquired=f.ask(f.acquire);await vi.waitFor(()=>expect(resolve).toBeTypeOf('function'));f.data['run:7'].status='idle';
 const stopped=f.ask({type:'PAGE_ATTENTION_RELEASE',token:'lease'});await new Promise(r=>setTimeout(r,0));resolve({cssLayoutViewport:{clientWidth:0,clientHeight:0}});
 expect(await acquired).toMatchObject({ok:false,error:expect.stringContaining('dừng')});await stopped;expect(detach).toHaveBeenCalledOnce();expect(f.update).not.toHaveBeenCalledWith(1,{focused:true});
});
it.each([false,true])('Start restores the window and waits for an occluded account header (occluded=%s)',async occluded=>{const f=await fixture();f.data['run:7'].status='idle';f.data.managedRun.status='idle';f.data.profile={values:{},customFields:[],attachments:{},mappings:{}};f.data.profileRevision=1;vi.mocked(chrome.tabs.get).mockResolvedValue({id:7,windowId:1,url:f.sender.url,status:'complete'} as any);Object.assign(chrome.windows,{getLastFocused:vi.fn(async()=>({id:1,state:'minimized'}))});Object.assign(chrome.tabs,{create:vi.fn(async()=>({id:7,windowId:1})),sendMessage:vi.fn(async(_id,m:any)=>m.type==='PAGE_ACCOUNT'&&!occluded?{email:'fixture@example.test'}:{ok:true})});native.request.mockImplementation(async(kind:string)=>{if(kind==='ATTENTION_FOCUSED'){occluded=false;return {focused:true};}return {token:'lease'};});const result=await adapter.start({type:'COMMAND',protocol:1,sessionId:'session',commandId:'command',runId:'new-run',kind:'START',payload:{url:f.sender.url,mode:'test',revision:1,expectedEmail:'fixture@example.test'}},'session');expect(result.status).toBe('running');expect(f.update).toHaveBeenCalledWith(1,{state:'normal',focused:false});expect(f.update.mock.invocationCallOrder[0]).toBeLessThan(vi.mocked(chrome.tabs.create).mock.invocationCallOrder[0]);});

