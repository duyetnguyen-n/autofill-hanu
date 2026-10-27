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
 vi.stubGlobal('chrome',{runtime:{getURL:(s:string)=>s,onMessage:{addListener:(fn:any)=>listener=fn},sendMessage:vi.fn(async()=>({}))},action:{onClicked:{addListener:vi.fn()}},windows:{get:vi.fn(async()=>window),update,create:vi.fn()},tabs:{get:vi.fn(async()=>({id:7,windowId:1,url})),update:vi.fn(async()=>({})),sendMessage:vi.fn(async()=>({})),onUpdated:{addListener:vi.fn()},onRemoved:{addListener:vi.fn()}},storage:{local:{get:vi.fn(async(key:string)=>({[key]:structuredClone(data[key])})),set:vi.fn(async(value:any)=>Object.assign(data,structuredClone(value))),remove:vi.fn(async(key:string)=>delete data[key])}}});
 await import('../src/background');
 const sender={tab:{id:7,url},url,frameId:0};const ask=(m:ExtensionMessage,s=sender)=>new Promise<any>(resolve=>listener(m,s,resolve));
 cleanup=()=>ask({type:'PAGE_ATTENTION_RELEASE',token:'lease'});
 return {data,ask,sender,update,acquire:{type:'PAGE_ATTENTION_ACQUIRE' as const,runId:'run',epoch:'document',purpose:'Chọn đáp án'}};
}
it('restores a minimized window, selects the form, and acquires/releases the shared attention lease without a controller popup',async()=>{const f=await fixture();expect(await f.ask(f.acquire)).toMatchObject({ok:true,token:'lease'});expect(f.update).toHaveBeenCalledWith(1,{state:'normal',focused:false});expect(f.update).toHaveBeenCalledWith(1,{focused:true});expect(chrome.tabs.update).toHaveBeenCalledWith(7,{active:true});expect(chrome.windows.create).not.toHaveBeenCalled();await f.ask({type:'PAGE_ATTENTION_RELEASE',token:'lease'});expect(native.request).toHaveBeenCalledWith('ATTENTION_RELEASE',expect.objectContaining({runId:'run'}),{token:'lease'});});
it('rejects old-run, old-document and subframe requests before focusing',async()=>{const f=await fixture();for(const m of [{...f.acquire,runId:'old'},{...f.acquire,epoch:'old'}])expect(await f.ask(m)).toMatchObject({ok:false});expect(await f.ask(f.acquire,{...f.sender,frameId:1})).toMatchObject({ok:false});expect(f.update).not.toHaveBeenCalled();});
it('requests automatic Resume for the exact managed run after a correction',async()=>{
 const f=await fixture();f.data['run:7'].status='waiting_manual';f.data['run:7'].blockingIssue={reason:'validation',message:'Sai định dạng'};
 expect(await f.ask({type:'AUTO_RESUME',runId:'run',epoch:'document'})).toEqual({ok:true,resumed:true});
 expect(native.request).toHaveBeenCalledWith('AUTO_RESUME',expect.objectContaining({runId:'run',status:'waiting_manual'}));
});
it.each(['paused','idle','completed','submit_uncertain'] as const)('rejects automatic Resume when the local run is %s',async status=>{
 const f=await fixture();f.data['run:7'].status=status;f.data['run:7'].blockingIssue={reason:'validation',message:'Sai định dạng'};
 expect(await f.ask({type:'AUTO_RESUME',runId:'run',epoch:'document'})).toMatchObject({ok:false});expect(native.request).not.toHaveBeenCalled();
});
it('rejects stale documents, wrong forms, subframes, recovery and submit locks before auto Resume',async()=>{
 const f=await fixture();f.data['run:7'].status='waiting_manual';f.data['run:7'].blockingIssue={reason:'validation',message:'Sai định dạng'};
 const msg={type:'AUTO_RESUME' as const,runId:'run',epoch:'document'};
 for(const extra of [{runId:'old'},{epoch:'old'}])expect(await f.ask({...msg,...extra})).toMatchObject({ok:false});
 expect(await f.ask(msg,{...f.sender,frameId:1})).toMatchObject({ok:false});
 expect(await f.ask(msg,{...f.sender,url:f.sender.url.replace('attention-fixture','other')})).toMatchObject({ok:false});
 f.data['run:7'].recoveryRequired=true;expect(await f.ask(msg)).toMatchObject({ok:false});f.data['run:7'].recoveryRequired=false;
 f.data['run:7'].submitAttempted=true;expect(await f.ask(msg)).toMatchObject({ok:false});expect(native.request).not.toHaveBeenCalled();
});
it('does not restart a run paused while an automatic Resume command is checking the form',async()=>{
 const f=await fixture();f.data['run:7'].status='waiting_manual';f.data['run:7'].blockingIssue={reason:'validation',message:'Sai định dạng'};f.data.managedRun=structuredClone(f.data['run:7']);
 let release!:()=>void;native.request.mockImplementation(async(kind:string)=>{if(kind==='CHECK_FORM')await new Promise<void>(resolve=>release=resolve);return {};});
 vi.mocked(chrome.tabs.sendMessage).mockImplementation(async(_id,m:any)=>m.type==='PAGE_ACCOUNT'?{email:'fixture@example.test'}:{ok:true});
 f.data['run:7'].expectedEmail='fixture@example.test';f.data.managedRun.expectedEmail='fixture@example.test';
 const resumed=adapter.control({kind:'RESUME',runId:'run',payload:{automatic:true}});
 await vi.waitFor(()=>expect(release).toBeTypeOf('function'));f.data['run:7'].status='paused';release();
 await expect(resumed).rejects.toThrow('không tự tiếp tục');expect(f.data['run:7'].status).toBe('paused');expect(chrome.tabs.sendMessage).not.toHaveBeenCalledWith(7,expect.objectContaining({type:'RUN_CURRENT_PAGE'}));
});
it('does not focus a run stopped while its request is waiting in the shared queue',async()=>{const f=await fixture();let grant!:(v:any)=>void;native.request.mockImplementationOnce(()=>new Promise(r=>grant=r));const pending=f.ask(f.acquire);await vi.waitFor(()=>expect(grant).toBeTypeOf('function'));f.data['run:7'].status='idle';grant({token:'lease'});expect(await pending).toMatchObject({ok:false});expect(f.update).not.toHaveBeenCalled();expect(native.request).toHaveBeenCalledWith('ATTENTION_RELEASE',expect.anything(),{token:'lease'});});
it('a fresh document releases its predecessor’s lease before claiming the run',async()=>{const f=await fixture();await f.ask(f.acquire);expect(await f.ask({type:'CLAIM_DOCUMENT',epoch:'new'})).toMatchObject({ok:true,run:{contentEpoch:'new'}});expect(native.request).toHaveBeenCalledWith('ATTENTION_RELEASE',expect.anything(),{token:'lease'});});
it('keeps rendering enabled through trusted input, then resets and detaches on release',async()=>{
 const f=await fixture();const attach=vi.fn(async()=>{}),detach=vi.fn(async()=>{}),sendCommand=vi.fn(async()=>{});Object.assign(chrome,{debugger:{attach,detach,sendCommand}});
 await f.ask(f.acquire);expect(sendCommand).toHaveBeenCalledWith({tabId:7},'Emulation.setFocusEmulationEnabled',{enabled:true});
 expect(await f.ask({type:'TRUSTED_CLICK',x:10,y:10,runId:'run',epoch:'document'})).toMatchObject({dispatched:true});expect(attach).toHaveBeenCalledOnce();expect(detach).not.toHaveBeenCalled();
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
it('acknowledges renderer release without waiting for a hung layout response',async()=>{
 const f=await fixture();let resolve!:(v:any)=>void;
 const detach=vi.fn(async()=>{}),sendCommand=vi.fn(async(_t:any,method:string)=>method==='Page.getLayoutMetrics'?await new Promise(r=>resolve=r):{});
 Object.assign(chrome,{debugger:{attach:vi.fn(async()=>{}),detach,sendCommand}});
 native.request.mockImplementation(async(kind:string)=>kind==='ATTENTION_ACQUIRE'?{token:'lease',mode:'background'}:{renewed:true});
 const acquired=f.ask(f.acquire);await vi.waitFor(()=>expect(resolve).toBeTypeOf('function'));
 await f.ask({type:'PAGE_ATTENTION_RELEASE',token:'lease'});expect(detach).toHaveBeenCalledOnce();
 resolve({cssLayoutViewport:{clientWidth:0,clientHeight:0}});expect(await acquired).toMatchObject({ok:false});
 expect(f.update).not.toHaveBeenCalledWith(1,{focused:true});
});
it('allows a fresh renderer request after releasing a hung acquisition',async()=>{
 const f=await fixture();let resolve!:(v:any)=>void,reads=0,leases=0;
 const sendCommand=vi.fn(async(_t:any,method:string)=>method==='Page.getLayoutMetrics'&&++reads===1?await new Promise(r=>resolve=r):{});
 Object.assign(chrome,{debugger:{attach:vi.fn(async()=>{}),detach:vi.fn(async()=>{}),sendCommand}});
 native.request.mockImplementation(async(kind:string)=>kind==='ATTENTION_ACQUIRE'?{token:'lease-'+(++leases),mode:'background'}:{renewed:true});
 const old=f.ask(f.acquire);await vi.waitFor(()=>expect(resolve).toBeTypeOf('function'));
 await f.ask({type:'PAGE_ATTENTION_RELEASE',token:'lease-1'});
 expect(await f.ask(f.acquire)).toMatchObject({ok:true,token:'lease-2'});
 resolve({cssLayoutViewport:{clientWidth:0,clientHeight:0}});expect(await old).toMatchObject({ok:false});
 await f.ask({type:'PAGE_ATTENTION_RELEASE',token:'lease-2'});
});
it.each([false,true])('Start restores the window and waits for an occluded account header (occluded=%s)',async occluded=>{const f=await fixture();f.data['run:7'].status='idle';f.data.managedRun.status='idle';f.data.profile={values:{},customFields:[],attachments:{},mappings:{}};f.data.profileRevision=1;vi.mocked(chrome.tabs.get).mockResolvedValue({id:7,windowId:1,url:f.sender.url,status:'complete'} as any);Object.assign(chrome.windows,{getLastFocused:vi.fn(async()=>({id:1,state:'minimized'}))});Object.assign(chrome.tabs,{create:vi.fn(async()=>({id:7,windowId:1})),sendMessage:vi.fn(async(_id,m:any)=>m.type==='PAGE_ACCOUNT'&&!occluded?{email:'fixture@example.test'}:{ok:true})});native.request.mockImplementation(async(kind:string)=>{if(kind==='ATTENTION_FOCUSED'){occluded=false;return {focused:true};}return {token:'lease'};});const result=await adapter.start({type:'COMMAND',protocol:1,sessionId:'session',commandId:'command',runId:'new-run',kind:'START',payload:{url:f.sender.url,mode:'test',revision:1,expectedEmail:'fixture@example.test'}},'session');expect(result.status).toBe('running');expect(chrome.windows.getLastFocused).toHaveBeenCalledWith({windowTypes:['normal']});expect(f.update).toHaveBeenCalledWith(1,{state:'normal',focused:false});expect(f.update.mock.invocationCallOrder[0]).toBeLessThan(vi.mocked(chrome.tabs.create).mock.invocationCallOrder[0]);});

it('rejects trusted input from a stale document or a stopped run before touching Chrome',async()=>{
 const f=await fixture(),sendCommand=vi.fn(async()=>{});Object.assign(chrome,{debugger:{attach:vi.fn(async()=>{}),detach:vi.fn(async()=>{}),sendCommand}});
 expect(await f.ask({type:'TRUSTED_CLICK',x:10,y:10,runId:'run',epoch:'old'})).toMatchObject({dispatched:false});
 f.data['run:7'].status='idle';expect(await f.ask({type:'TRUSTED_KEYS',keys:['Enter'],runId:'run',epoch:'document'})).toMatchObject({dispatched:false});
 expect(sendCommand).not.toHaveBeenCalled();
});
it('releases a pending mouse press outside the control if Stop arrives before mouse-up',async()=>{
 const f=await fixture(),sendCommand=vi.fn(async(_target:any,method:string,params:any)=>{if(method==='Input.dispatchMouseEvent'&&params.type==='mousePressed')f.data['run:7'].status='idle';});
 Object.assign(chrome,{debugger:{attach:vi.fn(async()=>{}),detach:vi.fn(async()=>{}),sendCommand}});
 await f.ask({type:'TRUSTED_CLICK',x:10,y:10,runId:'run',epoch:'document'});
 expect(sendCommand).toHaveBeenCalledWith({tabId:7},'Input.dispatchMouseEvent',expect.objectContaining({type:'mouseReleased',x:-1,y:-1}));
});
it('waits for the old remote release before granting the next document lease',async()=>{
 const f=await fixture();await f.ask(f.acquire);let release!:()=>void;
 native.request.mockImplementation(async(kind:string)=>{if(kind==='ATTENTION_RELEASE')await new Promise<void>(r=>release=r);return kind==='ATTENTION_ACQUIRE'?{token:'next',mode:'background'}:{renewed:true};});
 const dropping=f.ask({type:'PAGE_ATTENTION_RELEASE',token:'lease'});await vi.waitFor(()=>expect(release).toBeTypeOf('function'));
 f.data['run:7'].contentEpoch='next-document';const next=f.ask({...f.acquire,epoch:'next-document'});
 await new Promise(r=>setTimeout(r,10));expect(native.request.mock.calls.filter((c:any)=>c[0]==='ATTENTION_ACQUIRE')).toHaveLength(1);
 release();await dropping;expect(await next).toMatchObject({ok:true,token:'next'});
 native.request.mockResolvedValue({});await f.ask({type:'PAGE_ATTENTION_RELEASE',token:'next'});
});
it('coalesces simultaneous acquires until renderer setup finishes',async()=>{
 const f=await fixture();let grant!:(v:any)=>void;native.request.mockImplementationOnce(()=>new Promise(r=>grant=r));
 const first=f.ask(f.acquire),second=f.ask(f.acquire);await vi.waitFor(()=>expect(grant).toBeTypeOf('function'));
 expect(native.request.mock.calls.filter((c:any)=>c[0]==='ATTENTION_ACQUIRE')).toHaveLength(1);
 grant({token:'lease',mode:'background'});expect(await first).toMatchObject({ok:true});expect(await second).toMatchObject({ok:true});
});
it('Stop while a predecessor is releasing prevents the queued acquire from touching Chrome',async()=>{
 const f=await fixture();await f.ask(f.acquire);let release!:()=>void;
 native.request.mockImplementation(async(kind:string)=>{if(kind==='ATTENTION_RELEASE')await new Promise<void>(r=>release=r);return {token:'next',mode:'background'};});
 const dropping=f.ask({type:'PAGE_ATTENTION_RELEASE',token:'lease'});await vi.waitFor(()=>expect(release).toBeTypeOf('function'));
 const next=f.ask(f.acquire);await new Promise(r=>setTimeout(r,0));f.data['run:7'].status='idle';release();await dropping;
 expect(await next).toMatchObject({ok:false,error:expect.stringContaining('dừng')});expect(native.request.mock.calls.filter((c:any)=>c[0]==='ATTENTION_ACQUIRE')).toHaveLength(1);
});

it('Start navigates the prepared owned tab instead of creating a new one',async()=>{
 const f=await fixture();f.data['run:7'].status='idle';f.data.managedRun.status='idle';f.data.profile={values:{},customFields:[],attachments:{},mappings:{}};f.data.profileRevision=1;
 let destination='ready.html';Object.assign(chrome.tabs,{create:vi.fn(async()=>({id:17,windowId:1,url:'ready.html'})),get:vi.fn(async(id:number)=>({id,windowId:1,url:id===17?destination:f.sender.url,status:'complete'})),update:vi.fn(async(id:number,options:any)=>{if(options.url)destination=options.url;return {id,windowId:1,url:destination};}),sendMessage:vi.fn(async(_id,m:any)=>m.type==='PAGE_ACCOUNT'?{email:'fixture@example.test'}:{ok:true})});
 await adapter.control({kind:'PREPARE_FORM',payload:{}});expect(f.data.preparedFormTab).toBe(17);
 const result=await adapter.start({runId:'prepared-run',payload:{url:f.sender.url,mode:'test',revision:1,expectedEmail:'fixture@example.test'}},'session');
 expect(result.tabId).toBe(17);expect(chrome.tabs.create).toHaveBeenCalledTimes(1);expect(chrome.tabs.update).toHaveBeenCalledWith(17,{url:f.sender.url,active:true});expect(f.data.preparedFormTab).toBeUndefined();
});

it('reads the verification from a running form without focusing, pausing or acquiring its renderer',async()=>{
 const f=await fixture();vi.mocked(chrome.tabs.sendMessage).mockResolvedValue({questions:[{id:'verification',label:'Câu xác thực?',verification:true}]} as any);
 const result=await adapter.control({kind:'SCAN_FORM',runId:'run',payload:{verificationOnly:true}});
 expect(result).toMatchObject({formId:'attention-fixture',runId:'run',questions:[{verification:true}]});
 expect(chrome.tabs.update).not.toHaveBeenCalled();expect(f.update).not.toHaveBeenCalled();expect(native.request).not.toHaveBeenCalled();
 expect(f.data.managedRun.status).toBe('running');
 await expect(adapter.control({kind:'SCAN_FORM',runId:'stale',payload:{verificationOnly:true}})).rejects.toThrow('Lượt đã thay đổi');
});
