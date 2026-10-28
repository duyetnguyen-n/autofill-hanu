import type {BlockingIssue} from '../shared';

export interface ExecutionPage {
  url: string;
  documentKey: string;
  script?: string;
  history: number[];
  account: string;
  hasForm: boolean;
  hasNext: boolean;
  hasSubmit: boolean;
  text: string;
  blocked: boolean;
  issue?: BlockingIssue;
  validationErrors?: string[];
  draftRefresh?: boolean;
  draftUpdated?: boolean;
}

// These functions are serialized into the responder tab by chrome.scripting.
// Session field VALUES remain in that document, never in storage or logs.
export function readExecutionPage(): ExecutionPage {
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

  const allowed = location.origin === 'https://docs.google.com' && /^\/forms\/(?:u\/\d+\/)?d\/e\/[^/]+\/(?:viewform|formResponse|closedform)$/.test(location.pathname);
  if (!allowed) throw new Error('Tab đã rời Google Form. Kiểm tra đăng nhập trước khi tiếp tục.');
  const form = document.querySelector<HTMLFormElement>('form[action*="/formResponse"]');
  const script = document.getElementById('hanuDirectSchema')?.textContent??[...document.scripts].find(s => /^\s*(?:var\s+)?FB_PUBLIC_LOAD_DATA_\s*=/.test(s.textContent ?? ''))?.textContent ?? undefined;
  const text = document.body.innerText ?? document.body.textContent ?? '';
  const visible = (e: Element) => {const r=e.getBoundingClientRect();return r.width>0&&r.height>0&&getComputedStyle(e).visibility!=='hidden';};
  const buttons = [...document.querySelectorAll('button,[role="button"]')].filter(visible).map(e => e.textContent?.normalize('NFC').trim() ?? '');
  const current=document.querySelector<HTMLFormElement>('#hanuDirectState')??form;
  const history = current?.querySelector<HTMLInputElement>('input[name="pageHistory"]')?.value ?? '0';
  const emailLabel = document.querySelector('[role="checkbox"][aria-label*="@"]')?.getAttribute('aria-label');
  const account = (emailLabel ?? form?.innerText ?? '').match(/[A-Z0-9.!#$%&'*+/=?^_`{|}~-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i)?.[0] ?? '';
  // A random document key avoids confusing two pages with the same pathname.
  const html = document.documentElement;
  if (!html.dataset.hanuDirectDocument) html.dataset.hanuDirectDocument = crypto.randomUUID();
  let issue:BlockingIssue|undefined;
  if(hasUnsatisfiedCaptcha())issue={reason:'captcha',message:'Google yêu cầu xác thực. Giữ nguyên tab, hoàn tất CAPTCHA trên Google rồi bấm Tiếp tục.'};
  else if(location.pathname.endsWith('/closedform')||/không còn chấp nhận|không còn nhận câu trả lời|no longer accepting|form (?:is )?closed/i.test(text))issue={reason:'form_closed',message:'Google Form đã ngừng nhận phản hồi.'};
  else if(/too many requests|unusual traffic|quá nhiều yêu cầu/i.test(text))issue={reason:'server_error',message:'Google đang giới hạn truy cập. Giữ nguyên trang để kiểm tra.'};
  const validationErrors=[...document.querySelectorAll<HTMLElement>('[role="alert"],[id^="i.err."],[aria-invalid="true"]')].filter(visible).map(e=>e.getAttribute('aria-invalid')==='true'?'Có trường chưa hợp lệ. Kiểm tra các câu được Google đánh dấu.':e.textContent?.trim()??'').filter(Boolean).slice(0,10).map(t=>t.slice(0,300));
  return {url:location.href, documentKey:html.dataset.hanuDirectDocument,
    script, history:/^\d+(?:,\d+)*$/.test(history) ? history.split(',').map(Number) : [], account,
    hasForm:!!form, hasNext:current?.id==='hanuDirectState'?current.dataset.next==='true':buttons.some(t => /^(tiếp|next)$/i.test(t)),hasSubmit:current?.id==='hanuDirectState'?current.dataset.final==='true':buttons.some(t => /^(gửi|submit)$/i.test(t)),
    draftRefresh:/bản nháp mới hơn|more recent draft|newer draft/i.test(text),
    text:text.slice(0,60000), blocked:!!issue,issue,validationErrors};
}

export interface PagePost {
  formId: string;
  documentKey: string;
  account: string;
  requestId: string;
  final: boolean;
  entries: [string,string][];
  sentinels: string[];
  uploadEntries: string[];
  history?: number[];
  http?:boolean;
  route?:number[];
  questionLabels?:Record<string,string>;
  native?:boolean;
  manualReady?:boolean;
  validateOnly?:boolean;
}
export interface FinalPostResult {status:number;received:boolean;message:string}
export async function postExecutionPage(request: PagePost): Promise<{scheduled:true;finalResult?:FinalPostResult;error?:string}> {
  if (location.origin !== 'https://docs.google.com' || !location.pathname.includes(`/d/e/${request.formId}/`) || document.documentElement.dataset.hanuDirectDocument !== request.documentKey) throw new Error('Document/form đã thay đổi trước khi gửi request.');
  const original = document.querySelector<HTMLFormElement>('form[action*="/formResponse"]');
  if (!original) throw new Error('Không còn form để gửi.');
  const action = new URL(original.action);
  if (action.origin !== location.origin || !action.pathname.endsWith(`/d/e/${request.formId}/formResponse`)) throw new Error('Đích gửi không khớp form.');
  if (document.documentElement.dataset.hanuDirectPost) throw new Error('Document này đã có request, không gửi lặp.');
  const account = (document.querySelector('[role="checkbox"][aria-label*="@"]')?.getAttribute('aria-label') ?? original.innerText ?? original.textContent ?? '').match(/[A-Z0-9.!#$%&'*+/=?^_`{|}~-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i)?.[0] ?? '';
  if (!request.account || account.toLowerCase() !== request.account.toLowerCase()) throw new Error('Tài khoản Google đã thay đổi.');
  if(document.documentElement.dataset.hanuDirectStopped)throw new Error('Đã dừng trước khi gửi request.');
  const prepared=request.manualReady?document.querySelector<HTMLFormElement>('#hanuDirectManualReady'):undefined;
  if(request.manualReady&&prepared?.dataset.document!==request.documentKey)throw new Error('Không còn đúng câu trả lời vừa được Google kiểm tra.');
  const source = new FormData(prepared??document.querySelector<HTMLFormElement>('#hanuDirectState')??original), body = new URLSearchParams();
  for (const [key,value] of source) if (typeof value === 'string') body.append(key,value);
  // Keep Google's current upload references and partialResponse verbatim.
  // Never synthesize a Drive ID from local attachment metadata.
  const uploadValues=new Map<string,unknown[]>();
  for (const id of request.uploadEntries) {
    let direct:unknown;
    try{direct=JSON.parse(String(source.get(`entry.${id}`)??'null'));}catch{}
    const directFiles=Array.isArray(direct)&&direct.length>0?direct:undefined;
    let partialFiles:unknown[]|undefined;
    try {
      const rows = JSON.parse(String(source.get('partialResponse') ?? 'null'))?.[0];
      const row=Array.isArray(rows)?rows.find(row=>Array.isArray(row)&&String(row[1])===id):undefined;
      if(Array.isArray(row?.[4])&&row[4].length)partialFiles=row[4];
    } catch { /* no serialized upload */ }
    const files=directFiles??partialFiles;
    if(!files)throw new Error('Ảnh có trên giao diện nhưng chưa có reference trong dữ liệu Google; chưa gửi.');
    uploadValues.set(id,files);
  }
  const keys = new Set(request.entries.map(e=>e[0]));
  for (const key of keys) body.delete(key);
  for (const [key,value] of request.entries) {
    if (!/^entry\.\d+$/.test(key)) throw new Error('Tên trường request không hợp lệ.');
    body.append(key,value);
  }
  // partialResponse belongs to the current Google response. Never merge or
  // fabricate rows, pageHistory or draft revisions: entries encode THIS page.
  const actualHistory=String(source.get('pageHistory')??'');
  if(request.history&&request.history.join(',')!==actualHistory)throw new Error('Không được nhảy qua trang chưa được Google xác nhận.');
  const sessionKey=`hanu-direct-draft:${request.formId}`;
  const captured=JSON.parse(sessionStorage.getItem(sessionKey)??'{}');
  for(const name of ['dlut','fuIds']){
    if(body.get(name))captured[name]=body.get(name);
    else if(captured[name])body.set(name,captured[name]);
  }
  sessionStorage.setItem(sessionKey,JSON.stringify(captured));
  for (const id of request.sentinels) body.set(`entry.${id}_sentinel`,'');
  body.set('emailAddress',request.account);
  body.set('fvv',body.get('fvv') || '1');
  body.delete('back');body.delete('continue');body.delete('submit');
  if (!request.final) body.set('continue','1');
  if(request.final&&request.native){
    if(document.getElementById('hanuDirectState'))throw new Error('Cần khôi phục trang Google thật trước khi Gửi.');
    for(const [name,value]of request.entries)if(!source.getAll(name).includes(value))throw new Error('Dữ liệu trên trang Google chưa khớp dữ liệu đã kiểm tra.');
    if(request.validateOnly)return {scheduled:true};
    if(prepared){
      document.documentElement.dataset.hanuDirectPost=request.requestId;
      prepared.method='POST';prepared.action=action.href;prepared.target='_self';
      HTMLFormElement.prototype.submit.call(prepared);return {scheduled:true};
    }
    const submit=[...original.querySelectorAll<HTMLElement>('button,[role="button"]')].filter(b=>/^(gửi|submit)$/i.test(b.textContent?.normalize('NFC').trim()??'')&&b.getBoundingClientRect().width>0);
    if(submit.length!==1)throw new Error('Không xác định duy nhất nút Gửi của Google.');
    document.documentElement.dataset.hanuDirectPost=request.requestId;
    // The recovery guard consumes this one-shot permit. A native click keeps
    // Google's real confirmation/validation page available to the user.
    document.documentElement.dataset.hanuDirectNativePermit='1';submit[0].click();
    delete document.documentElement.dataset.hanuDirectNativePermit;
    return {scheduled:true};
  }
  if(request.validateOnly)return {scheduled:true};
  if(request.final||request.http){
    if(request.final)body.set('submit','Submit');
    // Same-origin fetch keeps Google's authenticated upload session but does
    // not trigger beforeunload/autosave navigation after the file is selected.
    document.documentElement.dataset.hanuDirectPost=request.requestId;
    const controller=new AbortController(),stop=()=>controller.abort(),timer=setTimeout(stop,35000);
    document.addEventListener('hanu-direct-stop',stop,{once:true});
    try{
      const response=await fetch(action.href,{method:'POST',credentials:'include',redirect:'follow',headers:{'Content-Type':'application/x-www-form-urlencoded;charset=UTF-8'},body:body.toString(),signal:controller.signal});
      const html=await response.text();
      // Parse only inert text/structural markers. Do not insert response HTML
      // into Google's document or create a Trusted Types policy in MAIN.
      if(!request.final){
        if(!response.ok)throw new Error(`Google từ chối chuyển trang HTTP ${response.status}.`);
        const decode=(s:string)=>s.replace(/&(#x[0-9a-f]+|#\d+|amp|quot|apos|lt|gt);/gi,(_all,v)=>v[0]==='#'?String.fromCodePoint(v[1].toLowerCase()==='x'?parseInt(v.slice(2),16):parseInt(v.slice(1),10)):({amp:'&',quot:'"',apos:"'",lt:'<',gt:'>'} as Record<string,string>)[v.toLowerCase()]);
        const fields=new URLSearchParams();
        for(const tag of html.match(/<input\b[^>]*>/gi)??[]){const attrs:Record<string,string>={};for(const m of tag.matchAll(/([\w:-]+)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/g))attrs[m[1].toLowerCase()]=decode(m[2]??m[3]??m[4]);if(attrs.name&&attrs.type?.toLowerCase()==='hidden')fields.append(attrs.name,attrs.value??'');}
        const path=fields.get('pageHistory')??'',route=request.route;
        const next=path.split(',').map(Number),position=route?.indexOf(next.at(-1)!);
        const previous=String(source.get('pageHistory')??'').split(',').map(Number);
        if(!route||position===undefined||position<0||path===previous.join(',')||next.join(',')!==route.slice(0,position+1).join(',')||position!==route.indexOf(previous.at(-1)!)+1||!fields.get('token')||!fields.get('fbzx')||!fields.get('partialResponse')){
          // Read only visible error text from an inert string. Keep response
          // values/tokens out of logs and do not insert returned HTML into DOM.
          const errors:{questionId?:string;label?:string;message:string}[]=[];
          const alerts:{depth:number;id:string;text:string[]}[]=[];let depth=0;
          const inert=html.replace(/<(script|style)\b[^>]*>[\s\S]*?<\/\1\s*>/gi,'');
          for(const piece of inert.match(/<[^>]*>|[^<]+/g)??[]){
            if(/^<div\b/i.test(piece)){
              depth++;const id=/\bid\s*=\s*["']([^"']*)["']/i.exec(piece)?.[1]??'';
              if(/^i\.err\./.test(id)||/\brole\s*=\s*["']alert["']/i.test(piece))alerts.push({depth,id,text:[]});
            }else if(/^<\/div\s*>/i.test(piece)){
              for(let i=alerts.length-1;i>=0;i--)if(alerts[i].depth===depth){const a=alerts.splice(i,1)[0],message=decode(a.text.join(' ')).replace(/&nbsp;/gi,' ').replace(/\s+/g,' ').trim();if(message){const questionId=a.id.startsWith('i.err.')?a.id.slice(6):undefined;errors.push({questionId,label:questionId?request.questionLabels?.[questionId]:undefined,message:message.slice(0,500)});}}
              depth--;
            }else if(!piece.startsWith('<'))for(const alert of alerts)alert.text.push(piece);
          }
          const words=decode(inert.replace(/<[^>]*>/g,' ')).normalize('NFD').replace(/[\u0300-\u036f]/g,'').replace(/đ/g,'d').toLowerCase().replace(/\s+/g,' ');
          const draft=/ban nhap moi hon|more recent draft|newer draft/.test(words);
          const login=!!response.url&&new URL(response.url).hostname==='accounts.google.com';
          const diagnostic={kind:login?'login':draft?'draft_conflict':errors.length?'validation':'navigation',httpStatus:response.status,from:previous,to:next,missingFields:['token','fbzx','partialResponse'].filter(k=>!fields.get(k)),errors:errors.slice(0,5)};
          const node=document.createElement('pre');node.id='hanuDirectFailure';node.hidden=true;node.textContent=JSON.stringify(diagnostic);document.getElementById(node.id)?.remove();document.body.append(node);
          const detail=login?'Google yêu cầu đăng nhập lại.':draft?'Google báo có bản nháp mới hơn; chưa chuyển trang.':errors.length?errors.slice(0,5).map(e=>`${e.label??'Google Forms'}: ${e.message}`).join(' · '):path===previous.join(',')?'Google trả lại cùng trang để kiểm tra dữ liệu.':`Google trả trạng thái điều hướng khác dự kiến (${previous.join(',')} → ${path||'trống'}).`;
          throw new Error(`${detail} Chưa gửi phản hồi; không tự gửi lại.`);
        }
        const script=[...html.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/gi)].map(m=>m[1]).find(s=>/^\s*(?:var\s+)?FB_PUBLIC_LOAD_DATA_\s*=/.test(s));
        if(!script)throw new Error('Không đọc được metadata trang tiếp theo.');
        const state=document.createElement('form');state.id='hanuDirectState';state.hidden=true;state.dataset.next=String(position<route.length-1);state.dataset.final=String(position===route.length-1);
        for(const[name,value]of fields){const input=document.createElement('input');input.type='hidden';input.name=name;input.value=value;state.append(input);}
        const meta=document.createElement('pre');meta.id='hanuDirectSchema';meta.hidden=true;meta.textContent=script;
        document.getElementById(state.id)?.remove();document.getElementById(meta.id)?.remove();document.body.append(state,meta);
        document.documentElement.dataset.hanuDirectDocument=crypto.randomUUID();delete document.documentElement.dataset.hanuDirectPost;
        return {scheduled:true};
      }
      const hasForm=/<form\b[^>]*action\s*=\s*["'][^"']*\/formResponse(?:[?"'])/i.test(html);
      const captcha=/<iframe\b[^>]*src\s*=\s*["'][^"']*(?:recaptcha|hcaptcha)/i.test(html);
      const text=html.replace(/<(script|style|iframe)\b[^>]*>[\s\S]*?<\/\1\s*>/gi,' ').replace(/<input\b[^>]*>/gi,' ').replace(/<[^>]*>/g,' ').replace(/&#(\d+);/g,(_all,n)=>String.fromCodePoint(Number(n))).replace(/&nbsp;|&#xA0;/gi,' ').replace(/&amp;/gi,'&').normalize('NFD').replace(/[\u0300-\u036f]/g,'').replace(/đ/g,'d').replace(/Đ/g,'d').toLowerCase().replace(/\s+/g,' ').trim();
      const received=response.ok&&!hasForm&&!captcha&&/(?:your )?response has been recorded|da ghi lai cau tra loi|cau tra loi cua ban da duoc ghi lai|chuc mung thi sinh da hoan thanh buoc dien thong tin dang ky bieu mau|恭喜您完成填写报名信息/.test(text);
      if(received){
        original.hidden=true;
        document.getElementById('hanuDirectState')?.remove();document.getElementById('hanuDirectSchema')?.remove();
        sessionStorage.removeItem(sessionKey);
        const notice=document.createElement('section');notice.id='hanuDirectConfirmation';notice.setAttribute('role','status');notice.style.cssText='max-width:640px;margin:48px auto;padding:32px;background:white;border:1px solid #dadce0;border-radius:8px;font:16px/1.6 system-ui;color:#202124';
        const heading=document.createElement('h1');heading.textContent='Đã gửi biểu mẫu';
        const message=document.createElement('p');message.textContent='Google đã xác nhận ghi lại phản hồi. Bạn có thể đóng tab này.';notice.append(heading,message);document.body.prepend(notice);document.title=`Đã gửi · ${document.title}`;
      }
      const draft=/ban nhap moi hon|more recent draft|newer draft/.test(text);
      const login=!!response.url&&new URL(response.url).hostname==='accounts.google.com';
      return {scheduled:true,finalResult:{status:response.status,received,message:received?'Google xác nhận đã ghi lại phản hồi.':login?'Google yêu cầu đăng nhập lại cho request Gửi.':draft?'Google trả về xung đột bản nháp, chưa xác nhận gửi.':hasForm?`Google trả lại form để kiểm tra dữ liệu; chưa xác nhận gửi. ${text.slice(-600)}`:`Google chưa trả xác nhận ghi phản hồi (HTTP ${response.status}).`}};
    }catch(error){return {scheduled:true,error:(error as Error).message};}
    finally{clearTimeout(timer);document.removeEventListener('hanu-direct-stop',stop);}
  }
  // Google pages can declare <base target="_blank">. A dynamically created
  // form must override it, otherwise the controller watches the wrong tab.
  const post = document.createElement('form');post.method='POST';post.action=action.href;post.target='_self';
  for (const [name,value] of body) {const input=document.createElement('input');input.type='hidden';input.name=name;input.value=value;post.append(input);}
  post.hidden=true;document.body.append(post);
  document.documentElement.dataset.hanuDirectPost=request.requestId;
  setTimeout(()=>{if(!document.documentElement.dataset.hanuDirectStopped)HTMLFormElement.prototype.submit.call(post);},0);
  return {scheduled:true};
}

export function refreshExecutionDraft():boolean {
  if(location.origin!=='https://docs.google.com'||!/\/forms\/(?:u\/\d+\/)?d\/e\//.test(location.pathname))return false;
  const text=document.body.innerText??'';
  if(!/bản nháp mới hơn|more recent draft|newer draft/i.test(text)||document.documentElement.dataset.hanuDirectDraftRefresh)return false;
  const buttons=[...document.querySelectorAll<HTMLElement>('button,[role="button"]')].filter(b=>/^(cập nhật|update)$/i.test(b.textContent?.normalize('NFC').trim()??'')&&b.getBoundingClientRect().width>0);
  if(buttons.length!==1)return false;
  document.documentElement.dataset.hanuDirectDraftRefresh='1';buttons[0].click();return true;
}

export function inspectExecutionUpload(input: {questionId:string;entryId:string;label:string;name:string;open:boolean;replaceExisting?:boolean}): {state:'ready'|'waiting'|'picker'|'missing'|'conflict';pickerUrl?:string;opened?:boolean;x?:number;y?:number} {
  const visible=(e:Element)=>{const r=e.getBoundingClientRect();return r.width>0&&r.height>0&&getComputedStyle(e).visibility!=='hidden';};
  const picker=[...document.querySelectorAll<HTMLIFrameElement>('iframe[src]')].find(f=>visible(f)&&f.src.startsWith('https://docs.google.com/picker?')&&new URL(f.src).searchParams.get('hostId')==='file-upload');
  if (picker) return {state:'picker',pickerUrl:picker.src};
  const norm=(s:string)=>(s??'').replace(/\s+/g,' ').trim();
  const roots=[...document.querySelectorAll<HTMLElement>('[role="listitem"],[data-item-id]')];
  const candidates=roots.filter(el=>el.dataset.itemId===input.questionId||!!el.querySelector(`[name="entry.${input.entryId}"]`)||[...el.querySelectorAll('[role="heading"],h3')].some(h=>norm(h.textContent??'').replace(/\s*\*$/,'')===norm(input.label)));
  const cards=candidates.filter(el=>!candidates.some(other=>other!==el&&el.contains(other)));
  if(cards.length!==1)return {state:'missing'};
  const card=cards[0], buttons=[...card.querySelectorAll<HTMLElement>('button,[role="button"]')].filter(visible);
  const remove=buttons.find(b=>/remove file|xóa tệp|xoa tep|delete file/i.test(`${b.getAttribute('aria-label')??''} ${b.textContent??''}`));
  const text=card.textContent??'';
  if(remove&&input.replaceExisting){remove.scrollIntoView({block:'center'});const r=remove.getBoundingClientRect();return {state:'waiting',x:r.x+r.width/2,y:r.y+r.height/2};}
  if(remove)return {state:text.includes(input.name)?'ready':'conflict'};
  if(input.open){
    const add=buttons.filter(b=>/add file|thêm tệp|tai tep|tải tệp/i.test(b.textContent??''));
    if(add.length===1){add[0].click();return {state:'waiting',opened:true};}
  }
  return {state:'waiting'};
}

// Stop is scoped to this document; a final request may already be in flight.
export function cancelExecutionPage():void {
  document.documentElement.dataset.hanuDirectStopped='1';
  document.dispatchEvent(new Event('hanu-direct-stop'));
}

// Use Google's own first Next to obtain its actual draft revision. Only the
// verified-email introduction is eligible; never guess Date.now() for dlut.
export function beginExecutionSession(formId:string):boolean {
  if(location.origin!=='https://docs.google.com'||!location.pathname.includes(`/d/e/${formId}/`))throw new Error('Sai form khởi tạo.');
  const form=document.querySelector<HTMLFormElement>('form[action*="/formResponse"]');
  if(!form)throw new Error('Không có form để Google ghi trạng thái.');
  const save=()=>{
    const body=new FormData(form),state:Record<string,string>={};
    for(const name of ['dlut','fuIds']){const value=body.get(name);if(typeof value==='string'&&value)state[name]=value;}
    sessionStorage.setItem(`hanu-direct-draft:${formId}`,JSON.stringify(state));
  };
  form.addEventListener('submit',save,{capture:true,once:true});
  form.submit=function(){save();HTMLFormElement.prototype.submit.call(this);};
  const checkbox=document.querySelector<HTMLElement>('[role="checkbox"][aria-label*="@"]');
  if(checkbox?.getAttribute('aria-checked')==='false')checkbox.click();
  const next=[...form.querySelectorAll<HTMLElement>('button,[role="button"]')].filter(b=>/^(tiếp|next)$/i.test(b.textContent?.normalize('NFC').trim()??''));
  if(next.length!==1)throw new Error('Không xác định được nút khởi tạo phiên.');
  next[0].click();return true;
}

export function resetExecutionPage():void {
  if(document.documentElement.dataset.hanuDirectPost)throw new Error('Trang cũ đã có request; chờ chuyển trang hoặc bắt đầu lượt mới, không gửi lặp.');
  delete document.documentElement.dataset.hanuDirectStopped;
}

// Used from upload onward so the real Google page is always recoverable.
export function prepareUploadAnswer(input:{questionId:string;entryId:string;label:string;kind:string;value:string}):{done?:boolean;x?:number;y?:number;keys?:string[]} {
  const norm=(s:string)=>s.normalize('NFC').replace(/\s+/g,' ').trim();
  const visible=(e:Element)=>{const r=e.getBoundingClientRect();return r.width>0&&r.height>0&&getComputedStyle(e).visibility!=='hidden';};
  const roots=[...document.querySelectorAll<HTMLElement>('[role="listitem"],[data-item-id]')];
  const matches=roots.filter(e=>e.dataset.itemId===input.questionId||[...e.querySelectorAll('[role="heading"],h3')].some(h=>norm(h.textContent??'').replace(/\s*\*$/,'')===norm(input.label)));
  const cards=matches.filter(e=>!matches.some(other=>other!==e&&e.contains(other)));
  if(cards.length!==1)throw new Error(`Không xác định duy nhất câu upload: ${input.label}`);
  const card=cards[0];
  const point=(e:HTMLElement,scroll=true)=>{if(scroll)e.scrollIntoView({block:'center',behavior:'instant'});const r=e.getBoundingClientRect();if(!visible(e))throw new Error('Điều khiển chưa hiển thị.');return {x:r.x+r.width/2,y:r.y+r.height/2};};
  // Forms stores committed select values in hidden inputs outside the card.
  const named=card.closest('form')?.querySelector<HTMLInputElement|HTMLTextAreaElement>(`[name="entry.${input.entryId}"]`);
  if(['text','textarea'].includes(input.kind)){
    const field=card.querySelector<HTMLInputElement|HTMLTextAreaElement>('input:not([type="hidden"]),textarea');
    if(!field)throw new Error('Không có ô nhập cho câu upload.');
    if(field.value!==input.value){const proto=field instanceof HTMLTextAreaElement?HTMLTextAreaElement.prototype:HTMLInputElement.prototype;Object.getOwnPropertyDescriptor(proto,'value')!.set!.call(field,input.value);field.dispatchEvent(new Event('input',{bubbles:true}));field.dispatchEvent(new Event('change',{bubbles:true}));}
    return {done:field.value===input.value};
  }
  if(input.kind==='radio'||input.kind==='checkbox'){
    const option=[...card.querySelectorAll<HTMLElement>('[role="radio"],[role="checkbox"]')].filter(e=>norm(e.getAttribute('data-value')??e.getAttribute('aria-label')??e.textContent??'')===norm(input.value));
    if(option.length!==1)throw new Error('Không khớp duy nhất lựa chọn tại trang upload.');
    return option[0].getAttribute('aria-checked')==='true'?{done:true}:point(option[0]);
  }
  if(input.kind==='dropdown'){
    if(named?.value===input.value)return {done:true};
    const list=card.querySelector<HTMLElement>('[role="listbox"]');if(!list)throw new Error('Không có danh sách tại trang upload.');
    const options=[...card.querySelectorAll<HTMLElement>('[role="option"]')].filter(e=>visible(e)&&norm(e.getAttribute('data-value')??e.textContent??'')===norm(input.value));
    if(list.getAttribute('aria-expanded')==='true'&&options.length===1){
      const option=options[0],siblings=[...option.parentElement!.children].filter(e=>e.matches('[role="option"]')&&e.getAttribute('aria-disabled')!=='true'&&visible(e));
      const offset=siblings.indexOf(option);if(offset<0)throw new Error('Không xác định được thứ tự lựa chọn tại trang upload.');
      // Google handles Up/Down but ignores Home. Reset to the first row with
      // clamped Up presses, then choose the exact offset and commit. A mere
      // aria-selected highlight is still not a committed hidden input value.
      option.focus();return {keys:[...Array.from({length:siblings.length-1},()=> 'ArrowUp'),...Array.from({length:offset},()=> 'ArrowDown'),'Enter']};
    }
    return point(list.querySelector<HTMLElement>('[jsname="LgbsSe"],[role="button"],button')??list);
  }
  throw new Error('Chưa hỗ trợ kiểu câu tại trang upload.');
}
