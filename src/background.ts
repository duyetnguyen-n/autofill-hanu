import { attachmentReference, blobToDataUrl, clearAttachments, dataUrlToBlob, getAttachment, getProfile, getProfileRevision, saveAttachment, saveProfile } from "./storage";
import { ExtensionMessage, FormEvent, Profile, RunLogEntry, RunMode, RunState } from "./shared";
import { assignPickerFile, PickerUploadResult } from "./picker-upload";
import { createNativeClient } from './native-client';
import { canonicalFormId, allowedFormUrl, sha256, type Command } from './protocol';

const RUN_PREFIX = "run:";
const interruptedRuns = new Set<string>();
let runWriteQueue=Promise.resolve();
let leaseQueue=Promise.resolve();
async function acquireLease(runId:string){const claim=leaseQueue.then(async()=>{const lease=(await chrome.storage.local.get('executionLease')).executionLease;if(lease?.active&&lease.runId!==runId)throw new Error('Profile đang có lượt chạy. Dừng lượt hiện tại trước khi bắt đầu lượt khác.');await chrome.storage.local.set({executionLease:{runId,active:true}});});leaseQueue=claim.catch(()=>undefined);await claim;}
const native = createNativeClient({start:startManaged,control:managedControl,focus:focusManaged,disconnected:parkManaged,reconcile:reconcileManaged});

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

async function saveRun(run: RunState): Promise<void> {
  const write=runWriteQueue.then(async()=>{
    const previous=await getRun(run.tabId);
    if(previous?.runId===run.runId){run.eventSeq=Math.max(previous?.eventSeq??0,run.eventSeq??0);run.contentEpoch??=previous?.contentEpoch;if(previous?.submitAttempted)run.submitAttempted=true;}
    if(run.managed&&interruptedRuns.has(run.runId!)&&run.status==='running'){run.status=run.submitAttempted?'submit_uncertain':'paused';run.recoveryRequired=true;}
    run.eventSeq = (run.eventSeq ?? 0) + 1;
    run.updatedAt=now();
    await chrome.storage.local.set({ [`${RUN_PREFIX}${run.tabId}`]: run, ...(run.managed ? {managedRun:run} : {}) });
    const lease=(await chrome.storage.local.get('executionLease')).executionLease;if(lease?.runId===run.runId)await chrome.storage.local.set({executionLease:{runId:run.runId,active:!['idle','completed','failed','ready_to_submit'].includes(run.status)}});
    native.state(run);
    await chrome.runtime.sendMessage({ type: "RUN_STATE_UPDATED", run }).catch(() => undefined);
  });runWriteQueue=write.catch(()=>undefined);await write;
}

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
  const target = { tabId };
  let attached = false;
  try {
    await chrome.debugger.attach(target, "1.3");
    attached = true;
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
  const target = { tabId };
  let attached = false;
  try {
    await chrome.debugger.attach(target, "1.3");
    attached = true;
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
  if(run?.status!=='running')throw new Error('Lượt đã dừng; không phát lệnh điền form.');
  await sendToForm(tabId, { type: "RUN_CURRENT_PAGE", mode, skipQuestionId, runId:run?.runId });
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
  const blob = await getAttachment(reference.id);
  if (!blob) throw new Error("Không đọc được tệp đã lưu. Hãy chọn lại ảnh trong extension.");
  const dataUrl = await blobToDataUrl(blob);
  const current = await getRun(tabId);
  const currentForm = (sender.url ?? sender.tab?.url)?.match(/\/d\/e\/([^/]+)/)?.[1];
  if (current?.status !== "running" || current.formId !== currentForm) throw new Error("Phiên đã dừng hoặc không còn ở form ban đầu.");
  const results = await chrome.scripting.executeScript({
    target: { tabId, allFrames: true },
    func: assignPickerFile,
    args: [{ dataUrl, name: reference.name, type: reference.type, pickerUrl: message.pickerUrl, requestId: message.requestId }]
  });
  const matching = results.map(item => item.result as PickerUploadResult | undefined)
    .filter((item): item is PickerUploadResult => Boolean(item && item.state !== "ignored"));
  return matching.find(item => item.state === "error")
    ?? matching.find(item => item.state === "assigned") ?? { state: "waiting" };
}

async function startRun(tabId: number, mode: RunMode): Promise<RunState> {
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
  await acquireLease(run.runId!);
  await saveRun(run);
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
  return run;
}

async function stopRun(tabId: number): Promise<RunState | undefined> {
  const current = await getRun(tabId);
  if (!current) return undefined;
  if(current.status==='completed')return current;
  const run = addLog({ ...current, status: current.submitAttempted?'submit_uncertain':"idle" }, "info", "Đã dừng. Giữ dữ liệu và khóa gửi của lượt.");
  await saveRun(run);
  await chrome.tabs.sendMessage(tabId, { type: "HALT_RUN" }).catch(() => undefined);
  return run;
}

async function resumeRun(tabId: number): Promise<RunState | undefined> {
  const current = await getRun(tabId);
  if (!current) return undefined;
  if (current.submitAttempted) throw new Error("Lượt đã khóa gửi; hãy xác minh kết quả, không chạy lại.");
  if(!current.runId){current.runId=crypto.randomUUID();current.profileSnapshot=await getProfile();current.profileRevision=await getProfileRevision();await saveRun(current);}
  if(current.managed&&!native.isConnected())throw new Error('App chưa kết nối.');
  if(current.managed)await checkAccount(tabId,current.expectedEmail!);
  await acquireLease(current.runId!);
  const run = addLog({ ...current, status: "running", blockingIssue: undefined, updatedAt: now() }, "info", "Đang quét lại trang hiện tại; các giá trị khác hồ sơ sẽ được cập nhật rồi tự đi tiếp.");
  await saveRun(run);
  // Some controls (notably the Google file picker) do not expose their value
  // back to a content script. The user explicitly resumes after handling it,
  // so advance past this exact card once and let Google Forms validate Next.
  await runOnTab(tabId, run.mode, current.blockingIssue?.reason === "file_upload" ? current.blockingIssue.questionId : undefined);
  return run;
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

async function openControllerWindow(tabId: number): Promise<void> {
  await chrome.windows.create({
    url: chrome.runtime.getURL(`sidepanel.html?tabId=${tabId}`),
    type: "popup", width: 460, height: 760
  });
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
  void getRun(tabId).then(async run=>{if(run?.managed){run.status=run.submitAttempted?'submit_uncertain':'paused';run.recoveryRequired=true;run.logs.push({at:now(),level:'error',message:'Tab đăng ký đã đóng.'});await saveRun(run);}});
});

let messageQueue=Promise.resolve();
chrome.runtime.onMessage.addListener((message: ExtensionMessage, sender, sendResponse) => {
  messageQueue=messageQueue.then(async () => {
    try {
      if(sender.tab&&isFormsUrl(sender.url??sender.tab.url)&&!['CLAIM_DOCUMENT','REQUEST_SUBMIT','GET_RUN_FOR_TAB','GET_PROFILE','GET_ATTACHMENT','UPLOAD_STORED_FILE','TRUSTED_CLICK','TRUSTED_KEYS','FORM_EVENT'].includes(message.type))throw new Error('Trang form không được phép thay đổi cấu hình extension.');
      if(message.type==='NATIVE_STATUS')return sendResponse(await native.status());
      if(message.type==='NATIVE_PAIR')return sendResponse(await native.pair(message.code));
      if(message.type==='NATIVE_UNLINK')return sendResponse(await native.unlink());
      if(message.type==='NATIVE_OPEN_MANAGER'){const result=await native.request('OPEN_MANAGER');await chrome.tabs.create({url:result.url,active:true});return sendResponse({ok:true});}
      if(message.type==='CLAIM_DOCUMENT'){
        if(sender.tab?.id===undefined||!isFormsUrl(sender.url??sender.tab.url)||(sender.frameId??0)!==0)throw new Error('Trang không hợp lệ.');
        const run=await getRun(sender.tab.id);if(run){run.contentEpoch=message.epoch;await saveRun(run);}return sendResponse({ok:true});
      }
      if(message.type==='REQUEST_SUBMIT')return sendResponse(await grantSubmit(message,sender));
      if (message.type === "GET_PANEL_STATE") return sendResponse(await panelState(message.tabId));
      if (message.type === "GET_RUN_FOR_TAB") {
        const run = sender.tab?.id === undefined ? undefined : await getRun(sender.tab.id);
        const currentFormId = canonicalFormId(sender.url??sender.tab?.url??'');
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
      if (message.type === "START_RUN") return sendResponse(await startRun(message.tabId, message.mode));
      if (message.type === "PAUSE_RUN"||message.type==='RESUME_RUN'||message.type==='STOP_RUN'){
        const run=await getRun(message.tabId);if(run?.managed){const result=await native.request('CONTROL',run,{action:message.type.replace('_RUN','')});return sendResponse(result.result);}
        return sendResponse(message.type==='PAUSE_RUN'?await pauseRun(message.tabId):message.type==='RESUME_RUN'?await resumeRun(message.tabId):await stopRun(message.tabId));
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
  const result=await sendToForm<{email?:string;error?:string}>(tabId,{type:'PAGE_ACCOUNT'});
  if(result.error)throw new Error(result.error);
  if(!result.email||result.email.trim().toLowerCase()!==expected.trim().toLowerCase())throw new Error(result.email?'Tài khoản trên form không khớp nick đã gán.':'Không xác định được tài khoản trên form.');
}
async function waitForForm(tabId:number):Promise<string>{
  for(let i=0;i<80;i++){const tab=await chrome.tabs.get(tabId);const id=canonicalFormId(tab.url??'');if(tab.status==='complete'&&tab.url?.startsWith('https://accounts.google.com/'))throw new Error('Cần đăng nhập Google.');if(tab.status==='complete'&&id)return id;await new Promise(r=>setTimeout(r,250));}
  throw new Error('Không tải được Google Form.');
}
async function startManaged(command:Command,sessionId:string){
  if(!command.runId||!allowedFormUrl(String(command.payload.url)))throw new Error('Lệnh chạy không hợp lệ.');
  const old=await getManaged();if(old&&old.runId===command.runId)return old;
  const ledger=(await chrome.storage.local.get('managedRunLedger')).managedRunLedger??{};if(ledger[command.runId])throw new Error('Lượt cũ đã được nhận; không khởi chạy lại.');
  if(old&&!['idle','completed','failed','ready_to_submit','submit_uncertain'].includes(old.status))throw new Error('Profile đang chạy lượt khác.');
  if(await getProfileRevision()!==command.payload.revision)throw new Error('Hồ sơ chưa đồng bộ phiên bản.');
  const profile=await getProfile();const attachmentHashes=command.payload.attachmentHashes as Record<string,string>??{};for(const a of Object.values(profile.attachments))if(a){const blob=await getAttachment(a.id);if(!blob||blob.size!==a.size||await sha256(await blob.arrayBuffer())!==attachmentHashes[a.id])throw new Error('Ảnh chưa sẵn sàng hoặc mã băm khác bản đã đồng bộ.');}
  ledger[command.runId]=now();await chrome.storage.local.set({managedRunLedger:ledger});
  await acquireLease(command.runId);
  interruptedRuns.delete(command.runId);
  let run:RunState={runId:command.runId,sessionId,managed:true,profileSnapshot:profile,profileRevision:Number(command.payload.revision),attachmentHashes,recoveryRequired:true,expectedEmail:String(command.payload.expectedEmail),url:String(command.payload.url),tabId:-1,formId:'',mode:command.payload.mode as 'test'|'live',status:'running',filled:[],skipped:[],logs:[],submitAttempted:false,updatedAt:now(),startedAt:now(),eventSeq:0};
  await saveRun(run);
  const tab=await chrome.tabs.create({url:run.url,active:false});run.tabId=tab.id!;await saveRun(run);
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
async function parkManaged(){const run=await getManaged();if(!run||['idle','completed','ready_to_submit'].includes(run.status))return;interruptedRuns.add(run.runId!);if(run.tabId>=0)await chrome.tabs.sendMessage(run.tabId,{type:'HALT_RUN'}).catch(()=>undefined);run.status=run.submitAttempted?'submit_uncertain':'paused';run.recoveryRequired=true;await saveRun(run);}
async function reconcileManaged(){await parkManaged();const run=await getManaged();if(run){native.state(run);return {run,tab:await chrome.tabs.get(run.tabId).catch(()=>undefined)};}return {run:null};}
async function focusManaged(){const run=await getManaged();let tab=run?await chrome.tabs.get(run.tabId).catch(()=>undefined):undefined;if(!tab)tab=await chrome.tabs.create({url:chrome.runtime.getURL('connection.html')});await chrome.tabs.update(tab.id!,{active:true});const window=await chrome.windows.get(tab.windowId);if(window.state==='minimized')await chrome.windows.update(tab.windowId,{state:'normal'});await chrome.windows.update(tab.windowId,{focused:true});return {tabId:tab.id};}
async function managedControl(command:Command){
  const run=await getManaged();if(!run||run.runId!==command.runId)throw new Error('Lượt điều khiển không khớp.');
  if(command.kind==='RESOLVE_SUBMISSION'){
    if(!['received','not_received'].includes(String(command.payload.result)))throw new Error('Kết quả xác minh không hợp lệ.');const locks=(await chrome.storage.local.get('submissionLocks')).submissionLocks??{};if(locks[run.runId!])locks[run.runId!].resolution=command.payload.result;await chrome.storage.local.set({submissionLocks:locks});run.status=command.payload.result==='received'?'completed':'idle';run.blockingIssue=undefined;run.recoveryRequired=false;await saveRun(run);return run;
  }
  if(command.kind==='STOP'){interruptedRuns.add(run.runId!);return stopRun(run.tabId);}
  if(command.kind==='PAUSE'){interruptedRuns.add(run.runId!);return pauseRun(run.tabId);}
  if(command.kind==='RESUME'){
    if(run.submitAttempted)throw new Error('Lượt đã khóa gửi.');
    await native.request('CHECK_FORM',run);const tab=await chrome.tabs.get(run.tabId);if(canonicalFormId(tab.url??'')!==run.formId)throw new Error('Tab không còn ở form của lượt.');
    interruptedRuns.delete(run.runId!);run.recoveryRequired=false;await saveRun(run);return resumeRun(run.tabId);
  }
  throw new Error('Lệnh không hỗ trợ.');
}
async function grantSubmit(message:Extract<ExtensionMessage,{type:'REQUEST_SUBMIT'}>,sender:chrome.runtime.MessageSender){
  if(sender.tab?.id===undefined||(sender.frameId??0)!==0)throw new Error('Trang gửi không hợp lệ.');const run=await getRun(sender.tab.id);
  if(!run||run.mode!=='live'||run.status!=='running'||run.submitAttempted||run.runId!==message.runId||run.contentEpoch!==message.epoch||canonicalFormId(sender.url??sender.tab.url??'')!==run.formId)throw new Error('Không được cấp quyền gửi lần nữa.');
  if(run.managed){if(interruptedRuns.has(run.runId!)||!native.isConnected())throw new Error('App đang dừng hoặc mất kết nối.');await checkAccount(run.tabId,run.expectedEmail!);}
  if(await hasLocalLock(run.formId))throw new Error('Form có khóa gửi.');
  const locks=(await chrome.storage.local.get('submissionLocks')).submissionLocks??{};locks[run.runId!]={formId:run.formId,resolution:'uncertain',createdAt:now()};
  await chrome.storage.local.set({submissionLocks:locks});run.submitAttempted=true;run.status='submitting';await saveRun(run);
  try{if(run.managed)await native.request('SUBMIT',run);}catch(e){run.status='submit_uncertain';run.blockingIssue={reason:'submit_uncertain',message:(e as Error).message};await saveRun(run);throw e;}
  return {ok:true,granted:true};
}

if(typeof chrome.runtime.connectNative==='function'){native.boot();setInterval(()=>native.heartbeat(),5000);chrome.runtime.onStartup?.addListener(()=>void reconcileManaged());}
