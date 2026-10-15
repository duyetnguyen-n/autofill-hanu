// @vitest-environment jsdom
import {afterEach,expect,it,vi} from 'vitest';
let listener:any;
afterEach(()=>{listener?.({type:'HALT_RUN'},{},()=>{});vi.useRealTimers();vi.unstubAllGlobals();vi.restoreAllMocks();vi.resetModules();document.body.replaceChildren();});
async function fixture(width=640,restore=false,late=false,validation=false,transient=false){
  vi.useFakeTimers();
  document.body.innerHTML='<div role="listitem"><div role="heading">TÔI CAM KẾT本人保证 *</div><div id="choices"></div></div><div role="alert"></div><button>Tiếp</button>';
  const mount=()=>{document.querySelector('#choices')!.innerHTML='<div role="radio" data-value="Tôi cam kết không thuê người đăng ký dự thi kỳ thi lần này." aria-checked="false"></div>';const r=document.querySelector('[role="radio"]')!;r.addEventListener('click',()=>r.setAttribute('aria-checked','true'));};
  if(late)setTimeout(mount,1800);else mount();
  Object.defineProperty(HTMLElement.prototype,'scrollIntoView',{configurable:true,value:()=>{}});
  vi.spyOn(HTMLElement.prototype,'getBoundingClientRect').mockImplementation(function(this:HTMLElement){return {width:this.tagName==='BUTTON'?70:width,height:50,left:0,top:0} as DOMRect;});
  let clickedAt=0,advancedAt=0;
  const clicks=vi.fn(()=>{clickedAt=Date.now();if(transient){const transientButton=document.createElement('button');transientButton.textContent='Cancel upload';document.body.append(transientButton);setTimeout(()=>document.querySelector('button')!.textContent='Submit',400);}else if(validation)document.querySelector('[role="alert"]')!.textContent='Đây là một câu hỏi bắt buộc';else document.querySelector('button')!.textContent='Submit';});document.querySelector('button')!.addEventListener('click',clicks);
  const sent:any[]=[];vi.stubGlobal('chrome',{runtime:{onMessage:{addListener:(fn:any)=>listener=fn},sendMessage:async(m:any)=>{sent.push(m);if(m.type==='FORM_EVENT'&&m.event.type==='page_advanced')advancedAt=Date.now();if(m.type==='TRUSTED_CLICK')return {dispatched:false};if(m.type==='GET_PROFILE')return {values:{firstCommitment:'true'},customFields:[],attachments:{},mappings:{}};if(m.type==='PAGE_ATTENTION_ACQUIRE'){if(restore)width=640;return {ok:true,token:'foreground'};}return m.type==='GET_RUN_FOR_TAB'?undefined:{ok:true};}}});
  await import('../src/content');listener({type:'RUN_CURRENT_PAGE',mode:'test'},{},()=>{});await vi.runAllTimersAsync();return {clicks,sent,advancedDelay:advancedAt-clickedAt,checked:document.querySelector('[role="radio"]')?.getAttribute('aria-checked')};
}
it('never clicks Next while the required card has zero width',async()=>{const f=await fixture(0);expect(f.clicks).not.toHaveBeenCalled();expect(f.checked).toBe('false');expect(f.sent).toContainEqual(expect.objectContaining({type:'FORM_EVENT',event:expect.objectContaining({type:'block',issue:expect.objectContaining({message:expect.stringContaining('Chưa bấm Tiếp')})})}));});
it('restores layout before scanning, fills the previously zero-width card and advances',async()=>{const f=await fixture(0,true);expect(f.checked).toBe('true');expect(f.clicks).toHaveBeenCalledOnce();expect(f.sent).toContainEqual(expect.objectContaining({type:'FORM_EVENT',event:{type:'ready_to_submit'}}));expect(f.sent).toContainEqual({type:'PAGE_ATTENTION_RELEASE',token:'foreground'});});
it('waits for a required question whose controls are mounted after the document load',async()=>{const f=await fixture(640,false,true);expect(f.checked).toBe('true');expect(f.clicks).toHaveBeenCalledOnce();expect(f.sent).toContainEqual(expect.objectContaining({type:'FORM_EVENT',event:{type:'ready_to_submit'}}));});
it('reports the real Vietnamese validation text with “một” and does not retry Next',async()=>{const f=await fixture(640,false,false,true);expect(f.clicks).toHaveBeenCalledOnce();expect(f.sent).toContainEqual(expect.objectContaining({type:'FORM_EVENT',event:expect.objectContaining({type:'block',issue:expect.objectContaining({message:'Google Forms báo lỗi: Đây là một câu hỏi bắt buộc'})})}));});

it('ignores upload-action mutations while Next is loading instead of advancing the same page twice',async()=>{const f=await fixture(640,false,false,false,true);expect(f.clicks).toHaveBeenCalledOnce();expect(f.advancedDelay).toBeGreaterThanOrEqual(400);expect(f.sent).toContainEqual(expect.objectContaining({type:'FORM_EVENT',event:{type:'ready_to_submit'}}));});
