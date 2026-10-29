// @vitest-environment jsdom
import {afterEach,expect,it,vi} from 'vitest';
import {prepareUploadAnswer} from '../src/google-direct/execute-page';

afterEach(()=>{vi.restoreAllMocks();Reflect.deleteProperty(document,'elementFromPoint');document.body.replaceChildren();delete document.documentElement.dataset.hanuDirectStopped;});
const input={questionId:'duration',entryId:'123',label:'Duration',kind:'dropdown',value:'One year'};
function menu(){
  document.body.innerHTML='<form><div role="listitem" data-item-id="duration"><h3>Duration</h3><div role="listbox" aria-expanded="false"><div jsname="LgbsSe">Choose</div><div role="option" data-value="Choose">Choose</div><div role="option" data-value="One year">One year</div></div></div><input type="hidden" name="entry.123" value=""></form>';
  vi.spyOn(Element.prototype,'getBoundingClientRect').mockReturnValue({x:10,y:20,left:10,top:20,width:100,height:30} as DOMRect);
  const list=document.querySelector<HTMLElement>('[role="listbox"]')!,opener=list.querySelector<HTMLElement>('[jsname]')!,choice=list.querySelector<HTMLElement>('[data-value="One year"]')!,value=document.querySelector<HTMLInputElement>('input')!;
  opener.onclick=()=>list.setAttribute('aria-expanded','true');
  return {list,opener,choice,value};
}
it('opens and selects by pointer, waiting for the actual hidden value to commit asynchronously',async()=>{
  const f=menu(),scroll=vi.fn();f.opener.scrollIntoView=scroll;f.choice.scrollIntoView=scroll;
  const events:string[]=[];for(const type of ['mousedown','mouseup','click'])f.choice.addEventListener(type,()=>events.push(type));
  f.choice.onclick=()=>{setTimeout(()=>{f.value.value='One year';f.list.setAttribute('aria-expanded','false');},15);};
  expect(await prepareUploadAnswer(input)).toEqual({done:true});expect(f.value.value).toBe('One year');expect(events).toEqual(['mousedown','mouseup','click']);expect(scroll).not.toHaveBeenCalled();
});
it('keeps a trusted mouse fallback before the clamped keyboard fallback when the pointer did not commit',async()=>{
  const f=menu();f.list.setAttribute('aria-expanded','true');
  expect(await prepareUploadAnswer(input)).toEqual({x:60,y:35});
  expect(await prepareUploadAnswer(input)).toEqual({keys:['ArrowUp','ArrowDown','Enter']});
  expect(f.value.value).toBe('');
});
it('does not click a hidden template when the visible popup contains the same option',async()=>{
  const f=menu();const copy=f.choice.cloneNode(true) as HTMLElement;f.list.append(copy);const hiddenClick=vi.fn();copy.onclick=hiddenClick;
  Object.defineProperty(document,'elementFromPoint',{configurable:true,value:()=>f.choice});
  f.choice.onclick=()=>{f.value.value='One year';};
  expect(await prepareUploadAnswer(input)).toEqual({done:true});expect(hiddenClick).not.toHaveBeenCalled();Reflect.deleteProperty(document,'elementFromPoint');
});
it('falls back to keyboard for an off-screen choice without clicking another option',async()=>{
  const f=menu();f.list.setAttribute('aria-expanded','true');const clicks=vi.fn();f.choice.onclick=clicks;
  Object.defineProperty(document,'elementFromPoint',{configurable:true,value:()=>null});
  expect(await prepareUploadAnswer(input)).toEqual({keys:['ArrowUp','ArrowDown','Enter']});expect(clicks).not.toHaveBeenCalled();Reflect.deleteProperty(document,'elementFromPoint');
});
it('supports an actual native select using its value setter and change events',async()=>{
  document.body.innerHTML='<div data-item-id="duration"><h3>Duration</h3><select name="entry.123"><option value="">Choose</option><option value="One year">One year</option></select></div>';
  const select=document.querySelector('select')!,changed=vi.fn();select.onchange=changed;
  expect(await prepareUploadAnswer(input)).toEqual({done:true});expect(select.value).toBe('One year');expect(changed).toHaveBeenCalledOnce();
});
it('Stop during a pointer press releases without clicking or opening the Picker',async()=>{
  const f=menu(),click=vi.fn();f.opener.onclick=click;f.opener.addEventListener('mousedown',()=>{document.documentElement.dataset.hanuDirectStopped='1';});
  await expect(prepareUploadAnswer(input)).rejects.toThrow('Đã dừng');expect(click).not.toHaveBeenCalled();expect(f.value.value).toBe('');
});
