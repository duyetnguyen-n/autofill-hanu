// @vitest-environment jsdom
import {afterEach,expect,it,vi} from 'vitest';
import {emptyProfile} from '../src/rules';
import type {ExtensionMessage} from '../src/shared';
let listener:(message:ExtensionMessage)=>void;
afterEach(()=>{listener?.({type:'HALT_RUN'});vi.useRealTimers();vi.unstubAllGlobals();vi.restoreAllMocks();vi.resetModules();document.body.replaceChildren();});
it('starts a new document from the run returned by its claim without a second recovery request',async()=>{
  document.body.innerHTML='<div role="listitem"><div role="heading">Họ và tên *</div><input type="text"></div><button>Gửi</button>';
  vi.spyOn(HTMLElement.prototype,'getBoundingClientRect').mockReturnValue({width:100,height:40} as DOMRect);
  Object.defineProperty(HTMLElement.prototype,'scrollIntoView',{configurable:true,value:()=>{}});
  const profile=emptyProfile();profile.values.fullName='NEW DOCUMENT TEST';
  const messages:ExtensionMessage[]=[];
  vi.stubGlobal('chrome',{runtime:{onMessage:{addListener:(fn:typeof listener)=>listener=fn},sendMessage:async(message:ExtensionMessage)=>{
    messages.push(message);
    if(message.type==='CLAIM_DOCUMENT')return {ok:true,run:{runId:'same-run',status:'running',mode:'test',recoveryRequired:false,submitAttempted:false}};
    if(message.type==='GET_RUN_FOR_TAB')throw new Error('Must use the atomic claim response');
    if(message.type==='GET_PROFILE')return profile;
    return {ok:true};
  }}});
  await import('../src/content');
  await vi.waitFor(()=>expect(messages).toContainEqual(expect.objectContaining({type:'FORM_EVENT',runId:'same-run',event:{type:'ready_to_submit'}})));
  expect(document.querySelector<HTMLInputElement>('input')!.value).toBe('NEW DOCUMENT TEST');
  expect(messages.some(m=>m.type==='GET_RUN_FOR_TAB')).toBe(false);
});

it.each([true,false])('reconciles a submitted document without clicking Submit again (confirmed=%s)',async confirmed=>{
  document.body.innerHTML=confirmed?'<p>Your response has been recorded</p>':'<button>Submit</button>';
  const clicked=vi.fn();document.querySelector('button')?.addEventListener('click',clicked);
  const messages:ExtensionMessage[]=[];
  vi.stubGlobal('chrome',{runtime:{onMessage:{addListener:(fn:typeof listener)=>listener=fn},sendMessage:async(message:ExtensionMessage)=>{
    messages.push(message);
    if(message.type==='CLAIM_DOCUMENT')return {ok:true,run:{runId:'locked-run',status:'submitting',mode:'live',submitAttempted:true}};
    return {ok:true};
  }}});
  await import('../src/content');
  await vi.waitFor(()=>expect(messages).toContainEqual(expect.objectContaining({type:'FORM_EVENT',runId:'locked-run',event:expect.objectContaining({type:confirmed?'completed':'block'})})));
  expect(clicked).not.toHaveBeenCalled();expect(messages.some(m=>m.type==='REQUEST_SUBMIT'||m.type==='GET_PROFILE')).toBe(false);
});

it.each(['submitting','submit_uncertain'] as const)('observes a delayed custom acknowledgement after reload (%s) without touching the form',async status=>{
  document.body.innerHTML='<div id="response">Đang tải kết quả…</div>';
  const messages:ExtensionMessage[]=[];
  vi.stubGlobal('chrome',{runtime:{onMessage:{addListener:(fn:typeof listener)=>listener=fn},sendMessage:async(m:ExtensionMessage)=>{
    messages.push(m);if(m.type==='CLAIM_DOCUMENT')return {ok:true,run:{runId:'locked',status,mode:'live',submitAttempted:true}};return {ok:true};
  }}});
  await import('../src/content');
  await vi.waitFor(()=>expect(document.documentElement.dataset.hanuRecovery).toContain(status));
  document.querySelector('#response')!.textContent='Chúc mừng thí sinh đã hoàn thành bước điền thông tin đăng ký biểu mẫu! Thí sinh vui lòng chờ email xác nhận của Điểm thi.';
  await vi.waitFor(()=>expect(messages).toContainEqual(expect.objectContaining({type:'FORM_EVENT',runId:'locked',event:expect.objectContaining({type:'completed'})})));
  expect(messages.some(m=>['REQUEST_SUBMIT','GET_PROFILE','PAGE_ATTENTION_ACQUIRE'].includes(m.type))).toBe(false);
});

it('resumes after Stop while the previous execution is still awaiting foreground',async()=>{
  document.body.innerHTML='<div role="listitem"><div role="heading">Họ và tên *</div><input type="text"></div><button>Submit</button>';
  let width=0,reject!:(e:Error)=>void,acquires=0;
  vi.spyOn(HTMLElement.prototype,'getBoundingClientRect').mockImplementation(()=>({width,height:40} as DOMRect));
  Object.defineProperty(HTMLElement.prototype,'scrollIntoView',{configurable:true,value:()=>{}});
  const messages:any[]=[];const profile=emptyProfile();profile.values.fullName='RESUMED TEST';
  vi.stubGlobal('chrome',{runtime:{onMessage:{addListener:(fn:typeof listener)=>listener=fn},sendMessage:async(m:any)=>{messages.push(m);if(m.type==='GET_PROFILE')return profile;if(m.type==='PAGE_ATTENTION_ACQUIRE'&&++acquires===1)return new Promise((_r,j)=>reject=j);return {ok:true,token:'new-lease'};}}});
  await import('../src/content');
  listener({type:'RUN_CURRENT_PAGE',mode:'test',runId:'run'});
  await vi.waitFor(()=>expect(reject).toBeTypeOf('function'));
  listener({type:'HALT_RUN'});width=640;
  listener({type:'RUN_CURRENT_PAGE',mode:'test',runId:'run'});
  await new Promise(r=>setTimeout(r,0));reject(new Error('Previous operation cancelled'));
  await vi.waitFor(()=>expect(messages).toContainEqual(expect.objectContaining({type:'FORM_EVENT',event:{type:'ready_to_submit'}})));
  expect(document.querySelector<HTMLInputElement>('input')!.value).toBe('RESUMED TEST');
  expect(messages.some(m=>m.event?.type==='failed')).toBe(false);
});

it.each(['fresh','bfcache','captcha-removed'] as const)('automatically resumes a recovered form (%s) without editing existing values',async scenario=>{
  document.body.innerHTML='<div role="listitem"><div role="heading">Họ và tên *</div><input value="KEEP THIS"></div><button>Submit</button>';
  vi.spyOn(HTMLElement.prototype,'getBoundingClientRect').mockReturnValue({width:100,height:40} as DOMRect);
  let status=scenario==='fresh'?'waiting_manual':'paused';const messages:any[]=[];
  vi.stubGlobal('chrome',{runtime:{onMessage:{addListener:(fn:typeof listener)=>listener=fn},sendMessage:async(m:any)=>{
    messages.push(m);if(m.type==='CLAIM_DOCUMENT')return {ok:true,run:{runId:'return',mode:'test',status,autoContinue:true,submitAttempted:false,blockingIssue:{reason:'captcha'}}};return {ok:true};
  }}});
  await import('../src/content');await vi.waitFor(()=>expect(document.documentElement.dataset.hanuRecovery).not.toContain('claiming'));
  if(scenario==='bfcache'){
    window.dispatchEvent(new PageTransitionEvent('pagehide',{persisted:true}));status='waiting_manual';
    window.dispatchEvent(new PageTransitionEvent('pageshow',{persisted:true}));window.dispatchEvent(new PopStateEvent('popstate'));
  }
  if(scenario==='captcha-removed'){
    const frame=document.createElement('iframe');frame.src='https://www.google.com/recaptcha/api2/anchor';document.body.append(frame);
    status='waiting_manual';listener({type:'HALT_RUN',watchReturn:true});
    await vi.waitFor(()=>expect(document.documentElement.dataset.hanuRecovery).toContain('waiting_manual'));
    expect(messages.some(m=>m.type==='AUTO_RESUME')).toBe(false);frame.remove();
  }
  await vi.waitFor(()=>expect(messages.filter(m=>m.type==='AUTO_RESUME')).toHaveLength(1));
  expect(messages.find(m=>m.type==='AUTO_RESUME')).toMatchObject({runId:'return',source:'page_ready'});
  expect(document.querySelector<HTMLInputElement>('input')!.value).toBe('KEEP THIS');
  expect(messages.some(m=>m.type==='GET_PROFILE'||m.type==='REQUEST_SUBMIT')).toBe(false);
});

it.each(['paused','idle','completed','ready_to_submit'] as const)('does not resume explicit/terminal state %s on Back, online or DOM changes',async status=>{
  document.body.innerHTML='<button>Submit</button>';
  vi.spyOn(HTMLElement.prototype,'getBoundingClientRect').mockReturnValue({width:100,height:40} as DOMRect);
  const messages:any[]=[];
  vi.stubGlobal('chrome',{runtime:{onMessage:{addListener:(fn:typeof listener)=>listener=fn},sendMessage:async(m:any)=>{messages.push(m);if(m.type==='CLAIM_DOCUMENT')return {ok:true,run:{runId:'stopped',status,mode:'test',autoContinue:false,submitAttempted:false,blockingIssue:{reason:'captcha'}}};return {ok:true};}}});
  await import('../src/content');window.dispatchEvent(new PageTransitionEvent('pageshow',{persisted:true}));window.dispatchEvent(new Event('online'));document.body.append(document.createElement('span'));
  await vi.waitFor(()=>expect(document.documentElement.dataset.hanuRecovery).toContain(status));
  expect(messages.some(m=>m.type==='AUTO_RESUME'||m.type==='GET_PROFILE')).toBe(false);
});

it('does not restart an active document on its ordinary initial pageshow',async()=>{
 document.body.innerHTML='<button>Submit</button>';const messages:any[]=[];
 vi.stubGlobal('chrome',{runtime:{onMessage:{addListener:(fn:typeof listener)=>listener=fn},sendMessage:async(m:any)=>{messages.push(m);return {ok:true};}}});
 await import('../src/content');await vi.waitFor(()=>expect(document.documentElement.dataset.hanuRecovery).toBe('no-run'));
 const claims=messages.filter(m=>m.type==='CLAIM_DOCUMENT').length;
 window.dispatchEvent(new PageTransitionEvent('pageshow',{persisted:false}));await Promise.resolve();
 expect(messages.filter(m=>m.type==='CLAIM_DOCUMENT')).toHaveLength(claims);
});

it('fills independent text fields while progress persistence is delayed, then flushes before marking ready',async()=>{
 document.body.innerHTML='<div role="listitem"><div role="heading">Họ và tên *</div><input id="name" type="text"></div><div role="listitem"><div role="heading">Số điện thoại *</div><input id="phone" type="text"></div><button>Submit</button>';
 vi.spyOn(HTMLElement.prototype,'getBoundingClientRect').mockReturnValue({width:100,height:40} as DOMRect);
 Object.defineProperty(HTMLElement.prototype,'scrollIntoView',{configurable:true,value:()=>{}});
 const profile=emptyProfile();profile.values.fullName='SYNTHETIC NAME';profile.values.phone='0900000000';
 let release!:()=>void;const gate=new Promise<void>(r=>release=r),messages:any[]=[];
 vi.stubGlobal('chrome',{runtime:{onMessage:{addListener:(fn:typeof listener)=>listener=fn},sendMessage:async(m:any)=>{
  messages.push(m);if(m.type==='CLAIM_DOCUMENT')return {ok:true,run:{runId:'overlap',status:'running',mode:'test',submitAttempted:false}};
  if(m.type==='GET_PROFILE')return profile;
  if(m.type==='FORM_EVENT'&&m.event.type==='progress')await gate;return {ok:true};
 }}});
 await import('../src/content');
 try{
  await vi.waitFor(()=>expect(document.querySelector<HTMLInputElement>('#phone')!.value).toBe('0900000000'));
  expect(document.querySelector<HTMLInputElement>('#name')!.value).toBe('SYNTHETIC NAME');
  expect(messages.some(m=>m.event?.type==='ready_to_submit')).toBe(false);
 }finally{release();}
 await vi.waitFor(()=>expect(messages.some(m=>m.event?.type==='ready_to_submit')).toBe(true));
});

it('abandons the previous confirmation wait on pagehide so a returned document does not wait twenty seconds',async()=>{
 vi.useFakeTimers();document.body.innerHTML='<div role="listitem"><div role="heading">Họ và tên *</div><input type="text"></div><button>Submit</button>';
 vi.spyOn(HTMLElement.prototype,'getBoundingClientRect').mockReturnValue({width:100,height:40} as DOMRect);Object.defineProperty(HTMLElement.prototype,'scrollIntoView',{configurable:true,value:()=>{}});
 const profile=emptyProfile();profile.values.fullName='SYNTHETIC';let retries=0,grants=0,blocked=false;const clicked=vi.fn();document.querySelector('button')!.addEventListener('click',clicked);
 vi.stubGlobal('chrome',{runtime:{onMessage:{addListener:(fn:typeof listener)=>listener=fn},sendMessage:async(m:any)=>{
  if(m.type==='CLAIM_DOCUMENT')return {ok:true,run:{runId:'return',status:blocked?'waiting_manual':'running',mode:'live',submitAttempted:false,submissionRetries:retries}};
  if(m.type==='GET_PROFILE')return profile;if(m.type==='REQUEST_SUBMIT')return {granted:++grants===1};if(m.type==='FORM_EVENT'&&m.event.type==='block')blocked=true;return {ok:true};
 }}});
 await import('../src/content');await vi.advanceTimersByTimeAsync(20);expect(clicked).toHaveBeenCalledOnce();
 window.dispatchEvent(new PageTransitionEvent('pagehide',{persisted:true}));retries=1;window.dispatchEvent(new PageTransitionEvent('pageshow',{persisted:true}));
 await vi.advanceTimersByTimeAsync(300);expect(grants).toBe(2);expect(clicked).toHaveBeenCalledOnce();
});
