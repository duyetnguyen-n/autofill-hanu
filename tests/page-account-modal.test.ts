// @vitest-environment jsdom
import {afterEach,expect,it,vi} from 'vitest';
afterEach(()=>{vi.unstubAllGlobals();vi.restoreAllMocks();vi.resetModules();document.body.replaceChildren();});
async function setup(picker=true,hidden=true){
 document.body.innerHTML=`<div ${hidden?'aria-hidden="true"':''}><div id="account">fixture@example.test <a href="https://accounts.google.com/AccountChooser?continue=forms">Switch account</a></div><div role="listitem"><input></div><button>Next</button></div>${picker?'<iframe src="https://docs.google.com/picker?hostId=file-upload&rpcService=test&rpctoken=test"></iframe>':''}`;
 vi.spyOn(HTMLElement.prototype,'getBoundingClientRect').mockReturnValue({width:100,height:40} as DOMRect);
 vi.stubGlobal('chrome',{runtime:{sendMessage:vi.fn(async()=>undefined),onMessage:{addListener:vi.fn()}}});
 return (await import('../src/content')).pageAccount;
}
it('reads the painted Forms account header while Picker hides the background form from accessibility',async()=>{
 const account=await setup();expect(account()).toEqual({email:'fixture@example.test'});
});
it('does not accept an aria-hidden header without an open Google upload Picker',async()=>{
 const account=await setup(false);expect(account()).toEqual({});
});
it('does not infer the Google account from a candidate email answer',async()=>{
 const account=await setup();document.querySelector('#account')!.remove();document.querySelector('[role="listitem"]')!.innerHTML='<input value="candidate@example.test">';expect(account()).toEqual({});
});
it('refuses ambiguous account headers even while the modal is open',async()=>{
 const account=await setup();document.body.insertAdjacentHTML('beforeend','<div data-google-account="other@example.test">other@example.test</div>');expect(account()).toEqual({});
});
