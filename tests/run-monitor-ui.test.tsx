// @vitest-environment jsdom
import React,{act} from 'react';
import {createRoot,type Root} from 'react-dom/client';
import {afterEach,expect,it,vi} from 'vitest';
import {LiveRunBar,currentRunTarget} from '../manager/ui/LiveRunBar';
vi.mock('@fluentui/react-components',()=>({Button:({appearance,icon,children,...props}:any)=><button {...props}>{children}</button>,Select:({children,...props}:any)=><select {...props}>{children}</select>}));
vi.mock('../manager/ui/Notice',()=>({Notice:({intent,children,onDismiss}:any)=><div role={intent==='error'?'alert':'status'}>{children}{onDismiss&&<button onClick={onDismiss}>Đóng thông báo</button>}</div>}));
let root:Root|undefined;
afterEach(async()=>{if(root)await act(async()=>root!.unmount());root=undefined;document.body.replaceChildren();vi.unstubAllGlobals();});
const createdAt=new Date().toISOString();
const group={id:'group',mode:'test',members:['a','b'],paused:false,createdAt};
const sessions=[{id:'a',name:'Profile A',run:{runId:'group',status:'running',updatedAt:createdAt}},{id:'b',name:'Profile B',run:{runId:'group',status:'waiting_manual',updatedAt:createdAt}}];
async function mount(extra:any={}){
 vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT',true);const host=document.createElement('div');document.body.append(host);root=createRoot(host);
 const request=vi.fn(async()=>[]),onDismiss=vi.fn();const props={target:{kind:'group',id:'group',createdAt},groups:[group],sessions,connected:true,onTarget:vi.fn(),onDismiss,request,...extra};
 await act(async()=>root!.render(<LiveRunBar {...props}/>));return {request,onDismiss,host,props};
}
async function click(text:string){await act(async()=>{[...document.querySelectorAll('button')].find(b=>b.textContent===text||b.getAttribute('aria-label')===text)!.click();});}
it('tracks Test schedules across their separate groups rather than choosing only the latest group',()=>{
 const schedule={id:'schedule',mode:'test',status:'finished',members:[{id:'a',runId:'group'}],createdAt};
 expect(currentRunTarget(schedule as any,[group] as any,sessions as any)).toEqual({kind:'schedule',id:'schedule',createdAt});
});
it('starts compact and can expand, collapse and dismiss while keeping Stop reachable',async()=>{
 const f=await mount();expect(document.querySelector('[aria-label="Mở rộng theo dõi"]')).not.toBeNull();
 await act(async()=>document.querySelector<HTMLButtonElement>('[aria-label="Mở rộng theo dõi"]')!.click());
 await act(async()=>document.querySelector<HTMLButtonElement>('[aria-label="Thu gọn theo dõi"]')!.click());
 expect(document.querySelector('select')).toBeNull();expect([...document.querySelectorAll('button')].some(b=>b.getAttribute('aria-label')==='Dừng toàn bộ lượt')).toBe(true);
 await act(async()=>document.querySelector<HTMLButtonElement>('[aria-label="Ẩn bảng theo dõi"]')!.click());expect(f.onDismiss).toHaveBeenCalledOnce();
});
it('keeps retry enabled after a cancelled schedule has a failed Stop acknowledgement',async()=>{
 const schedule={id:'schedule',mode:'live',status:'cancelled',members:[{id:'a',runId:'group',status:'started'},{id:'b',runId:'group',status:'started'}],createdAt};
 const f=await mount({target:{kind:'schedule',id:'schedule',createdAt},schedule});
 f.request.mockResolvedValueOnce([{id:'b',ok:false,error:'Mất kết nối'}] as any);await click('Thử dừng lại');
 expect(f.request).toHaveBeenCalledWith('registration-schedule/stop',{scheduleId:'schedule'});expect(document.querySelector('[role="alert"]')?.textContent).toContain('Profile B');
 expect([...document.querySelectorAll<HTMLButtonElement>('button')].find(b=>b.textContent==='Thử dừng lại')?.disabled).toBe(false);
 await click('Thử dừng lại');expect(f.request).toHaveBeenCalledTimes(2);
});
it('can Stop while Pause is still pending',async()=>{
 let release!:(v:any)=>void;const request=vi.fn((path:string)=>path.endsWith('/pause')?new Promise(r=>release=r):Promise.resolve([]));
 await mount({request});await click('Tạm dừng lượt');await click('Dừng toàn bộ lượt');
 expect(request.mock.calls.map(c=>c[0])).toEqual(['groups/group/pause','groups/group/stop']);await act(async()=>release([]));
});
it('does not treat an idle manager run as stopped when the extension still reports execution',async()=>{
 const f=await mount({groups:[{...group,stopped:true}],sessions:sessions.map(s=>({...s,run:{...s.run,status:'idle'},execution:{status:'running'}}))});
 expect(f.host.textContent).toContain('Còn profile chưa xác nhận dừng');expect([...document.querySelectorAll<HTMLButtonElement>('button')].find(b=>b.textContent==='Thử dừng lại')?.disabled).toBe(false);
});
it('does not expose historical group IDs or a run-history dropdown in the live dock',async()=>{
 await mount({groups:[group,...Array.from({length:50},(_,i)=>({...group,id:`old-${i}`,createdAt:new Date(Date.now()-i*60000).toISOString()}))]});
 await act(async()=>document.querySelector<HTMLButtonElement>('[aria-label="Mở rộng theo dõi"]')!.click());
 expect(document.querySelector('select')).toBeNull();expect(document.body.textContent).not.toContain('old-');expect(document.body.textContent).toContain('2 profile');
});
it('confirms a cancelled waiting-only schedule without matching two missing run IDs',async()=>{
 const schedule={id:'schedule',mode:'test',status:'cancelled',members:[{id:'a',status:'waiting'},{id:'b',status:'waiting'}],createdAt},waiting=sessions.map(({id,name})=>({id,name}));
 expect(currentRunTarget(schedule as any,[],waiting as any)).toBeUndefined();
 const f=await mount({target:{kind:'schedule',id:'schedule',createdAt},schedule,groups:[],sessions:waiting});
 expect(f.host.querySelector('h2')?.textContent).toBe('Đã dừng');expect(f.host.textContent).not.toContain('Còn profile');expect(f.host.querySelector('[aria-label="Thử dừng lại"]')).toBeNull();
});
