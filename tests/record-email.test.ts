// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest';
import { emptyProfile } from '../src/rules';
import type { ExtensionMessage } from '../src/shared';
let listener: (message: ExtensionMessage) => void;
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
