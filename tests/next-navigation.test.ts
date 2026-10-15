// @vitest-environment jsdom
import {afterEach,expect,it,vi} from 'vitest';

let listener:any;
afterEach(()=>{listener?.({type:'HALT_RUN'},{},()=>{});vi.useRealTimers();vi.unstubAllGlobals();vi.restoreAllMocks();vi.resetModules();document.body.replaceChildren();});

async function fixture(options:{delay?:number;bridge?:'native'|'unavailable'|'missing'|'error';hidden?:boolean;covered?:boolean;disabled?:boolean;transition?:'empty'|'late-controls'|'instructions'|'long-label';haltDuringDispatch?:boolean}={}){
  vi.useFakeTimers();
  const card='<div role="listitem" data-item-id="name"><div role="heading">Họ và tên *</div><input type="text" value="AUDIT" required></div>';
  document.body.innerHTML=card+'<button id="next">Tiếp</button>';
  if(options.transition==='long-label')document.querySelector('[role="heading"]')!.textContent='Họ và tên '+ 'X'.repeat(900);
  // A prefilled unrecognized long title is valid, without guessing its mapping.
  const next=document.querySelector<HTMLButtonElement>('#next')!;
  if(options.disabled)next.disabled=true;
  const box={left:10,top:10,width:100,height:40,right:110,bottom:50,x:10,y:10,toJSON:()=>({})};
  vi.spyOn(HTMLElement.prototype,'getBoundingClientRect').mockImplementation(()=>box);
  const scroll=vi.fn(()=>{options.hidden=false;});Object.defineProperty(HTMLElement.prototype,'scrollIntoView',{configurable:true,value:scroll});
  const cover=document.createElement('div');
  Object.defineProperty(document,'elementFromPoint',{configurable:true,value:()=>options.covered?cover:options.hidden?null:next});
  const events:any[]=[],clicks:number[]=[],native=vi.fn(),submit=vi.fn();
  const commit=()=>{
    if(options.transition==='instructions')document.querySelector('[role="listitem"]')!.outerHTML='<h2>Trang hướng dẫn</h2>';
    if(options.transition==='long-label'&&clicks.length===1){document.querySelector('[role="listitem"]')!.setAttribute('data-item-id','another-section');return;}
    next.textContent='Submit';
  };
  next.addEventListener('click',()=>{
    if(next.textContent==='Submit'){submit();return;}
    clicks.push(Date.now());
    if(options.transition==='empty'){
      document.querySelector('[role="listitem"]')!.remove();next.remove();
      setTimeout(()=>{document.body.innerHTML='<h2>Trang cuối</h2>';document.body.append(next);commit();},800);
    }else if(options.transition==='late-controls'){
      document.querySelector('[role="listitem"]')!.innerHTML='<div role="heading">Email *</div>';
      next.textContent='Submit';setTimeout(()=>document.querySelector('[role="listitem"]')!.insertAdjacentHTML('beforeend','<input type="email" required>'),800);
    }else if(options.delay)setTimeout(commit,options.delay);
    else commit();
  });
  vi.stubGlobal('chrome',{runtime:{onMessage:{addListener:(fn:any)=>listener=fn},sendMessage:async(m:any)=>{
    if(m.type==='GET_PROFILE')return {values:{fullName:'AUDIT',email:'audit@example.test'},customFields:[],attachments:{},mappings:{}};
    if(m.type==='CLAIM_DOCUMENT'||m.type==='GET_RUN_FOR_TAB')return undefined;
    if(m.type==='FORM_EVENT'){events.push({at:Date.now(),...m.event});return {ok:true};}
    if(m.type==='PAGE_ATTENTION_ACQUIRE')return {ok:true,token:'fixture'};
    if(m.type==='TRUSTED_CLICK'){
      native();if(options.bridge==='unavailable')return {dispatched:false};
      next.click();
      if(options.haltDuringDispatch)listener({type:'HALT_RUN'},{},()=>{});
      if(options.bridge==='missing')return undefined;
      if(options.bridge==='error')throw new Error('Lost acknowledgement');
      return {dispatched:true};
    }
    return {ok:true};
  }}});
  await import('../src/content');listener({type:'RUN_CURRENT_PAGE',mode:'test'},{},()=>{});
  await vi.advanceTimersByTimeAsync(0);
  return {events,clicks,native,submit,scroll,next};
}

it('uses browser input immediately and never follows it with a synthetic duplicate',async()=>{
  const f=await fixture();await vi.runAllTimersAsync();expect(f.native).toHaveBeenCalledOnce();expect(f.clicks).toHaveLength(1);expect(f.events.at(-1)).toMatchObject({type:'ready_to_submit'});expect(f.submit).not.toHaveBeenCalled();
});
it('keeps waiting for a slow accepted click without a second click',async()=>{
  const f=await fixture({delay:1800});await vi.advanceTimersByTimeAsync(1000);expect(f.clicks).toHaveLength(1);expect(f.events.some(e=>e.type==='page_advanced')).toBe(false);await vi.runAllTimersAsync();expect(f.clicks).toHaveLength(1);expect(f.events.at(-1)).toMatchObject({type:'ready_to_submit'});
});
it.each(['missing','error'] as const)('does not duplicate an accepted click when the bridge acknowledgement is %s',async bridge=>{
  const f=await fixture({bridge,delay:1000});await vi.runAllTimersAsync();expect(f.clicks).toHaveLength(1);expect(f.events.at(-1)).toMatchObject({type:'ready_to_submit'});
});
it('falls back once when the browser bridge explicitly could not dispatch',async()=>{
  const f=await fixture({bridge:'unavailable'});await vi.runAllTimersAsync();expect(f.native).toHaveBeenCalledOnce();expect(f.clicks).toHaveLength(1);expect(f.events.at(-1)).toMatchObject({type:'ready_to_submit'});
});
it('scrolls the button into view before checking its hit target',async()=>{
  const f=await fixture({hidden:true});await vi.runAllTimersAsync();expect(f.scroll).toHaveBeenCalled();expect(f.native).toHaveBeenCalledOnce();expect(f.events.at(-1)).toMatchObject({type:'ready_to_submit'});
});
it.each([{covered:true},{disabled:true}])('does not click an obscured or disabled Next: %j',async options=>{
  const f=await fixture(options);await vi.runAllTimersAsync();expect(f.native).not.toHaveBeenCalled();expect(f.clicks).toHaveLength(0);expect(f.events.at(-1)).toMatchObject({type:'block'});
});
it('waits through an empty transition without reporting an advance or failure early',async()=>{
  const f=await fixture({transition:'empty'});await vi.advanceTimersByTimeAsync(700);expect(f.events.some(e=>['page_advanced','failed','block'].includes(e.type))).toBe(false);await vi.runAllTimersAsync();expect(f.events.at(-1)).toMatchObject({type:'ready_to_submit'});expect(f.clicks).toHaveLength(1);
});
it('waits for the new required controls before advancing, then fills them',async()=>{
  const f=await fixture({transition:'late-controls'});await vi.advanceTimersByTimeAsync(700);expect(f.events.some(e=>e.type==='page_advanced')).toBe(false);await vi.runAllTimersAsync();expect((document.querySelector('input') as HTMLInputElement).value).toBe('audit@example.test');expect(f.events.at(-1)).toMatchObject({type:'ready_to_submit'});expect(f.submit).not.toHaveBeenCalled();
});
it('accepts a section containing only instructions',async()=>{
  const f=await fixture({transition:'instructions'});await vi.runAllTimersAsync();expect(f.events.at(-1)).toMatchObject({type:'ready_to_submit'});
});
it('distinguishes long identical titles by stable item ID',async()=>{
  const f=await fixture({transition:'long-label'});await vi.runAllTimersAsync();expect(f.events.at(-1)).toMatchObject({type:'ready_to_submit'});expect(f.clicks).toHaveLength(2);expect(f.events.find(e=>e.type==='page_advanced')!.at-f.clicks[0]).toBeLessThan(100);
});
it('does not continue after Stop arrives during browser dispatch',async()=>{
  const f=await fixture({haltDuringDispatch:true,delay:1000});await vi.runAllTimersAsync();expect(f.clicks).toHaveLength(1);expect(f.events.some(e=>['page_advanced','ready_to_submit'].includes(e.type))).toBe(false);expect(f.submit).not.toHaveBeenCalled();
});
