// @vitest-environment jsdom
import {afterEach,expect,it,vi} from 'vitest';
import {emptyProfile} from '../src/rules';
import type {ExtensionMessage} from '../src/shared';
let listener:(message:ExtensionMessage)=>void;
afterEach(()=>{listener?.({type:'HALT_RUN'});vi.unstubAllGlobals();vi.restoreAllMocks();vi.resetModules();document.body.replaceChildren();});
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

it('resumes after Stop while the previous execution is still awaiting foreground',async()=>{
  document.body.innerHTML='<div role="listitem"><div role="heading">Họ và tên *</div><input type="text"></div><button>Submit</button>';
  let width=0,reject!:(e:Error)=>void;
  vi.spyOn(HTMLElement.prototype,'getBoundingClientRect').mockImplementation(()=>({width,height:40} as DOMRect));
  Object.defineProperty(HTMLElement.prototype,'scrollIntoView',{configurable:true,value:()=>{}});
  const messages:any[]=[];const profile=emptyProfile();profile.values.fullName='RESUMED TEST';
  vi.stubGlobal('chrome',{runtime:{onMessage:{addListener:(fn:typeof listener)=>listener=fn},sendMessage:async(m:any)=>{messages.push(m);if(m.type==='GET_PROFILE')return profile;if(m.type==='PAGE_ATTENTION_ACQUIRE')return new Promise((_r,j)=>reject=j);return {ok:true};}}});
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
