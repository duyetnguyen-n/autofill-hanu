// @vitest-environment jsdom
import {readFileSync} from 'node:fs';
import {afterEach,expect,it,vi} from 'vitest';
import {emptyProfile} from '../src/rules';
import {DirectExecutor} from '../src/google-direct/executor';
import {DIRECT_LAB_FORM_ID,DIRECT_LAB_URL} from '../src/google-direct/schema';
import {readExecutionPage,postExecutionPage,inspectExecutionUpload,beginExecutionSession,cancelExecutionPage,resetExecutionPage,prepareUploadAnswer,type ExecutionPage,type PagePost} from '../src/google-direct/execute-page';
import {DirectPageDialogs} from '../src/google-direct/dialogs';
import {armDirectManualSubmit,prepareDirectNativeSubmit,directManualReady} from '../src/google-direct/recovery-page';

const script = `var FB_PUBLIC_LOAD_DATA_ = ${readFileSync('tests/fixtures/google-direct-lab.json','utf8')};`;
afterEach(()=>{vi.useRealTimers();vi.unstubAllGlobals();vi.restoreAllMocks();document.body.replaceChildren();delete document.documentElement.dataset.hanuDirectDocument;delete document.documentElement.dataset.hanuDirectPost;delete document.documentElement.dataset.hanuDirectStopped;sessionStorage.clear();});
function profile(){const p=emptyProfile();p.values={...p.values,fullName:'NGHIEN CUU LAB',identityType:'CCCD',identityNumber:'000000000000',gender:'Nam',birthDate:'2000-01-01',nationality:'Việt Nam',motherTongue:'Tiếng Việt',email:'hanu.lab.request@gmail.com',phone:'0000000000',chineseStudyDuration:'1 năm',paymentMethod:'E-BANKING',bankAccountNumber:'0',bankAccountHolder:'NGHIEN CUU LAB',bankName:'BIDV',firstCommitment:'true',termsCommitment:'true'};return p;}
function fixture(options:{uncertain?:boolean;lease?:boolean;accountChanged?:boolean;priorPending?:boolean;validationReturn?:boolean;clientValidation?:boolean;finalPage?:boolean}={}){
  let index=options.finalPage?7:0,submitted=false;
  const posts:PagePost[]=[],data:Record<string,any>={executionLease:{active:!!options.lease},submissionLocks:{}};
  const key=`googleDirectSubmit:${DIRECT_LAB_FORM_ID}:fixture@example.test`;
  if(options.priorPending)data[key]={status:'pending',runId:'prior'};
  const history=[0,1,2,3,5,6,7,8];
  const pages:ExecutionPage[]=history.map((n,i)=>({url:DIRECT_LAB_URL,documentKey:`doc-${i}`,script,history:history.slice(0,i+1),account:options.accountChanged&&i>0?'other@example.test':'fixture@example.test',hasForm:true,hasNext:i<history.length-1,hasSubmit:i===history.length-1,text:'Fixture form',blocked:false}));
  const confirmation:ExecutionPage={...pages[0],documentKey:'confirmed',script:undefined,history:[],account:'',hasForm:false,hasNext:false,hasSubmit:false,text:options.uncertain?'Thank you':'Câu trả lời của bạn đã được ghi lại'};
  const executeScript=vi.fn(async({func,args}:any):Promise<any>=>{
    if(func===readExecutionPage)return [{result:submitted?confirmation:pages[index]??confirmation}];
    if(func===armDirectManualSubmit)return [{result:undefined}];
    if(func===directManualReady)return [{result:true}];
    if(func===prepareDirectNativeSubmit)return [{result:{ready:!options.clientValidation,message:'Google: sai dữ liệu'}}];
    if(func===prepareUploadAnswer)return [{result:{done:true}}];
    if(func===resetExecutionPage)return [{result:undefined}];
    if(func===beginExecutionSession){index++;return [{result:true}];}
    if(func===inspectExecutionUpload)return [{result:{state:'ready'}}];
    if(func===postExecutionPage){if(args[0].validateOnly)return [{result:{scheduled:true}}];posts.push(args[0]);if(args[0].final){submitted=true;return [{result:{scheduled:true,finalResult:{status:200,received:!options.uncertain,message:options.uncertain?'Chưa nhận được xác nhận.':'Google xác nhận đã ghi lại phản hồi.'}}}];}else if(options.validationReturn&&index===2)pages[index]={...pages[index],documentKey:'validation-return'};else index++;return [{result:{scheduled:true}}];}
    throw new Error('Unexpected injection');
  });
  vi.stubGlobal('chrome',{scripting:{executeScript},storage:{local:{get:vi.fn(async(keys:any)=>keys===null?{...data}:typeof keys==='string'?{[keys]:data[keys]}:Object.fromEntries(keys.map((k:string)=>[k,data[k]]))),set:vi.fn(async(values:any)=>Object.assign(data,values))}}});
  Object.defineProperty(navigator,'locks',{configurable:true,value:{request:async(_name:any,options:any,callback:any)=>(callback??options)({name:'fixture-lock'})}});
  const run=()=>new DirectExecutor().run({tabId:42,profile:profile(),overrides:{'982814777':'2026'},expectedScript:script,file:{name:'fixture.png',type:'image/png',blob:new Blob(['fixture'])},signal:new AbortController().signal,onProgress:vi.fn()});
  return {posts,data,key,run,executeScript};
}
it('automatically posts the CCCD route, checks Google upload, locks before final POST and verifies acknowledgement',async()=>{
  vi.useFakeTimers();const f=fixture();const promise=f.run();await vi.runAllTimersAsync();
  expect(await promise).toMatchObject({status:'received',postCount:4});
  expect(f.posts.map(p=>p.final)).toEqual([false,false,false,true]);
  expect(f.posts.find(p=>p.entries.some(e=>e[0]==='entry.78959346'))!.entries).toContainEqual(['entry.78959346','000000000000']);
  expect(f.posts.find(p=>p.entries.some(e=>e[0]==='entry.260703157'))!.entries).toContainEqual(['entry.260703157','']); // clear optional saved draft
  expect(f.posts.at(-1)!.entries.some(e=>e[0]==='entry.1511537540')).toBe(false);
  expect(f.posts.at(-1)!.uploadEntries).toEqual(['1365092776']);
  expect(f.posts.at(-1)!.history).toEqual([0,1,2,3,5,6,7,8]);
  expect(f.data[f.key].status).toBe('received');
  expect(f.posts.every(p=>!p.http)).toBe(true);expect(f.posts.at(-1)).toMatchObject({native:true,manualReady:true});
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
  expect(await promise).toMatchObject({status:'failed',postCount:0,message:expect.stringContaining('Tài khoản Google')});
});
it('does not post twice when Google returns the same page with validation errors',async()=>{
  vi.useFakeTimers();const f=fixture({validationReturn:true});const promise=f.run();await vi.runAllTimersAsync();
  expect(await promise).toMatchObject({status:'failed',postCount:2,message:expect.stringContaining('trả lại trang')});
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
it('waits for a menu commit after several asynchronous open/key actions instead of failing immediately after the last action',async()=>{
  vi.useFakeTimers();const f=fixture();const original=f.executeScript.getMockImplementation()!;let actions=0;
  f.executeScript.mockImplementation(async request=>request.func===prepareUploadAnswer&&++actions<=6?[{result:{keys:['Home','ArrowDown','Enter']}}]:original(request));
  const keys=vi.spyOn(DirectPageDialogs.prototype,'keys').mockResolvedValue();
  const running=f.run();await vi.runAllTimersAsync();expect(await running).toMatchObject({status:'received'});expect(keys).toHaveBeenCalledTimes(6);
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
  expect(partial[0]).toContainEqual([null,2075638650,['OLD DRAFT'],0]);
  expect(body.get('entry.2075638650')).toBe('NGHIEN CUU LAB');
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
it('dispatches a complete trusted pointer sequence with the pressed button state Google menus require',async()=>{
  const sendCommand=vi.fn(async(_source:unknown,_method:string,_params:unknown)=>{});
  vi.stubGlobal('chrome',{debugger:{sendCommand}});
  await new DirectPageDialogs(42,new AbortController().signal).click(100,200);
  expect(sendCommand.mock.calls.map(([,method,params])=>[method,params])).toEqual([
    ['Input.dispatchMouseEvent',{type:'mouseMoved',x:100,y:200,button:'none',buttons:0,pointerType:'mouse'}],
    ['Input.dispatchMouseEvent',{type:'mousePressed',x:100,y:200,button:'left',buttons:1,clickCount:1,pointerType:'mouse'}],
    ['Input.dispatchMouseEvent',{type:'mouseReleased',x:100,y:200,button:'left',buttons:0,clickCount:1,pointerType:'mouse'}]
  ]);
});
it('releases held mouse/key input and does not commit Enter when Stop arrives during selection',async()=>{
  const controller=new AbortController();
  const sendCommand=vi.fn(async(_source:unknown,_method:string,params:any)=>{if(params.type==='mousePressed'||params.type==='keyDown')controller.abort();});
  vi.stubGlobal('chrome',{debugger:{sendCommand}});
  await expect(new DirectPageDialogs(42,controller.signal).click(100,200)).rejects.toThrow('dừng');
  expect(sendCommand.mock.calls.at(-1)?.[2]).toMatchObject({type:'mouseReleased',x:-1,y:-1,buttons:0});
  sendCommand.mockClear();const keysController=new AbortController();
  sendCommand.mockImplementation(async(_source,_method,params)=>{if(params.type==='keyDown')keysController.abort();});
  await expect(new DirectPageDialogs(42,keysController.signal).keys(['Home','ArrowDown','Enter'])).rejects.toThrow('dừng');
  expect(sendCommand.mock.calls.map(([, ,p])=>[p.type,p.key])).toEqual([['keyDown','Home'],['keyUp','Home']]);
});
it('recognizes a dropdown value committed in a hidden input outside its card',()=>{
  document.body.innerHTML='<form><div role="listitem" data-item-id="gender"><h3>Gender</h3><div role="listbox"></div></div><input type="hidden" name="entry.123" value="Nam"></form>';
  expect(prepareUploadAnswer({questionId:'gender',entryId:'123',label:'Gender',kind:'dropdown',value:'Nam'})).toEqual({done:true});
});
it('emits the Enter character needed by a menu keypress commit handler',async()=>{
  document.body.innerHTML='<div role="listbox" tabindex="0"></div><input name="entry.123" value="">';
  const menu=document.querySelector<HTMLElement>('[role="listbox"]')!;
  const answer=document.querySelector<HTMLInputElement>('input')!;
  menu.addEventListener('keypress',event=>{if((event as KeyboardEvent).key==='Enter')answer.value='Nam';});
  const sendCommand=vi.fn(async(_source:unknown,_method:string,params:any)=>{
    if(params.type==='keyDown'&&params.text==='\r')menu.dispatchEvent(new KeyboardEvent('keypress',{key:params.key}));
  });
  vi.stubGlobal('chrome',{debugger:{sendCommand}});
  await new DirectPageDialogs(42,new AbortController().signal).keys(['Home','ArrowDown','Enter']);
  expect(answer.value).toBe('Nam');
  expect(sendCommand.mock.calls.filter(([, ,p])=>p.type==='keyUp').map(([, ,p])=>p.key)).toEqual(['Home','ArrowDown','Enter']);
});
it('commits the requested menu row by keyboard and does not treat a highlighted row as a committed answer',()=>{
  document.body.innerHTML='<form><div role="listitem" data-item-id="gender"><h3>Gender</h3><div role="listbox" aria-expanded="true"><div role="option" data-value="">Choose</div><div role="option" data-value="Nam" aria-selected="true">Nam</div></div></div><input name="entry.123" value=""></form>';
  const option=document.querySelector<HTMLElement>('[role="option"]')!;
  option.scrollIntoView=vi.fn();vi.spyOn(Element.prototype,'getBoundingClientRect').mockReturnValue({x:10,y:20,width:100,height:40} as DOMRect);
  expect(prepareUploadAnswer({questionId:'gender',entryId:'123',label:'Gender',kind:'dropdown',value:'Nam'})).toEqual({keys:['ArrowUp','ArrowDown','Enter']});
  expect(option.scrollIntoView).not.toHaveBeenCalled();
});
it('chooses the same dropdown row from any previous highlight without relying on Home',async()=>{
  const values=['Choose','Under six months','One year','Two years','Three years'];
  document.body.innerHTML=`<form><div role="listitem" data-item-id="duration"><h3>Duration</h3><div role="listbox" aria-expanded="true">${values.map(v=>`<div role="option" data-value="${v}">${v}</div>`).join('')}</div></div><input name="entry.123" value=""></form>`;
  vi.spyOn(Element.prototype,'getBoundingClientRect').mockReturnValue({x:10,y:20,width:100,height:40} as DOMRect);
  const choice=prepareUploadAnswer({questionId:'duration',entryId:'123',label:'Duration',kind:'dropdown',value:'One year'});
  for(let start=0;start<values.length;start++){
    let selected=start,committed='';
    vi.stubGlobal('chrome',{debugger:{sendCommand:async(_source:unknown,_method:string,p:any)=>{
      if(p.type!=='keyDown')return;
      // Like Google's animation-frame update, the next key must not read the
      // previous highlight while this one is still queued.
      if(p.key==='ArrowUp'){const next=Math.max(0,selected-1);setTimeout(()=>{selected=next;},10);}
      if(p.key==='ArrowDown'){const next=Math.min(values.length-1,selected+1);setTimeout(()=>{selected=next;},10);}
      if(p.text==='\r')committed=values[selected];
    }}});
    await new DirectPageDialogs(42,new AbortController().signal).keys(choice.keys!);
    expect(committed).toBe('One year');
  }
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
it('preserves current Google upload JSON without fabricating a partialResponse row',async()=>{
  const request={...form(),final:true,uploadEntries:['1365092776'],history:[0]};
  const files=[[['GOOGLE_FILE_ID','fixture.png','image/png']]];
  const input=document.createElement('input');input.name='entry.1365092776';input.value=JSON.stringify(files);document.querySelector('form')!.append(input);
  document.querySelector<HTMLInputElement>('input[name="partialResponse"]')!.value=JSON.stringify([[[null,78959346,['000000000000'],0]],null,'session-only',null,null,null,'draft-state',123]);
  let posted='';vi.stubGlobal('fetch',vi.fn(async(_url,options)=>{posted=String(options.body);return {status:200,ok:true,text:async()=>'<html><body>Your response has been recorded</body></html>'};}));
  expect(await postExecutionPage(request)).toMatchObject({finalResult:{received:true}});
  const body=new URLSearchParams(posted),partial=JSON.parse(String(body.get('partialResponse')));
  expect(partial[0]).toHaveLength(1);expect(body.get('entry.1365092776')).toBe(JSON.stringify(files));expect(partial[6]).toBe('draft-state');expect(partial[7]).toBe(123);
  expect(body.get('pageHistory')).toBe('0');
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

it('rejects a fabricated final-page history before any request',async()=>{
  const request={...form(),final:true,history:[0,1,2,3,5,6,7,8]};const fetch=vi.fn();vi.stubGlobal('fetch',fetch);
  await expect(postExecutionPage(request)).rejects.toThrow('nhảy qua');expect(fetch).not.toHaveBeenCalled();
});
it('Stop cancels a queued native navigation before it can dispatch',async()=>{
  vi.useFakeTimers();const submit=vi.spyOn(HTMLFormElement.prototype,'submit').mockImplementation(()=>{});
  await postExecutionPage(form());cancelExecutionPage();await vi.runAllTimersAsync();expect(submit).not.toHaveBeenCalled();
});
it('explicit Test mode traverses to the actual final page and never invokes the final grant or POST',async()=>{
  vi.useFakeTimers();const f=fixture(),beforeSubmit=vi.fn();
  const promise=new DirectExecutor().run({tabId:42,mode:'test',profile:profile(),overrides:{'982814777':'2026'},expectedScript:script,file:{name:'fixture.png',type:'image/png',blob:new Blob(['fixture'])},signal:new AbortController().signal,onProgress:vi.fn(),beforeSubmit});
  await vi.runAllTimersAsync();expect(await promise).toMatchObject({status:'ready'});expect(beforeSubmit).not.toHaveBeenCalled();expect(f.posts.every(p=>!p.final)).toBe(true);expect(f.data[f.key]).toBeUndefined();
});

it('recognizes Google’s decomposed Vietnamese Gửi label on the final page',()=>{
  form();document.querySelector('form')!.insertAdjacentHTML('beforeend','<div role="button">Gửi</div>');
  vi.spyOn(Element.prototype,'getBoundingClientRect').mockReturnValue({width:90,height:30} as DOMRect);
  expect(readExecutionPage()).toMatchObject({hasSubmit:true,hasNext:false});
});
it('keeps HTTP transitions in the Google document, preserving the new server state without navigation',async()=>{
  const request={...form(),http:true,route:[0,1],history:[0]};
  const partial=JSON.stringify([[[null,2075638650,['SERVER VALUE'],0]],null,'server-session']);
  const attr=(s:string)=>s.replace(/&/g,'&amp;').replace(/"/g,'&quot;');
  vi.stubGlobal('fetch',vi.fn(async()=>({ok:true,status:200,text:async()=>`<form action="/formResponse"><input type="hidden" name="token" value="next-token"><input type="hidden" name="fbzx" value="server-session"><input type="hidden" name="pageHistory" value="0,1"><input type="hidden" name="partialResponse" value="${attr(partial)}"></form><script>${script}</script>`})));
  const submit=vi.spyOn(HTMLFormElement.prototype,'submit').mockImplementation(()=>{});
  expect(await postExecutionPage(request)).toEqual({scheduled:true});expect(submit).not.toHaveBeenCalled();
  expect(readExecutionPage()).toMatchObject({history:[0,1],hasSubmit:true,hasNext:false});
  const stored=new FormData(document.querySelector<HTMLFormElement>('#hanuDirectState')!);
  expect(stored.get('partialResponse')).toBe(partial);expect(stored.get('token')).toBe('next-token');expect(stored.get('fbzx')).toBe('server-session');
});
it('stops a HTTP transition that returns the same page instead of marking it ready to send',async()=>{
  const request={...form(),http:true,route:[0,1],history:[0]};
  vi.stubGlobal('fetch',vi.fn(async()=>({ok:true,status:200,text:async()=>'<form action="/formResponse"><input type="hidden" name="pageHistory" value="0"></form>'})));
  expect(await postExecutionPage(request)).toMatchObject({error:expect.stringContaining('cùng trang')});expect(document.querySelector('#hanuDirectState')).toBeNull();
  expect(JSON.parse(document.querySelector('#hanuDirectFailure')!.textContent!)).toMatchObject({kind:'navigation',from:[0],to:[0],missingFields:['token','fbzx','partialResponse']});
});
it('reports the rejected question without leaking hidden session fields or executing response HTML',async()=>{
  const request={...form(),http:true,route:[0,1],history:[0],questionLabels:{'123':'Số tài khoản'}};
  const fetch=vi.fn(async()=>({ok:true,status:200,text:async()=>'<form><input type="hidden" name="pageHistory" value="0"><input type="hidden" name="token" value="PRIVATE_TOKEN"><input type="hidden" name="partialResponse" value="PRIVATE_PROFILE"></form><div id="i.err.123"><span>Phải là một số</span><div>lớn hơn 0</div></div><script>throw new Error("must not execute")</script>'}));vi.stubGlobal('fetch',fetch);
  expect(await postExecutionPage(request)).toMatchObject({error:expect.stringContaining('Số tài khoản: Phải là một số lớn hơn 0')});
  const diagnostic=document.querySelector('#hanuDirectFailure')!.textContent!;
  expect(JSON.parse(diagnostic)).toMatchObject({kind:'validation',errors:[{questionId:'123',label:'Số tài khoản',message:'Phải là một số lớn hơn 0'}]});
  expect(diagnostic).not.toContain('PRIVATE_');expect(diagnostic).not.toContain('must not execute');expect(fetch).toHaveBeenCalledOnce();
});
it('identifies a newer draft returned during a post-upload transition and does not retry',async()=>{
  const request={...form(),http:true,route:[0,1],history:[0]};
  const fetch=vi.fn(async()=>({ok:true,status:200,text:async()=>'<div role="alert">Có bản nháp mới hơn. Vui lòng tải lại.</div>'}));vi.stubGlobal('fetch',fetch);
  expect(await postExecutionPage(request)).toMatchObject({error:expect.stringContaining('bản nháp mới hơn')});
  expect(JSON.parse(document.querySelector('#hanuDirectFailure')!.textContent!)).toMatchObject({kind:'draft_conflict'});expect(fetch).toHaveBeenCalledOnce();
});
it('captures the draft revision generated by Google on native upload Next rather than inventing one',()=>{
  form();document.querySelector<HTMLInputElement>('[name="pageHistory"]')!.value='0,1,2,3,5';
  const dlut=document.createElement('input');dlut.name='dlut';document.querySelector('form')!.append(dlut);
  const button=document.createElement('div');button.setAttribute('role','button');button.textContent='Tiếp';document.querySelector('form')!.append(button);
  const submit=vi.spyOn(HTMLFormElement.prototype,'submit').mockImplementation(()=>{});
  button.addEventListener('click',()=>{dlut.value='GOOGLE-UPLOAD-REVISION';document.querySelector('form')!.submit();});
  beginExecutionSession(DIRECT_LAB_FORM_ID);
  expect(JSON.parse(sessionStorage.getItem(`hanu-direct-draft:${DIRECT_LAB_FORM_ID}`)!)).toEqual({dlut:'GOOGLE-UPLOAD-REVISION'});expect(submit).toHaveBeenCalledOnce();
});

it('leaves the real final page editable when Google client validation rejects, without granting or posting',async()=>{
  vi.useFakeTimers();const f=fixture({clientValidation:true}),beforeSubmit=vi.fn();
  const running=new DirectExecutor().run({tabId:42,profile:profile(),overrides:{'982814777':'2026'},file:{name:'fixture.png',type:'image/png',blob:new Blob(['fixture'])},beforeSubmit,signal:new AbortController().signal,onProgress:vi.fn()});
  await vi.runAllTimersAsync();expect(await running).toMatchObject({status:'waiting',message:'Google: sai dữ liệu'});expect(beforeSubmit).not.toHaveBeenCalled();expect(f.posts.every(p=>!p.final)).toBe(true);expect(f.data[f.key]).toBeUndefined();
});
it('uses the exact Google-validated manual body, even when configured verification differs',async()=>{
  vi.useFakeTimers();const f=fixture({finalPage:true}),beforeSubmit=vi.fn();
  const running=new DirectExecutor().run({tabId:42,resume:true,manualFinal:'doc-7',profile:profile(),overrides:{'982814777':'WRONG CONFIGURED VALUE'},file:{name:'fixture.png',type:'image/png',blob:new Blob(['fixture'])},beforeSubmit,signal:new AbortController().signal,onProgress:vi.fn()});
  await vi.runAllTimersAsync();expect(await running).toMatchObject({status:'received'});expect(beforeSubmit).toHaveBeenCalledOnce();expect(f.posts).toHaveLength(1);expect(f.posts[0]).toMatchObject({final:true,manualReady:true,entries:[]});
});
