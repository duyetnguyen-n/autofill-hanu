// Temporary, local extension page for investigating the known sample form.
// It never reads stored attachments, edits a profile, navigates, or submits.
import { assignPickerFile as assignEarlyPickerFile } from './picker-upload-experiment';
import { assignPickerFile } from '../src/picker-upload';
import { assignFastPickerFile } from './picker-upload-fast';

const sampleId = '1FAIpQLSdwGr_cZjiXs_AapAIHmP1cdHp5q4_tLWI3fNytLWHtUJW5JQ';
const output = document.querySelector('pre')!;
const select = document.querySelector('select')!;
const log = (value: unknown) => { output.textContent += `${new Date().toISOString()} ${JSON.stringify(value, null, 2)}\n`; };
let haltedTab: number | undefined;
const tabId = async () => {
  const id = Number(select.value), tab = await chrome.tabs.get(id);
  if (!tab.url?.startsWith(`https://docs.google.com/forms/d/e/${sampleId}/`)) throw new Error('Chỉ được kiểm tra form mẫu đã chỉ định.');
  return id;
};

// Self-contained, serialized by Chrome into each frame. Never return URL
// queries, credentials, cookies, attachment bytes, or personal form fields.
function snapshot() {
  if (location.origin !== 'https://docs.google.com' || !location.pathname.startsWith('/picker') || new URL(location.href).searchParams.get('hostId') !== 'file-upload') return;
  const entries = performance.getEntriesByType('resource') as PerformanceResourceTiming[];
  return {
    pickerUrl: location.href,
    documentTime: performance.timeOrigin,
    selectedFiles: Array.from(document.querySelectorAll<HTMLInputElement>('input[type="file"]')).map(input => ({count: input.files?.length ?? 0})),
    marker: document.documentElement.dataset.hanuPickerUpload,
    cold: document.documentElement.dataset.hanuDiagnosticCold,
    error: document.documentElement.dataset.hanuPickerError,
    network: document.documentElement.dataset.hanuDiagnosticNetwork,
    fastTrace: document.documentElement.dataset.hanuFastTrace,
    text: document.body?.innerText?.slice(-2000)??'',
    requests: entries.filter(entry => /\/upload\/drive\/|\/batch\/drive\//.test(entry.name)).slice(-10).map(entry => {
      const url = new URL(entry.name);
      return {path: url.origin + url.pathname, kind: entry.initiatorType, status: (entry as PerformanceResourceTiming & {responseStatus?: number}).responseStatus,
        at: new Date(performance.timeOrigin + entry.startTime).toISOString(), duration: Math.round(entry.duration), bytes: entry.transferSize};
    })
  };
}

function formResult() {
  if(location.origin!=='https://docs.google.com'||!location.pathname.startsWith('/forms/'))return;
  const card=Array.from(document.querySelectorAll('[role="listitem"], [data-item-id]')).find(el=>/ẢNH MẶT TRƯỚC GTTT|Ảnh giấy tờ tùy thân/.test(el.querySelector('[role="heading"]')?.textContent??''));
  const frames=Array.from(document.querySelectorAll<HTMLIFrameElement>('iframe[src]')).filter(frame=>frame.src.includes('/picker?')&&frame.src.includes('hostId=file-upload'));
  const visible=frames.find(frame=>{const r=frame.getBoundingClientRect(),s=getComputedStyle(frame);return r.width>0&&r.height>0&&s.visibility!=='hidden'&&s.display!=='none'&&s.opacity!=='0'&&!frame.closest('[aria-hidden="true"]');});
  return {confirmedFile:!!card?.textContent?.includes('hanu-upload-diagnostic.png')&&Array.from(card.querySelectorAll('button,[role="button"]')).some(button=>/xóa tệp|remove file/i.test(button.getAttribute('aria-label')??'')),
    pickerVisible:!!visible,pickerUrl:visible?.src};
}

async function inspect() {
  const id = await tabId();
  const panel = await chrome.runtime.sendMessage({type: 'GET_PANEL_STATE', tabId: id});
  const native = await chrome.runtime.sendMessage({type: 'NATIVE_STATUS'});
  log({tabId:id, connection:{connected:native.connected,error:native.error}, run:panel.run && {
    status:panel.run.status,mode:panel.run.mode,recoveryRequired:panel.run.recoveryRequired,updatedAt:panel.run.updatedAt,
    issue:panel.run.blockingIssue?.message
  }});
  const form=(await chrome.scripting.executeScript({target:{tabId:id},func:formResult}))[0]?.result;
  log({form:{confirmedFile:form?.confirmedFile,pickerVisible:form?.pickerVisible}});
  const frames = await chrome.scripting.executeScript({target:{tabId:id,allFrames:true},func:snapshot});
  for (const frame of frames) if (frame.result && form?.pickerUrl && new URL(frame.result.pickerUrl).searchParams.get('rpcService')===new URL(form.pickerUrl).searchParams.get('rpcService') && new URL(frame.result.pickerUrl).searchParams.get('rpctoken')===new URL(form.pickerUrl).searchParams.get('rpctoken')) {
    const {pickerUrl: _url, ...safe} = frame.result;
    log({frameId:frame.frameId,...safe});
  }
  return form?.pickerUrl;
}

async function halt() {
  const id=await tabId();
  await chrome.tabs.sendMessage(id,{type:'HALT_RUN'});
  const state=await chrome.tabs.sendMessage(id,{type:'PAGE_RUN_STATUS'});
  if (state?.active !== false) throw new Error('Chưa xác nhận form đã dừng.');
  haltedTab=id;
  log({halted:true,tabId:id});
}

async function fresh() {
  const candidates=await chrome.tabs.query({url:`https://docs.google.com/forms/d/e/${sampleId}/formResponse`});
  const original=candidates.find(tab=>tab.id!==undefined);
  // Duplicate the already-open section; do not fill or transmit new personal
  // answers to navigate through the earlier registration pages.
  const tab=original?.id!==undefined?await chrome.tabs.duplicate(original.id):await chrome.tabs.create({url:`https://docs.google.com/forms/d/e/${sampleId}/viewform`,active:false});
  if(!tab||tab.id===undefined)throw new Error('Không mở được tab thử.');
  const option=document.createElement('option');option.value=String(tab.id);option.textContent=`Tab ${tab.id} · thử riêng`;select.append(option);select.value=option.value;
  for(let attempt=0;attempt<80;attempt++){
    if((await chrome.tabs.get(tab.id)).status==='complete'){
      try{await halt();log({freshTab:tab.id});return;}catch{}
    }
    await new Promise(resolve=>setTimeout(resolve,250));
  }
  throw new Error('Tab thử chưa tải xong.');
}

async function openPicker(id:number) {
  await chrome.scripting.executeScript({target:{tabId:id},func:()=>{
    const card=Array.from(document.querySelectorAll('[role="listitem"], [data-item-id]')).find(el=>/ẢNH MẶT TRƯỚC GTTT|Ảnh giấy tờ tùy thân/.test(el.querySelector('[role="heading"]')?.textContent??''));
    const opener=Array.from(card?.querySelectorAll<HTMLElement>('button,[role="button"]')??[]).find(el=>/add file|thêm tệp/i.test(el.textContent??''));
    if(!opener)throw new Error('Không thấy nút Thêm tệp của câu ảnh.');opener.click();
  }});
  for(let attempt=0;attempt<80;attempt++){
    const current=await chrome.scripting.executeScript({target:{tabId:id},func:formResult});
    const url=current[0]?.result?.pickerUrl;
    if(url)return url;
    await new Promise(resolve=>setTimeout(resolve,100));
  }
  throw new Error('Picker chưa mở.');
}

async function test(world: chrome.scripting.ExecutionWorld, delivery?: "input", settle=false, fixed=false, fast=false, diagnosticStableMs=1000, diagnosticAnnouncement=false) {
  const started=performance.now();
  const id=await tabId();
  await halt();
  const state=await chrome.tabs.sendMessage(id,{type:'PAGE_RUN_STATUS'});
  if (state?.active !== false) throw new Error('Form chưa dừng.');
  const previous=(await chrome.scripting.executeScript({target:{tabId:id},func:formResult}))[0]?.result;
  if(previous?.pickerUrl){
    await chrome.scripting.executeScript({target:{tabId:id,allFrames:true},func:(url:string)=>{
      const current=new URL(location.href),expected=new URL(url);
      if(location.origin!=='https://docs.google.com'||!location.pathname.startsWith('/picker')||current.searchParams.get('rpcService')!==expected.searchParams.get('rpcService')||current.searchParams.get('rpctoken')!==expected.searchParams.get('rpctoken'))return;
      const close=Array.from(document.querySelectorAll<HTMLElement>('button,[role="button"]')).find(button=>/Đóng bộ chọn|Close.*picker|Close.*Insert/i.test(button.getAttribute('aria-label')??''));
      if(!close)throw new Error('Không thấy nút đóng Picker.');close.click();
    },args:[previous.pickerUrl]});
    for(let attempt=0;attempt<40;attempt++){
      const current=(await chrome.scripting.executeScript({target:{tabId:id},func:formResult}))[0]?.result;
      if(!current?.pickerVisible)break;
      if(attempt===39)throw new Error('Picker cũ chưa đóng; chưa tải ảnh thử.');
      await new Promise(resolve=>setTimeout(resolve,100));
    }
  }
  await chrome.scripting.executeScript({target:{tabId:id},func:()=>{
    const card=Array.from(document.querySelectorAll('[role="listitem"], [data-item-id]')).find(el=>/ẢNH MẶT TRƯỚC GTTT|Ảnh giấy tờ tùy thân/.test(el.querySelector('[role="heading"]')?.textContent??''));
    const remove=Array.from(card?.querySelectorAll<HTMLElement>('button,[role="button"]')??[]).find(button=>/xóa tệp|remove file/i.test(button.getAttribute('aria-label')??''));
    if(remove){if(!card?.textContent?.includes('hanu-upload-diagnostic.png'))throw new Error('Form có tệp khác; không thay tệp của người dùng.');remove.click();}
  }});
  // Open through the real Forms control so the parent's RPC callbacks remain
  // intact. Reloading just the iframe is not a valid end-to-end upload test.
  const pickerUrl=await openPicker(id);
  const watch=()=>chrome.scripting.executeScript({target:{tabId:id,allFrames:true},world:'MAIN',func:(pickerUrl:string)=>{
    const url=new URL(location.href),expected=new URL(pickerUrl);
    if(url.origin!=='https://docs.google.com'||!url.pathname.startsWith('/picker')||url.searchParams.get('rpcService')!==expected.searchParams.get('rpcService')||url.searchParams.get('rpctoken')!==expected.searchParams.get('rpctoken'))return;
    if(document.documentElement.dataset.hanuDiagnosticNetwork)return;
    const records:unknown[]=[];
    const save=(entry:unknown)=>{records.push(entry);document.documentElement.dataset.hanuDiagnosticNetwork=JSON.stringify(records.slice(-12));};
    save({watching:true});
    const open=XMLHttpRequest.prototype.open,send=XMLHttpRequest.prototype.send;
    const paths=new WeakMap<XMLHttpRequest,string>();
    XMLHttpRequest.prototype.open=function(method:string,target:string|URL,async:boolean=true,username?:string|null,password?:string|null){
      const url=new URL(String(target),location.href);paths.set(this,url.origin+url.pathname);
      return open.call(this,method,target,async,username,password);
    };
    XMLHttpRequest.prototype.send=function(...args:Parameters<XMLHttpRequest['send']>){
      const path=paths.get(this)??'';
      if(path.includes('/upload/drive/')||path.includes('/batch/drive/'))this.addEventListener('loadend',()=>{
        // Inspect only the fake upload's response shape and error fields, never
        // retain tokens, file identifiers, response bodies or resource queries.
        let body='';try{body=this.responseText;}catch{}
        const errors=Array.from(body.matchAll(/"(?:message|reason|error_description)"\s*:\s*"([^"\n]{0,240})"/g)).map(match=>match[1]);
        const keys=Array.from(new Set(Array.from(body.matchAll(/"([a-zA-Z_]{1,40})"\s*:/g)).map(match=>match[1]))).slice(0,60);
        save({path,status:this.status,keys,errors,bodyBytes:body.length});
      },{once:true});
      return send.apply(this,args);
    };
    window.addEventListener('error',event=>save({scriptError:event.message.slice(0,400)}));
    window.addEventListener('unhandledrejection',event=>save({rejection:String(event.reason?.message??'unknown').slice(0,400)}));
    document.addEventListener('change',event=>{
      const input=event.target;if(!(input instanceof HTMLInputElement)||input.type!=='file')return;
      save({change:true,readyState:document.readyState,selected:input.files?.length});
      for(const ms of [100,1000,3000])setTimeout(()=>save({after:ms,connected:input.isConnected,sameInput:document.querySelector('input[type="file"]')===input}),ms);
    },true);
  },args:[pickerUrl]});
  if(settle){await watch();await new Promise(resolve=>setTimeout(resolve,5000));}
  const requestId=crypto.randomUUID();
  const args={pickerUrl,requestId,delivery,diagnosticStableMs,diagnosticAnnouncement,name:'hanu-upload-diagnostic.png',type:'image/png',
    dataUrl:'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+ip1sAAAAASUVORK5CYII='};
  log({test:world,delivery:delivery??'drop',settle,fixed,fast,requestId,file:args.name,description:'Ảnh thử 1×1, không có dữ liệu cá nhân'});
  let assigned: chrome.scripting.InjectionResult<ReturnType<typeof assignPickerFile>>[]=[];
  for(let attempt=0;attempt<80;attempt++){
    await watch();
    if(fixed){
      assigned=await chrome.scripting.executeScript({target:{tabId:id,allFrames:true},world,func:assignPickerFile,args:[{pickerUrl,requestId,prepareOnly:true}]});
      if(assigned.some(frame=>frame.result?.state==='ready'))assigned=await chrome.scripting.executeScript({target:{tabId:id,allFrames:true},world,func:assignPickerFile,args:[args]});
    }else assigned=await chrome.scripting.executeScript({target:{tabId:id,allFrames:true},world,func:fast?assignFastPickerFile:assignEarlyPickerFile,args:[args]});
    if(assigned.some(frame=>frame.result?.state==='assigned'||frame.result?.state==='error'))break;
    await new Promise(resolve=>setTimeout(resolve,250));
  }
  log({assignedAfterMs:Math.round(performance.now()-started),assignment:assigned.map(frame=>({frameId:frame.frameId,result:frame.result}))});
  if (!assigned.some(frame=>frame.result?.state==='assigned')) return;
  for(let attempt=0;attempt<120;attempt++){
    await new Promise(resolve=>setTimeout(resolve,500));
    const result=await chrome.scripting.executeScript({target:{tabId:id,allFrames:true},world,func:assignPickerFile,args:[{pickerUrl,requestId,checkOnly:true}]});
    const error=result.find(frame=>frame.result?.state==='error');
    if(error){log({uploadError:error.result});await inspect();return;}
    const current=(await chrome.scripting.executeScript({target:{tabId:id},func:formResult}))[0]?.result;
    if(current?.confirmedFile&&!current.pickerVisible){
      log({success:true,totalMs:Math.round(performance.now()-started),form:{confirmedFile:current.confirmedFile,pickerVisible:current.pickerVisible}});
      const frames=await chrome.scripting.executeScript({target:{tabId:id,allFrames:true},func:snapshot});
      for(const frame of frames)if(frame.result?.marker===requestId){const {pickerUrl:_,...safe}=frame.result;log({completedFrame:frame.frameId,...safe});}
      return;
    }
    if(attempt===5||attempt===19)await inspect();
  }
  log({timeout:true});await inspect();
}

for(const button of document.querySelectorAll<HTMLButtonElement>('button'))button.onclick=async()=>{
  try{
    button.disabled=true;
    if(button.id==='inspect')await inspect();
    if(button.id==='fresh')await fresh();
    if(button.id==='halt')await halt();
    if(button.id==='legacy')await test('ISOLATED' as chrome.scripting.ExecutionWorld,'input');
    if(button.id==='isolated')await test('ISOLATED' as chrome.scripting.ExecutionWorld);
    if(button.id==='main')await test('MAIN' as chrome.scripting.ExecutionWorld);
    if(button.id==='warm')await test('ISOLATED' as chrome.scripting.ExecutionWorld,'input',true);
    if(button.id==='fixed')await test('ISOLATED' as chrome.scripting.ExecutionWorld,'input',false,true);
    if(button.id==='fast')await test('ISOLATED' as chrome.scripting.ExecutionWorld,'input',false,false,true);
    if(button.id==='fast250')await test('ISOLATED' as chrome.scripting.ExecutionWorld,'input',false,false,true,250);
    if(button.id==='announced')await test('ISOLATED' as chrome.scripting.ExecutionWorld,'input',false,false,true,250,true);
  }catch(error){log({error:error instanceof Error?error.message:String(error)});}
  finally{button.disabled=false;}
};
for(const tab of await chrome.tabs.query({url:`https://docs.google.com/forms/d/e/${sampleId}/*`})){
  if(tab.id===undefined)continue;
  const option=document.createElement('option');option.value=String(tab.id);option.textContent=`Tab ${tab.id} · ${new URL(tab.url!).pathname.split('/').at(-1)}`;
  select.append(option);
  if(tab.url?.endsWith('/formResponse'))select.value=option.value;
}
log({ready:true});
