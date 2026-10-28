/** Serialized into the isolated responder world. No profile/token is persisted here. */
export function showDirectRecovery(input:{runId:string;formId:string;account:string;status:string;mode:string;manual:boolean;message:string;eventSeq?:number;preservePrepared?:boolean}):void {
  if(location.origin!=='https://docs.google.com'||!location.pathname.includes(`/d/e/${input.formId}/`))return;
  const root=document.documentElement;
  if(root.dataset.hanuDirectRecoveryRun===input.runId&&Number(root.dataset.hanuDirectRecoverySeq)>Number(input.eventSeq??0))return;
  root.dataset.hanuDirectRecoveryRun=input.runId;root.dataset.hanuDirectRecoverySeq=String(input.eventSeq??0);
  if(!root.dataset.hanuDirectDocument)root.dataset.hanuDirectDocument=crypto.randomUUID();
  const state=document as Document&{hanuDirectRecoveryCleanup?:()=>void};state.hanuDirectRecoveryCleanup?.();
  document.getElementById('hanuDirectRecovery')?.remove();
  if(['completed','idle'].includes(input.status)){const form=document.querySelector<HTMLFormElement>('form[action*="/formResponse"]');if(form)form.inert=false;return;}
  const form=document.querySelector<HTMLFormElement>('form[action*="/formResponse"]');if(!form)return;
  if(['paused','waiting_manual','ready_to_submit','failed'].includes(input.status)&&!input.preservePrepared){form.inert=false;delete root.dataset.hanuDirectManualPending;document.getElementById('hanuDirectManualReady')?.remove();}
  const panel=document.createElement('aside');panel.id='hanuDirectRecovery';panel.setAttribute('role','status');
  panel.style.cssText='position:relative;z-index:10;max-width:640px;margin:16px auto;padding:16px;box-sizing:border-box;background:#fff9e6;border:1px solid #a96e00;border-radius:8px;color:#252525;font:14px/1.5 system-ui';
  const heading=document.createElement('strong'),text=document.createElement('p');
  heading.textContent=input.manual?'Bạn đang tiếp quản form':input.status==='running'?'Tool đang xử lý form':'Giữ lại lượt đăng ký';
  text.textContent=input.status==='submit_uncertain'?'Chưa rõ Google đã nhận phản hồi hay chưa. Kiểm tra kết quả trước khi gửi lại.':input.manual?'Tool đã ngừng tự điền và tự tiếp tục. Bạn có thể sửa dữ liệu, bấm Tiếp trên Google; ở chế độ Live, bấm Gửi sẽ kiểm tra và gửi đúng một lần.':input.message;
  panel.append(heading,text);
  let busy=false;
  const request=async(action:'takeover'|'resume'|'submit')=>{
    if(busy)return;busy=true;
    try{
      const result=await chrome.runtime.sendMessage({type:'DIRECT_MANUAL',action,runId:input.runId,documentKey:root.dataset.hanuDirectDocument});
      if(!result?.ok)throw new Error(result?.error??'Chưa liên lạc được với extension. Giữ nguyên tab và dữ liệu.');
    }catch(error){text.textContent=(error as Error).message;form.inert=false;delete root.dataset.hanuDirectManualPending;document.getElementById('hanuDirectManualReady')?.remove();}finally{busy=false;}
  };
  if(!['submitting','submit_uncertain'].includes(input.status)){
    const button=document.createElement('button');button.type='button';button.textContent=input.manual?'Tiếp tục tự động':'Tiếp quản trên form';button.style.cssText='padding:8px 12px;cursor:pointer';button.onclick=()=>void request(input.manual?'resume':'takeover');panel.append(button);
  }
  // The real Google Submit remains usable, but it crosses the same durable
  // grant as automation. User edits never race an automatic second submit.
  const intercept=(event:Event)=>{
    const target=event.target instanceof Element?event.target.closest('button,[role="button"]'):null;
    const submit=event.type==='submit'&&event.target===form||target&&form.contains(target)&&/^(gửi|submit)$/i.test(target.textContent?.normalize('NFC').trim()??'');
    if(!submit)return;
    if(root.dataset.hanuDirectNativePermit==='1'||root.dataset.hanuDirectAutoPreparing==='1')return;
    // In Live waiting/manual mode, Google runs its own validation first.
    // armDirectManualSubmit intercepts only the resulting native submit.
    if(input.mode==='live'&&!['running','submitting','submit_uncertain'].includes(input.status)){
      if(event.isTrusted){if(root.dataset.hanuDirectAutoPreparing==='finished'){delete root.dataset.hanuDirectManualPending;document.getElementById('hanuDirectManualReady')?.remove();}delete root.dataset.hanuDirectAutoPreparing;}
      return;
    }
    event.preventDefault();event.stopImmediatePropagation();
    if(input.mode!=='live'){text.textContent='Đang ở chế độ Test: dừng trước Gửi. Dữ liệu và ảnh vẫn được giữ trên form.';return;}
    if(['running','submitting','submit_uncertain'].includes(input.status)){text.textContent=input.status==='submit_uncertain'?'Cần đối chiếu kết quả trước khi gửi lại.':'Tool đang xử lý. Bấm Tiếp quản trên form nếu muốn nhập tay.';return;}
  };
  const ready=()=>{text.textContent='Google đã kiểm tra dữ liệu. Đang xin quyền gửi cho câu trả lời vừa xác nhận…';void request('submit');};
  document.addEventListener('hanu-direct-manual-submit-ready',ready);
  document.addEventListener('click',intercept,true);document.addEventListener('submit',intercept,true);
  state.hanuDirectRecoveryCleanup=()=>{document.removeEventListener('hanu-direct-manual-submit-ready',ready);document.removeEventListener('click',intercept,true);document.removeEventListener('submit',intercept,true);};
  document.body.prepend(panel);
}

/** MAIN: Google's own submit handler calls this only after its validation and
 * draft preparation. Keep that exact body in the document while acquiring the
 * durable grant. No form response, file or token is copied to extension storage. */
export function armDirectManualSubmit():void{
  const form=document.querySelector<HTMLFormElement>('form[action*="/formResponse"]');
  if(!form||form.dataset.hanuDirectManualArmed)return;
  form.dataset.hanuDirectManualArmed='1';
  const original=form.submit.bind(form);
  (form as HTMLFormElement&{hanuDirectOriginalSubmit?:()=>void}).hanuDirectOriginalSubmit=original;
  form.submit=function(){
    const root=document.documentElement;
    const final=[...form.querySelectorAll<HTMLElement>('button,[role="button"]')].some(b=>/^(gửi|submit)$/i.test(b.textContent?.normalize('NFC').trim()??'')&&b.getBoundingClientRect().width>0);
    if(!final||root.dataset.hanuDirectNativePermit==='1'){original();return;}
    if(root.dataset.hanuDirectManualPending)return;
    if(document.getElementById('hanuDirectState'))return;
    const ready=document.createElement('form');ready.id='hanuDirectManualReady';ready.hidden=true;ready.dataset.document=root.dataset.hanuDirectDocument;
    for(const [key,value]of new FormData(form))if(typeof value==='string'){const field=document.createElement('input');field.type='hidden';field.name=key;field.value=value;ready.append(field);}
    document.getElementById(ready.id)?.remove();document.body.append(ready);
    root.dataset.hanuDirectManualPending='1';form.inert=true;
    if(root.dataset.hanuDirectAutoPreparing!=='1')document.dispatchEvent(new Event('hanu-direct-manual-submit-ready'));
  };
}
export function disarmDirectManualSubmit():void{
  const form=document.querySelector<HTMLFormElement>('form[action*="/formResponse"]') as (HTMLFormElement&{hanuDirectOriginalSubmit?:()=>void})|null;
  if(form?.hanuDirectOriginalSubmit){form.submit=form.hanuDirectOriginalSubmit;delete form.hanuDirectOriginalSubmit;delete form.dataset.hanuDirectManualArmed;form.inert=false;}
  document.getElementById('hanuDirectManualReady')?.remove();delete document.documentElement.dataset.hanuDirectManualPending;
}
export function directManualReady(documentKey:string):boolean{
  return !document.getElementById('hanuDirectState')&&document.querySelector<HTMLFormElement>('#hanuDirectManualReady')?.dataset.document===documentKey;
}

/** Run Google's own client validation without sending anything. Its prepared
 * native POST is held until the executor obtains the durable final grant. */
export async function prepareDirectNativeSubmit(documentKey:string):Promise<{ready:boolean;message?:string;reason?:'captcha'}>{
  function hasUnsatisfiedCaptcha():boolean {
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
  const root=document.documentElement;
  if(root.dataset.hanuDirectStopped)throw new Error('Đã dừng lượt Direct.');
  if(root.dataset.hanuDirectDocument!==documentKey||document.getElementById('hanuDirectState'))throw new Error('Trang đã thay đổi trước khi kiểm tra dữ liệu.');
  const form=document.querySelector<HTMLFormElement>('form[action*="/formResponse"]');if(!form?.dataset.hanuDirectManualArmed)throw new Error('Chưa cài bộ giữ request Gửi.');
  const submit=[...form.querySelectorAll<HTMLElement>('button,[role="button"]')].filter(b=>/^(gửi|submit)$/i.test(b.textContent?.normalize('NFC').trim()??'')&&b.getBoundingClientRect().width>0);
  if(submit.length!==1)throw new Error('Không xác định duy nhất nút Gửi.');
  document.getElementById('hanuDirectManualReady')?.remove();delete root.dataset.hanuDirectManualPending;root.dataset.hanuDirectAutoPreparing='1';
  try{
    submit[0].click();const deadline=Date.now()+6000;
    while(Date.now()<deadline){
      if(root.dataset.hanuDirectStopped)throw new Error('Đã dừng lượt Direct.');
      if(document.querySelector<HTMLFormElement>('#hanuDirectManualReady')?.dataset.document===documentKey)return {ready:true};
      if(hasUnsatisfiedCaptcha())return {ready:false,reason:'captcha',message:'Google yêu cầu xác thực. Hoàn tất CAPTCHA trên tab hiện tại rồi bấm Tiếp tục.'};
      const errors=[...form.querySelectorAll<HTMLElement>('[role="alert"],[id^="i.err."]')].filter(e=>e.getBoundingClientRect().width>0).map(e=>e.textContent?.trim()).filter(Boolean);
      if(errors.length)return {ready:false,message:errors.join(' · ').slice(0,600)};
      await new Promise(resolve=>setTimeout(resolve,100));
    }
    return {ready:false,message:'Google chưa hoàn tất kiểm tra dữ liệu. Có thể tiếp quản trên form; chưa có request Gửi.'};
  }finally{root.dataset.hanuDirectAutoPreparing='finished';if(!document.getElementById('hanuDirectManualReady'))form.inert=false;}
}

/** Explicit recovery of 1.9.7's hidden state. Back is non-final and uses only
 * Google's own current fields; it does not invent a history, file ID or revision. */
export function restoreDirectNativePage(input:{formId:string;documentKey:string;automatic?:boolean}):boolean{
  if(input.automatic&&document.documentElement.dataset.hanuDirectStopped)throw new Error('Đã dừng lượt Direct; không chuyển trang.');
  if(location.origin!=='https://docs.google.com'||!location.pathname.includes(`/d/e/${input.formId}/`)||document.documentElement.dataset.hanuDirectDocument!==input.documentKey)throw new Error('Trang đã thay đổi; kiểm tra lại trước khi tiếp quản.');
  const state=document.querySelector<HTMLFormElement>('#hanuDirectState');
  document.getElementById('hanuDirectManualReady')?.remove();delete document.documentElement.dataset.hanuDirectManualPending;delete document.documentElement.dataset.hanuDirectAutoPreparing;
  if(!state){delete document.documentElement.dataset.hanuDirectPost;delete document.documentElement.dataset.hanuDirectStopped;const original=document.querySelector<HTMLFormElement>('form[action*="/formResponse"]');if(original)original.inert=false;return false;}
  const original=document.querySelector<HTMLFormElement>('form[action*="/formResponse"]');if(!original)throw new Error('Không còn form Google để khôi phục.');
  const action=new URL(original.action);if(action.origin!==location.origin||!action.pathname.endsWith(`/d/e/${input.formId}/formResponse`))throw new Error('Đích khôi phục không đúng form.');
  const body=new FormData(state),post=document.createElement('form');post.method='POST';post.action=action.href;post.target='_self';post.hidden=true;
  const captured=JSON.parse(sessionStorage.getItem(`hanu-direct-draft:${input.formId}`)??'{}');
  for(const name of ['dlut','fuIds'])if(!body.get(name)&&captured[name])body.set(name,captured[name]);
  for(const [key,value]of body)if(typeof value==='string'&&!['continue','submit','back'].includes(key)){const field=document.createElement('input');field.type='hidden';field.name=key;field.value=value;post.append(field);}
  const back=document.createElement('input');back.type='hidden';back.name='back';back.value='1';post.append(back);document.body.append(post);
  HTMLFormElement.prototype.submit.call(post);return true;
}
