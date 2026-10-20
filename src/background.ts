import { attachmentReference, blobToDataUrl, clearAttachments, dataUrlToBlob, getAttachment, getProfile, getProfileRevision, saveAttachment, saveProfile } from "./storage";
import { ExtensionMessage, FormEvent, Profile, RunLogEntry, RunMode, RunState, validateFinalQuestion } from "./shared";
import type { PickerUploadResult } from "./picker-upload";
import { StoredPickerUploads } from './stored-picker-upload';
import { createNativeClient } from './native-client';
import {automaticRecoveryAllowed,pageReadyResumeAllowed,returnedSubmissionAllowed,recoveryDelay,MAX_RECOVERY_ATTEMPTS,NAVIGATION_SLOW_MS,NAVIGATION_LIMIT_MS,validCorrections,type PageHealth} from './recovery';
import { cloudOrigin } from './coordinator-transport';
import { canonicalFormId, allowedFormUrl, sha256, type Command, type ExecutionView } from './protocol';
import {FacebookWatcher,enableFacebookWatch} from './facebook-watch';

const RUN_PREFIX = "run:";
const interruptedRuns = new Set<string>();
const storedPickerUploads = new StoredPickerUploads();
let interruptEpoch=0;
let runWriteQueue=Promise.resolve();
const endedExecution=(run:RunState)=>['idle','completed','failed','ready_to_submit','submit_uncertain'].includes(run.status);
function writeState<T>(fn:()=>Promise<T>):Promise<T>{const work=runWriteQueue.then(fn);runWriteQueue=work.then(()=>undefined,()=>undefined);return work;}
async function acquireLease(runId:string,tabId=-1,managed=false){return writeState(async()=>{const owner=await repairLeaseNow();if(owner&&owner.runId!==runId)throw new Error('Profile đang có lượt chạy. Bấm Xem form hoặc Dừng trên hàng profile để xử lý lượt đang giữ profile.');await chrome.storage.local.set({executionLease:{runId,tabId,managed,acquiredAt:now(),active:true}});});}
const native = createNativeClient({start:startManaged,control:managedControl,focus:focusManaged,disconnected:async()=>{facebookWatcher.stop();await parkManaged();},watchFacebook:p=>facebookWatcher.command(p),reconcile:reconcileManaged,execution:executionSnapshot,interrupt:async c=>{const current=await getManaged();if(c.runId&&current?.runId&&c.runId!==current.runId&&!endedExecution(current))throw new Error('Lệnh thuộc lượt cũ; không dừng lượt mới.');interruptEpoch++;if(c.runId)interruptedRuns.add(c.runId);await parkManaged();}});
const facebookWatcher=new FacebookWatcher(()=>native.isConnected(),payload=>native.request('FACEBOOK_OBSERVATION',undefined,payload));
const recoveryTimers=new Map<string,ReturnType<typeof setTimeout>>();
const recoveriesInFlight=new Map<string,Promise<void>>();
interface NavigationWatch {token:string;tabId:number;runId:string;epoch?:string;started:number;timer?:ReturnType<typeof setTimeout>}
const navigationWatches=new Map<number,NavigationWatch>();
function cancelNavigationWatch(tabId:number){
  const watch=navigationWatches.get(tabId);if(!watch)return;
  navigationWatches.delete(tabId);clearTimeout(watch.timer);
  void chrome.storage.local.remove(`navigation:${watch.token}`).catch(()=>{});
  if(chrome.alarms?.clear)void chrome.alarms.clear(`hanu-navigation:${watch.token}`);
}
async function armNavigationWatch(tabId:number){
  const run=await getRun(tabId);
  if(!run?.runId||!['running','submitting'].includes(run.status)||run.recoveryRequired||interruptedRuns.has(run.runId))return;
  if(navigationWatches.get(tabId)?.runId===run.runId)return;
  cancelNavigationWatch(tabId);
  const watch:NavigationWatch={token:crypto.randomUUID(),tabId,runId:run.runId,epoch:run.contentEpoch,started:Date.now()};
  navigationWatches.set(tabId,watch);
  await chrome.storage.local.set({[`navigation:${watch.token}`]:{...watch}});
  if(navigationWatches.get(tabId)!==watch)return;
  watch.timer=setTimeout(()=>void checkNavigationWatch(watch).catch(()=>{}),NAVIGATION_SLOW_MS);
  if(chrome.alarms?.create)void chrome.alarms.create(`hanu-navigation:${watch.token}`,{when:watch.started+NAVIGATION_LIMIT_MS});
}
async function checkNavigationWatch(watch:NavigationWatch){
  if(navigationWatches.get(watch.tabId)?.token!==watch.token)return;
  let run=await getRun(watch.tabId);const tab=await chrome.tabs.get(watch.tabId).catch(()=>undefined);
  if(!run||run.runId!==watch.runId||!tab||!['running','submitting'].includes(run.status)||run.recoveryRequired||interruptedRuns.has(watch.runId)||run.contentEpoch!==watch.epoch){cancelNavigationWatch(watch.tabId);return;}
  // A Picker/subframe can keep the tab's loading spinner on while the main
  // form is actively filling/uploading. Only its current run/document may
  // attest this. An explicit Next or Submit keeps its navigation deadline.
  if(!run.submitAttempted&&run.activity?.phase!=='navigating'){
    const page=await observePage(chrome.tabs.sendMessage(watch.tabId,{type:'PAGE_RUN_STATUS'})).catch(()=>undefined) as {runId?:string;epoch?:string;active?:boolean;inFlight?:boolean}|undefined;
    if(navigationWatches.get(watch.tabId)?.token!==watch.token)return;
    run=await getRun(watch.tabId);
    if(!run||run.runId!==watch.runId||run.contentEpoch!==watch.epoch||!['running','submitting'].includes(run.status)||run.recoveryRequired||interruptedRuns.has(watch.runId)){cancelNavigationWatch(watch.tabId);return;}
    if(!run.submitAttempted&&run.activity?.phase!=='navigating'&&page?.runId===run.runId&&page.epoch===run.contentEpoch&&page.active===true&&page.inFlight===true){cancelNavigationWatch(watch.tabId);return;}
  }
  // A completed HTTP load can still have a stuck in-document Next. Conversely,
  // a newly claimed document owns recovery and cancels the predecessor's timer.
  if(tab.status!=='loading'&&run.activity?.phase!=='navigating'&&!run.submitAttempted){cancelNavigationWatch(watch.tabId);return;}
  if(Date.now()-watch.started>=NAVIGATION_LIMIT_MS){
    cancelNavigationWatch(watch.tabId);
    const lease=pageAttention.get(watch.tabId)?.token;
    const blocked=await blockPageProblem(watch.runId,{issue:{reason:'navigation',message:'Google chưa hoàn tất tải/chuyển trang sau 25 giây. Không bấm Tiếp lần hai.'},retryable:true},watch.tabId,watch.epoch);
    if(blocked&&lease)await releasePageAttention(watch.tabId,lease);
    return;
  }
  await writeState(async()=>{
    const current=await getRun(watch.tabId);
    if(navigationWatches.get(watch.tabId)!==watch||current?.runId!==watch.runId||current.contentEpoch!==watch.epoch||!['running','submitting'].includes(current.status)||current.recoveryRequired)return;
    current.activity={phase:'navigating',message:current.submitAttempted?'Google đang trả kết quả Gửi chậm. Giữ khóa, không gửi lại.':'Google đang tải/chuyển trang chậm. Các profile khác vẫn chạy; chưa bấm Tiếp lại.',at:now()};
    await writeRunNow(current);
  });
  if(navigationWatches.get(watch.tabId)===watch)watch.timer=setTimeout(()=>void checkNavigationWatch(watch).catch(()=>{}),Math.max(1,NAVIGATION_LIMIT_MS-(Date.now()-watch.started)));
}
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
  run={...run!,activity:{phase:/chuyển trang/i.test(message.purpose)?'navigating':/upload|tải ảnh|tệp/i.test(message.purpose)?'uploading':'filling',message:message.purpose.slice(0,200),at:now()}};
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
async function haltDocument(tabId:number,watchReturn=false){
  let timer:ReturnType<typeof setTimeout>|undefined;
  // A frozen renderer must not hold the durable control/recovery queue open.
  await Promise.race([chrome.tabs.sendMessage(tabId,{type:'HALT_RUN',...(watchReturn?{watchReturn:true}:{})}).catch(()=>{}),new Promise<void>(resolve=>timer=setTimeout(resolve,500))]).finally(()=>clearTimeout(timer));
}
async function observePage<T>(work:Promise<T>):Promise<T>{
  let timer:ReturnType<typeof setTimeout>|undefined;
  return Promise.race([work,new Promise<never>((_resolve,reject)=>timer=setTimeout(()=>reject(new Error('Không đọc được trang đang bị treo.')),750))]).finally(()=>clearTimeout(timer));
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

async function writeRunNow(run:RunState,returnedRetry=false):Promise<void>{
    const previous=await getRun(run.tabId);
    if(previous&&previous.runId===run.runId){if((run.submissionRetries??0)!==(previous.submissionRetries??0)&&!(returnedRetry&&(run.submissionRetries??0)===(previous.submissionRetries??0)+1))throw new Error('Sự kiện thuộc lần gửi cũ.');run.eventSeq=Math.max(previous?.eventSeq??0,run.eventSeq??0);run.contentEpoch??=previous?.contentEpoch;if(previous?.submitAttempted&&!returnedRetry)run.submitAttempted=true;}
    if(run.managed&&interruptedRuns.has(run.runId!)&&run.status==='running'){run.status=run.submitAttempted?'submit_uncertain':'paused';run.recoveryRequired=true;}
    storedPickerUploads.reconcile(run.tabId, run);
    run.eventSeq = (run.eventSeq ?? 0) + 1;
    run.updatedAt=now();
    const lease=(await chrome.storage.local.get('executionLease')).executionLease;
    const managed=run.managed?await getManaged():undefined;
    const ownsManaged=run.managed&&(!managed||managed.runId===run.runId||lease?.runId===run.runId);
    await chrome.storage.local.set({ [`${RUN_PREFIX}${run.tabId}`]: run, ...(ownsManaged ? {managedRun:run} : {}) });
    if(!['running','submitting'].includes(run.status)||run.recoveryRequired)cancelNavigationWatch(run.tabId);
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
 // Error/login documents still belong to this run. Keep its lease while the
 // page-health handler parks it or schedules a bounded safe GET.
 if(tab&&/^(?:chrome-error:|https:\/\/(?:accounts\.google\.com\/|(?:www\.)?google\.com\/sorry))/i.test(tab.url??''))return run;
 if(!opening&&(!tab||run.formId&&canonicalFormId(tab.url??tab.pendingUrl??'')!==run.formId)){
   if(tab)await haltDocument(run.tabId);
   const stopped=addLog({...run,status:run.submitAttempted?'submit_uncertain':'idle',recoveryRequired:false,blockingIssue:run.submitAttempted?run.blockingIssue:undefined},'warning','Tab của lượt đã đóng hoặc chuyển sang form khác. Đã dừng lượt và giải phóng profile.');
   await writeRunNow(stopped);return;
 }
 return run;
}
async function executionSnapshot():Promise<ExecutionView|null>{return writeState(async()=>{
 const run=await repairLeaseNow();if(!run)return null;
 // A hung renderer can leave sendMessage unresolved forever. A heartbeat
 // observation must not retain the durable queue needed by Stop/Restart.
 const page=run.tabId>=0?await observePage(chrome.tabs.sendMessage(run.tabId,{type:'PAGE_RUN_STATUS'})).catch(()=>undefined):undefined;
 const active=page?.runId===run.runId&&typeof page.active==='boolean'?page.active:undefined;
 return {runId:run.runId,tabId:run.tabId,mode:run.mode,status:run.status,managed:!!run.managed,tabOpen:run.tabId>=0,active,eventSeq:run.eventSeq,message:run.blockingIssue?.message??run.logs.at(-1)?.message,startedAt:run.startedAt,updatedAt:run.updatedAt};
});}

function addLog(run: RunState, level: RunLogEntry["level"], message: string): RunState {
  return { ...run, logs: [...run.logs.slice(-49), { at: now(), level, message }], updatedAt: now() };
}

function cancelRecovery(runId?:string){
  if(!runId)return;clearTimeout(recoveryTimers.get(runId));recoveryTimers.delete(runId);
  if(typeof chrome.alarms?.clear==='function')void chrome.alarms.clear(`hanu-recovery:${runId}`);
}
function transientState(run:RunState,reason:'network'|'server_error'|'navigation',message:string):RunState {
  const attempt=(run.recovery?.attempt??0)+1,automatic=attempt<=MAX_RECOVERY_ATTEMPTS;
  const retryAt=automatic?new Date(Date.now()+recoveryDelay(attempt)).toISOString():undefined;
  const explanation=automatic?`${message} Thử lại ${attempt}/${MAX_RECOVERY_ATTEMPTS}; bạn có thể Dừng bất kỳ lúc nào.`:`${message} Đã hết ${MAX_RECOVERY_ATTEMPTS} lần tự thử. Kiểm tra form rồi bấm Tiếp tục hoặc Chạy lại.`;
  return addLog({...run,status:'waiting_manual',recoveryRequired:false,recovery:{reason,attempt,automatic,retryAt},blockingIssue:{reason,message:explanation},activity:{phase:automatic?'retrying':'waiting_user',message:explanation,at:now()}},'warning',explanation);
}
function scheduleRecovery(run:RunState){
  cancelRecovery(run.runId);
  if(!run.runId||run.submitAttempted||run.recoveryRequired||!run.recovery?.automatic||!run.recovery.retryAt)return;
  const delay=Math.max(0,Date.parse(run.recovery.retryAt)-Date.now());if(!Number.isFinite(delay)||delay>60000)return;
  recoveryTimers.set(run.runId,setTimeout(()=>void recoverPage(run.tabId,run.runId!).catch(()=>{}),delay));
  if(typeof chrome.alarms?.create==='function')void chrome.alarms.create(`hanu-recovery:${run.runId}`,{when:Date.now()+delay});
}
function recoverPage(tabId:number,runId:string):Promise<void>{
  const pending=recoveriesInFlight.get(runId);if(pending)return pending;
  // Chrome can fire both the timer and its durable alarm for the same attempt.
  // Coalesce before the first storage read: a late duplicate must not cancel
  // the next attempt scheduled while the first RECOVER command is finishing.
  const handled:{attempt?:number}={};
  const work=recoverPageOnce(tabId,runId,handled);recoveriesInFlight.set(runId,work);
  void work.finally(async()=>{
    if(recoveriesInFlight.get(runId)!==work)return;recoveriesInFlight.delete(runId);
    const latest=await getRun(tabId);
    // A new retry can become due while the preceding command is still being
    // acknowledged. Its coalesced wakeup must be restored after completion.
    if(latest?.runId===runId&&(latest.recovery?.attempt??0)>(handled.attempt??Infinity)&&!recoveriesInFlight.has(runId)&&!interruptedRuns.has(runId)&&automaticRecoveryAllowed(latest,Infinity))scheduleRecovery(latest);
  }).catch(()=>{});
  return work;
}
async function recoverPageOnce(tabId:number,runId:string,handled:{attempt?:number}){
  const run=await getRun(tabId);if(run?.runId!==runId)return;
  handled.attempt=run.recovery?.attempt;
  if(!automaticRecoveryAllowed(run)){
    // A timer/alarm may wake just before retryAt. Returning without rearming
    // loses that wakeup and can strand the final allowed recovery indefinitely.
    // Keep the original deadline/attempt; never bypass Stop or submit gates.
    if(!interruptedRuns.has(runId)&&automaticRecoveryAllowed(run,Infinity))scheduleRecovery(run);
    return;
  }
  cancelRecovery(runId);
  try{
    if(run.managed){if(!native.isConnected())return;await native.request('RECOVER',run,{attempt:run.recovery!.attempt});}
    else await prepareResume(run,false,true);
  }catch(error){
    await writeState(async()=>{
      const current=await getRun(tabId);
      if(current?.runId!==runId||!automaticRecoveryAllowed(current))return;
      current.recovery!.automatic=false;current.activity={phase:'waiting_user',message:'Chưa xác nhận được quyền phục hồi. Bấm Tiếp tục để đối chiếu lại.',at:now()};
      current.blockingIssue={reason:current.recovery!.reason,message:`Chưa tự tiếp tục được: ${(error as Error).message}`};await writeRunNow(current);
    });
  }
}
if(chrome.alarms?.onAlarm)chrome.alarms.onAlarm.addListener(alarm=>{
  if(alarm.name.startsWith('hanu-navigation:')){const token=alarm.name.slice('hanu-navigation:'.length);void chrome.storage.local.get(`navigation:${token}`).then(async data=>{const watch=data[`navigation:${token}`] as NavigationWatch|undefined;if(!watch)return;if(!navigationWatches.has(watch.tabId))navigationWatches.set(watch.tabId,watch);await checkNavigationWatch(watch);}).catch(()=>{});return;}
  if(!alarm.name.startsWith('hanu-recovery:'))return;
  void getManaged().then(run=>{if(run?.runId===alarm.name.slice('hanu-recovery:'.length))return recoverPage(run.tabId,run.runId);}).catch(()=>{});
});

class PageProblem extends Error {
  constructor(public health:PageHealth){super(health.issue?.message??'Không đọc được trạng thái Google Forms.');}
}

async function blockPageProblem(runId:string,health:PageHealth,tabId?:number,expectedEpoch?:string):Promise<RunState|undefined>{
  const result=await writeState(async()=>{
    const current=tabId===undefined?await getManaged():await getRun(tabId);if(!current||current.runId!==runId||!(['running','submitting','submit_uncertain'].includes(current.status)||pageReadyResumeAllowed(current))||interruptedRuns.has(runId)&&!current.submitAttempted)return;
    if(expectedEpoch!==undefined&&current.contentEpoch!==expectedEpoch)return;
    if(current.submitAttempted){current.status='submit_uncertain';current.blockingIssue={reason:health.issue&&['captcha','account','form_closed'].includes(health.issue.reason)?health.issue.reason:'submit_uncertain',message:`${health.issue?.message??'Google chưa xác nhận sau khi khóa gửi.'} Lượt này chưa thể kết luận chưa gửi. Giữ nguyên trang để kiểm tra; nếu lượt cho phép thử lại, extension tự tiếp tục khi đúng form sẵn sàng trở lại.`};current.activity={phase:'waiting_user',message:current.blockingIssue.message,at:now()};if(current.recovery)current.recovery.automatic=false;}
    else if(health.retryable&&health.issue&&['network','server_error','navigation'].includes(health.issue.reason)){
      const next=transientState(current,health.issue.reason as 'network'|'server_error'|'navigation',health.issue.message);await writeRunNow(next);return next;
    }else{
      current.status='waiting_manual';current.recoveryRequired=false;current.blockingIssue=health.issue??{reason:'account',message:'Không xác minh được trang hoặc tài khoản. Kiểm tra rồi bấm Tiếp tục.'};
      current.activity={phase:'waiting_user',message:current.blockingIssue.message,at:now()};if(current.recovery)current.recovery.automatic=false;
    }
    await writeRunNow(current);return current;
  });
  if(result){scheduleRecovery(result);await haltDocument(result.tabId,true);}
  return result;
}

async function prepareResume(run:RunState,automatic=false,recovering=false):Promise<RunState|undefined>{
  const epoch=interruptEpoch;
  const valid=async()=>{const current=run.managed?await getManaged():await getRun(run.tabId);if(epoch!==interruptEpoch||current?.runId!==run.runId||interruptedRuns.has(run.runId!))throw new Error('Lượt đã dừng hoặc thay đổi; hủy phục hồi.');return current;};
  if(run.submitAttempted)throw new Error('Lượt đã khóa gửi; không tải lại hoặc gửi lại.');
  if(recovering&&!automaticRecoveryAllowed(run))throw new Error('Lượt không còn chờ tự phục hồi.');
  if(automatic)return resumeRun(run.tabId,true);
  // A user/server-authorized Resume establishes a new intent. Every later
  // asynchronous step checks this generation before touching the form.
  interruptedRuns.delete(run.runId!);cancelRecovery(run.runId);
  const preparing={...run,status:'running' as const,recoveryRequired:true,activity:{phase:'checking_account' as const,message:'Đang đối chiếu trang và tài khoản trước khi tiếp tục.',at:now()}};
  await saveRun(preparing);
  try{
    let tab=await chrome.tabs.get(run.tabId);await valid();
    if(tab.status==='loading'){
      // Only a due bounded recovery may abandon an unresolved non-submit
      // navigation. Open the original GET URL, never reload its POST document.
      if(recovering&&run.url&&allowedFormUrl(run.url))await chrome.tabs.update(run.tabId,{url:run.url});
      await waitForForm(run.tabId,run.runId);await valid();tab=await chrome.tabs.get(run.tabId);
    }
    const actual=canonicalFormId(tab.url??'');
    if(actual&&actual!==run.formId||!actual&&!/^(?:chrome-error:|about:blank)/.test(tab.url??''))throw new PageProblem({issue:{reason:'account',message:'Tab đã chuyển sang trang khác. Mở đúng form rồi Tiếp tục hoặc Chạy lại.'}});
    const health=actual?await sendToForm<PageHealth>(run.tabId,{type:'PAGE_HEALTH'}).catch(()=>({issue:{reason:'network' as const,message:'Không đọc được trang Google Forms.'},retryable:true})):({issue:{reason:'network' as const,message:'Trang tải lỗi.'},retryable:true});
    await valid();
    if(health.issue&&!health.retryable)throw new PageProblem(health);
    if(health.retryable){
      if(!run.url||!allowedFormUrl(run.url))throw new Error('Không có link form an toàn để mở lại.');
      await chrome.tabs.update(run.tabId,{url:run.url});await waitForForm(run.tabId,run.runId);await valid();
      const again=await sendToForm<PageHealth>(run.tabId,{type:'PAGE_HEALTH'});if(again.issue)throw new PageProblem(again);
    }
    // resumeRun performs the account check on this current document immediately
    // before dispatch. Repeating it here adds another browser/server round trip.
    await valid();
    const current=run.managed?await getManaged():await getRun(run.tabId);if(!current)return;
    current.recoveryRequired=false;current.activity=undefined;if(current.recovery)current.recovery.automatic=false;
    await saveRun(current);await valid();return resumeRun(run.tabId);
  }catch(error){
    if(epoch!==interruptEpoch||interruptedRuns.has(run.runId!))throw error;
    return blockPageProblem(run.runId!,error instanceof PageProblem?error.health:{issue:{reason:'navigation',message:(error as Error).message},retryable:/Không tải|Không đọc|Receiving end|Could not establish|network/i.test((error as Error).message)},run.tabId);
  }
}

async function sendToForm<T>(tabId: number, command: ExtensionMessage): Promise<T> {
  const readOnly=['PAGE_HEALTH','PAGE_ACCOUNT','PAGE_RUN_STATUS','SCAN_FORM'].includes(command.type);
  for(let attempt=0;attempt<(readOnly?4:1);attempt++){
    try{
      let reply:T;
      try{const work=chrome.tabs.sendMessage(tabId,command);reply=await(readOnly?observePage(work):work) as T;if(readOnly&&reply===undefined)throw new Error('Không đọc được phản hồi từ trang đang chuyển.');}
      catch{
        // A tab opened before an extension reload has no static script. Inject
        // once; document claims still fence any predecessor racing navigation.
        if(attempt===0){const work=chrome.scripting.executeScript({target:{tabId},files:['content.js']});await(readOnly?observePage(work):work);}
        const work=chrome.tabs.sendMessage(tabId,command);reply=await(readOnly?observePage(work):work) as T;
      }
      if(readOnly&&reply===undefined)throw new Error('Không đọc được phản hồi từ trang đang chuyển.');
      return reply;
    }catch(error){
      // Only repeat observations. A missing side-effect acknowledgement must
      // never reissue Next, upload or a control command.
      if(!readOnly||attempt===3)throw error;
      await new Promise(resolve=>setTimeout(resolve,75));
    }
  }
  throw new Error('Không đọc được trang form.');
}

async function inputAllowed(tabId:number,scope:{runId?:string;epoch?:string},epoch:number){
 const run=await getRun(tabId);
 return epoch===interruptEpoch&&!!run&&run.status==='running'&&!run.submitAttempted&&!run.recoveryRequired&&(!run.runId||scope.runId===run.runId&&scope.epoch===run.contentEpoch)&&(!run.managed||native.isConnected()&&!interruptedRuns.has(run.runId!));
}
async function dispatchTrustedClick(tabId: number, x: number, y: number,valid:()=>Promise<boolean>): Promise<boolean> {
  if(renderGuards.get(tabId)?.cancelled||!await valid())return false;
  const target = { tabId };
  let attached = false;
  try {
    if(!renderGuards.has(tabId)){await chrome.debugger.attach(target, "1.3");attached=true;}
    // Google Forms' Material controls can ignore synthetic DOM clicks. CDP
    // creates a browser-trusted pointer sequence at the exact CSS position.
    if(!await valid())return false;
    await chrome.debugger.sendCommand(target, "Input.dispatchMouseEvent", { type: "mouseMoved", x, y, button: "none", buttons: 0, pointerType: "mouse" });
    await chrome.debugger.sendCommand(target, "Input.dispatchMouseEvent", { type: "mousePressed", x, y, button: "left", buttons: 1, clickCount: 1, pointerType: "mouse" });
    await new Promise((resolve) => setTimeout(resolve, 18));
    const releasing=await valid();
    await chrome.debugger.sendCommand(target, "Input.dispatchMouseEvent", { type: "mouseReleased", x:releasing?x:-1, y:releasing?y:-1, button: "left", buttons: 0, clickCount: 1, pointerType: "mouse" });
    return true;
  } catch {
    // Some managed Chromium builds block debugger. The content script retains
    // its DOM-event fallback in that case.
    return false;
  } finally {
    if (attached) await chrome.debugger.detach(target).catch(() => undefined);
  }
}

async function dispatchTrustedKeys(tabId: number, keys: string[],valid:()=>Promise<boolean>): Promise<boolean> {
  if(renderGuards.get(tabId)?.cancelled||!await valid())return false;
  const target = { tabId };
  let attached = false;
  try {
    if(!renderGuards.has(tabId)){await chrome.debugger.attach(target, "1.3");attached=true;}
    for (const key of keys) {
      if(!await valid())return false;
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
  await sendToForm(tabId, { type: "RUN_CURRENT_PAGE", mode, skipQuestionId, runId:run?.runId, finalQuestion:run.finalQuestion,corrections:run.corrections });
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
  const interruption = interruptEpoch;
  const assertActive = async () => {
    const current = await getRun(tabId);
    if (interruption !== interruptEpoch || current?.status !== "running" || current.recoveryRequired || current.submitAttempted || current.runId && interruptedRuns.has(current.runId) || current.formId !== currentForm || current.runId!==activeRun?.runId || current.contentEpoch!==activeRun?.contentEpoch || current.runId&&message.runId!==current.runId || current.contentEpoch&&message.epoch!==current.contentEpoch) throw new Error("Phiên đã dừng hoặc không còn ở form ban đầu.");
  };
  return storedPickerUploads.upload({
    tabId, runId: activeRun?.runId, epoch: activeRun?.contentEpoch,
    key: JSON.stringify([activeRun?.runId, activeRun?.contentEpoch, activeRun?.profileRevision,
      reference, message.pickerUrl, message.requestId]),
    pickerUrl: message.pickerUrl, requestId: message.requestId, name: reference.name, type: reference.type,
    checkOnly: message.checkOnly, assertActive,
    prepare: async () => {
      const started = performance.now();
      const blob = await getAttachment(reference.id);
      const readMs = performance.now() - started;
      await assertActive();
      if (!blob || blob.size !== reference.size) throw new Error("Không đọc được đúng tệp đã lưu. Hãy chọn lại ảnh trong extension.");
      const encoding = performance.now();
      const dataUrl = await blobToDataUrl(blob);
      const encodeMs = performance.now() - encoding;
      await assertActive();
      return { dataUrl, readMs, encodeMs };
    }
  });
}

async function startRun(tabId: number, mode: RunMode): Promise<RunState> {
  if(cloudOrigin()){
    const tab=await chrome.tabs.get(tabId);
    if(!allowedFormUrl(tab.url??''))throw new Error('Hãy mở một trang Google Forms trước khi chạy.');
    const reply=await native.request('START',undefined,{url:tab.url,mode,operationId:crypto.randomUUID()});
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
    url:tab.url,
    mode,
    autoContinue:true,retryOnReturn:true,
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

async function haltRun(tabId:number,status:'idle'|'paused'):Promise<RunState|undefined>{
  interruptEpoch++;
  storedPickerUploads.cancel(tabId);
  const run=await writeState(async()=>{
    const current=await getRun(tabId);if(!current||current.status==='completed')return current;
    if(current.runId)interruptedRuns.add(current.runId);
    cancelRecovery(current.runId);
    const next=addLog({...current,autoContinue:false,activity:undefined,recovery:current.recovery?{...current.recovery,automatic:false}:undefined,status:current.submitAttempted?'submit_uncertain':status,recoveryRequired:false,blockingIssue:current.submitAttempted?current.blockingIssue:undefined},'info',status==='idle'?'Đã dừng. Giữ dữ liệu và khóa gửi của lượt.':'Đã tạm dừng theo yêu cầu.');
    await writeRunNow(next);return next;
  });
  await haltDocument(tabId);
  await releasePageAttention(tabId);return run;
}
async function pauseRun(tabId:number){return haltRun(tabId,'paused');}
async function stopRun(tabId:number){return haltRun(tabId,'idle');}

async function resumeRun(tabId: number,automatic=false): Promise<RunState | undefined> {
  const epoch=interruptEpoch;
  const current = await getRun(tabId);
  if(cloudOrigin()&&(!current?.managed||!native.isConnected()))throw new Error('Tiếp tục lượt từ website bằng tài khoản đã được duyệt.');
  if (!current) return undefined;
  if (current.submitAttempted) throw new Error("Lượt đã khóa gửi; hãy xác minh kết quả, không chạy lại.");
  if(!current.runId){current.runId=crypto.randomUUID();current.profileSnapshot=await getProfile();current.profileRevision=await getProfileRevision();await saveRun(current);}
  if(current.managed&&!native.isConnected())throw new Error('App chưa kết nối.');
  if(current.managed)await checkAccount(tabId,current.expectedEmail!);
  await acquireLease(current.runId!,tabId);
  const run=await writeState(async()=>{
    const latest=await getRun(tabId);
    if(epoch!==interruptEpoch||latest?.runId!==current.runId)throw new Error('Có lệnh Dừng mới; không tiếp tục lượt cũ.');
    if(!automatic&&latest?.runId)interruptedRuns.delete(latest.runId);
    if(!latest||automatic&&(latest.runId!==current.runId||latest.contentEpoch!==current.contentEpoch||latest.status!=='waiting_manual'||latest.submitAttempted||latest.recoveryRequired||interruptedRuns.has(current.runId!)))throw new Error('Lượt đã dừng hoặc thay đổi; không tự tiếp tục.');
    const next=addLog({...latest,status:'running',autoContinue:true,retryOnReturn:true,blockingIssue:undefined,recovery:undefined,updatedAt:now()},'info',automatic?'Trang đã sẵn sàng; đang tự tiếp tục từ dữ liệu hiện có.':'Đang quét lại trang hiện tại; các giá trị khác hồ sơ sẽ được cập nhật rồi tự đi tiếp.');
    await writeRunNow(next);return next;
  });
  // A reload may have erased the upload that used to block this run. Resume
  // re-reads the current card; an old blockingQuestion is never proof of a file.
  await runOnTab(tabId, run.mode);
  return run;
}

async function authorizeLocalReturnedRetry(run:RunState,retries=(run.submissionRetries??0)+1,manual=false){
  return writeState(async()=>{
    const latest=await getRun(run.tabId);
    if(latest&&latest.runId===run.runId&&latest.contentEpoch===run.contentEpoch&&!latest.submitAttempted&&latest.submissionRetries===retries)return latest;
    if(!returnedSubmissionAllowed(manual&&latest?{...latest,autoContinue:true}:latest)||latest!.runId!==run.runId||latest!.contentEpoch!==run.contentEpoch||!manual&&interruptedRuns.has(run.runId!)||retries!==(latest!.submissionRetries??0)+1)throw new Error('Lượt/trang đã thay đổi; hủy thử gửi lại.');
    const locks=(await chrome.storage.local.get('submissionLocks')).submissionLocks??{};
    if(locks[run.runId!])locks[run.runId!].retryReady=true;
    await chrome.storage.local.set({submissionLocks:locks});
    if(manual)interruptedRuns.delete(run.runId!);
    const next=addLog({...latest!,autoContinue:true,submitAttempted:false,status:'waiting_manual',submissionRetries:retries,blockingIssue:{reason:'navigation',message:'Form đã trở lại. Đang tiếp tục theo chế độ cho phép gửi trùng.'}},'warning','Cho phép thử lại trên form đã khôi phục; kết quả lần gửi trước vẫn chưa rõ và có thể tạo phản hồi trùng.');
    await writeRunNow(next,true);return next;
  });
}

async function autoResumePage(message:Extract<ExtensionMessage,{type:'AUTO_RESUME'}>,sender:chrome.runtime.MessageSender){
  const tabId=sender.tab?.id;
  if(tabId===undefined||(sender.frameId??0)!==0||!isFormsUrl(sender.url??sender.tab?.url))throw new Error('Trang không hợp lệ.');
  const run=await getRun(tabId);
  if(!run?.runId||message.runId!==run.runId||message.epoch!==run.contentEpoch||run.formId!==canonicalFormId(sender.url??sender.tab?.url??'')||run.recoveryRequired||interruptedRuns.has(run.runId)||!(message.source==='page_ready'?(pageReadyResumeAllowed(run)||returnedSubmissionAllowed(run)):!run.submitAttempted&&run.status==='waiting_manual'&&['validation','unknown_required','file_upload','unsupported'].includes(run.blockingIssue?.reason??'')))throw new Error('Lượt đã dừng, thay đổi hoặc không chờ sửa dữ liệu.');
  if(message.source==='page_ready'){const health=await sendToForm<PageHealth>(tabId,{type:'PAGE_HEALTH'});if(health.issue||!health.ready)throw new Error('Form chưa sẵn sàng.');}
  if(run.managed){
    if(!native.isConnected())throw new Error('App mất kết nối; không tự tiếp tục.');
    if(run.submitAttempted)await checkAccount(tabId,run.expectedEmail!);
    if(message.source)await native.request('AUTO_RESUME',run,{source:run.submitAttempted?'returned_submit':message.source,epoch:run.contentEpoch,retries:run.submissionRetries??0});else await native.request('AUTO_RESUME',run);
  }else {if(run.submitAttempted)await authorizeLocalReturnedRetry(run);await resumeRun(tabId,true);}
  cancelRecovery(run.runId);
  return {ok:true,resumed:true};
}

async function processFormEvent(tabId: number, event: FormEvent, scope?:{runId?:string;epoch?:string}): Promise<void> {
  return writeState(async()=>{
  const current = await getRun(tabId);
  if (!current || current.status === "idle" || current.status === "paused") throw new Error('Lượt đã dừng hoặc tạm dừng; bỏ thao tác trang cũ.');
  if(current.runId&&(scope?.runId!==current.runId||scope?.epoch!==current.contentEpoch))throw new Error('Sự kiện thuộc lượt/trang cũ.');
  if(current.managed&&!native.isConnected()&&event.type!=='completed')throw new Error('App mất kết nối; dừng để đối chiếu.');
  if(current.status==='completed'&&event.type!=='completed')return;
  if(current.managed&&interruptedRuns.has(current.runId!)&&event.type!=='completed')return;
  if(current.status==='waiting_manual'&&!['corrections','completed','block'].includes(event.type))return;
  if(current.submitAttempted&&!['completed','block','transient_error','submit_attempt'].includes(event.type))return;
  let run = current;
  if(event.type==='activity'){run={...run,activity:{phase:event.phase,message:event.message,at:now()}};}
  else if(event.type==='corrections'){if(!validCorrections(event.answers))throw new Error('Đáp án sửa tay không hợp lệ.');run={...run,corrections:{...run.corrections,...event.answers}};}
  else if(event.type==='transient_error'){if(run.submitAttempted){run=addLog({...run,status:'submit_uncertain',blockingIssue:{reason:'submit_uncertain',message:'Google lỗi sau khi đã khóa gửi. Giữ lịch sử để đối chiếu; tự tiếp tục khi đúng form được khôi phục nếu lượt cho phép.'}},'warning',event.message);}else run=transientState(run,event.reason,event.message);}
  else if (event.type === "progress") {
    run = addLog({ ...run, status: "running", blockingIssue: undefined }, "info", event.message);
    if (event.filled && !run.filled.includes(event.filled)) run.filled = [...run.filled, event.filled];
    if (event.skipped && !run.skipped.includes(event.skipped)) run.skipped = [...run.skipped, event.skipped];
  } else if (event.type === "block") {
    run = addLog({ ...run, status: run.submitAttempted?"submit_uncertain":"waiting_manual", blockingIssue: event.issue,activity:{phase:'waiting_user',message:event.issue.message,at:now()},recovery:run.recovery?{...run.recovery,automatic:false}:undefined }, "warning", event.issue.message);
  } else if (event.type === "ready_to_submit") {
    run = addLog({ ...run, status: "ready_to_submit",activity:undefined,recovery:undefined }, "success", "Đã điền xong. Chế độ Test dừng trước nút Gửi.");
  } else if (event.type === "submit_attempt") {
    if (run.submitAttempted) return;
    run = addLog({ ...run, status: "submitting", submitAttempted: true }, "info", "Đã bấm Gửi một lần; đang chờ xác nhận từ Google Forms.");
  } else if (event.type === "completed") {
    run = addLog({ ...run, status: "completed", blockingIssue: undefined,activity:undefined,recovery:undefined }, "success", event.message);
  } else if (event.type === "failed") {
    run = addLog({ ...run, status: "failed" }, "error", event.message);
  } else if (event.type === "page_advanced") {
    run = addLog({ ...run, pageFingerprint: event.fingerprint, status: "running" }, "info", "Đã chuyển sang trang tiếp theo.");
  }
  await writeRunNow(run);
  if(event.type==='activity'&&event.phase==='navigating')void armNavigationWatch(tabId);
  if(event.type==='page_advanced')cancelNavigationWatch(tabId);
  if(event.type==='transient_error')scheduleRecovery(run);
  });
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
  if(changeInfo.status==='loading')void armNavigationWatch(tabId).catch(()=>{});
  if(changeInfo.status==='complete')void inspectLoadedDocument(tabId).catch(()=>{});
});

const documentInspections=new Map<number,Promise<void>>();
async function inspectLoadedDocument(tabId:number):Promise<void>{
  if(documentInspections.has(tabId))return documentInspections.get(tabId)!;
  const work=(async()=>{
    const before=await getRun(tabId);if(!before||!(['running','submitting','submit_uncertain'].includes(before.status)||pageReadyResumeAllowed(before))||before.recoveryRequired)return;
    const tab=await chrome.tabs.get(tabId).catch(()=>undefined);if(!tab)return;
    const externalIssue=/^https:\/\/accounts\.google\.com\//i.test(tab.url??'')?{reason:'account' as const,message:'Google yêu cầu đăng nhập lại. Xử lý tài khoản rồi bấm Tiếp tục.'}:/^https:\/\/(?:www\.)?google\.com\/sorry/i.test(tab.url??'')?{reason:'captcha' as const,message:'Google chặn lưu lượng và yêu cầu xác thực. Giữ nguyên tab để kiểm tra.'}:undefined;
    if(externalIssue){await blockPageProblem(before.runId!,{issue:externalIssue},tabId);return;}
    if(canonicalFormId(tab.url??'')!==before.formId&&!/^(?:chrome-error:|about:blank)/.test(tab.url??''))return;
    let health:PageHealth;
    try{health=await sendToForm<PageHealth>(tabId,{type:'PAGE_HEALTH'});}
    catch{health={issue:{reason:'network',message:'Trang Google không tải được hoặc extension chưa đọc được trang.'},retryable:true};}
    if(!health?.issue)return;
    const latest=await getRun(tabId);if(!latest||latest.runId!==before.runId||!(['running','submitting','submit_uncertain'].includes(latest.status)||pageReadyResumeAllowed(latest))||latest.recoveryRequired||latest.contentEpoch!==before.contentEpoch)return;
    await blockPageProblem(before.runId!,health,tabId,before.contentEpoch);
  })();documentInspections.set(tabId,work);try{await work;}finally{if(documentInspections.get(tabId)===work)documentInspections.delete(tabId);}
}

chrome.tabs.onRemoved.addListener((tabId) => {
  storedPickerUploads.cancel(tabId);
  cancelNavigationWatch(tabId);
  void releasePageAttention(tabId);
  void writeState(async()=>{const run=await getRun(tabId);if(run&&!endedExecution(run)){cancelRecovery(run.runId);if(run.runId)interruptedRuns.add(run.runId);run.autoContinue=false;run.status=run.submitAttempted?'submit_uncertain':'idle';run.activity=undefined;if(run.recovery)run.recovery.automatic=false;run.recoveryRequired=false;run.blockingIssue=run.submitAttempted?run.blockingIssue:undefined;run.logs.push({at:now(),level:'warning',message:'Tab đăng ký đã đóng. Đã dừng lượt và giải phóng profile.'});await writeRunNow(run);}});
});

let messageQueue=Promise.resolve();
chrome.runtime.onMessage.addListener((message: ExtensionMessage, sender, sendResponse) => {
  if(['FACEBOOK_ENABLE','FACEBOOK_WATCH_CONFIG','FACEBOOK_WATCH_REPORT'].includes(message.type)){
    void (async()=>{
      if(message.type==='FACEBOOK_ENABLE'){if(sender.tab)throw new Error('Cấp quyền tại panel extension.');await enableFacebookWatch();return {ok:true};}
      if(message.type==='FACEBOOK_WATCH_CONFIG')return facebookWatcher.configuration(sender)??{active:false};
      return facebookWatcher.observation(sender,message);
    })().then(sendResponse).catch(e=>sendResponse({ok:false,error:(e as Error).message}));return true;
  }
  // Panel controls can wait for a coordinator command which itself needs page
  // messages (CLAIM_DOCUMENT, FORM_EVENT, GET_RUN_FOR_TAB). Keep that queue free.
  if(['START_RUN','RESTART_RUN','PAUSE_RUN','RESUME_RUN','STOP_RUN'].includes(message.type)){
    void (async()=>{
      if(sender.tab&&isFormsUrl(sender.url??sender.tab.url))throw new Error('Trang form không được phép điều khiển profile.');
      if(message.type==='START_RUN')return startRun(message.tabId,message.mode);
      if(message.type==='RESTART_RUN'){const run=await getRun(message.tabId);if(!run?.runId||message.runId&&message.runId!==run.runId)throw new Error('Lượt đã thay đổi; đọc lại trạng thái.');if(run.submitAttempted)throw new Error('Lượt đã khóa gửi; xác minh trước khi chạy lại.');if(run.managed)return (await native.request('RESTART',run,{operationId:message.operationId??crypto.randomUUID()})).run;await stopRun(message.tabId);return startRun(message.tabId,run.mode);}
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
      if(sender.tab&&isFormsUrl(sender.url??sender.tab.url)&&!['CLAIM_DOCUMENT','REQUEST_SUBMIT','GET_RUN_FOR_TAB','GET_PROFILE','GET_ATTACHMENT','UPLOAD_STORED_FILE','REQUEST_UPLOAD_REPAIR','TRUSTED_CLICK','TRUSTED_KEYS','FORM_EVENT'].includes(message.type))throw new Error('Trang form không được phép thay đổi cấu hình extension.');
      if(message.type==='NATIVE_STATUS')return sendResponse(await native.status());
      if(message.type==='NATIVE_PAIR')return sendResponse(await native.pair(message.code));
      if(message.type==='NATIVE_UNLINK')return sendResponse(await native.unlink());
      if(message.type==='NATIVE_OPEN_MANAGER'){const url=cloudOrigin()||(await native.request('OPEN_MANAGER')).url;await chrome.tabs.create({url,active:true});return sendResponse({ok:true});}
      if(message.type==='CLAIM_DOCUMENT'){
        if(sender.tab?.id===undefined||sender.documentLifecycle&&sender.documentLifecycle!=='active'||!isFormsUrl(sender.url??sender.tab.url)||(sender.frameId??0)!==0)throw new Error('Trang không hợp lệ.');
        formReadiness.get(sender.tab.id)?.();
        const run=await getRun(sender.tab.id);
        if(run?.contentEpoch!==message.epoch){cancelNavigationWatch(sender.tab.id);storedPickerUploads.cancel(sender.tab.id);}
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
        return sendResponse({ ok: true, dispatched: await dispatchTrustedClick(sender.tab.id, message.x, message.y,(()=>{const epoch=interruptEpoch;return ()=>inputAllowed(sender.tab!.id!,message,epoch);})()) });
      }
      if (message.type === "TRUSTED_KEYS") {
        if (sender.tab?.id === undefined || !isFormsUrl(sender.tab.url)) throw new Error("Trusted keys chỉ được phép trên Google Forms.");
        return sendResponse({ ok: true, dispatched: await dispatchTrustedKeys(sender.tab.id, message.keys,(()=>{const epoch=interruptEpoch;return ()=>inputAllowed(sender.tab!.id!,message,epoch);})()) });
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
      if(message.type==='REQUEST_UPLOAD_REPAIR'){
        if(sender.tab?.id===undefined||(sender.frameId??0)!==0||!isFormsUrl(sender.url??sender.tab.url))throw new Error('Trang sửa ảnh không hợp lệ.');
        const tabId=sender.tab.id;
        const result=await writeState(async()=>{
          const run=await getRun(tabId);
          if(!run?.runId||run.runId!==message.runId||run.contentEpoch!==message.epoch||run.formId!==canonicalFormId(sender.url??sender.tab?.url??'')||run.status!=='running'||run.submitAttempted||run.recoveryRequired||interruptedRuns.has(run.runId))return {ok:true,repairGranted:false};
          const profile=run.profileSnapshot??await getProfile();
          if(!Object.values(profile.attachments).some(a=>a?.id===message.attachmentId)||(run.uploadRepairs?.[message.attachmentId]??0)>=1)return {ok:true,repairGranted:false};
          run.uploadRepairs={...run.uploadRepairs,[message.attachmentId]:1};
          run.activity={phase:'uploading',message:'Google từ chối ảnh không còn khả dụng; đang thay lại đúng ảnh một lần.',at:now()};
          cancelNavigationWatch(tabId);
          await writeRunNow(addLog(run,'warning','Google từ chối ảnh không còn khả dụng. Cấp một lần thay ảnh của đúng hồ sơ; chưa Gửi form.'));
          return {ok:true,repairGranted:true};
        });
        return sendResponse(result);
      }
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
async function hasLocalLock(formId:string,retryingRun?:string){const locks=(await chrome.storage.local.get('submissionLocks')).submissionLocks??{};return Object.entries(locks).some(([id,v]:[string,any])=>v.formId===formId&&v.resolution!=='not_received'&&!(id===retryingRun&&v.retryReady===true));}
async function checkAccount(tabId:number,expected:string){
  let result=await sendToForm<{email?:string;error?:string;health?:PageHealth}>(tabId,{type:'PAGE_ACCOUNT'});
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
  if(result.error)throw new PageProblem(result.health??{issue:{reason:'account',message:result.error}});
  if(!result.email||result.email.trim().toLowerCase()!==expected.trim().toLowerCase())throw new Error(result.email?'Tài khoản trên form không khớp nick đã gán.':'Không xác định được tài khoản trên form.');
}
const formReadiness=new Map<number,()=>void>();
async function waitForForm(tabId:number,runId?:string):Promise<string>{
  const deadline=Date.now()+NAVIGATION_LIMIT_MS;
  while(Date.now()<deadline){
    if(runId&&interruptedRuns.has(runId))throw new Error('Lượt đã dừng.');
    const tab=await chrome.tabs.get(tabId),id=canonicalFormId(tab.url??'');
    if(tab.status==='complete'&&tab.url?.startsWith('https://accounts.google.com/'))throw new PageProblem({issue:{reason:'account',message:'Cần đăng nhập Google.'}});
    if(tab.status==='complete'&&/https:\/\/(?:www\.)?google\.com\/sorry/.test(tab.url??''))throw new PageProblem({issue:{reason:'captcha',message:'Google yêu cầu xác thực. Hãy xử lý trong trình duyệt rồi Tiếp tục.'}});
    if(id){
      if(tab.status==='complete')return id;
      // DOM readiness, rather than every image/analytics request finishing,
      // permits account checks and filling. A stalled content reply is bounded.
      let timer:ReturnType<typeof setTimeout>|undefined;
      const health=await Promise.race([chrome.tabs.sendMessage(tabId,{type:'PAGE_HEALTH'}).catch(()=>undefined),new Promise<undefined>(r=>timer=setTimeout(()=>r(undefined),500))]).finally(()=>clearTimeout(timer)) as PageHealth|undefined;
      if(health?.ready||health?.issue)return id;
    }
    await new Promise<void>(resolve=>{const finish=()=>{clearTimeout(timer);if(formReadiness.get(tabId)===finish)formReadiness.delete(tabId);resolve();};const timer=setTimeout(finish,125);formReadiness.set(tabId,finish);});
  }
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
  if(interruptedRuns.has(command.runId))throw new Error('Lượt đã dừng trước khi mở form.');
  let run:RunState={runId:command.runId,sessionId,managed:true,autoContinue:true,retryOnReturn:true,profileSnapshot:profile,finalQuestion:command.payload.finalQuestion,profileRevision:Number(command.payload.revision),attachmentHashes,recoveryRequired:true,expectedEmail:String(command.payload.expectedEmail),url:String(command.payload.url),tabId:-1,formId:'',mode:command.payload.mode as 'test'|'live',status:'running',activity:{phase:'opening',message:'Đang mở form trong đúng profile.',at:now()},filled:[],skipped:[],logs:[],submitAttempted:false,updatedAt:now(),startedAt:now(),eventSeq:0};
  await saveRun(run);
  // Keep the registration tab selected in its own profile window. Background
  // tabs can throttle Forms initialization and the content script's timers.
  try{
    const window=chrome.windows?.getLastFocused?await chrome.windows.getLastFocused({windowTypes:['normal']}):undefined;
    if(window?.id!==undefined&&window.state==='minimized')await chrome.windows.update(window.id,{state:'normal',focused:false});
    const tab=await chrome.tabs.create({url:run.url,active:true,...(window?.id!==undefined?{windowId:window.id}:{})});run.tabId=tab.id!;
    if(interruptedRuns.has(run.runId!)){run.status='idle';run.recoveryRequired=false;await saveRun(run);return getManaged();}
    await saveRun(run);await prepareFormWindow(run.tabId);
  }catch(e){run=addLog({...run,status:'failed'},'error',`Không mở được tab form: ${(e as Error).message}`);await saveRun(run);throw e;}
  try{
    run.formId=await waitForForm(run.tabId,run.runId);
    if(interruptedRuns.has(run.runId!))return getManaged();
    await saveRun(run);
    const health=await sendToForm<PageHealth>(run.tabId,{type:'PAGE_HEALTH'});
    if(health.issue)throw new PageProblem(health);
  }catch(error){
    if(interruptedRuns.has(run.runId!))return getManaged();
    return blockPageProblem(run.runId!,error instanceof PageProblem?error.health:{issue:{reason:'network',message:(error as Error).message},retryable:true});
  }
  run=(await getManaged())!;
  if(interruptedRuns.has(run.runId!))return run;
  const currentTab=await chrome.tabs.get(run.tabId);run.formId=canonicalFormId(currentTab.url??'')!;
  await saveRun(run);
  try{
    if(await hasLocalLock(run.formId))throw new Error('Form có khóa gửi chưa giải quyết.');
    // Both are observations; join both before any form input. Neither check
    // needs the other's result, so they can share the same network interval.
    const checks=await Promise.allSettled([native.request('CHECK_FORM',run),checkAccount(run.tabId,run.expectedEmail!)]);
    for(const result of checks)if(result.status==='rejected')throw result.reason;
    if(interruptedRuns.has(run.runId!))return getManaged();
    run=(await getManaged())!;run.recoveryRequired=false;await saveRun(run);await runOnTab(run.tabId,run.mode);return run;
  }catch(e){return blockPageProblem(run.runId!,e instanceof PageProblem?e.health:{issue:{reason:'account',message:(e as Error).message}});}
}
async function parkManaged(){
  const run=await writeState(async()=>{
    const run=await getManaged();if(!run||endedExecution(run))return;
    interruptedRuns.add(run.runId!);
    cancelRecovery(run.runId);
    run.status=run.submitAttempted?'submit_uncertain':run.status==='waiting_manual'?'waiting_manual':'paused';
    run.activity=run.status==='waiting_manual'?{phase:'waiting_user',message:run.blockingIssue?.message??'Cần kiểm tra form trước khi tiếp tục.',at:now()}:{phase:'reconnecting',message:native.isConnected()?'Đã kết nối. Bấm Tiếp tục để đối chiếu trang trước khi chạy.':'Mất kết nối bộ điều phối. Đang nối lại; lượt được giữ để đối chiếu.',at:now()};
    run.recoveryRequired=true;await writeRunNow(run);return run;
  });
  if(run?.tabId!==undefined&&run.tabId>=0){await haltDocument(run.tabId);await releasePageAttention(run.tabId);}
}
async function reconcileManaged(){await parkManaged();const run=await getManaged();if(run){native.state(run);return {run,tab:await chrome.tabs.get(run.tabId).catch(()=>undefined)};}return {run:null};}
async function focusManaged(){
  const execution=await executionSnapshot();const run=execution?await getRun(execution.tabId):await getManaged();let tab=run?await chrome.tabs.get(run.tabId).catch(()=>undefined):undefined;
  if(tab&&run?.formId&&canonicalFormId(tab.url??'')!==run.formId)tab=undefined;
  if(!tab){const forms=await chrome.tabs.query({url:'https://docs.google.com/forms/*'});tab=forms.find(t=>run?canonicalFormId(t.url??'')===(run.formId||canonicalFormId(run.url??'')):canonicalFormId(t.url??''));}
  if(!tab)tab=await chrome.tabs.create({...(run?.url&&allowedFormUrl(run.url)?{url:run.url}:{}),active:true});
  await chrome.tabs.update(tab.id!,{active:true});const window=await chrome.windows.get(tab.windowId);
  if(window.state==='minimized')await chrome.windows.update(tab.windowId,{state:'normal'});
  await chrome.windows.update(tab.windowId,{focused:true});
  // After an extension update the old response document can still be open.
  // Reattach read-only inspection there; never reload a POST or click Submit.
  if(run?.submitAttempted&&run.status!=='completed'&&tab.id===run.tabId&&canonicalFormId(tab.url??'')===run.formId)await sendToForm(tab.id!,{type:'PAGE_HEALTH'}).catch(()=>{});
  return {tabId:tab.id};
}
async function stopProfile(expectedRunId?:string){
 const data=await chrome.storage.local.get(null),managed=await getManaged();
 if(expectedRunId&&managed?.runId&&managed.runId!==expectedRunId&&!endedExecution(managed))throw new Error('Lệnh Dừng thuộc lượt cũ; giữ nguyên lượt mới.');
 const runs=new Map<string,RunState>();for(const [key,value]of Object.entries(data)){const run=value as RunState;if(key.startsWith(RUN_PREFIX)&&run?.runId&&!endedExecution(run)){const old=runs.get(run.runId);if(!old||(old.eventSeq??0)<(run.eventSeq??0))runs.set(run.runId,run);}}
 if(managed?.runId&&managed.status!=='completed')runs.set(managed.runId,managed);
 for(const run of runs.values()){
   interruptedRuns.add(run.runId!);cancelRecovery(run.runId);
   if(await getRun(run.tabId))await stopRun(run.tabId);
   else {const next=addLog({...run,status:run.submitAttempted?'submit_uncertain':'idle',activity:undefined,recovery:undefined,recoveryRequired:false},'info','Đã dừng lượt không còn tab. Giữ khóa gửi để đối chiếu.');await saveRun(next);}
 }
 return {run:await getManaged(),execution:await executionSnapshot()};
}
async function managedControl(command:Command){
  if(command.kind==='STOP_PROFILE')return stopProfile(command.runId);
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
  let run=await getManaged();if(!run||run.runId!==command.runId)throw new Error('Lượt điều khiển không khớp.');
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
    if(command.payload.retryReturned){const retry=command.payload.retryReturned as {epoch:string;retries:number};if(run.contentEpoch!==retry.epoch)throw new Error('Trang thử lại đã thay đổi.');run=await authorizeLocalReturnedRetry(run,retry.retries,command.payload.automatic!==true);}
    if(command.payload.automatic&&(run.status!=='waiting_manual'||run.recoveryRequired||interruptedRuns.has(run.runId!)))throw new Error('Lượt đã dừng; không tự tiếp tục.');
    if(run.submitAttempted)throw new Error('Lượt đã khóa gửi.');
    const epoch=interruptEpoch;
    if(!command.payload.retryReturned)await native.request('CHECK_FORM',run);
    if(epoch!==interruptEpoch)throw new Error('Có lệnh Dừng mới; không tiếp tục.');
    return prepareResume(run,command.payload.automatic===true,command.payload.recovery===true);
  }
  throw new Error('Lệnh không hỗ trợ.');
}
async function grantSubmit(message:Extract<ExtensionMessage,{type:'REQUEST_SUBMIT'}>,sender:chrome.runtime.MessageSender){
  if(sender.tab?.id===undefined||(sender.frameId??0)!==0)throw new Error('Trang gửi không hợp lệ.');
  const tabId=sender.tab.id,epoch=interruptEpoch,initial=await getRun(tabId);
  const valid=(run:RunState|undefined)=>run&&run.mode==='live'&&run.status==='running'&&!run.submitAttempted&&run.runId===message.runId&&run.contentEpoch===message.epoch&&canonicalFormId(sender.url??sender.tab?.url??'')===run.formId&&epoch===interruptEpoch&&!interruptedRuns.has(run.runId!);
  if(!valid(initial))throw new Error('Không được cấp quyền gửi lần nữa hoặc lượt đã dừng.');
  if(cloudOrigin()&&(!initial!.managed||!native.isConnected()))throw new Error('Website chưa cấp quyền gửi cho lượt này.');
  if(initial!.managed){if(!native.isConnected())throw new Error('App đang mất kết nối.');await checkAccount(tabId,initial!.expectedEmail!);}
  const run=await writeState(async()=>{
    const latest=await getRun(tabId);if(!valid(latest))throw new Error('Lượt/trang đã dừng hoặc thay đổi trước khi cấp quyền gửi.');
    if(await hasLocalLock(latest!.formId,latest!.runId))throw new Error('Form có khóa gửi.');
    if(epoch!==interruptEpoch)throw new Error('Có lệnh Dừng mới; không cấp quyền gửi.');
    const locks=(await chrome.storage.local.get('submissionLocks')).submissionLocks??{};
    locks[latest!.runId!]={formId:latest!.formId,resolution:'uncertain',createdAt:now()};
    await chrome.storage.local.set({submissionLocks:locks});latest!.submitAttempted=true;latest!.submissionEpoch=latest!.contentEpoch;latest!.status='submitting';latest!.activity=undefined;latest!.recovery=undefined;cancelRecovery(latest!.runId);await writeRunNow(latest!);return latest!;
  });
  try{if(run.managed)await native.request('SUBMIT',run);}
  catch(error){await writeState(async()=>{const current=await getRun(tabId);if(current&&current.runId===run.runId){current.status='submit_uncertain';current.blockingIssue={reason:'submit_uncertain',message:(error as Error).message};await writeRunNow(current);}});throw error;}
  const current=await getRun(tabId);
  if(epoch!==interruptEpoch||!current||current.runId!==run.runId||current.status!=='submitting'||interruptedRuns.has(run.runId!))throw new Error('Đã dừng sau khi giữ khóa gửi. Đối chiếu kết quả; không tự gửi lại.');
  return {ok:true,granted:true};
}

if(cloudOrigin()||typeof chrome.runtime.connectNative==='function'){native.boot();setInterval(()=>native.heartbeat(),cloudOrigin()?20000:5000);chrome.runtime.onStartup?.addListener(()=>void reconcileManaged());}
