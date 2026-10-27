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
  draftRefresh?: boolean;
  draftUpdated?: boolean;
}

// These functions are serialized into the responder tab by chrome.scripting.
// Session field VALUES remain in that document, never in storage or logs.
export function readExecutionPage(): ExecutionPage {
  const allowed = location.origin === 'https://docs.google.com' && /^\/forms\/(?:u\/\d+\/)?d\/e\/[^/]+\/(?:viewform|formResponse)$/.test(location.pathname);
  if (!allowed) throw new Error('Tab đã rời Google Form. Kiểm tra đăng nhập trước khi tiếp tục.');
  const form = document.querySelector<HTMLFormElement>('form[action*="/formResponse"]');
  const script = [...document.scripts].find(s => /^\s*(?:var\s+)?FB_PUBLIC_LOAD_DATA_\s*=/.test(s.textContent ?? ''))?.textContent ?? undefined;
  const text = document.body.innerText ?? document.body.textContent ?? '';
  const visible = (e: Element) => {const r=e.getBoundingClientRect();return r.width>0&&r.height>0&&getComputedStyle(e).visibility!=='hidden';};
  const buttons = [...document.querySelectorAll('button,[role="button"]')].filter(visible).map(e => e.textContent?.trim() ?? '');
  const history = form?.querySelector<HTMLInputElement>('input[name="pageHistory"]')?.value ?? '0';
  const emailLabel = document.querySelector('[role="checkbox"][aria-label*="@"]')?.getAttribute('aria-label');
  const account = (emailLabel ?? form?.innerText ?? '').match(/[A-Z0-9.!#$%&'*+/=?^_`{|}~-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i)?.[0] ?? '';
  // A random document key avoids confusing two pages with the same pathname.
  const html = document.documentElement;
  if (!html.dataset.hanuDirectDocument) html.dataset.hanuDirectDocument = crypto.randomUUID();
  return {url:location.href, documentKey:html.dataset.hanuDirectDocument,
    script, history:/^\d+(?:,\d+)*$/.test(history) ? history.split(',').map(Number) : [], account,
    hasForm:!!form, hasNext:buttons.some(t => /^(tiếp|next)$/i.test(t)),hasSubmit:buttons.some(t => /^(gửi|submit)$/i.test(t)),
    draftRefresh:/bản nháp mới hơn|more recent draft|newer draft/i.test(text),
    text:text.slice(0,60000), blocked:[...document.querySelectorAll('iframe[src*="recaptcha"],iframe[src*="hcaptcha"]')].some(f=>visible(f)&&f.getBoundingClientRect().height>50)
      || /không còn chấp nhận|no longer accepting|too many requests|unusual traffic/i.test(text)};
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
}
export interface FinalPostResult {status:number;received:boolean;message:string}
export async function postExecutionPage(request: PagePost): Promise<{scheduled:true;finalResult?:FinalPostResult}> {
  if (location.origin !== 'https://docs.google.com' || !location.pathname.includes(`/d/e/${request.formId}/`) || document.documentElement.dataset.hanuDirectDocument !== request.documentKey) throw new Error('Document/form đã thay đổi trước khi gửi request.');
  const original = document.querySelector<HTMLFormElement>('form[action*="/formResponse"]');
  if (!original) throw new Error('Không còn form để gửi.');
  const action = new URL(original.action);
  if (action.origin !== location.origin || !action.pathname.endsWith(`/d/e/${request.formId}/formResponse`)) throw new Error('Đích gửi không khớp form.');
  if (document.documentElement.dataset.hanuDirectPost) throw new Error('Document này đã có request, không gửi lặp.');
  const account = (document.querySelector('[role="checkbox"][aria-label*="@"]')?.getAttribute('aria-label') ?? original.innerText ?? original.textContent ?? '').match(/[A-Z0-9.!#$%&'*+/=?^_`{|}~-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i)?.[0] ?? '';
  if (!request.account || account.toLowerCase() !== request.account.toLowerCase()) throw new Error('Tài khoản Google đã thay đổi.');
  const source = new FormData(original), body = new URLSearchParams();
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
  // Google's autosaved draft can rehydrate older answers between navigations.
  // Merge the frozen answers into partialResponse too, preserving Google file
  // references and every other session slot verbatim.
  const rawPartial=body.get('partialResponse');
  if(rawPartial){
    let partial:any;
    try{partial=JSON.parse(rawPartial);}catch{throw new Error('Trạng thái bản nháp Google không hợp lệ.');}
    if(!Array.isArray(partial)||partial[0]!=null&&!Array.isArray(partial[0]))throw new Error('Cấu trúc bản nháp Google đã thay đổi.');
    const rows:any[]=partial[0]??[];
    for(const key of keys){
      const id=key.slice(6),values=request.entries.filter(e=>e[0]===key).map(e=>e[1]);
      const old=rows.find(row=>Array.isArray(row)&&String(row[1])===id);
      if(old)old[2]=values;else rows.push([null,Number(id),values,0]);
    }
    // Observed on this Lab: a file answer is [null, entry, null, 0, files],
    // and the current entry's JSON equals slot 4 exactly. Preserve that opaque
    // Google-produced structure; it is NOT a text answer in slot 2.
    for(const [id,files] of uploadValues){
      const old=rows.find(row=>Array.isArray(row)&&String(row[1])===id);
      if(old){old[2]=null;old[4]=files;}else rows.push([null,Number(id),null,0,files]);
    }
    partial[0]=rows;body.set('partialResponse',JSON.stringify(partial));
  }
  body.set('submissionTimestamp',String(Date.now()));
  if(request.history){
    if(!request.history.length||request.history.some(n=>!Number.isSafeInteger(n)||n<0))throw new Error('Lộ trình gửi không hợp lệ.');
    body.set('pageHistory',request.history.join(','));
  }
  for (const id of request.sentinels) body.set(`entry.${id}_sentinel`,'');
  body.set('emailAddress',request.account);
  body.set('fvv',body.get('fvv') || '1');
  body.delete('back');body.delete('continue');
  if (!request.final) body.set('continue','1');
  if(request.final){
    // Same-origin fetch keeps Google's authenticated upload session but does
    // not trigger beforeunload/autosave navigation after the file is selected.
    document.documentElement.dataset.hanuDirectPost=request.requestId;
    const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),35000);
    try{
      const response=await fetch(action.href,{method:'POST',credentials:'include',redirect:'follow',headers:{'Content-Type':'application/x-www-form-urlencoded;charset=UTF-8'},body:body.toString(),signal:controller.signal});
      const html=await response.text();
      // Parse only inert text/structural markers. Do not insert response HTML
      // into Google's document or create a Trusted Types policy in MAIN.
      const hasForm=/<form\b[^>]*action\s*=\s*["'][^"']*\/formResponse(?:[?"'])/i.test(html);
      const captcha=/<iframe\b[^>]*src\s*=\s*["'][^"']*(?:recaptcha|hcaptcha)/i.test(html);
      const text=html.replace(/<(script|style|iframe)\b[^>]*>[\s\S]*?<\/\1\s*>/gi,' ').replace(/<input\b[^>]*>/gi,' ').replace(/<[^>]*>/g,' ').replace(/&#(\d+);/g,(_all,n)=>String.fromCodePoint(Number(n))).replace(/&nbsp;|&#xA0;/gi,' ').replace(/&amp;/gi,'&').normalize('NFD').replace(/[\u0300-\u036f]/g,'').replace(/đ/g,'d').replace(/Đ/g,'d').toLowerCase().replace(/\s+/g,' ').trim();
      const received=response.ok&&!hasForm&&!captcha&&/(?:your )?response has been recorded|da ghi lai cau tra loi|cau tra loi cua ban da duoc ghi lai|chuc mung thi sinh da hoan thanh buoc dien thong tin dang ky bieu mau|恭喜您完成填写报名信息/.test(text);
      const draft=/ban nhap moi hon|more recent draft|newer draft/.test(text);
      const login=!!response.url&&new URL(response.url).hostname==='accounts.google.com';
      return {scheduled:true,finalResult:{status:response.status,received,message:received?'Google xác nhận đã ghi lại phản hồi.':login?'Google yêu cầu đăng nhập lại cho request Gửi.':draft?'Google trả về xung đột bản nháp, chưa xác nhận gửi.':hasForm?`Google trả lại form để kiểm tra dữ liệu; chưa xác nhận gửi. ${text.slice(-600)}`:`Google chưa trả xác nhận ghi phản hồi (HTTP ${response.status}).`}};
    }finally{clearTimeout(timer);}
  }
  // Google pages can declare <base target="_blank">. A dynamically created
  // form must override it, otherwise the controller watches the wrong tab.
  const post = document.createElement('form');post.method='POST';post.action=action.href;post.target='_self';
  for (const [name,value] of body) {const input=document.createElement('input');input.type='hidden';input.name=name;input.value=value;post.append(input);}
  post.hidden=true;document.body.append(post);
  document.documentElement.dataset.hanuDirectPost=request.requestId;
  setTimeout(()=>HTMLFormElement.prototype.submit.call(post),0);
  return {scheduled:true};
}

export function refreshExecutionDraft():boolean {
  if(location.origin!=='https://docs.google.com'||!/\/forms\/(?:u\/\d+\/)?d\/e\//.test(location.pathname))return false;
  const text=document.body.innerText??'';
  if(!/bản nháp mới hơn|more recent draft|newer draft/i.test(text)||document.documentElement.dataset.hanuDirectDraftRefresh)return false;
  const buttons=[...document.querySelectorAll<HTMLElement>('button,[role="button"]')].filter(b=>/^(cập nhật|update)$/i.test(b.textContent?.trim()??'')&&b.getBoundingClientRect().width>0);
  if(buttons.length!==1)return false;
  document.documentElement.dataset.hanuDirectDraftRefresh='1';buttons[0].click();return true;
}

export function inspectExecutionUpload(input: {questionId:string;entryId:string;label:string;name:string;open:boolean}): {state:'ready'|'waiting'|'picker'|'missing'|'conflict';pickerUrl?:string;opened?:boolean} {
  const visible=(e:Element)=>{const r=e.getBoundingClientRect();return r.width>0&&r.height>0&&getComputedStyle(e).visibility!=='hidden';};
  const picker=[...document.querySelectorAll<HTMLIFrameElement>('iframe[src]')].find(f=>visible(f)&&f.src.startsWith('https://docs.google.com/picker?')&&new URL(f.src).searchParams.get('hostId')==='file-upload');
  if (picker) return {state:'picker',pickerUrl:picker.src};
  const norm=(s:string)=>(s??'').replace(/\s+/g,' ').trim();
  const roots=[...document.querySelectorAll<HTMLElement>('[role="listitem"],[data-item-id]')];
  const candidates=roots.filter(el=>el.dataset.itemId===input.questionId||!!el.querySelector(`[name="entry.${input.entryId}"]`)||[...el.querySelectorAll('[role="heading"],h3')].some(h=>norm(h.textContent??'').replace(/\s*\*$/,'')===norm(input.label)));
  const cards=candidates.filter(el=>!candidates.some(other=>other!==el&&el.contains(other)));
  if(cards.length!==1)return {state:'missing'};
  const card=cards[0], buttons=[...card.querySelectorAll<HTMLElement>('button,[role="button"]')].filter(visible);
  const remove=buttons.some(b=>/remove file|xóa tệp|xoa tep|delete file/i.test(`${b.getAttribute('aria-label')??''} ${b.textContent??''}`));
  const text=card.textContent??'';
  if(remove)return {state:text.includes(input.name)?'ready':'conflict'};
  if(input.open){
    const add=buttons.filter(b=>/add file|thêm tệp|tai tep|tải tệp/i.test(b.textContent??''));
    if(add.length===1){add[0].click();return {state:'waiting',opened:true};}
  }
  return {state:'waiting'};
}
