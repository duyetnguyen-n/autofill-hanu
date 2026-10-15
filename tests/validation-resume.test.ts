// @vitest-environment jsdom
// @vitest-environment-options {"url":"https://docs.google.com/forms/d/e/validation-fixture/viewform"}
import {afterEach,expect,it,vi} from 'vitest';
import {emptyProfile} from '../src/rules';
let listener:any;
afterEach(()=>{listener?.({type:'HALT_RUN'},{},()=>{});vi.useRealTimers();vi.unstubAllGlobals();vi.restoreAllMocks();vi.resetModules();document.body.replaceChildren();});
const card=(id:string,title:string,input:string)=>`<div role="listitem" data-item-id="${id}"><div role="heading">${title}</div>${input}</div>`;
async function fixture(extra='',mode:'test'|'live'='test'){
  vi.useFakeTimers();
  document.body.innerHTML=card('phone','Số điện thoại *','<input name="entry.phone" type="text" pattern="[0-9]{10}" required>')+extra+'<button id="next">Next</button>';
  vi.spyOn(HTMLElement.prototype,'getBoundingClientRect').mockReturnValue({width:640,height:80} as DOMRect);
  Object.defineProperty(HTMLElement.prototype,'scrollIntoView',{configurable:true,value:()=>{}});
  const profile=emptyProfile();profile.values.phone='wrong';
  const sent:any[]=[],next=vi.fn(()=>{document.body.innerHTML='<button id="submit">Submit</button>';document.querySelector('button')!.addEventListener('click',submit);}),submit=vi.fn();
  document.querySelector('#next')!.addEventListener('click',next);
  vi.stubGlobal('chrome',{runtime:{onMessage:{addListener:(fn:any)=>listener=fn},sendMessage:async(m:any)=>{
    sent.push(m);
    if(m.type==='TRUSTED_CLICK')return {dispatched:false};
    if(m.type==='GET_PROFILE')return profile;
    if(m.type==='AUTO_RESUME'){listener({type:'RUN_CURRENT_PAGE',mode,runId:'run'},{},()=>{});return {ok:true,resumed:true};}
    if(m.type==='REQUEST_SUBMIT')return {granted:true};
    return {ok:true};
  }}});
  await import('../src/content');await vi.runAllTimersAsync();
  listener({type:'RUN_CURRENT_PAGE',mode,runId:'run'},{},()=>{});await vi.runAllTimersAsync();
  const input=document.querySelector<HTMLInputElement>('[name="entry.phone"]')!;
  const edit=(value:string,commit=true)=>{input.value=value;input.dispatchEvent(new Event('input',{bubbles:true}));if(commit)input.dispatchEvent(new Event('change',{bubbles:true}));};
  return {profile,input,sent,next,submit,edit,events:()=>sent.filter(m=>m.type==='FORM_EVENT').map(m=>m.event)};
}
it('continues once after a valid committed correction and preserves it against a wrong profile value',async()=>{
  const x=await fixture();expect(x.events().at(-1)).toMatchObject({type:'block',issue:{reason:'validation'}});expect(x.next).not.toHaveBeenCalled();
  x.edit('0900000000');await vi.runAllTimersAsync();
  expect(x.next).toHaveBeenCalledOnce();expect(x.events().at(-1)).toEqual({type:'ready_to_submit'});expect(x.profile.values.phone).toBe('wrong');
  expect(x.events()).toContainEqual(expect.objectContaining({type:'progress',message:expect.stringContaining('Giữ nguyên đáp án bạn vừa sửa')}));expect(x.submit).not.toHaveBeenCalled();
  expect(x.sent.filter(m=>m.type==='AUTO_RESUME')).toHaveLength(1);
});
it('does not continue on an invalid replacement or while the user is still typing',async()=>{
  const x=await fixture();x.edit('123');await vi.runAllTimersAsync();expect(x.next).not.toHaveBeenCalled();
  x.edit('0900000000',false);await vi.runAllTimersAsync();expect(x.next).not.toHaveBeenCalled();
  x.input.dispatchEvent(new FocusEvent('focusout',{bubbles:true}));await vi.runAllTimersAsync();expect(x.next).toHaveBeenCalledOnce();
});
it('waits for every error to clear and preserves corrections in multiple cards',async()=>{
  const x=await fixture(card('email','Địa chỉ email liên hệ','<input id="email" type="email" value="bad">'));
  x.edit('0900000000');await vi.runAllTimersAsync();expect(x.next).not.toHaveBeenCalled();
  const email=document.querySelector<HTMLInputElement>('#email')!;email.value='valid@example.test';email.dispatchEvent(new Event('input',{bubbles:true}));email.dispatchEvent(new Event('change',{bubbles:true}));
  await vi.runAllTimersAsync();expect(x.next).toHaveBeenCalledOnce();expect(x.events().at(-1)).toEqual({type:'ready_to_submit'});
});
it('waits for the visible Google alert to disappear after the input commits',async()=>{
  const x=await fixture();x.input.setAttribute('aria-invalid','true');x.input.parentElement!.insertAdjacentHTML('beforeend','<div role="alert">Sai định dạng</div>');
  x.edit('0900000000');await vi.runAllTimersAsync();expect(x.next).not.toHaveBeenCalled();
  x.input.removeAttribute('aria-invalid');document.querySelector('[role="alert"]')!.remove();await vi.runAllTimersAsync();expect(x.next).toHaveBeenCalledOnce();
});
it('Pause/Stop cancels correction monitoring even if the error clears later',async()=>{
  const x=await fixture();listener({type:'HALT_RUN'},{},()=>{});x.edit('0900000000');await vi.runAllTimersAsync();expect(x.next).not.toHaveBeenCalled();expect(x.sent.filter(m=>m.type==='AUTO_RESUME')).toHaveLength(0);
});
it('a new run does not inherit the previous manual correction',async()=>{
  const x=await fixture();x.edit('0900000000');await vi.runAllTimersAsync();
  document.body.innerHTML=card('phone','Số điện thoại *','<input name="entry.phone" type="text" pattern="[0-9]{10}" value="0900000000" required>')+'<button>Submit</button>';
  listener({type:'RUN_CURRENT_PAGE',mode:'test',runId:'new-run'},{},()=>{});await vi.runAllTimersAsync();
  expect(document.querySelector<HTMLInputElement>('input')!.value).toBe('wrong');expect(x.events().at(-1)).toMatchObject({type:'block',issue:{reason:'validation'}});
});
it('Live continues and obtains a single submit grant after a valid correction',async()=>{
  const x=await fixture('','live');x.edit('0900000000');await vi.runAllTimersAsync();expect(x.next).toHaveBeenCalledOnce();expect(x.submit).toHaveBeenCalledOnce();expect(x.sent.filter(m=>m.type==='REQUEST_SUBMIT')).toHaveLength(1);
  listener({type:'RUN_CURRENT_PAGE',mode:'live',runId:'run'},{},()=>{});await vi.runAllTimersAsync();expect(x.submit).toHaveBeenCalledOnce();
});
