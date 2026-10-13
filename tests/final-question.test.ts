// @vitest-environment jsdom
// @vitest-environment-options {"url":"https://docs.google.com/forms/d/e/final-fixture/viewform"}
import {afterEach,expect,it,vi} from 'vitest';
import {emptyProfile} from '../src/rules';
import {matchesFinalQuestionLabel,validateFinalQuestion,type FinalQuestion} from '../src/shared';
let listener:any;
afterEach(()=>{listener?.({type:'HALT_RUN'},{},()=>{});vi.useRealTimers();vi.unstubAllGlobals();vi.restoreAllMocks();vi.resetModules();document.body.replaceChildren();});
const label='Năm nay là năm bao nhiêu?';
const card=(title=label,id='123',control='<input type="text" name="entry.123">')=>`<div role="listitem" data-item-id="${id}"><div role="heading">${title} *</div>${control}</div>`;
async function run(html:string,finalQuestion?:FinalQuestion){
  vi.useFakeTimers();
  document.body.innerHTML=html+'<button>Submit</button>';
  vi.spyOn(HTMLElement.prototype,'getBoundingClientRect').mockReturnValue({width:640,height:80} as DOMRect);
  Object.defineProperty(HTMLElement.prototype,'scrollIntoView',{configurable:true,value:()=>{}});
  const sent:any[]=[],submit=vi.fn();document.querySelector('button')!.onclick=submit;
  vi.stubGlobal('chrome',{runtime:{onMessage:{addListener:(fn:any)=>listener=fn},sendMessage:async(m:any)=>{sent.push(m);if(m.type==='GET_PROFILE')return emptyProfile();if(m.type==='GET_RUN_FOR_TAB')return {finalQuestion};return {ok:true};}}});
  await import('../src/content');await vi.runAllTimersAsync();listener({type:'RUN_CURRENT_PAGE',mode:'test',finalQuestion},{},()=>{});await vi.runAllTimersAsync();
  return {sent,submit,events:sent.filter(m=>m.type==='FORM_EVENT').map(m=>m.event)};
}
it('fills an explicitly supplied verification answer and Test still never submits',async()=>{
  const f=await run(card(),{label,value:'2026'});expect(document.querySelector('input')!.value).toBe('2026');expect(f.events).toContainEqual({type:'ready_to_submit'});expect(f.submit).not.toHaveBeenCalled();
});
it('keeps verification manual without an explicit shared answer',async()=>{const f=await run(card());expect(document.querySelector('input')!.value).toBe('');expect(f.events.at(-1)).toMatchObject({type:'block',issue:{reason:'verification'}});});
it('corrects a stale prefilled verification answer using the supplied answer',async()=>{const f=await run(card(label,'123','<input type="text" name="entry.123" value="2025">'),{label,value:'2026'});expect(document.querySelector('input')!.value).toBe('2026');expect(f.events.at(-1)).toEqual({type:'ready_to_submit'});});
it('refuses to guess by last position or partial title',async()=>{const f=await run(card('Câu hỏi khác'),{label:'Câu hỏi',value:'2026'});expect(document.querySelector('input')!.value).toBe('');expect(f.events.at(-1)).toMatchObject({type:'block',issue:{message:expect.stringContaining('Không tìm thấy')}});});
it('blocks duplicate titles unless the exact stable question is selected',async()=>{const f=await run(card()+card(label,'456','<input type="text" name="entry.456">'),{label,value:'2026'});expect(f.events.at(-1)).toMatchObject({type:'block',issue:{message:expect.stringContaining('nhiều câu')}});});
it('uses a stable entry ID across profiles and ignores DOM generated IDs',async()=>{const f=await run(card(label,'different-dom-id','<input type="text" name="entry.123">'),{label,value:'2026',formId:'final-fixture',questionId:'entry.123',kind:'text'});expect(document.querySelector('input')!.value).toBe('2026');expect(f.events.at(-1)).toEqual({type:'ready_to_submit'});});
it('checks the title again even when the selected entry ID is still present',async()=>{const f=await run(card('Câu hỏi đã đổi'),{label,value:'2026',formId:'final-fixture',questionId:'entry.123'});expect(f.events.at(-1)).toMatchObject({type:'block',issue:{message:expect.stringContaining('nội dung đã thay đổi')}});expect(document.querySelector('input')!.value).toBe('');});
it.each([{formId:'other-form'},{kind:'textarea' as const}])('rejects wrong form/type: %j',async extra=>{const f=await run(card(),{label,value:'2026',...extra});expect(f.events.at(-1).type).toBe('block');expect(document.querySelector('input')!.value).toBe('');});
it('fills native dropdown by its answer label and checks it committed',async()=>{const f=await run(card('Câu hỏi cuối','123','<select><option value="">Choose</option><option value="answer-id">Đáp án chính xác</option></select>'),{label:'Câu hỏi cuối',value:'Đáp án chính xác',kind:'dropdown'});expect(document.querySelector('select')!.value).toBe('answer-id');expect(f.events.at(-1)).toEqual({type:'ready_to_submit'});});
it('reports an unavailable choice instead of continuing with an empty select',async()=>{const f=await run(card('Câu hỏi cuối','123','<select><option value="">Choose</option><option>Khác</option></select>'),{label:'Câu hỏi cuối',value:'Đáp án chính xác'});expect(f.events.at(-1)).toMatchObject({type:'block',issue:{reason:'unsupported'}});});
it('fills paragraph answers and checks the actual value',async()=>{const f=await run(card('Câu hỏi cuối','123','<textarea></textarea>'),{label:'Câu hỏi cuối',value:'Đáp án dài',kind:'textarea'});expect(document.querySelector('textarea')!.value).toBe('Đáp án dài');expect(f.events.at(-1)).toEqual({type:'ready_to_submit'});});
it('does not mistake a supplied Có answer for a boolean commitment',async()=>{const f=await run(card('Câu hỏi cuối','123','<input type="radio" name="answer" value="Không"><input type="radio" name="answer" value="Có">'),{label:'Câu hỏi cuối',value:'Có',kind:'radio'});expect(document.querySelectorAll<HTMLInputElement>('input')[0].checked).toBe(false);expect(document.querySelectorAll<HTMLInputElement>('input')[1].checked).toBe(true);expect(f.events.at(-1)).toEqual({type:'ready_to_submit'});});
it('fills an explicitly named checkbox option',async()=>{const f=await run(card('Câu hỏi cuối','123','<input type="checkbox" value="Đáp án A">'),{label:'Câu hỏi cuối',value:'Đáp án A',kind:'checkbox'});expect(document.querySelector<HTMLInputElement>('input')!.checked).toBe(true);expect(f.events.at(-1)).toEqual({type:'ready_to_submit'});});
it('removes stale checkbox answers so the common answer is the exact selection',async()=>{const f=await run(card('Câu hỏi cuối','123','<input type="checkbox" value="Đáp án A"><input type="checkbox" value="Đáp án B" checked>'),{label:'Câu hỏi cuối',value:'Đáp án A',kind:'checkbox'});expect([...document.querySelectorAll<HTMLInputElement>('input')].map(i=>i.checked)).toEqual([true,false]);expect(f.events.at(-1)).toEqual({type:'ready_to_submit'});});
it('scans the stable target ID, actual kind and visible options',async()=>{await run(card('Câu hỏi cuối','123','<select name="entry.789"><option>Choose</option><option>Đáp án A</option></select>'));let result:any;listener({type:'SCAN_FORM'},{},(r:any)=>result=r);expect(result.questions[0]).toMatchObject({targetId:'entry.789',kind:'dropdown',options:['Đáp án A']});});
it('normalizes numbering, accents and required markers but never title fragments',()=>{expect(matchesFinalQuestionLabel('12. Năm nay là năm bao nhiêu? *',label)).toBe(true);expect(matchesFinalQuestionLabel('Năm nay là năm bao nhiêu? / Một câu khác',label)).toBe(false);});
it('validates nonempty answers, supported types and form-scoped IDs',()=>{for(const value of [{label,value:''},{label,value:'2026',kind:'file'},{label,value:'2026',questionId:'entry.123'}])expect(()=>validateFinalQuestion(value)).toThrow();expect(()=>validateFinalQuestion(undefined)).not.toThrow();});
