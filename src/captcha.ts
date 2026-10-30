import type {BlockingIssue} from './shared';

/** A traffic-check page remains blocked even when its challenge frame fails.
 * Inspect only the URL and visible text; never read a CAPTCHA frame/token. */
export function googleSecurityIssue(input:{url?:string;text?:string;hasForm?:boolean}):BlockingIssue|undefined {
  let redirect=false;
  if(input.url)try{
    const url=new URL(input.url);
    redirect=url.protocol==='https:'&&/^(?:(?:www|ipv4|ipv6)\.)?google\.com$/i.test(url.hostname)&&/^\/sorry(?:\/|$)/.test(url.pathname);
  }catch{/* A malformed/non-Google URL is not evidence of a traffic check. */}
  const text=(input.text??'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').replace(/đ/g,'d').toLowerCase().replace(/\s+/g,' ');
  const warning=!input.hasForm&&/\bunusual traffic\b|luu luong truy cap bat thuong|cannot contact recaptcha|could not connect to (?:the )?recaptcha|khong the (?:ket noi|lien he).*recaptcha/.test(text);
  if(redirect||warning)return {reason:'captcha',message:'Google đang yêu cầu xác minh lưu lượng; khung CAPTCHA có thể chưa tải được. Tool giữ lượt và không tự tải lại trang cảnh báo. Giữ nguyên tab và dữ liệu để xử lý xác minh.'};
}

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
