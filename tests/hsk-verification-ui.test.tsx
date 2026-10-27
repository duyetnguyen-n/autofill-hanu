// @vitest-environment jsdom
import React,{act} from 'react';
import {createRoot,type Root} from 'react-dom/client';
import {afterEach,expect,it,vi} from 'vitest';
import {HskVerification} from '../manager/ui/HskVerification';
vi.mock('../manager/ui/Notice',()=>({Notice:({intent,children,actions,onDismiss}:any)=><div role={intent==='error'?'alert':'status'}>{children}{actions}{onDismiss&&<button onClick={onDismiss}>Đóng thông báo</button>}</div>}));

// Keep real React event/effect behavior; Fluent presentation is immaterial here.
vi.mock('@fluentui/react-components',()=>({
 Button:({appearance,size,children,...props}:any)=><button {...props}>{children}</button>,
 Field:({label,hint,children}:any)=><label>{label}{children}</label>,
 Input:({onChange,...props}:any)=><input {...props} onInput={e=>onChange?.(e,{value:e.currentTarget.value})}/>,
 Select:({children,...props}:any)=><select {...props}>{children}</select>,
}));
let root:Root|undefined;
afterEach(async()=>{if(root)await act(async()=>root!.unmount());root=undefined;document.body.replaceChildren();vi.unstubAllGlobals();});
const label='Câu mới chưa được nhận diện *';
const question={id:'new',targetId:'entry.40',label,kind:'text',required:true,filled:false,options:[],verification:false};
async function fixture(extra:any={}){
 vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT',true);
 const host=document.createElement('div');document.body.append(host);root=createRoot(host);
 const save=vi.fn(async()=>({})),scan=vi.fn(async()=>({formId:'form',runId:'run',questions:[question]}));
 const props={level:'4',sessions:[{id:'profile',name:'Candidate',connected:true,run:{runId:'run',formId:'form',status:'waiting_manual',blockingIssue:{reason:'unknown_required',questionId:'new',questionLabel:label}}}],saved:{value:'HANU'},scope:'schedule:form',busy:false,onDraft:vi.fn(),save,scan,...extra};
 await act(async()=>root!.render(<HskVerification {...props}/>));return {save,scan,host};
}
async function click(name:string){const button=[...document.querySelectorAll('button')].find(b=>b.textContent===name);expect(button).toBeDefined();await act(async()=>button!.click());}
it('reads an unknown blocker without applying the saved answer until it is explicitly selected',async()=>{
 const f=await fixture();expect(f.save).not.toHaveBeenCalled();expect(f.host.textContent).toContain(label);
 await click('Lấy câu xác thực');expect(f.scan).toHaveBeenCalledWith('profile');expect(f.save).not.toHaveBeenCalled();
 const select=document.querySelector('select')!;expect(select.value).toBe('');
 await act(async()=>{select.value='new';select.dispatchEvent(new Event('change',{bubbles:true}));});
 expect(f.save).toHaveBeenCalledExactlyOnceWith({label,value:'HANU',formId:'form',questionId:'entry.40',kind:'text'});
});
it('the explicit use-blocked-question action reads the current form then applies its exact entry',async()=>{
 const f=await fixture();await click('Dùng câu này & tiếp tục');
 expect(f.scan).toHaveBeenCalledTimes(1);expect(f.save).toHaveBeenCalledExactlyOnceWith({label,value:'HANU',formId:'form',questionId:'entry.40',kind:'text'});
});
it('does not save when the read belongs to another form or the blocker has changed',async()=>{
 const scan=vi.fn(async()=>({formId:'other',questions:[question]})),f=await fixture({scan});
 await click('Dùng câu này & tiếp tục');expect(f.save).not.toHaveBeenCalled();expect(document.querySelector('[role="alert"]')?.textContent).toContain('form khác');
 scan.mockResolvedValueOnce({formId:'form',questions:[{...question,id:'changed'}]});
 await click('Dùng câu này & tiếp tục');expect(f.save).not.toHaveBeenCalled();
});
it('uses question IDs rather than duplicate labels when the user selects a candidate',async()=>{
 const q1={...question,verification:true},q2={...q1,id:'second',targetId:'entry.50'};
 const f=await fixture({scan:vi.fn(async()=>({formId:'form',questions:[q1,q2]}))});await click('Lấy câu xác thực');
 expect(f.save).not.toHaveBeenCalled();const select=document.querySelector('select')!;
 await act(async()=>{select.value='second';select.dispatchEvent(new Event('change',{bubbles:true}));});
 expect(f.save).toHaveBeenCalledExactlyOnceWith({label,value:'HANU',formId:'form',questionId:'entry.50',kind:'text'});
});
it('does not fall back to sessions outside the schedule current runs',async()=>{
 const f=await fixture({currentRunIds:{profile:'other-run'}});await click('Lấy câu xác thực');
 expect(f.scan).not.toHaveBeenCalled();expect(f.save).not.toHaveBeenCalled();
});
it('preserves the normal recognized-verification apply flow without another scan',async()=>{
 const fee='Lệ phí thi HSK4+HSK Khẩu ngữ Trung cấp năm 2026 là bao nhiêu? *';
 const f=await fixture({sessions:[{id:'profile',connected:true,run:{runId:'run',formId:'form',status:'waiting_manual',blockingIssue:{reason:'verification',questionId:'new',questionLabel:fee,question:{...question,label:fee,verification:true}}}}]});
 await click('Lưu & tự tiếp tục');expect(f.scan).not.toHaveBeenCalled();
 expect(f.save).toHaveBeenCalledExactlyOnceWith({label:fee,value:'HANU',formId:'form',questionId:'entry.40',kind:'text'});
});
it('rejects another run even if it has the same form and question',async()=>{
 const f=await fixture({scan:vi.fn(async()=>({formId:'form',runId:'new-run',questions:[question]}))});
 await click('Dùng câu này & tiếp tục');expect(f.save).not.toHaveBeenCalled();expect(document.querySelector('[role="alert"]')?.textContent).toContain('Lượt đã thay đổi');
});
it('can retry a failed read without applying an answer from the failed attempt',async()=>{
 const scan=vi.fn().mockRejectedValueOnce(new Error('Mất kết nối')).mockResolvedValueOnce({formId:'form',runId:'run',questions:[question]});
 const f=await fixture({scan});await click('Dùng câu này & tiếp tục');expect(f.save).not.toHaveBeenCalled();
 await click('Dùng câu này & tiếp tục');expect(f.save).toHaveBeenCalledTimes(1);
});
