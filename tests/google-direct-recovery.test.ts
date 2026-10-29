// @vitest-environment jsdom
import {afterEach,expect,it,vi} from 'vitest';
import {armDirectManualSubmit,disarmDirectManualSubmit,prepareDirectNativeSubmit,showDirectRecovery,restoreDirectNativePage,directManualReady} from '../src/google-direct/recovery-page';
import {postExecutionPage} from '../src/google-direct/execute-page';
import {DIRECT_LAB_FORM_ID,DIRECT_LAB_URL} from '../src/google-direct/schema';

afterEach(()=>{(document as Document&{hanuDirectRecoveryCleanup?:()=>void}).hanuDirectRecoveryCleanup?.();document.body.replaceChildren();for(const key of Object.keys(document.documentElement.dataset))delete document.documentElement.dataset[key];sessionStorage.clear();vi.restoreAllMocks();vi.unstubAllGlobals();});
function fixture(mode='live'){
  vi.stubGlobal('location',new URL(DIRECT_LAB_URL));
  document.documentElement.dataset.hanuDirectDocument='doc-final';
  document.body.innerHTML=`<form action="${DIRECT_LAB_URL.replace('viewform','formResponse')}">fixture@example.test <input type="hidden" name="fbzx" value="PRIVATE_SESSION"><input type="hidden" name="token" value="PRIVATE_TOKEN"><input type="hidden" name="pageHistory" value="0,1,2,3,5,6,7,8"><input type="hidden" name="partialResponse" value="[]"><input name="entry.123" value="1350000"><div role="button">Gửi</div></form>`;
  vi.spyOn(Element.prototype,'getBoundingClientRect').mockReturnValue({width:100,height:25} as DOMRect);
  const native=vi.spyOn(HTMLFormElement.prototype,'submit').mockImplementation(()=>{}),send=vi.fn(async()=>({ok:true}));
  vi.stubGlobal('chrome',{runtime:{sendMessage:send}});
  const google=vi.fn(()=>{
    const form=document.querySelector('form')!;
    if(form.querySelector<HTMLInputElement>('[name="entry.123"]')!.value!=='1350000'){const error=document.createElement('div');error.setAttribute('role','alert');error.textContent='Đáp án chưa đúng';form.append(error);return;}
    const dlut=document.createElement('input');dlut.type='hidden';dlut.name='dlut';dlut.value='GOOGLE_VALIDATED_REVISION';form.append(dlut);form.submit();
  });
  document.querySelector('[role="button"]')!.addEventListener('click',google);
  showDirectRecovery({runId:'one',formId:DIRECT_LAB_FORM_ID,account:'fixture@example.test',status:'waiting_manual',mode,manual:true,message:'Nhập đáp án',eventSeq:3});
  armDirectManualSubmit();return {native,send,google};
}
it('lets Google validate a manual answer before reserving any submit, and holds the exact native body',async()=>{
  const f=fixture();(document.querySelector('[role="button"]') as HTMLElement).click();await vi.waitFor(()=>expect(f.send).toHaveBeenCalledOnce());
  expect(f.native).not.toHaveBeenCalled();expect(f.send).toHaveBeenCalledWith({type:'DIRECT_MANUAL',action:'submit',runId:'one',documentKey:'doc-final'});
  expect(directManualReady('doc-final')).toBe(true);expect(directManualReady('other-document')).toBe(false);
  const body=new FormData(document.querySelector<HTMLFormElement>('#hanuDirectManualReady')!);
  expect(body.get('entry.123')).toBe('1350000');expect(body.get('dlut')).toBe('GOOGLE_VALIDATED_REVISION');
});
it('updates upload progress without replacing the banner or losing the Test submit guard',()=>{
  const f=fixture('test');const input={runId:'one',formId:DIRECT_LAB_FORM_ID,account:'fixture@example.test',status:'running',mode:'test',manual:false,message:'Opening Picker',eventSeq:4};
  showDirectRecovery(input);const panel=document.getElementById('hanuDirectRecovery')!,button=panel.querySelector('button');
  showDirectRecovery({...input,message:'Google is processing the image',eventSeq:5});
  expect(document.getElementById('hanuDirectRecovery')).toBe(panel);expect(panel.querySelector('button')).toBe(button);expect(panel.textContent).toContain('Google is processing');
  (document.querySelector('[role="button"]') as HTMLElement).click();expect(f.google).not.toHaveBeenCalled();expect(f.native).not.toHaveBeenCalled();
});
it('a wrong manual answer remains a Google validation error without a submit grant or network POST',()=>{
  const f=fixture();document.querySelector<HTMLInputElement>('[name="entry.123"]')!.value='123456';(document.querySelector('[role="button"]') as HTMLElement).click();
  expect(f.google).toHaveBeenCalledOnce();expect(f.send).not.toHaveBeenCalled();expect(f.native).not.toHaveBeenCalled();expect(document.querySelector('[role="alert"]')!.textContent).toBe('Đáp án chưa đúng');
});
it('preflights automation through Google but never emits a manual submit request or sends before the grant',async()=>{
  const f=fixture();expect(await prepareDirectNativeSubmit('doc-final')).toEqual({ready:true});
  expect(f.send).not.toHaveBeenCalled();expect(f.native).not.toHaveBeenCalled();
  const request={formId:DIRECT_LAB_FORM_ID,documentKey:'doc-final',account:'fixture@example.test',requestId:'one:final',final:true,native:true,manualReady:true,entries:[['entry.123','1350000']] as [string,string][],uploadEntries:[],sentinels:[],history:[0,1,2,3,5,6,7,8]};
  expect(await postExecutionPage({...request,validateOnly:true})).toEqual({scheduled:true});expect(f.native).not.toHaveBeenCalled();
  await postExecutionPage(request);expect(f.native).toHaveBeenCalledOnce();
  const posted=f.native.mock.instances[0] as HTMLFormElement;expect(posted.id).toBe('hanuDirectManualReady');expect(posted.target).toBe('_self');expect(new FormData(posted).get('dlut')).toBe('GOOGLE_VALIDATED_REVISION');
  await expect(postExecutionPage(request)).rejects.toThrow('không gửi lặp');expect(f.native).toHaveBeenCalledOnce();
});
it('rejects a failed native preflight while retaining the editable real form',async()=>{
  const f=fixture();document.querySelector<HTMLInputElement>('[name="entry.123"]')!.value='wrong';
  expect(await prepareDirectNativeSubmit('doc-final')).toEqual({ready:false,message:'Đáp án chưa đúng'});expect(f.send).not.toHaveBeenCalled();expect(f.native).not.toHaveBeenCalled();
});
it('Test blocks manual Send as well as automatic Send',()=>{
  const f=fixture('test');(document.querySelector('[role="button"]') as HTMLElement).click();expect(f.google).not.toHaveBeenCalled();expect(f.send).not.toHaveBeenCalled();expect(f.native).not.toHaveBeenCalled();expect(document.getElementById('hanuDirectRecovery')!.textContent).toContain('Test');
});
it.each(['test','live'])('native Back on the final page remains a non-final navigation in %s',mode=>{
  const f=fixture(mode),form=document.querySelector('form')!;
  const back=document.createElement('input');back.type='hidden';back.name='back';back.value='1';form.append(back);
  form.submit();expect(f.native).toHaveBeenCalledOnce();expect(f.send).not.toHaveBeenCalled();expect(directManualReady('doc-final')).toBe(false);
});
it.each(['test','live'])('does not cancel a real Back submit event in %s',mode=>{
  fixture(mode);const form=document.querySelector('form')!,back=document.createElement('input');back.name='back';back.value='1';form.append(back);
  const event=new Event('submit',{bubbles:true,cancelable:true});form.dispatchEvent(event);expect(event.defaultPrevented).toBe(false);
});
it('an older progress callback cannot replace the takeover guard',()=>{
  fixture();showDirectRecovery({runId:'one',formId:DIRECT_LAB_FORM_ID,account:'fixture@example.test',status:'running',mode:'live',manual:false,message:'OLD',eventSeq:2});
  expect(document.getElementById('hanuDirectRecovery')!.textContent).toContain('Bạn đang tiếp quản');expect(document.getElementById('hanuDirectRecovery')!.textContent).not.toContain('OLD');
});
it('explicit Stop restores Google’s original submit instead of leaving a stopped tab trapped behind the bridge',()=>{
  const f=fixture();disarmDirectManualSubmit();showDirectRecovery({runId:'one',formId:DIRECT_LAB_FORM_ID,account:'fixture@example.test',status:'idle',mode:'live',manual:false,message:'Stopped',eventSeq:4});
  (document.querySelector('[role="button"]') as HTMLElement).click();expect(f.native).toHaveBeenCalledOnce();expect(f.send).not.toHaveBeenCalled();expect(document.getElementById('hanuDirectRecovery')).toBeNull();
});
it('restores legacy hidden state with an exact non-final Back, retaining Google file/session state',()=>{
  const f=fixture(),state=document.createElement('form');state.id='hanuDirectState';state.hidden=true;
  for(const [name,value]of [['pageHistory','0,1,2,3,5,6,7,8'],['partialResponse','GOOGLE_FILE_REFERENCE'],['fbzx','PRIVATE_SESSION'],['token','PRIVATE_TOKEN']]){const input=document.createElement('input');input.name=name;input.value=value;state.append(input);}document.body.append(state);
  sessionStorage.setItem(`hanu-direct-draft:${DIRECT_LAB_FORM_ID}`,JSON.stringify({dlut:'GOOGLE_REVISION',fuIds:'GOOGLE_FILE_IDS'}));
  expect(restoreDirectNativePage({formId:DIRECT_LAB_FORM_ID,documentKey:'doc-final'})).toBe(true);
  const body=new FormData(f.native.mock.instances[0] as HTMLFormElement);expect(body.get('back')).toBe('1');expect(body.has('submit')).toBe(false);expect(body.has('continue')).toBe(false);expect(body.get('pageHistory')).toBe('0,1,2,3,5,6,7,8');expect(body.get('partialResponse')).toBe('GOOGLE_FILE_REFERENCE');expect(body.get('dlut')).toBe('GOOGLE_REVISION');expect(body.get('fuIds')).toBe('GOOGLE_FILE_IDS');
});
it('refuses recovery after the document changes and clears only non-final stopped state on explicit takeover',()=>{
  const f=fixture();expect(()=>restoreDirectNativePage({formId:DIRECT_LAB_FORM_ID,documentKey:'stale'})).toThrow('Trang đã thay đổi');expect(f.native).not.toHaveBeenCalled();
  document.documentElement.dataset.hanuDirectStopped='1';document.documentElement.dataset.hanuDirectPost='non-final';expect(restoreDirectNativePage({formId:DIRECT_LAB_FORM_ID,documentKey:'doc-final'})).toBe(false);expect(document.documentElement.dataset.hanuDirectPost).toBeUndefined();expect(document.documentElement.dataset.hanuDirectStopped).toBeUndefined();
});

it('hands off a visible CAPTCHA during native validation immediately, leaving the form editable',async()=>{
  const f=fixture();f.google.mockImplementation(()=>{const frame=document.createElement('iframe');frame.src='https://www.google.com/recaptcha/api2/bframe?size=invisible';document.body.append(frame);});
  expect(await prepareDirectNativeSubmit('doc-final')).toMatchObject({ready:false,reason:'captcha'});
  expect(document.querySelector<HTMLFormElement>('form')!.inert).toBe(false);expect(f.native).not.toHaveBeenCalled();expect(f.send).not.toHaveBeenCalled();
});
it('does not mistake an invisible badge for CAPTCHA during native validation',async()=>{
  fixture();const frame=document.createElement('iframe');frame.src='https://www.google.com/recaptcha/api2/anchor?size=invisible';document.body.append(frame);
  expect(await prepareDirectNativeSubmit('doc-final')).toEqual({ready:true});
});
it('allows a late Google callback after human verification to cross the manual grant bridge',async()=>{
  const f=fixture();f.google.mockImplementation(()=>{const frame=document.createElement('iframe');frame.src='https://www.google.com/recaptcha/api2/bframe';document.body.append(frame);});
  expect(await prepareDirectNativeSubmit('doc-final')).toMatchObject({reason:'captcha'});
  document.querySelector('iframe')!.remove();document.querySelector('form')!.submit();
  await vi.waitFor(()=>expect(f.send).toHaveBeenCalledOnce());expect(f.native).not.toHaveBeenCalled();expect(directManualReady('doc-final')).toBe(true);
});
it('honors Stop while waiting for Google validation rather than waiting out six seconds',async()=>{
  vi.useFakeTimers();const f=fixture();f.google.mockImplementation(()=>{});
  const running=prepareDirectNativeSubmit('doc-final'),checked=expect(running).rejects.toThrow('Đã dừng');
  document.documentElement.dataset.hanuDirectStopped='1';await vi.advanceTimersByTimeAsync(100);await checked;
  expect(f.native).not.toHaveBeenCalled();expect(document.querySelector<HTMLFormElement>('form')!.inert).toBe(false);vi.useRealTimers();
});
it('does not restore or clear a stopped document during automatic request fallback',()=>{
  const f=fixture();document.documentElement.dataset.hanuDirectStopped='1';
  expect(()=>restoreDirectNativePage({formId:DIRECT_LAB_FORM_ID,documentKey:'doc-final',automatic:true})).toThrow('Đã dừng');expect(f.native).not.toHaveBeenCalled();expect(document.documentElement.dataset.hanuDirectStopped).toBe('1');
});
