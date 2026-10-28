/** Observe the rendered challenge only. An invisible badge is not a request
 * for human input. Do not read frames, solve challenges, or alter Google state.
 * Keep the serialized copies in execute-page/recovery-page covered by the same tests. */
export function hasUnsatisfiedCaptcha():boolean {
  const visible=(element:Element)=>{
    const rect=element.getBoundingClientRect();if(rect.width<=0||rect.height<=0)return false;
    for(let node:Element|null=element;node;node=node.parentElement){const style=getComputedStyle(node);if(node.hasAttribute('hidden')||node.getAttribute('aria-hidden')==='true'||style.display==='none'||style.visibility==='hidden'||style.visibility==='collapse'||style.opacity==='0')return false;}
    return true;
  };
  return [...document.querySelectorAll<HTMLIFrameElement>('iframe[src*="recaptcha" i],iframe[src*="hcaptcha" i]')].some(frame=>{
    if(!visible(frame))return false;
    const url=new URL(frame.src,location.href),challenge=/\/bframe(?:\/|$)/i.test(url.pathname)||url.searchParams.get('frame')==='challenge';
    // A visible image challenge wins over an expired/stale response field.
    if(challenge)return true;
    if(url.searchParams.get('size')==='invisible'||frame.closest('.grecaptcha-badge,[data-size="invisible"]'))return false;
    const name=/hcaptcha/i.test(frame.src)?'h-captcha-response':'g-recaptcha-response';
    return ![...document.querySelectorAll<HTMLInputElement|HTMLTextAreaElement>(`[name="${name}"]`)].some(field=>field.value.trim());
  });
}
