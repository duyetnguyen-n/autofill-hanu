// @vitest-environment jsdom
import React,{act,useEffect,useState} from 'react';
import {createRoot,type Root} from 'react-dom/client';
import {afterEach,beforeEach,expect,it,vi} from 'vitest';
vi.mock('@fluentui/react-components',()=>({Button:({children,...props}:any)=><button {...props}>{children}</button>}));
vi.mock('../manager/ui/AccountPage',()=>({AccountPage:()=> <div>Account restricted</div>}));
import {CloudGate} from '../manager/ui/CloudLogin';
let root:Root,host:HTMLDivElement,mounts=0;
const account={id:'user',email:'test@example.test',emailVerified:true,status:'active'};
const reply=(status:number,data:any)=>new Response(JSON.stringify(data),{status});
function Workspace(){const [selection,setSelection]=useState('profile-a');useEffect(()=>{mounts++;},[]);return <button onClick={()=>setSelection('profile-b')}>{selection}</button>;}
beforeEach(()=>{vi.useFakeTimers();vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT',true);mounts=0;host=document.createElement('div');document.body.append(host);root=createRoot(host);vi.stubGlobal('fetch',vi.fn(async()=>reply(200,account)));});
afterEach(async()=>{await act(async()=>root.unmount());host.remove();vi.unstubAllGlobals();vi.useRealTimers();});
const render=()=>act(async()=>{root.render(<CloudGate>{()=> <Workspace/>}</CloudGate>);});
it.each(['network','503','html'])('keeps workspace and selection mounted after a temporary %s failure',async kind=>{
 await render();await act(async()=>host.querySelector('button')!.click());expect(host.textContent).toBe('profile-b');
 if(kind==='network')vi.mocked(fetch).mockRejectedValueOnce(new TypeError('Failed to fetch'));
 else vi.mocked(fetch).mockResolvedValueOnce(kind==='503'?reply(503,{error:'Busy'}):new Response('<html>gateway</html>',{status:502}));
 await act(async()=>vi.advanceTimersByTimeAsync(30000));expect(host.textContent).toBe('profile-b');expect(mounts).toBe(1);
 await act(async()=>vi.advanceTimersByTimeAsync(5000));expect(host.textContent).toBe('profile-b');expect(mounts).toBe(1);
});
it('rechecks an operation-level auth event without unmounting an authenticated workspace',async()=>{
 await render();await act(async()=>window.dispatchEvent(new Event('hanu-auth-expired')));expect(host.textContent).toBe('profile-a');expect(mounts).toBe(1);
});
it('still signs out after a confirmed auth/me 401 and restricts a revoked account',async()=>{
 await render();vi.mocked(fetch).mockResolvedValueOnce(reply(200,{...account,status:'blocked'}));
 await act(async()=>vi.advanceTimersByTimeAsync(30000));expect(host.textContent).toBe('Account restricted');
 vi.mocked(fetch).mockResolvedValueOnce(reply(401,{error:'Expired'}));await act(async()=>vi.advanceTimersByTimeAsync(30000));expect(host.textContent).toContain('Tiếp tục với Google');expect(host.textContent).not.toContain('profile-a');
});
it('shows retry, rather than sign-in, when the initial auth service is unavailable',async()=>{
 vi.mocked(fetch).mockResolvedValueOnce(reply(503,{error:'Busy'}));await render();expect(host.textContent).toContain('Thử kết nối lại');expect(host.textContent).not.toContain('Tiếp tục với Google');
 await act(async()=>vi.advanceTimersByTimeAsync(5000));expect(host.textContent).toBe('profile-a');
});
it('coalesces focus, expiry and timer checks while a request is pending',async()=>{
 await render();let resolve!:(r:Response)=>void;vi.mocked(fetch).mockImplementationOnce(()=>new Promise(r=>resolve=r));
 await act(async()=>{window.dispatchEvent(new Event('hanu-auth-expired'));window.dispatchEvent(new Event('hanu-account-updated'));await vi.advanceTimersByTimeAsync(30000);});
 expect(fetch).toHaveBeenCalledTimes(2);await act(async()=>resolve(reply(200,account)));expect(mounts).toBe(1);
});
