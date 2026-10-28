// @vitest-environment jsdom
import {afterEach,expect,it,vi} from 'vitest';
import {hasUnsatisfiedCaptcha} from '../src/captcha';
import {readExecutionPage} from '../src/google-direct/execute-page';
import {DIRECT_LAB_URL} from '../src/google-direct/schema';

afterEach(()=>{document.body.replaceChildren();vi.restoreAllMocks();vi.unstubAllGlobals();});
function fixture(html:string){
  vi.stubGlobal('location',new URL(DIRECT_LAB_URL));
  document.body.innerHTML=`<form action="${DIRECT_LAB_URL.replace('viewform','formResponse')}">${html}</form>`;
  vi.spyOn(Element.prototype,'getBoundingClientRect').mockReturnValue({width:304,height:78} as DOMRect);
}
// Both functions are executed in different JS worlds; serialized callbacks
// cannot import a helper. Exercise both implementations against the same DOM.
it.each([
  ['an invisible badge','<iframe src="https://www.google.com/recaptcha/api2/anchor?size=invisible"></iframe>',false],
  ['a badge container','<div class="grecaptcha-badge"><iframe src="https://www.google.com/recaptcha/api2/anchor"></iframe></div>',false],
  ['a hidden challenge ancestor','<div style="opacity:0"><iframe src="https://www.google.com/recaptcha/api2/bframe"></iframe></div>',false],
  ['a hidden checkbox','<div aria-hidden="true"><iframe src="https://www.google.com/recaptcha/api2/anchor"></iframe></div>',false],
  ['an unsolved checkbox','<iframe src="https://www.google.com/recaptcha/api2/anchor?size=normal"></iframe>',true],
  ['a solved checkbox','<iframe src="https://www.google.com/recaptcha/api2/anchor"></iframe><textarea name="g-recaptcha-response">SYNTHETIC_RESPONSE</textarea>',false],
  ['a visible challenge despite a stale response','<iframe src="https://www.google.com/recaptcha/api2/bframe?size=invisible"></iframe><textarea name="g-recaptcha-response">STALE_FIXTURE</textarea>',true],
  ['a challenge after an invisible first frame','<iframe src="https://www.google.com/recaptcha/api2/anchor?size=invisible"></iframe><iframe src="https://www.google.com/recaptcha/api2/bframe"></iframe>',true],
  ['an hcaptcha challenge','<iframe src="https://newassets.hcaptcha.com/captcha.html?frame=challenge"></iframe>',true],
  ['a solved hcaptcha checkbox','<iframe src="https://newassets.hcaptcha.com/captcha.html?frame=checkbox"></iframe><input name="h-captcha-response" value="SYNTHETIC_RESPONSE">',false],
] as const)('classifies %s without changing Google state',(_name,html,expected)=>{
  fixture(html);const before=document.body.innerHTML;
  expect(hasUnsatisfiedCaptcha()).toBe(expected);
  expect(readExecutionPage().issue?.reason==='captcha').toBe(expected);
  expect(document.body.innerHTML).toBe(before);
});
it('ignores zero-size frames',()=>{
  fixture('<iframe src="https://www.google.com/recaptcha/api2/bframe"></iframe>');
  vi.mocked(Element.prototype.getBoundingClientRect).mockReturnValue({width:0,height:0} as DOMRect);
  expect(hasUnsatisfiedCaptcha()).toBe(false);expect(readExecutionPage().blocked).toBe(false);
});
it.each([
  ['Biểu mẫu không còn chấp nhận phản hồi','form_closed'],
  ['Too many requests','server_error'],
] as const)('keeps %s separate from CAPTCHA',(text,reason)=>{fixture(text);expect(readExecutionPage().issue?.reason).toBe(reason);});
it('reports visible field validation separately and excludes hidden errors',()=>{
  fixture('<div role="alert">Lệ phí chưa chính xác</div><div role="alert" style="visibility:hidden">Hidden</div>');
  expect(readExecutionPage()).toMatchObject({blocked:false,validationErrors:['Lệ phí chưa chính xác']});
});
it('classifies Google’s closedform URL immediately even without a schema or recognizable language',()=>{
  fixture('');vi.stubGlobal('location',new URL(DIRECT_LAB_URL.replace('viewform','closedform')));document.querySelector('form')!.remove();
  expect(readExecutionPage()).toMatchObject({hasForm:false,blocked:true,issue:{reason:'form_closed'}});
});
