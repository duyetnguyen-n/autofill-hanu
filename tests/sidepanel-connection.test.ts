// @vitest-environment jsdom
import {readFileSync} from 'node:fs';
import {afterEach,expect,it,vi} from 'vitest';
import {emptyProfile} from '../src/rules';

afterEach(()=>{window.dispatchEvent(new Event('pagehide'));vi.useRealTimers();vi.unstubAllGlobals();vi.resetModules();document.body.replaceChildren();});
function setup(granted=false){
  vi.useFakeTimers();vi.stubGlobal('__HANU_CLOUD_ORIGIN__','https://fixture.example');
  document.body.innerHTML=readFileSync('sidepanel.html','utf8');
  let allowed=granted,removed:Function|undefined;
  const request=vi.fn(async()=>{allowed=true;return true;}),send=vi.fn(async(m:any)=>{
    if(m.type==='GET_PANEL_STATE')return {profile:emptyProfile(),tabId:1};
    if(m.type==='FACEBOOK_STATUS')return {ok:true,status:{permission:allowed?'granted':'missing',reader:allowed?'ready':'missing'}};
    if(m.type==='NATIVE_STATUS')return {extensionId:'a'.repeat(32),sessionId:'fixture-session',connected:true,paired:true};
    return {ok:true};
  });
  vi.stubGlobal('chrome',{runtime:{getManifest:()=>({version:'test'}),onMessage:{addListener:vi.fn()},sendMessage:send},permissions:{contains:vi.fn(async()=>allowed),request,onAdded:{addListener:vi.fn(),removeListener:vi.fn()},onRemoved:{addListener:(fn:Function)=>{removed=fn;},removeListener:vi.fn()}}});
  return {request,send,revoke(){allowed=false;removed?.();}};
}
it('shows the existing Facebook grant without prompting and updates after revocation',async()=>{
  const f=setup(true);await import('../src/sidepanel');
  await vi.waitFor(()=>expect(document.querySelector('#facebookPermissionStatus')!.textContent).toContain('Đã có quyền · bộ đọc sẵn sàng'));
  expect(document.querySelector<HTMLButtonElement>('#enableFacebook')!.disabled).toBe(false);expect(f.request).not.toHaveBeenCalled();
  document.querySelector<HTMLButtonElement>('#enableFacebook')!.click();
  await vi.waitFor(()=>expect(f.send).toHaveBeenCalledWith({type:'FACEBOOK_ENABLE'}));expect(f.request).not.toHaveBeenCalled();
  await vi.waitFor(()=>expect(document.querySelector<HTMLButtonElement>('#enableFacebook')!.disabled).toBe(false));
  f.revoke();await vi.waitFor(()=>expect(document.querySelector('#enableFacebook')!.textContent).toContain('Cho phép theo dõi Facebook'));
  expect(document.querySelector('#enableFacebook')!.textContent).toContain('Cho phép theo dõi Facebook');
});
it('requests permission only on click and preserves an expanded connection section across refreshes',async()=>{
  const f=setup();await import('../src/sidepanel');
  const details=document.querySelector<HTMLDetailsElement>('#pairingDetails')!;
  await vi.waitFor(()=>expect(details.open).toBe(false));
  expect(document.querySelector('#connectionBadge')!.textContent).toBe('Đã kết nối');
  expect(f.request).not.toHaveBeenCalled();
  details.open=true;document.querySelector<HTMLInputElement>('#pairCode')!.value='draft-code';
  await vi.advanceTimersByTimeAsync(3000);expect(details.open).toBe(true);expect(document.querySelector<HTMLInputElement>('#pairCode')!.value).toBe('draft-code');
  document.querySelector<HTMLButtonElement>('#enableFacebook')!.click();expect(f.request).toHaveBeenCalledOnce();
  await vi.waitFor(()=>expect(document.querySelector('#facebookPermission')!.getAttribute('data-granted')).toBe('true'));
  expect(f.send).toHaveBeenCalledWith({type:'FACEBOOK_ENABLE'});
});

it('requires a destructive warning before unlink and allows cancelling',async()=>{
  const f=setup(true);await import('../src/sidepanel');await vi.waitFor(()=>expect(document.querySelector('#unlinkProfile')!.hasAttribute('hidden')).toBe(false));
  const confirm=vi.spyOn(window,'confirm').mockReturnValue(false);
  document.querySelector<HTMLButtonElement>('#unlinkProfile')!.click();expect(confirm).toHaveBeenCalledWith(expect.stringContaining('xóa vĩnh viễn'));expect(f.send).not.toHaveBeenCalledWith({type:'NATIVE_UNLINK'});
  confirm.mockReturnValue(true);document.querySelector<HTMLButtonElement>('#unlinkProfile')!.click();await vi.waitFor(()=>expect(f.send).toHaveBeenCalledWith({type:'NATIVE_UNLINK'}));confirm.mockRestore();
});
