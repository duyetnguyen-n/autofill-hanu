import {afterEach,it,expect,vi} from 'vitest';
import type {RunState} from '../src/shared';

let adapter:{focus:()=>Promise<any>};
vi.mock('../src/native-client',()=>({createNativeClient:(a:typeof adapter)=>{adapter=a;return {boot:vi.fn(),state:vi.fn(),isConnected:()=>true};}}));
afterEach(()=>{vi.unstubAllGlobals();vi.resetModules();});
const url='https://docs.google.com/forms/d/e/focus-fixture/viewform';
async function setup(status:RunState['status']='idle'){
 const run:RunState={runId:'run',sessionId:'session',managed:true,tabId:7,formId:'focus-fixture',url,mode:'test',status,filled:[],skipped:[],logs:[],submitAttempted:false,updatedAt:''};
 const data:Record<string,any>={managedRun:run,'run:7':run};let removed:(id:number)=>void;
 const tabs:any[]=[{id:7,windowId:1,url}],windows=new Map<number,any>([[1,{id:1,state:'minimized'}]]);
 const query=vi.fn(async({url:pattern}:any={})=>tabs.filter(t=>!pattern||(pattern.endsWith('*')?t.url.startsWith('https://docs.google.com/forms/'):t.url===pattern)));
 const create=vi.fn(async(options:any)=>{const id=windows.size+1;windows.set(id,{id,state:'normal'});tabs.push({id:100+id,windowId:id,url:options.url});return {id};});
 const update=vi.fn(async(id:number,options:any)=>{Object.assign(windows.get(id),options);return windows.get(id);});
 const tabCreate=vi.fn(async(options:any)=>{const tab={id:99,windowId:1,url:options.url};tabs.push(tab);return tab;});
 vi.stubGlobal('chrome',{runtime:{getURL:(p:string)=>`chrome-extension://test/${p}`,onMessage:{addListener:vi.fn()},sendMessage:vi.fn(async()=>({}))},action:{onClicked:{addListener:vi.fn()}},windows:{create,update,get:vi.fn(async(id:number)=>windows.get(id))},tabs:{query,create:tabCreate,get:vi.fn(async(id:number)=>{const tab=tabs.find(t=>t.id===id);if(!tab)throw new Error('closed');return tab;}),update:vi.fn(async(id:number,options:any)=>Object.assign(tabs.find(t=>t.id===id),options)),sendMessage:vi.fn(async()=>({})),onUpdated:{addListener:vi.fn()},onRemoved:{addListener:(fn:typeof removed)=>removed=fn}},storage:{local:{get:vi.fn(async(key:string)=>({[key]:structuredClone(data[key])})),set:vi.fn(async(value:any)=>Object.assign(data,structuredClone(value)))}}});
 await import('../src/background');return {data,tabs,create,update,tabCreate,removed:(id:number)=>removed(id)};
}
it('focuses only the form without opening the extension on repeated clicks',async()=>{
 const f=await setup();expect(await adapter.focus()).toMatchObject({tabId:7});
 expect(chrome.tabs.update).toHaveBeenCalledWith(7,{active:true});expect(f.update).toHaveBeenCalledWith(1,{state:'normal'});expect(f.update).toHaveBeenCalledWith(1,{focused:true});
 expect(f.create).not.toHaveBeenCalled();
 await adapter.focus();expect(f.create).not.toHaveBeenCalled();
});
it('finds a form already reopened by the user when the old run tab was closed',async()=>{
 const f=await setup();f.tabs.splice(0,1,{id:8,windowId:1,url:url.replace('/viewform','/formResponse')});expect(await adapter.focus()).toMatchObject({tabId:8});expect(f.tabCreate).not.toHaveBeenCalled();
});
it('does not open a controller even when an old controller is already present',async()=>{
 const f=await setup();f.tabs.push({id:105,windowId:1,url:'chrome-extension://test/sidepanel.html?tabId=7'});
 await Promise.all([adapter.focus(),adapter.focus()]);expect(f.create).not.toHaveBeenCalled();
});
it('does not open a controller on simultaneous focus requests',async()=>{
 const f=await setup();await Promise.all([adapter.focus(),adapter.focus()]);expect(f.create).not.toHaveBeenCalled();
});
it('opens the last form without starting autofill when its tab was closed',async()=>{
 const f=await setup();f.tabs.length=0;expect(await adapter.focus()).toMatchObject({tabId:99});expect(f.tabCreate).toHaveBeenCalledWith({url,active:true});expect(chrome.tabs.sendMessage).not.toHaveBeenCalled();expect(f.data.managedRun.status).toBe('idle');
});
it('rechecks an existing reserved response read-only when opening it after an extension update',async()=>{
 const f=await setup('submit_uncertain');f.data.managedRun.submitAttempted=true;f.data['run:7'].submitAttempted=true;
 f.tabs[0].url=url.replace('/viewform','/formResponse');
 await adapter.focus();
 expect(chrome.tabs.sendMessage).toHaveBeenCalledWith(7,{type:'PAGE_HEALTH'});
 expect(chrome.tabs.update).toHaveBeenCalledWith(7,{active:true});
 expect(vi.mocked(chrome.tabs.update).mock.calls.every(([,options])=>!options.url)).toBe(true);
 expect(f.data.managedRun.submitAttempted).toBe(true);
});
it.each(['idle','completed','ready_to_submit'] as const)('closing a %s form preserves its terminal state and released lease',async status=>{
 const f=await setup(status);f.removed(7);await vi.waitFor(()=>expect(chrome.storage.local.get).toHaveBeenCalledWith('run:7'));expect(f.data.managedRun.status).toBe(status);expect(chrome.storage.local.set).not.toHaveBeenCalled();
});
