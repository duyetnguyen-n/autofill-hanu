// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest';
import { emptyProfile } from '../src/rules';
import type { ExtensionMessage } from '../src/shared';
let listener: (message: ExtensionMessage, sender?: unknown, respond?: (response:any)=>void) => void;
afterEach(() => {
  listener?.({type:'HALT_RUN'});
  vi.unstubAllGlobals(); vi.restoreAllMocks(); vi.resetModules();
  document.body.replaceChildren();
});
it.each([
  'Lưu lại first.account@gmail.com dưới dạng email để thêm vào câu trả lời của tôi',
  'Lưu lại second@example.com dưới dạng email để thêm vào câu trả lời của tôi',
  'Record another@example.com as the email to be included with my response'
])('checks the standalone account email checkbox: %s', async label => {
  document.body.innerHTML='<div role="checkbox" aria-checked="false" id="record"></div><button>Submit</button>';
  const checkbox=document.querySelector<HTMLElement>('#record')!;
  checkbox.setAttribute('aria-label',label);
  checkbox.textContent=label;
  checkbox.addEventListener('click',()=>checkbox.setAttribute('aria-checked','true'));
  vi.spyOn(HTMLElement.prototype,'getBoundingClientRect').mockReturnValue({width:100,height:40} as DOMRect);
  Object.defineProperty(HTMLElement.prototype,'scrollIntoView',{configurable:true,value:()=>{}});
  const profile=emptyProfile(); profile.values.recordGoogleEmail='true';
  const sent: ExtensionMessage[]=[];
  vi.stubGlobal('chrome',{runtime:{onMessage:{addListener:(fn:typeof listener)=>listener=fn},sendMessage:async(message:ExtensionMessage)=>{
    sent.push(message); return message.type==='GET_PROFILE'?profile:undefined;
  }}});
  const submit=vi.fn(); document.querySelector('button')!.addEventListener('click',submit);
  await import('../src/content'); listener({type:'RUN_CURRENT_PAGE',mode:'test'});
  await vi.waitFor(()=>expect(sent).toContainEqual({type:'FORM_EVENT',event:{type:'ready_to_submit'}}));
  expect(checkbox.getAttribute('aria-checked')).toBe('true');
  expect(submit).not.toHaveBeenCalled();
});

it.each(['', undefined])('records the required Google account email when a legacy profile has %s', async saved => {
  document.body.innerHTML='<h3>Email <span aria-label="Câu hỏi bắt buộc">*</span></h3><div role="checkbox" aria-checked="false" id="record" aria-label="Lưu lại second@example.com dưới dạng email để thêm vào câu trả lời của tôi"></div><button>Next</button>';
  const checkbox=document.querySelector<HTMLElement>('#record')!;
  checkbox.addEventListener('click',()=>checkbox.setAttribute('aria-checked','true'));
  vi.spyOn(HTMLElement.prototype,'getBoundingClientRect').mockReturnValue({width:100,height:40} as DOMRect);
  Object.defineProperty(HTMLElement.prototype,'scrollIntoView',{configurable:true,value:()=>{}});
  const profile=emptyProfile();
  if(saved!==undefined)profile.values.recordGoogleEmail=saved;
  else delete profile.values.recordGoogleEmail;
  const sent:ExtensionMessage[]=[];
  vi.stubGlobal('chrome',{runtime:{onMessage:{addListener:(fn:typeof listener)=>listener=fn},sendMessage:async(m:ExtensionMessage)=>{
    sent.push(m);return m.type==='GET_PROFILE'?profile:undefined;
  }}});
  const next=vi.fn(()=>{if(checkbox.getAttribute('aria-checked')==='true')document.querySelector('button')!.textContent='Submit';});
  document.querySelector('button')!.addEventListener('click',next);
  await import('../src/content');listener({type:'RUN_CURRENT_PAGE',mode:'test'});
  await vi.waitFor(()=>expect(sent).toContainEqual({type:'FORM_EVENT',event:{type:'ready_to_submit'}}));
  expect(checkbox.getAttribute('aria-checked')).toBe('true');
  expect(next).toHaveBeenCalledOnce();
  expect(profile.values.recordGoogleEmail).toBe(saved);
  let scan:any;listener({type:'SCAN_FORM',tabId:0},{},(r:any)=>scan=r);
  expect(scan.questions[0].required).toBe(true);
});

it('respects an explicit refusal, then resumes when the user checks the required email box',async()=>{
  document.body.innerHTML='<div role="checkbox" aria-label="Record second@example.com as the email to be included with my response" aria-checked="false" id="record"></div><button>Next</button>';
  const checkbox=document.querySelector<HTMLElement>('#record')!;
  checkbox.addEventListener('click',()=>checkbox.setAttribute('aria-checked','true'));
  vi.spyOn(HTMLElement.prototype,'getBoundingClientRect').mockReturnValue({width:100,height:40} as DOMRect);
  Object.defineProperty(HTMLElement.prototype,'scrollIntoView',{configurable:true,value:()=>{}});
  const profile=emptyProfile();profile.values.recordGoogleEmail='false';
  const sent:ExtensionMessage[]=[];
  vi.stubGlobal('chrome',{runtime:{onMessage:{addListener:(fn:typeof listener)=>listener=fn},sendMessage:async(m:ExtensionMessage)=>{
    sent.push(m);return m.type==='GET_PROFILE'?profile:undefined;
  }}});
  const next=vi.fn(()=>{checkbox.remove();document.querySelector('button')!.textContent='Submit';});
  document.querySelector('button')!.addEventListener('click',next);
  await import('../src/content');listener({type:'RUN_CURRENT_PAGE',mode:'test'});
  await vi.waitFor(()=>expect(sent).toContainEqual(expect.objectContaining({type:'FORM_EVENT',event:expect.objectContaining({type:'block',issue:expect.objectContaining({reason:'validation',questionId:'record'})})})));
  expect(checkbox.getAttribute('aria-checked')).toBe('false');
  expect(next).not.toHaveBeenCalled();
  checkbox.click();
  await vi.waitFor(()=>expect(sent).toContainEqual({type:'FORM_EVENT',event:{type:'ready_to_submit'}}));
  expect(next).toHaveBeenCalledOnce();
  expect(profile.values.recordGoogleEmail).toBe('false');
});

it('does not opt into an unrelated required checkbox with a blank profile',async()=>{
  document.body.innerHTML='<div role="listitem"><div role="heading">TÔI CAM KẾT | 本人保证 *</div><input type="checkbox"></div><button>Next</button>';
  vi.spyOn(HTMLElement.prototype,'getBoundingClientRect').mockReturnValue({width:100,height:40} as DOMRect);
  const profile=emptyProfile(),sent:ExtensionMessage[]=[];
  vi.stubGlobal('chrome',{runtime:{onMessage:{addListener:(fn:typeof listener)=>listener=fn},sendMessage:async(m:ExtensionMessage)=>{sent.push(m);return m.type==='GET_PROFILE'?profile:undefined;}}});
  const next=vi.fn();document.querySelector('button')!.addEventListener('click',next);
  await import('../src/content');listener({type:'RUN_CURRENT_PAGE',mode:'test'});
  await vi.waitFor(()=>expect(sent).toContainEqual(expect.objectContaining({type:'FORM_EVENT',event:expect.objectContaining({type:'block',issue:expect.objectContaining({reason:'unknown_required'})})})));
  expect(document.querySelector('input')!.checked).toBe(false);expect(next).not.toHaveBeenCalled();
});
