// @vitest-environment jsdom
import {readFileSync} from 'node:fs';
import {afterEach,expect,it,vi} from 'vitest';
import {emptyProfile} from '../src/rules';
import {DirectExecutor} from '../src/google-direct/executor';
import {DIRECT_LAB_FORM_ID,DIRECT_LAB_URL} from '../src/google-direct/schema';
import {readExecutionPage,postExecutionPage,inspectExecutionUpload,type ExecutionPage,type PagePost} from '../src/google-direct/execute-page';
import {DirectPageDialogs} from '../src/google-direct/dialogs';

const script = `var FB_PUBLIC_LOAD_DATA_ = ${readFileSync('tests/fixtures/google-direct-lab.json','utf8')};`;
afterEach(()=>{vi.useRealTimers();vi.unstubAllGlobals();vi.restoreAllMocks();document.body.replaceChildren();delete document.documentElement.dataset.hanuDirectDocument;delete document.documentElement.dataset.hanuDirectPost;});
function profile(){const p=emptyProfile();p.values={...p.values,fullName:'NGHIEN CUU LAB',identityType:'CCCD',identityNumber:'000000000000',gender:'Nam',birthDate:'2000-01-01',nationality:'Việt Nam',motherTongue:'Tiếng Việt',email:'hanu.lab.request@gmail.com',phone:'0000000000',chineseStudyDuration:'1 năm',paymentMethod:'E-BANKING',bankAccountNumber:'0',bankAccountHolder:'NGHIEN CUU LAB',bankName:'BIDV',firstCommitment:'true',termsCommitment:'true'};return p;}
function fixture(options:{uncertain?:boolean;lease?:boolean;accountChanged?:boolean;priorPending?:boolean;validationReturn?:boolean}={}){
  let index=0,submitted=false;
  const posts:PagePost[]=[],data:Record<string,any>={executionLease:{active:!!options.lease},submissionLocks:{}};
  const key=`googleDirectSubmit:${DIRECT_LAB_FORM_ID}:fixture@example.test`;
  if(options.priorPending)data[key]={status:'pending',runId:'prior'};
  const history=[0,1,2,3,5,6,7,8];
  const pages:ExecutionPage[]=history.map((n,i)=>({url:DIRECT_LAB_URL,documentKey:`doc-${i}`,script,history:history.slice(0,i+1),account:options.accountChanged&&i>0?'other@example.test':'fixture@example.test',hasForm:true,hasNext:i<history.length-1,hasSubmit:i===history.length-1,text:'Fixture form',blocked:false}));
  const confirmation:ExecutionPage={...pages[0],documentKey:'confirmed',script:undefined,history:[],account:'',hasForm:false,hasNext:false,hasSubmit:false,text:options.uncertain?'Thank you':'Câu trả lời của bạn đã được ghi lại'};
  const executeScript=vi.fn(async({func,args}:any)=>{
    if(func===readExecutionPage)return [{result:submitted?confirmation:pages[index]??confirmation}];
    if(func===inspectExecutionUpload)return [{result:{state:'ready'}}];
    if(func===postExecutionPage){posts.push(args[0]);if(args[0].final){submitted=true;return [{result:{scheduled:true,finalResult:{status:200,received:!options.uncertain,message:options.uncertain?'Chưa nhận được xác nhận.':'Google xác nhận đã ghi lại phản hồi.'}}}];}else if(options.validationReturn&&index===2)pages[index]={...pages[index],documentKey:'validation-return'};else index++;return [{result:{scheduled:true}}];}
    throw new Error('Unexpected injection');
  });
  vi.stubGlobal('chrome',{scripting:{executeScript},storage:{local:{get:vi.fn(async(keys:any)=>keys===null?{...data}:typeof keys==='string'?{[keys]:data[keys]}:Object.fromEntries(keys.map((k:string)=>[k,data[k]]))),set:vi.fn(async(values:any)=>Object.assign(data,values))}}});
  Object.defineProperty(navigator,'locks',{configurable:true,value:{request:async(_name:any,options:any,callback:any)=>(callback??options)({name:'fixture-lock'})}});
  const run=()=>new DirectExecutor().run({tabId:42,profile:profile(),overrides:{'982814777':'2026'},expectedScript:script,file:{name:'fixture.png',type:'image/png',blob:new Blob(['fixture'])},signal:new AbortController().signal,onProgress:vi.fn()});
  return {posts,data,key,run,executeScript};
}
it('automatically posts the CCCD route, checks Google upload, locks before final POST and verifies acknowledgement',async()=>{
  vi.useFakeTimers();const f=fixture();const promise=f.run();await vi.runAllTimersAsync();
  expect(await promise).toMatchObject({status:'received',postCount:5});
  expect(f.posts.map(p=>p.final)).toEqual([false,false,false,false,true]);
  expect(f.posts.at(-1)!.entries).toContainEqual(['entry.78959346','000000000000']);
  expect(f.posts.at(-1)!.entries).toContainEqual(['entry.260703157','']); // clear optional saved draft
  expect(f.posts.at(-1)!.entries.some(e=>e[0]==='entry.1511537540')).toBe(false);
  expect(f.posts.at(-1)!.uploadEntries).toEqual(['1365092776']);
  expect(f.posts.at(-1)!.history).toEqual([0,1,2,3,5,6,7,8]);
  expect(f.data[f.key].status).toBe('received');
});
it('keeps a durable uncertain lock when the result is not a positive response acknowledgement',async()=>{
  vi.useFakeTimers();const f=fixture({uncertain:true});const promise=f.run();await vi.runAllTimersAsync();
  expect(await promise).toMatchObject({status:'uncertain'});expect(f.data[f.key].status).toBe('pending');
  const count=f.posts.length,second=f.run();await vi.runAllTimersAsync();expect(await second).toMatchObject({status:'failed'});expect(f.posts).toHaveLength(count);
});
it.each([{lease:true},{priorPending:true}])('does not dispatch when the legacy engine or an unresolved Direct lock owns the form: %j',async options=>{
  const f=fixture(options);expect(await f.run()).toMatchObject({status:'failed',postCount:0});expect(f.posts).toHaveLength(0);
});
it('stops before another request if Google account changes after navigation',async()=>{
  vi.useFakeTimers();const f=fixture({accountChanged:true});const promise=f.run();await vi.runAllTimersAsync();
  expect(await promise).toMatchObject({status:'failed',postCount:1,message:expect.stringContaining('Tài khoản Google')});
});
it('does not post twice when Google returns the same page with validation errors',async()=>{
  vi.useFakeTimers();const f=fixture({validationReturn:true});const promise=f.run();await vi.runAllTimersAsync();
  expect(await promise).toMatchObject({status:'failed',postCount:3,message:expect.stringContaining('trả lại trang')});
});
it('uses a fresh foreground tab for every explicitly started run',async()=>{
  vi.useFakeTimers();const f=fixture();
  const create=vi.fn(async()=>({id:99,windowId:7})),update=vi.fn(async()=>({id:99,windowId:7}));
  Object.assign(chrome,{tabs:{create,update},windows:{update:vi.fn(async()=>({id:7}))}});
  const promise=f.run();await vi.runAllTimersAsync();expect(await promise).toMatchObject({status:'received'});
  expect(create).toHaveBeenCalledWith({url:DIRECT_LAB_URL,active:true});
  expect(update).toHaveBeenCalledWith(99,{active:true});
  expect(f.executeScript.mock.calls.every(([request])=>request.target.tabId===99)).toBe(true);
});
function form(){
  vi.stubGlobal('location',new URL(DIRECT_LAB_URL));
  document.body.innerHTML=`<form action="${DIRECT_LAB_URL.replace('viewform','formResponse')}">fixture@example.test<input type="hidden" name="fbzx" value="session-only"><input type="hidden" name="partialResponse" value=""><input type="hidden" name="pageHistory" value="0"></form>`;
  document.documentElement.dataset.hanuDirectDocument='current';
  return {formId:DIRECT_LAB_FORM_ID,documentKey:'current',account:'fixture@example.test',requestId:'req-1',final:false,entries:[['entry.2075638650','NGHIEN CUU LAB']],sentinels:['816025126'],uploadEntries:[]} as PagePost;
}
it('builds a real form POST using current session fields and marks the document before dispatch',async()=>{
  vi.useFakeTimers();const submit=vi.spyOn(HTMLFormElement.prototype,'submit').mockImplementation(()=>{});const request=form();
  expect(await postExecutionPage(request)).toEqual({scheduled:true});
  const created=document.querySelectorAll('form')[1],body=new FormData(created);
  expect(created.target).toBe('_self');
  expect(body.get('fbzx')).toBe('session-only');expect(body.get('entry.2075638650')).toBe('NGHIEN CUU LAB');expect(body.get('continue')).toBe('1');expect(body.get('emailAddress')).toBe('fixture@example.test');
  await expect(postExecutionPage(request)).rejects.toThrow('không gửi lặp');
  await vi.runAllTimersAsync();expect(submit).toHaveBeenCalledOnce();
});
it('overrides stale draft text without modifying uploaded-file references or session slots',async()=>{
  vi.useFakeTimers();const request={...form(),final:true};let posted='';
  vi.stubGlobal('fetch',vi.fn(async(_url,options)=>{posted=String(options.body);return {status:200,ok:true,text:async()=>'<html><body>Your response has been recorded</body></html>'};}));
  const original=document.querySelector('form')!,dlut=document.createElement('input');dlut.name='dlut';dlut.value='old-draft-timestamp';original.append(dlut);
  document.querySelector<HTMLInputElement>('input[name="partialResponse"]')!.value=JSON.stringify([[[null,2075638650,['OLD DRAFT'],0],[null,1365092776,null,0,[[['GOOGLE_FILE_ID','fixture.png','image/png']]]]],null,'session-only']);
  await postExecutionPage(request);const body=new URLSearchParams(posted);
  const partial=JSON.parse(String(body.get('partialResponse')));
  expect(partial[0]).toContainEqual([null,2075638650,['NGHIEN CUU LAB'],0]);
  expect(partial[0]).toContainEqual([null,1365092776,null,0,[[['GOOGLE_FILE_ID','fixture.png','image/png']]]]);
  expect(partial[2]).toBe('session-only');expect(body.get('dlut')).toBe('old-draft-timestamp');
  await vi.runAllTimersAsync();
});
it('handles only the current run/tab beforeunload dialog and cancels it after Stop',async()=>{
  let listener:any;
  const sendCommand=vi.fn(async()=>{}),removeListener=vi.fn(),detach=vi.fn(async()=>{});
  vi.stubGlobal('chrome',{debugger:{attach:vi.fn(async()=>{}),detach,sendCommand,onEvent:{addListener:vi.fn(fn=>listener=fn),removeListener}}});
  const controller=new AbortController(),dialogs=new DirectPageDialogs(42,controller.signal);await dialogs.connect();sendCommand.mockClear();
  listener({tabId:42},'Page.javascriptDialogOpening',{type:'beforeunload'});expect(sendCommand).not.toHaveBeenCalled();
  dialogs.posting(true);
  listener({tabId:43},'Page.javascriptDialogOpening',{type:'beforeunload'});
  listener({tabId:42},'Page.javascriptDialogOpening',{type:'alert'});expect(sendCommand).not.toHaveBeenCalled();
  listener({tabId:42},'Page.javascriptDialogOpening',{type:'beforeunload'});
  expect(sendCommand).toHaveBeenLastCalledWith({tabId:42},'Page.handleJavaScriptDialog',{accept:true});
  controller.abort();listener({tabId:42},'Page.javascriptDialogOpening',{type:'beforeunload'});
  expect(sendCommand).toHaveBeenLastCalledWith({tabId:42},'Page.handleJavaScriptDialog',{accept:false});
  await dialogs.close();expect(removeListener).toHaveBeenCalledWith(listener);expect(detach).toHaveBeenCalledWith({tabId:42});
});
it('rejects final submission without a Google file reference and preserves a genuine serialized reference',async()=>{
  vi.useFakeTimers();let posted='';const fetch=vi.fn(async(_url,options)=>{posted=String(options.body);return {status:200,ok:true,text:async()=>'<html><body>Câu trả lời của bạn đã được ghi lại</body></html>'};});vi.stubGlobal('fetch',fetch);
  const request={...form(),final:true,uploadEntries:['1365092776']};
  await expect(postExecutionPage(request)).rejects.toThrow('reference');expect(fetch).not.toHaveBeenCalled();
  const partial=JSON.stringify([[[null,1365092776,null,0,[[['GOOGLE_FILE_ID','fixture.png','image/png']]]]],null,'session-only']);
  document.querySelector<HTMLInputElement>('input[name="partialResponse"]')!.value=partial;
  expect(await postExecutionPage(request)).toMatchObject({finalResult:{status:200,received:true}});const body=new URLSearchParams(posted);
  expect(JSON.parse(String(body.get('partialResponse')))[0]).toContainEqual([null,1365092776,null,0,[[['GOOGLE_FILE_ID','fixture.png','image/png']]]]);expect(body.has('continue')).toBe(false);
  await vi.runAllTimersAsync();expect(fetch).toHaveBeenCalledOnce();
});
it('commits the current Google upload JSON to the observed file-answer slot before a direct final POST',async()=>{
  const request={...form(),final:true,uploadEntries:['1365092776'],history:[0,1,2,3,5,6,7,8]};
  const files=[[['GOOGLE_FILE_ID','fixture.png','image/png']]];
  const input=document.createElement('input');input.name='entry.1365092776';input.value=JSON.stringify(files);document.querySelector('form')!.append(input);
  document.querySelector<HTMLInputElement>('input[name="partialResponse"]')!.value=JSON.stringify([[[null,78959346,['000000000000'],0]],null,'session-only',null,null,null,'draft-state',123]);
  let posted='';vi.stubGlobal('fetch',vi.fn(async(_url,options)=>{posted=String(options.body);return {status:200,ok:true,text:async()=>'<html><body>Your response has been recorded</body></html>'};}));
  expect(await postExecutionPage(request)).toMatchObject({finalResult:{received:true}});
  const body=new URLSearchParams(posted),partial=JSON.parse(String(body.get('partialResponse')));
  expect(partial[0]).toContainEqual([null,1365092776,null,0,files]);expect(partial[6]).toBe('draft-state');expect(partial[7]).toBe(123);
  expect(body.get('pageHistory')).toBe('0,1,2,3,5,6,7,8');
});
it('does not classify a HTTP 200 returned form as a received response',async()=>{
  const request={...form(),final:true};
  vi.stubGlobal('fetch',vi.fn(async()=>({status:200,ok:true,text:async()=>'<html><body><form action="/formResponse">Your response has been recorded<input value="secret"></form></body></html>'})));
  expect(await postExecutionPage(request)).toMatchObject({finalResult:{received:false}});
});
it('releases only an explicitly reconciled pending run, retaining its audit metadata',async()=>{
  const f=fixture({priorPending:true});await new DirectExecutor().resolveNotReceived('prior');expect(f.data[f.key]).toMatchObject({runId:'prior',status:'not_received'});
  await expect(new DirectExecutor().resolveNotReceived('other')).rejects.toThrow('Không còn đúng khóa');
});
