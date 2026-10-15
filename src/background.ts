import { attachmentReference, blobToDataUrl, clearAttachments, dataUrlToBlob, getAttachment, getProfile, getProfileRevision, saveAttachment, saveProfile } from "./storage";
import { ExtensionMessage, FormEvent, Profile, RunLogEntry, RunMode, RunState, validateFinalQuestion } from "./shared";
import { assignPickerFile, PickerUploadResult } from "./picker-upload";
import { createNativeClient } from './native-client';
import { cloudOrigin } from './coordinator-transport';
import { canonicalFormId, allowedFormUrl, sha256, type Command, type ExecutionView } from './protocol';

const RUN_PREFIX = "run:";
const interruptedRuns = new Set<string>();
let runWriteQueue=Promise.resolve();
const endedExecution=(run:RunState)=>['idle','completed','failed','ready_to_submit','submit_uncertain'].includes(run.status);
function writeState<T>(fn:()=>Promise<T>):Promise<T>{const work=runWriteQueue.then(fn);runWriteQueue=work.then(()=>undefined,()=>undefined);return work;}
async function acquireLease(runId:string,tabId=-1,managed=false){return writeState(async()=>{const owner=await repairLeaseNow();if(owner&&owner.runId!==runId)throw new Error('Profile đang có lượt chạy. Bấm Xem form hoặc Dừng trên hàng profile để xử lý lượt đang giữ profile.');await chrome.storage.local.set({executionLease:{runId,tabId,managed,acquiredAt:now(),active:true}});});}
const native = createNativeClient({start:startManaged,control:managedControl,focus:focusManaged,disconnected:parkManaged,reconcile:reconcileManaged,execution:executionSnapshot});
const pageAttention=new Map<number,{token:string;epoch:string;run:RunState;timer?:ReturnType<typeof setInterval>}>();
interface RenderGuard {token:string;cancelled:boolean;attached:boolean;ready:Promise<void>;finish:()=>void}
const renderGuards=new Map<number,RenderGuard>();
async function enablePageRendering(tabId:number,token:string,foreground=false){
  if(!chrome.debugger?.attach)return;
  if(renderGuards.has(tabId))throw new Error('Trang đang xử lý một bước khác.');
  const guard:RenderGuard={token,cancelled:false,attached:false,ready:Promise.resolve(),finish:()=>{}};
  guard.ready=new Promise(resolve=>guard.finish=resolve);renderGuards.set(tabId,guard);
  const valid=()=>{if(guard.cancelled)throw new Error('Lượt đã dừng; bỏ xử lý trang.');};
  try{
    await chrome.debugger.attach({tabId},'1.3');guard.attached=true;valid();
    if(foreground)await chrome.debugger.sendCommand({tabId},'Page.bringToFront');
    valid();
    await chrome.debugger.sendCommand({tabId},'Emulation.setFocusEmulationEnabled',{enabled:true});
    const metrics=await chrome.debugger.sendCommand({tabId},'Page.getLayoutMetrics') as {cssLayoutViewport?:{clientWidth:number;clientHeight:number};layoutViewport?:{clientWidth:number;clientHeight:number}}|undefined;
    valid();
    const viewport=metrics?.cssLayoutViewport??metrics?.layoutViewport;
    // A restored window can still have an initial 0x0 renderer viewport. Repair
    // only that startup state; normal dropdown/upload work remains concurrent.
    if(viewport&&(viewport.clientWidth===0||viewport.clientHeight===0)){
      await prepareFormWindow(tabId,true);
      valid();
      await chrome.debugger.sendCommand({tabId},'Page.bringToFront');
    }
    valid();
  }
  catch(error){if(guard.attached){guard.attached=false;await chrome.debugger.detach({tabId}).catch(()=>{});}if(renderGuards.get(tabId)===guard)renderGuards.delete(tabId);throw error;}
  finally{guard.finish();}
}
async function disablePageRendering(tabId:number,token:string){
  const guard=renderGuards.get(tabId);if(guard?.token!==token)return;
  guard.cancelled=true;await guard.ready;
  if(renderGuards.get(tabId)!==guard)return;
  renderGuards.delete(tabId);
  await chrome.debugger.sendCommand({tabId},'Emulation.setFocusEmulationEnabled',{enabled:false}).catch(()=>{});
  await chrome.debugger.detach({tabId}).catch(()=>{});
}
async function prepareFormWindow(tabId:number,focused=false){
  const tab=await chrome.tabs.get(tabId);
  if(tab.windowId===undefined||!chrome.windows?.get||!chrome.windows?.update)return;
  const window=await chrome.windows.get(tab.windowId);
  if(window.state==='minimized')await chrome.windows.update(tab.windowId,{state:'normal',focused:false});
  await chrome.tabs.update(tabId,{active:true});
  if(focused)await chrome.windows.update(tab.windowId,{focused:true});
}
async function releasePageAttention(tabId:number,token?:string){
  const lease=pageAttention.get(tabId);if(!lease||token&&lease.token!==token)return;
  pageAttention.delete(tabId);clearInterval(lease.timer);
  await disablePageRendering(tabId,lease.token);
  if(lease.run.managed)await native.request('ATTENTION_RELEASE',lease.run,{token:lease.token}).catch(()=>{});
}
async function acquirePageAttention(message:Extract<ExtensionMessage,{type:'PAGE_ATTENTION_ACQUIRE'}>,sender:chrome.runtime.MessageSender){
  const tabId=sender.tab?.id;
  if(tabId===undefined||(sender.frameId??0)!==0||!isFormsUrl(sender.url??sender.tab?.url))throw new Error('Trang không hợp lệ.');
  let run=await getRun(tabId);
  const valid=(r?:RunState)=>r?.status==='running'&&!r.submitAttempted&&r.runId===message.runId&&r.contentEpoch===message.epoch&&(!cloudOrigin()||r.managed)&&(!r.managed||native.isConnected()&&!interruptedRuns.has(r.runId!));
  if(!valid(run))throw new Error('Lượt/trang đã dừng; không mở cửa sổ.');
  const old=pageAttention.get(tabId);if(old?.epoch===message.epoch)return {ok:true,token:old.token};
  await releasePageAttention(tabId);
  const rendering=typeof chrome.debugger?.attach==='function'?'background':'foreground';
  run=addLog(run!,'info',`Đang xử lý${rendering==='background'?' đồng thời':''}: ${message.purpose.slice(0,100)}`);await saveRun(run);
  const granted=run.managed?await native.request('ATTENTION_ACQUIRE',run,{rendering}):{token:crypto.randomUUID(),mode:rendering};
  const foreground=granted.mode!=='background';
  if(!valid(await getRun(tabId))){if(run.managed)await native.request('ATTENTION_RELEASE',run,{token:granted.token}).catch(()=>{});throw new Error('Lượt đã dừng; bỏ thao tác cửa sổ.');}
  const lease={token:String(granted.token),epoch:message.epoch,run,timer:undefined as ReturnType<typeof setInterval>|undefined};pageAttention.set(tabId,lease);
  try{
    if(run.managed)lease.timer=setInterval(()=>{void native.request('ATTENTION_RENEW',run,{token:lease.token}).then(reply=>{if(!reply.renewed)void releasePageAttention(tabId,lease.token);}).catch(()=>void releasePageAttention(tabId,lease.token));},4000);
    await prepareFormWindow(tabId,foreground);
    await enablePageRendering(tabId,lease.token,foreground);
    if(run.managed&&foreground){const marked=await native.request('ATTENTION_FOCUSED',run,{token:lease.token});if(!marked.focused)throw new Error('Lượt đã mất quyền xử lý cửa sổ.');}
    if(!valid(await getRun(tabId)))throw new Error('Lượt đã dừng; bỏ thao tác cửa sổ.');
    return {ok:true,token:lease.token};
  }catch(e){await releasePageAttention(tabId,lease.token);throw e;}
}

function now(): string {
  return new Date().toISOString();
}

function isFormsUrl(url?: string): boolean {
  try{const u=new URL(url??'');return u.protocol==='https:'&&u.hostname==='docs.google.com'&&u.pathname.startsWith('/forms/');}catch{return false;}
}

async function getRun(tabId: number): Promise<RunState | undefined> {
  // storage.session and Side Panel are not available in older Chromium builds
  // (including several Cốc Cốc releases). Local storage is supported by every
  // Manifest V3 Chrome version and is sufficient for this small run state.
  const result = await chrome.storage.local.get(`${RUN_PREFIX}${tabId}`);
  return result[`${RUN_PREFIX}${tabId}`] as RunState | undefined;
}

async function writeRunNow(run:RunState):Promise<void>{
    const previous=await getRun(run.tabId);
    if(previous?.runId===run.runId){run.eventSeq=Math.max(previous?.eventSeq??0,run.eventSeq??0);run.contentEpoch??=previous?.contentEpoch;if(previous?.submitAttempted)run.submitAttempted=true;}
    if(run.managed&&interruptedRuns.has(run.runId!)&&run.status==='running'){run.status=run.submitAttempted?'submit_uncertain':'paused';run.recoveryRequired=true;}
    run.eventSeq = (run.eventSeq ?? 0) + 1;
    run.updatedAt=now();
    const lease=(await chrome.storage.local.get('executionLease')).executionLease;
    const managed=run.managed?await getManaged():undefined;
    const ownsManaged=run.managed&&(!managed||managed.runId===run.runId||lease?.runId===run.runId);
    await chrome.storage.local.set({ [`${RUN_PREFIX}${run.tabId}`]: run, ...(ownsManaged ? {managedRun:run} : {}) });
    if(lease?.runId===run.runId)await chrome.storage.local.set({executionLease:{runId:run.runId,tabId:run.tabId,active:!endedExecution(run)}});
    native.state(run);
    // Panel notifications must not hold the storage or request queue open.
    // A panel can disappear during navigation or leave its reply unresolved.
    void chrome.runtime.sendMessage({ type: "RUN_STATE_UPDATED", run }).catch(() => undefined);
}
async function saveRun(run:RunState):Promise<void>{return writeState(()=>writeRunNow(run));}
async function leaseOwner():Promise<RunState|undefined>{
 const lease=(await chrome.storage.local.get('executionLease')).executionLease;if(!lease?.active)return;
 const direct=Number.isInteger(lease.tabId)?await getRun(lease.tabId):undefined;if(direct?.runId===lease.runId)return direct;
 const managed=await getManaged();if(managed?.runId===lease.runId)return managed;
 const data=await chrome.storage.local.get(null);
 return Object.entries(data).filter(([key])=>key.startsWith(RUN_PREFIX)).map(([,run])=>run as RunState).filter(run=>run?.runId===lease.runId).sort((a,b)=>(b.eventSeq??0)-(a.eventSeq??0))[0];
}
async function repairLeaseNow():Promise<RunState|undefined>{
 const lease=(await chrome.storage.local.get('executionLease')).executionLease;if(!lease?.active)return;
 const run=await leaseOwner();
 if(!run&&lease.acquiredAt&&Date.now()-Date.parse(lease.acquiredAt)<30000)return {runId:lease.runId,tabId:lease.tabId??-1,managed:lease.managed,formId:'',mode:'test',status:'running',filled:[],skipped:[],logs:[],submitAttempted:false,startedAt:lease.acquiredAt,updatedAt:lease.acquiredAt};
 if(!run||endedExecution(run)){await chrome.storage.local.set({executionLease:{...lease,active:false}});return;}
 const tab=run.tabId>=0?await chrome.tabs.get(run.tabId).catch(()=>undefined):undefined;
 const opening=run.tabId<0&&Date.now()-Date.parse(run.startedAt??run.updatedAt)<30000;
 if(!opening&&(!tab||run.formId&&canonicalFormId(tab.url??tab.pendingUrl??'')!==run.formId)){
   if(tab)await chrome.tabs.sendMessage(run.tabId,{type:'HALT_RUN'}).catch(()=>undefined);
   const stopped=addLog({...run,status:run.submitAttempted?'submit_uncertain':'idle',recoveryRequired:false,blockingIssue:run.submitAttempted?run.blockingIssue:undefined},'warning','Tab của lượt đã đóng hoặc chuyển sang form khác. Đã dừng lượt và giải phóng profile.');
   await writeRunNow(stopped);return;
 }
 return run;
}
async function executionSnapshot():Promise<ExecutionView|null>{return writeState(async()=>{
 const run=await repairLeaseNow();if(!run)return null;
 const page=run.tabId>=0?await chrome.tabs.sendMessage(run.tabId,{type:'PAGE_RUN_STATUS'}).catch(()=>undefined):undefined;
 const active=page?.runId===run.runId&&typeof page.active==='boolean'?page.active:undefined;
 return {runId:run.runId,tabId:run.tabId,mode:run.mode,status:run.status,managed:!!run.managed,tabOpen:run.tabId>=0,active,message:run.blockingIssue?.message??run.logs.at(-1)?.message,startedAt:run.startedAt,updatedAt:run.updatedAt};
});}

function addLog(run: RunState, level: RunLogEntry["level"], message: string): RunState {
  return { ...run, logs: [...run.logs.slice(-49), { at: now(), level, message }], updatedAt: now() };
}

async function sendToForm<T>(tabId: number, command: ExtensionMessage): Promise<T> {
  try {
    return await chrome.tabs.sendMessage(tabId, command) as T;
  } catch {
    // A static content script is not attached to tabs that were already open
    // when the extension was loaded/reloaded. Inject once, then retry.
    await chrome.scripting.executeScript({ target: { tabId }, files: ["content.js"] });
    return await chrome.tabs.sendMessage(tabId, command) as T;
  }
}

async function dispatchTrustedClick(tabId: number, x: number, y: number): Promise<boolean> {
  if(renderGuards.get(tabId)?.cancelled)return false;
  const target = { tabId };
  let attached = false;
  try {
    if(!renderGuards.has(tabId)){await chrome.debugger.attach(target, "1.3");attached=true;}
    // Google Forms' Material controls can ignore synthetic DOM clicks. CDP
    // creates a browser-trusted pointer sequence at the exact CSS position.
    await chrome.debugger.sendCommand(target, "Input.dispatchMouseEvent", { type: "mouseMoved", x, y, button: "none", buttons: 0, pointerType: "mouse" });
    await chrome.debugger.sendCommand(target, "Input.dispatchMouseEvent", { type: "mousePressed", x, y, button: "left", buttons: 1, clickCount: 1, pointerType: "mouse" });
    await new Promise((resolve) => setTimeout(resolve, 18));
    await chrome.debugger.sendCommand(target, "Input.dispatchMouseEvent", { type: "mouseReleased", x, y, button: "left", buttons: 0, clickCount: 1, pointerType: "mouse" });
    return true;
  } catch {
    // Some managed Chromium builds block debugger. The content script retains
    // its DOM-event fallback in that case.
    return false;
  } finally {
    if (attached) await chrome.debugger.detach(target).catch(() => undefined);
  }
}

async function dispatchTrustedKeys(tabId: number, keys: string[]): Promise<boolean> {
  if(renderGuards.get(tabId)?.cancelled)return false;
  const target = { tabId };
  let attached = false;
  try {
    if(!renderGuards.has(tabId)){await chrome.debugger.attach(target, "1.3");attached=true;}
    for (const key of keys) {
      const windowsVirtualKeyCode = key === "ArrowDown" ? 40 : key === "Home" ? 36 : key === "Enter" ? 13 : 0;
      await chrome.debugger.sendCommand(target, "Input.dispatchKeyEvent", { type: "keyDown", key, code: key, windowsVirtualKeyCode });
      await chrome.debugger.sendCommand(target, "Input.dispatchKeyEvent", { type: "keyUp", key, code: key, windowsVirtualKeyCode });
    }
    return true;
  } catch {
    return false;
  } finally {
    if (attached) await chrome.debugger.detach(target).catch(() => undefined);
  }
}

async function runOnTab(tabId: number, mode: RunMode, skipQuestionId?: string): Promise<void> {
  const run=await getRun(tabId);
  if(cloudOrigin()&&(!run?.managed||!native.isConnected()))throw new Error('Bắt đầu lượt từ website bằng tài khoản đã được duyệt.');
  if(run?.status!=='running')throw new Error('Lượt đã dừng; không phát lệnh điền form.');
  await sendToForm(tabId, { type: "RUN_CURRENT_PAGE", mode, skipQuestionId, runId:run?.runId, finalQuestion:run.finalQuestion });
}

async function uploadStoredFile(message: Extract<ExtensionMessage, { type: "UPLOAD_STORED_FILE" }>, sender: chrome.runtime.MessageSender): Promise<PickerUploadResult> {
  const tabId = sender.tab?.id;
  if (tabId === undefined || (sender.frameId ?? 0) !== 0 || !isFormsUrl(sender.url ?? sender.tab?.url)) {
    throw new Error("Chỉ trang Google Forms đang chạy được phép yêu cầu upload.");
  }
  const picker = new URL(message.pickerUrl);
  if (picker.origin !== "https://docs.google.com" || !/^\/picker(?:\/|$)/.test(picker.pathname)
    || picker.searchParams.get("hostId") !== "file-upload"
    || !picker.searchParams.get("rpcService") || !picker.searchParams.get("rpctoken")) {
    throw new Error("Hộp chọn tệp không thuộc luồng upload Google Forms.");
  }
  const activeRun = await getRun(tabId);
  const profile = activeRun?.profileSnapshot ?? await getProfile();
  const reference = Object.values(profile.attachments).find(item => item?.id === message.attachmentId);
  if (!reference) throw new Error("Tệp không còn nằm trong hồ sơ đã lưu. Hãy chọn lại ảnh trong extension.");
  const currentForm = (sender.url ?? sender.tab?.url)?.match(/\/d\/e\/([^/]+)/)?.[1];
  const assertActive = async () => {
    const current = await getRun(tabId);
    if (current?.status !== "running" || current.formId !== currentForm) throw new Error("Phiên đã dừng hoặc không còn ở form ban đầu.");
  };
  const inject = async (payload: Parameters<typeof assignPickerFile>[0]): Promise<PickerUploadResult> => {
    const results = await chrome.scripting.executeScript({ target: { tabId, allFrames: true }, func: assignPickerFile, args: [payload] });
    const matching = results.map(item => item.result as PickerUploadResult | undefined)
      .filter((item): item is PickerUploadResult => Boolean(item && item.state !== "ignored"));
    return matching.find(item => item.state === "error")
      ?? matching.find(item => item.state === "assigned")
      ?? matching.find(item => item.state === "ready") ?? { state: "waiting" };
  };
  await assertActive();
  if (message.checkOnly) return inject({ pickerUrl: message.pickerUrl, requestId: message.requestId, checkOnly: true });
  // Startup polling sends only readiness metadata. Avoid reading, encoding and
  // copying a potentially large stored photo into every frame on each poll.
  const prepared = await inject({ pickerUrl: message.pickerUrl, requestId: message.requestId, prepareOnly: true });
  if (prepared.state !== "ready") return prepared;
  await assertActive();
  const blob = await getAttachment(reference.id);
  if (!blob) throw new Error("Không đọc được tệp đã lưu. Hãy chọn lại ảnh trong extension.");
  const dataUrl = await blobToDataUrl(blob);
  await assertActive();
  return inject({ dataUrl, name: reference.name, type: reference.type, pickerUrl: message.pickerUrl, requestId: message.requestId });
}

async function startRun(tabId: number, mode: RunMode): Promise<RunState> {
  if(cloudOrigin()){
    const tab=await chrome.tabs.get(tabId);
    if(!allowedFormUrl(tab.url??''))throw new Error('Hãy mở một trang Google Forms trước khi chạy.');
    const reply=await native.request('START',undefined,{url:tab.url,mode});
    return reply.run;
  }
  await executionSnapshot();
  const tab = await chrome.tabs.get(tabId);
  if (!isFormsUrl(tab.url)) throw new Error("Hãy mở một trang Google Forms trước khi chạy.");
  const formId = canonicalFormId(tab.url ?? '');
  if(!formId)throw new Error('Không xác định được form.');
  const managed=await getManaged();if(managed&&!['idle','completed','failed','ready_to_submit'].includes(managed.status))throw new Error('Profile đang thuộc lượt của app. Hãy dừng lượt đó trước.');
  if(await hasLocalLock(formId))throw new Error('Form có khóa gửi. Hãy xác minh kết quả trước khi tạo lượt mới.');
  const existing = await getRun(tabId);
  if (existing?.status === "submitting") throw new Error("Đang chờ xác nhận gửi form; extension sẽ không gửi lại.");
  const run: RunState = {
    runId:crypto.randomUUID(),profileSnapshot:await getProfile(),profileRevision:await getProfileRevision(),startedAt:now(),
    tabId,
    formId,
    mode,
    status: "running",
    filled: existing?.filled ?? [],
    skipped: existing?.skipped ?? [],
    logs: [...(existing?.logs ?? []).slice(-45), { at: now(), level: "info", message: `Bắt đầu ở chế độ ${mode === "test" ? "Test" : "Live"}.` }],
    submitAttempted: false,
    updatedAt: now()
  };
  await acquireLease(run.runId!,tabId);
  await saveRun(run);
  await prepareFormWindow(tabId);
  // Start always validates every question again, including a failed dropdown.
  await runOnTab(tabId, mode);
  return run;
}

async function pauseRun(tabId: number): Promise<RunState | undefined> {
  const current = await getRun(tabId);
  if (!current) return undefined;
  if(current.status==='completed')return current;
  const run = addLog({ ...current, status: current.submitAttempted?'submit_uncertain':"paused" }, "info", "Đã tạm dừng theo yêu cầu.");
  await saveRun(run);
  await chrome.tabs.sendMessage(tabId, { type: "HALT_RUN" }).catch(() => undefined);
  await releasePageAttention(tabId);
  return run;
}

async function stopRun(tabId: number): Promise<RunState | undefined> {
  const current = await getRun(tabId);
  if (!current) return undefined;
  if(current.status==='completed')return current;
  const run = addLog({ ...current, status: current.submitAttempted?'submit_uncertain':"idle", blockingIssue:current.submitAttempted?current.blockingIssue:undefined }, "info", "Đã dừng. Giữ dữ liệu và khóa gửi của lượt.");
  await saveRun(run);
  await chrome.tabs.sendMessage(tabId, { type: "HALT_RUN" }).catch(() => undefined);
  await releasePageAttention(tabId);
  return run;
}

async function resumeRun(tabId: number,automatic=false): Promise<RunState | undefined> {
  const current = await getRun(tabId);
  if(cloudOrigin()&&(!current?.managed||!native.isConnected()))throw new Error('Tiếp tục lượt từ website bằng tài khoản đã được duyệt.');
  if (!current) return undefined;
  if (current.submitAttempted) throw new Error("Lượt đã khóa gửi; hãy xác minh kết quả, không chạy lại.");
  if(!current.runId){current.runId=crypto.randomUUID();current.profileSnapshot=await getProfile();current.profileRevision=await getProfileRevision();await saveRun(current);}
  if(current.managed&&!native.isConnected())throw new Error('App chưa kết nối.');
  if(current.managed)await checkAccount(tabId,current.expectedEmail!);
  await acquireLease(current.runId!,tabId);
  const run=await writeState(async()=>{
    const latest=automatic?await getRun(tabId):current;
    if(!latest||automatic&&(latest.runId!==current.runId||latest.contentEpoch!==current.contentEpoch||latest.status!=='waiting_manual'||latest.submitAttempted||latest.recoveryRequired||interruptedRuns.has(current.runId!)))throw new Error('Lượt đã dừng hoặc thay đổi; không tự tiếp tục.');
    const next=addLog({...latest,status:'running',blockingIssue:undefined,updatedAt:now()},'info',automatic?'Dữ liệu đã được sửa hợp lệ; đang tự tiếp tục.':'Đang quét lại trang hiện tại; các giá trị khác hồ sơ sẽ được cập nhật rồi tự đi tiếp.');
    await writeRunNow(next);return next;
  });
  // Some controls (notably the Google file picker) do not expose their value
  // back to a content script. The user explicitly resumes after handling it,
  // so advance past this exact card once and let Google Forms validate Next.
  await runOnTab(tabId, run.mode, current.blockingIssue?.reason === "file_upload" ? current.blockingIssue.questionId : undefined);
  return run;
}

async function autoResumePage(message:Extract<ExtensionMessage,{type:'AUTO_RESUME'}>,sender:chrome.runtime.MessageSender){
  const tabId=sender.tab?.id;
  if(tabId===undefined||(sender.frameId??0)!==0||!isFormsUrl(sender.url??sender.tab?.url))throw new Error('Trang không hợp lệ.');
  const run=await getRun(tabId);
  if(!run?.runId||message.runId!==run.runId||message.epoch!==run.contentEpoch||run.formId!==canonicalFormId(sender.url??sender.tab?.url??'')||run.status!=='waiting_manual'||run.submitAttempted||run.recoveryRequired||interruptedRuns.has(run.runId)||!['validation','unknown_required','file_upload','unsupported'].includes(run.blockingIssue?.reason??''))throw new Error('Lượt đã dừng, thay đổi hoặc không chờ sửa dữ liệu.');
  if(run.managed){
    if(!native.isConnected())throw new Error('App mất kết nối; không tự tiếp tục.');
    await native.request('AUTO_RESUME',run);
  }else await resumeRun(tabId,true);
  return {ok:true,resumed:true};
}

async function processFormEvent(tabId: number, event: FormEvent, scope?:{runId?:string;epoch?:string}): Promise<void> {
  const current = await getRun(tabId);
  if (!current || current.status === "idle" || current.status === "paused") return;
  if(current.runId&&(scope?.runId!==current.runId||scope?.epoch!==current.contentEpoch))throw new Error('Sự kiện thuộc lượt/trang cũ.');
  if(current.managed&&!native.isConnected()&&event.type!=='completed')throw new Error('App mất kết nối; dừng để đối chiếu.');
  if(current.status==='completed'&&event.type!=='completed')return;
  if(current.managed&&interruptedRuns.has(current.runId!)&&event.type!=='completed')return;
  let run = current;
  if (event.type === "progress") {
    run = addLog({ ...run, status: "running", blockingIssue: undefined }, "info", event.message);
    if (event.filled && !run.filled.includes(event.filled)) run.filled = [...run.filled, event.filled];
    if (event.skipped && !run.skipped.includes(event.skipped)) run.skipped = [...run.skipped, event.skipped];
  } else if (event.type === "block") {
    run = addLog({ ...run, status: run.submitAttempted?"submit_uncertain":"waiting_manual", blockingIssue: event.issue }, "warning", event.issue.message);
  } else if (event.type === "ready_to_submit") {
    run = addLog({ ...run, status: "ready_to_submit" }, "success", "Đã điền xong. Chế độ Test dừng trước nút Gửi.");
  } else if (event.type === "submit_attempt") {
    if (run.submitAttempted) return;
    run = addLog({ ...run, status: "submitting", submitAttempted: true }, "info", "Đã bấm Gửi một lần; đang chờ xác nhận từ Google Forms.");
  } else if (event.type === "completed") {
    run = addLog({ ...run, status: "completed", blockingIssue: undefined }, "success", event.message);
  } else if (event.type === "failed") {
    run = addLog({ ...run, status: "failed" }, "error", event.message);
  } else if (event.type === "page_advanced") {
    run = addLog({ ...run, pageFingerprint: event.fingerprint, status: "running" }, "info", "Đã chuyển sang trang tiếp theo.");
  }
  await saveRun(run);
}

async function activeTabId(): Promise<number | undefined> {
  const [tab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
  return tab?.id;
}

async function panelState(requestedTabId?: number) {
  const tabId = requestedTabId ?? await activeTabId();
  return { profile: await getProfile(), run: tabId === undefined ? undefined : await getRun(tabId), tabId };
}

// Chrome 114/115 can open a panel via action behavior but do not expose open().
// Chromium forks without Side Panel use a separate controller window bound to
// the original form tab, so changing focus cannot target the controller itself.
let panelActionConfigured = false;
if (chrome.sidePanel?.setPanelBehavior) {
  void chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true })
    .then(() => { panelActionConfigured = true; })
    .catch(() => undefined);
}

const controllerWindows=new Map<number,number>();
let controllerQueue:Promise<unknown>=Promise.resolve();
async function openControllerWindow(tabId: number, focused=true): Promise<number|undefined> {
  const opening=controllerQueue.then(async()=>{
    const remembered=controllerWindows.get(tabId);
    if(remembered!==undefined&&await chrome.windows.get(remembered).catch(()=>undefined)){await chrome.windows.update(remembered,{state:'normal',focused});return remembered;}
    const url=chrome.runtime.getURL(`sidepanel.html?tabId=${tabId}`);
    // Query filters use URL match patterns, not exact URLs with query strings.
    const existing=(await chrome.tabs.query({})).find(tab=>tab.url===url);
    if(existing){controllerWindows.set(tabId,existing.windowId);await chrome.windows.update(existing.windowId,{state:'normal',focused});return existing.windowId;}
    const window=await chrome.windows.create({url,type:"popup",width:460,height:760,focused});
    if(window?.id!==undefined)controllerWindows.set(tabId,window.id);
    return window?.id;
  });controllerQueue=opening.catch(()=>undefined);return opening;
}

chrome.action.onClicked.addListener((tab) => {
  if (tab.id === undefined) return;
  const tabId = tab.id;
  if (chrome.sidePanel?.open) {
    void chrome.sidePanel.open({ tabId }).catch(() => openControllerWindow(tabId));
  } else if (!panelActionConfigured) {
    void openControllerWindow(tabId);
  }
});

chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  if (!changeInfo.url && !changeInfo.status) return;
  if (chrome.sidePanel?.setOptions) {
    void chrome.sidePanel.setOptions({ tabId, path: "sidepanel.html", enabled: true }).catch(() => undefined);
  }
});

chrome.tabs.onRemoved.addListener((tabId) => {
  void releasePageAttention(tabId);
  void writeState(async()=>{const run=await getRun(tabId);if(run&&!endedExecution(run)){run.status=run.submitAttempted?'submit_uncertain':'idle';run.recoveryRequired=false;run.blockingIssue=run.submitAttempted?run.blockingIssue:undefined;run.logs.push({at:now(),level:'warning',message:'Tab đăng ký đã đóng. Đã dừng lượt và giải phóng profile.'});await writeRunNow(run);}});
});

let messageQueue=Promise.resolve();
chrome.runtime.onMessage.addListener((message: ExtensionMessage, sender, sendResponse) => {
  // Panel controls can wait for a coordinator command which itself needs page
  // messages (CLAIM_DOCUMENT, FORM_EVENT, GET_RUN_FOR_TAB). Keep that queue free.
  if(['START_RUN','PAUSE_RUN','RESUME_RUN','STOP_RUN'].includes(message.type)){
    void (async()=>{
      if(sender.tab&&isFormsUrl(sender.url??sender.tab.url))throw new Error('Trang form không được phép điều khiển profile.');
      if(message.type==='START_RUN')return startRun(message.tabId,message.mode);
      if(message.type!=='PAUSE_RUN'&&message.type!=='RESUME_RUN'&&message.type!=='STOP_RUN')throw new Error('Lệnh điều khiển không hợp lệ.');
      const run=await getRun(message.tabId);
      if(run?.managed){
        const reply=await native.request('CONTROL',run,{action:message.type.replace('_RUN','')});
        return message.type==='STOP_RUN'?reply.result?.run:reply.result;
      }
      return message.type==='PAUSE_RUN'?pauseRun(message.tabId):message.type==='RESUME_RUN'?resumeRun(message.tabId):stopRun(message.tabId);
    })().then(sendResponse).catch(e=>sendResponse({ok:false,error:(e as Error).message}));return true;
  }
  // An acquire may wait for another profile; never hold the regular page/Stop
  // queue while waiting, otherwise navigation claims and cancellation deadlock.
  if(message.type==='PAGE_ATTENTION_ACQUIRE'||message.type==='PAGE_ATTENTION_RELEASE'||message.type==='AUTO_RESUME'){
    void (async()=>{
      if(sender.tab?.id===undefined||(sender.frameId??0)!==0||!isFormsUrl(sender.url??sender.tab.url))throw new Error('Trang không hợp lệ.');
      if(message.type==='AUTO_RESUME')return autoResumePage(message,sender);
      if(message.type==='PAGE_ATTENTION_ACQUIRE')return acquirePageAttention(message,sender);
      await releasePageAttention(sender.tab.id,message.token);return {ok:true};
    })().then(sendResponse).catch(e=>sendResponse({ok:false,error:(e as Error).message}));return true;
  }
  messageQueue=messageQueue.then(async () => {
    try {
      if(sender.tab&&isFormsUrl(sender.url??sender.tab.url)&&!['CLAIM_DOCUMENT','REQUEST_SUBMIT','GET_RUN_FOR_TAB','GET_PROFILE','GET_ATTACHMENT','UPLOAD_STORED_FILE','TRUSTED_CLICK','TRUSTED_KEYS','FORM_EVENT'].includes(message.type))throw new Error('Trang form không được phép thay đổi cấu hình extension.');
      if(message.type==='NATIVE_STATUS')return sendResponse(await native.status());
      if(message.type==='NATIVE_PAIR')return sendResponse(await native.pair(message.code));
      if(message.type==='NATIVE_UNLINK')return sendResponse(await native.unlink());
      if(message.type==='NATIVE_OPEN_MANAGER'){const url=cloudOrigin()||(await native.request('OPEN_MANAGER')).url;await chrome.tabs.create({url,active:true});return sendResponse({ok:true});}
      if(message.type==='CLAIM_DOCUMENT'){
        if(sender.tab?.id===undefined||!isFormsUrl(sender.url??sender.tab.url)||(sender.frameId??0)!==0)throw new Error('Trang không hợp lệ.');
        const run=await getRun(sender.tab.id);
        if(pageAttention.get(sender.tab.id)?.epoch!==message.epoch)await releasePageAttention(sender.tab.id);
        if(run&&run.formId===canonicalFormId(sender.url??sender.tab.url??'')){
          if(cloudOrigin()&&!run.managed&&!endedExecution(run)){run.status=run.submitAttempted?'submit_uncertain':'paused';run.recoveryRequired=true;}
          run.contentEpoch=message.epoch;await saveRun(run);
          return sendResponse({ok:true,run:run.managed&&!native.isConnected()?{...run,recoveryRequired:true}:run});
        }
        return sendResponse({ok:true});
      }
      if(message.type==='REQUEST_SUBMIT')return sendResponse(await grantSubmit(message,sender));
      if (message.type === "GET_PANEL_STATE") return sendResponse(await panelState(message.tabId));
      if (message.type === "GET_RUN_FOR_TAB") {
        const run = sender.tab?.id === undefined ? undefined : await getRun(sender.tab.id);
        const currentFormId = canonicalFormId(sender.url??sender.tab?.url??'');
        if(cloudOrigin()&&run&&!run.managed)return sendResponse({...run,recoveryRequired:true});
        if(run?.managed&&(!native.isConnected()||run.recoveryRequired))return sendResponse({...run,recoveryRequired:true});
        return sendResponse(run?.formId === currentFormId ? run : undefined);
      }
      if (message.type === "TRUSTED_CLICK") {
        if (sender.tab?.id === undefined || !isFormsUrl(sender.tab.url)) throw new Error("Trusted click chỉ được phép trên Google Forms.");
        return sendResponse({ ok: true, dispatched: await dispatchTrustedClick(sender.tab.id, message.x, message.y) });
      }
      if (message.type === "TRUSTED_KEYS") {
        if (sender.tab?.id === undefined || !isFormsUrl(sender.tab.url)) throw new Error("Trusted keys chỉ được phép trên Google Forms.");
        return sendResponse({ ok: true, dispatched: await dispatchTrustedKeys(sender.tab.id, message.keys) });
      }
      if (message.type === "GET_PROFILE") {const run=sender.tab?.id===undefined?undefined:await getRun(sender.tab.id);return sendResponse(run?.profileSnapshot??await getProfile());}
      if (message.type === "SAVE_PROFILE") {
        await saveProfile(message.profile);
        native.profileChanged();
        return sendResponse({ ok: true });
      }
      if (message.type === "SAVE_ATTACHMENT") {
        const blob = await dataUrlToBlob(message.dataUrl);
        const profile = await getProfile();
        const id = `${message.attachmentKey}:${Date.now()}`;
        await saveAttachment(id, blob);
        profile.attachments[message.attachmentKey] = attachmentReference(id, message.name, message.mimeType, blob.size);
        await saveProfile(profile);
        native.profileChanged();
        return sendResponse({ ok: true, profile });
      }
      if (message.type === "GET_ATTACHMENT") {
        const blob = await getAttachment(message.attachmentId);
        return sendResponse(blob ? { dataUrl: await blobToDataUrl(blob) } : { dataUrl: undefined });
      }
      if (message.type === "UPLOAD_STORED_FILE") return sendResponse(await uploadStoredFile(message, sender));
      if (message.type === "CLEAR_ALL_DATA") {
        if((await getManaged())?.status==='running')throw new Error('Dừng lượt app trước khi xóa dữ liệu.');
        if(Object.values((await chrome.storage.local.get('submissionLocks')).submissionLocks??{}).some((v:any)=>v.resolution!=='not_received'))throw new Error('Còn khóa gửi chưa giải quyết; không được xóa.');
        await chrome.storage.local.clear();
        await clearAttachments();
        return sendResponse({ ok: true });
      }
      if (message.type === "SCAN_FORM") {
        const tab = await chrome.tabs.get(message.tabId);
        if (!isFormsUrl(tab.url)) throw new Error("Hãy mở một trang Google Forms trước khi khảo sát.");
        return sendResponse(await sendToForm(message.tabId, message));
      }
      if (message.type === "SAVE_MAPPING") {
        const run = await getRun(message.tabId);
        if (!run) throw new Error("Không tìm thấy phiên đang chạy.");
        const profile = await getProfile();
        profile.mappings[`${run.formId}:${message.questionId}`] = message.ruleKey;
        await saveProfile(profile);
        return sendResponse({ ok: true, profile });
      }
      if (message.type === "FORM_EVENT") {
        if (sender.tab?.id !== undefined&&(sender.frameId??0)===0&&isFormsUrl(sender.url??sender.tab.url)) await processFormEvent(sender.tab.id, message.event,message);
        return sendResponse({ ok: true });
      }
      return sendResponse({ ok: false, error: "Unsupported message" });
    } catch (error) {
      return sendResponse({ ok: false, error: error instanceof Error ? error.message : String(error) });
    }
  }).catch(error=>sendResponse({ok:false,error:String(error)}));
  return true;
});

async function getManaged():Promise<RunState|undefined>{return (await chrome.storage.local.get('managedRun')).managedRun;}
async function hasLocalLock(formId:string){const locks=(await chrome.storage.local.get('submissionLocks')).submissionLocks??{};return Object.values(locks).some((v:any)=>v.formId===formId&&v.resolution!=='not_received');}
async function checkAccount(tabId:number,expected:string){
  let result=await sendToForm<{email?:string;error?:string}>(tabId,{type:'PAGE_ACCOUNT'});
  // Occluded Forms can have zero-width account headers before autofill starts.
  // Read the account again under the same foreground queue as form controls.
  if(!result.email&&!result.error){
    const run=await getRun(tabId);
    if(run?.status==='running'&&!run.submitAttempted){
      const rendering=typeof chrome.debugger?.attach==='function'?'background':'foreground';
      const granted=run.managed?await native.request('ATTENTION_ACQUIRE',run,{rendering}):undefined;
      const token=granted?.token??crypto.randomUUID();
      const foreground=(granted?.mode??rendering)!=='background';
      try{
        const current=await getRun(tabId);
        if(!current||current.runId!==run.runId||current.status!=='running'||interruptedRuns.has(run.runId!))throw new Error('Lượt đã dừng; bỏ kiểm tra tài khoản.');
        await prepareFormWindow(tabId,foreground);
        await enablePageRendering(tabId,token,foreground);
        if(granted&&foreground){const marked=await native.request('ATTENTION_FOCUSED',run,{token});if(!marked.focused)throw new Error('Lượt đã mất quyền xử lý cửa sổ.');}
        const deadline=Date.now()+3000;
        do{result=await sendToForm(tabId,{type:'PAGE_ACCOUNT'});if(result.email||result.error)break;await new Promise(r=>setTimeout(r,100));}while(Date.now()<deadline);
      }finally{await disablePageRendering(tabId,token);if(granted)await native.request('ATTENTION_RELEASE',run,{token}).catch(()=>{});}
    }
  }
  if(result.error)throw new Error(result.error);
  if(!result.email||result.email.trim().toLowerCase()!==expected.trim().toLowerCase())throw new Error(result.email?'Tài khoản trên form không khớp nick đã gán.':'Không xác định được tài khoản trên form.');
}
async function waitForForm(tabId:number):Promise<string>{
  for(let i=0;i<80;i++){const tab=await chrome.tabs.get(tabId);const id=canonicalFormId(tab.url??'');if(tab.status==='complete'&&tab.url?.startsWith('https://accounts.google.com/'))throw new Error('Cần đăng nhập Google.');if(tab.status==='complete'&&id)return id;await new Promise(r=>setTimeout(r,250));}
  throw new Error('Không tải được Google Form.');
}
async function startManaged(command:Command,sessionId:string){
  if(!command.runId||!allowedFormUrl(String(command.payload.url)))throw new Error('Lệnh chạy không hợp lệ.');
  validateFinalQuestion(command.payload.finalQuestion);
  await executionSnapshot();
  const old=await getManaged();if(old&&old.runId===command.runId)return old;
  const ledger=(await chrome.storage.local.get('managedRunLedger')).managedRunLedger??{};if(ledger[command.runId])throw new Error('Lượt cũ đã được nhận; không khởi chạy lại.');
  if(old&&!['idle','completed','failed','ready_to_submit','submit_uncertain'].includes(old.status))throw new Error('Profile đang chạy lượt khác.');
  if(await getProfileRevision()!==command.payload.revision)throw new Error('Hồ sơ chưa đồng bộ phiên bản.');
  const profile=await getProfile();const attachmentHashes=command.payload.attachmentHashes as Record<string,string>??{};for(const a of Object.values(profile.attachments))if(a){const blob=await getAttachment(a.id);if(!blob||blob.size!==a.size||await sha256(await blob.arrayBuffer())!==attachmentHashes[a.id])throw new Error('Ảnh chưa sẵn sàng hoặc mã băm khác bản đã đồng bộ.');}
  await acquireLease(command.runId,-1,true);
  ledger[command.runId]=now();await chrome.storage.local.set({managedRunLedger:ledger});
  interruptedRuns.delete(command.runId);
  let run:RunState={runId:command.runId,sessionId,managed:true,profileSnapshot:profile,finalQuestion:command.payload.finalQuestion,profileRevision:Number(command.payload.revision),attachmentHashes,recoveryRequired:true,expectedEmail:String(command.payload.expectedEmail),url:String(command.payload.url),tabId:-1,formId:'',mode:command.payload.mode as 'test'|'live',status:'running',filled:[],skipped:[],logs:[],submitAttempted:false,updatedAt:now(),startedAt:now(),eventSeq:0};
  await saveRun(run);
  // Keep the registration tab selected in its own profile window. Background
  // tabs can throttle Forms initialization and the content script's timers.
  try{
    const window=chrome.windows?.getLastFocused?await chrome.windows.getLastFocused():undefined;
    if(window?.id!==undefined&&window.state==='minimized')await chrome.windows.update(window.id,{state:'normal',focused:false});
    const tab=await chrome.tabs.create({url:run.url,active:true,...(window?.id!==undefined?{windowId:window.id}:{})});run.tabId=tab.id!;await saveRun(run);await prepareFormWindow(run.tabId);
  }catch(e){run=addLog({...run,status:'failed'},'error',`Không mở được tab form: ${(e as Error).message}`);await saveRun(run);throw e;}
  let loaded=false,loadError='';
  for(let attempt=0;attempt<4;attempt++){
    if(interruptedRuns.has(run.runId!))return getManaged();
    try{run.formId=await waitForForm(run.tabId);const check=await sendToForm<{error?:string}>(run.tabId,{type:'PAGE_ACCOUNT'});if(check.error)throw new Error(check.error);loaded=true;break;}catch(e){loadError=(e as Error).message;if(/chặn truy cập/i.test(loadError)){native.failure(run);break;}if(/đăng nhập|form đã đóng/i.test(loadError))break;native.failure(run);if(attempt===3)break;await new Promise(r=>setTimeout(r,[2000,5000,10000][attempt]));if(interruptedRuns.has(run.runId!))return getManaged();await chrome.tabs.reload(run.tabId);}
  }
  run=(await getManaged())!;
  if(interruptedRuns.has(run.runId!))return run;
  if(!loaded){run.status='waiting_manual';run.blockingIssue={reason:'validation',message:loadError||'Không tải được form sau ba lần thử lại.'};await saveRun(run);return run;}
  const currentTab=await chrome.tabs.get(run.tabId);run.formId=canonicalFormId(currentTab.url??'')!;
  await saveRun(run);
  try{
    if(await hasLocalLock(run.formId))throw new Error('Form có khóa gửi chưa giải quyết.');
    await native.request('CHECK_FORM',run);await checkAccount(run.tabId,run.expectedEmail!);
    if(interruptedRuns.has(run.runId!))return getManaged();
    run=(await getManaged())!;run.recoveryRequired=false;await saveRun(run);await runOnTab(run.tabId,run.mode);return run;
  }catch(e){run=(await getManaged())!;run.status='waiting_manual';run.blockingIssue={reason:'validation',message:(e as Error).message};await saveRun(run);return run;}
}
async function parkManaged(){const run=await getManaged();if(!run||endedExecution(run))return;interruptedRuns.add(run.runId!);if(run.tabId>=0)await chrome.tabs.sendMessage(run.tabId,{type:'HALT_RUN'}).catch(()=>undefined);run.status=run.submitAttempted?'submit_uncertain':'paused';run.recoveryRequired=true;await saveRun(run);}
async function reconcileManaged(){await parkManaged();const run=await getManaged();if(run){native.state(run);return {run,tab:await chrome.tabs.get(run.tabId).catch(()=>undefined)};}return {run:null};}
async function focusManaged(){
  const execution=await executionSnapshot();const run=execution?await getRun(execution.tabId):await getManaged();let tab=run?await chrome.tabs.get(run.tabId).catch(()=>undefined):undefined;
  if(tab&&run?.formId&&canonicalFormId(tab.url??'')!==run.formId)tab=undefined;
  if(!tab){const forms=await chrome.tabs.query({url:'https://docs.google.com/forms/*'});tab=forms.find(t=>run?canonicalFormId(t.url??'')===(run.formId||canonicalFormId(run.url??'')):canonicalFormId(t.url??''));}
  if(!tab)tab=await chrome.tabs.create({...(run?.url&&allowedFormUrl(run.url)?{url:run.url}:{}),active:true});
  await chrome.tabs.update(tab.id!,{active:true});const window=await chrome.windows.get(tab.windowId);
  if(window.state==='minimized')await chrome.windows.update(tab.windowId,{state:'normal'});
  await chrome.windows.update(tab.windowId,{focused:true});
  return {tabId:tab.id};
}
async function stopProfile(){
 const data=await chrome.storage.local.get(null),managed=await getManaged();
 const runs=new Map<string,RunState>();for(const [key,value]of Object.entries(data)){const run=value as RunState;if(key.startsWith(RUN_PREFIX)&&run?.runId&&!endedExecution(run)){const old=runs.get(run.runId);if(!old||(old.eventSeq??0)<(run.eventSeq??0))runs.set(run.runId,run);}}
 if(managed?.runId&&managed.status!=='completed')runs.set(managed.runId,managed);
 for(const run of runs.values()){interruptedRuns.add(run.runId!);await stopRun(run.tabId);}
 return {run:await getManaged(),execution:await executionSnapshot()};
}
async function managedControl(command:Command){
  if(command.kind==='STOP_PROFILE')return stopProfile();
  if(command.kind==='SCAN_FORM'){
    const execution=await executionSnapshot();if(execution&&['running','submitting'].includes(execution.status))throw new Error('Tạm dừng lượt trong profile trước khi đọc câu hỏi, để không ảnh hưởng bước đang chạy.');
    const run=await getManaged();let tab=run?await chrome.tabs.get(run.tabId).catch(()=>undefined):undefined;
    if(!tab||!canonicalFormId(tab.url??'')){const tabs=await chrome.tabs.query({active:true,lastFocusedWindow:true});tab=tabs.find(t=>canonicalFormId(t.url??''));}
    if(!tab?.id||!canonicalFormId(tab.url??''))throw new Error('Mở form và chuyển đến trang chứa câu hỏi cuối trong profile này trước khi đọc.');
    if(renderGuards.has(tab.id))throw new Error('Form đang xử lý một bước. Chờ lượt dừng rồi đọc câu hỏi lại.');
    const token=`scan:${crypto.randomUUID()}`;
    try{await prepareFormWindow(tab.id);await enablePageRendering(tab.id,token);
      const result=await sendToForm<{questions:unknown[]}>(tab.id,{type:'SCAN_FORM',tabId:tab.id});
      return {...result,formId:canonicalFormId(tab.url!),url:tab.url};
    }finally{await disablePageRendering(tab.id,token);}
  }
  const run=await getManaged();if(!run||run.runId!==command.runId)throw new Error('Lượt điều khiển không khớp.');
  if(command.kind==='SET_FINAL_QUESTION'){
    validateFinalQuestion(command.payload.finalQuestion);
    if(!command.payload.finalQuestion||run.submitAttempted||!['paused','waiting_manual','ready_to_submit'].includes(run.status))throw new Error('Chỉ cập nhật câu hỏi cuối khi lượt đang chờ và chưa gửi.');
    if(command.payload.finalQuestion.formId&&command.payload.finalQuestion.formId!==run.formId)throw new Error('Câu hỏi đã chọn thuộc form khác.');
    run.finalQuestion=structuredClone(command.payload.finalQuestion);await saveRun(run);return run;
  }
  if(command.kind==='RESOLVE_SUBMISSION'){
    if(!['received','not_received'].includes(String(command.payload.result)))throw new Error('Kết quả xác minh không hợp lệ.');const locks=(await chrome.storage.local.get('submissionLocks')).submissionLocks??{};if(locks[run.runId!])locks[run.runId!].resolution=command.payload.result;await chrome.storage.local.set({submissionLocks:locks});run.status=command.payload.result==='received'?'completed':'idle';run.blockingIssue=undefined;run.recoveryRequired=false;await saveRun(run);return run;
  }
  if(command.kind==='STOP'){interruptedRuns.add(run.runId!);return stopRun(run.tabId);}
  if(command.kind==='PAUSE'){interruptedRuns.add(run.runId!);return pauseRun(run.tabId);}
  if(command.kind==='RESUME'){
    if(command.payload.automatic&&(run.status!=='waiting_manual'||run.recoveryRequired||interruptedRuns.has(run.runId!)))throw new Error('Lượt đã dừng; không tự tiếp tục.');
    if(run.submitAttempted)throw new Error('Lượt đã khóa gửi.');
    await native.request('CHECK_FORM',run);const tab=await chrome.tabs.get(run.tabId);if(canonicalFormId(tab.url??'')!==run.formId)throw new Error('Tab không còn ở form của lượt.');
    if(command.payload.automatic)return resumeRun(run.tabId,true);
    interruptedRuns.delete(run.runId!);run.recoveryRequired=false;await saveRun(run);return resumeRun(run.tabId);
  }
  throw new Error('Lệnh không hỗ trợ.');
}
async function grantSubmit(message:Extract<ExtensionMessage,{type:'REQUEST_SUBMIT'}>,sender:chrome.runtime.MessageSender){
  if(sender.tab?.id===undefined||(sender.frameId??0)!==0)throw new Error('Trang gửi không hợp lệ.');const run=await getRun(sender.tab.id);
  if(!run||run.mode!=='live'||run.status!=='running'||run.submitAttempted||run.runId!==message.runId||run.contentEpoch!==message.epoch||canonicalFormId(sender.url??sender.tab.url??'')!==run.formId)throw new Error('Không được cấp quyền gửi lần nữa.');
  if(cloudOrigin()&&(!run.managed||!native.isConnected()))throw new Error('Website chưa cấp quyền gửi cho lượt này.');
  if(run.managed){if(interruptedRuns.has(run.runId!)||!native.isConnected())throw new Error('App đang dừng hoặc mất kết nối.');await checkAccount(run.tabId,run.expectedEmail!);}
  if(await hasLocalLock(run.formId))throw new Error('Form có khóa gửi.');
  const locks=(await chrome.storage.local.get('submissionLocks')).submissionLocks??{};locks[run.runId!]={formId:run.formId,resolution:'uncertain',createdAt:now()};
  await chrome.storage.local.set({submissionLocks:locks});run.submitAttempted=true;run.status='submitting';await saveRun(run);
  try{if(run.managed)await native.request('SUBMIT',run);}catch(e){run.status='submit_uncertain';run.blockingIssue={reason:'submit_uncertain',message:(e as Error).message};await saveRun(run);throw e;}
  return {ok:true,granted:true};
}

if(cloudOrigin()||typeof chrome.runtime.connectNative==='function'){native.boot();setInterval(()=>native.heartbeat(),cloudOrigin()?20000:5000);chrome.runtime.onStartup?.addListener(()=>void reconcileManaged());}
