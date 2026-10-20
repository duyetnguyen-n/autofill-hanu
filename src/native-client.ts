import { CHUNK_BYTES, NATIVE_HOST, PROTOCOL_VERSION, bytesToBase64, sha256, validateProfile, type Command, type ExecutionView } from './protocol';
import { getProfile, getProfileRevision, getAttachment, saveAttachment, deleteAttachment, saveProfile } from './storage';
import type { RunState, AttachmentRef } from './shared';
import { cloudOrigin, websocketConnector, type Connector, type CoordinatorPort } from './coordinator-transport';

interface Identity {sessionId:string;token?:string}
interface Adapter {
  start(command:Command,sessionId:string):Promise<unknown>;
  control(command:Command):Promise<unknown>;
  focus():Promise<unknown>;
  disconnected():Promise<void>;
  interrupt?(command:Command):Promise<void>;
  reconcile():Promise<unknown>;
  execution?():Promise<ExecutionView|null>;
  watchFacebook?(payload:Record<string,unknown>):Promise<unknown>;
}
export function createNativeClient(adapter:Adapter,options:{origin?:string;connector?:Connector}={}){
  const origin=options.origin??cloudOrigin(),cloud=!!origin;
  const identityKey=cloud?`cloudCoordinatorIdentity:${origin}`:'coordinatorIdentity';
  const journalKey=cloud?`cloudJournal:${origin}`:'nativeJournal';
  const connector:Connector=options.connector??(cloud?websocketConnector(origin):()=>chrome.runtime.connectNative(NATIVE_HOST));
  let port:CoordinatorPort|undefined,identity:Identity,connected=false,error='',pairCode:string|undefined,stopped=false;
  let queue=Promise.resolve(),reconnectTimer:ReturnType<typeof setTimeout>|undefined;
  let interrupts=Promise.resolve(),commandEpoch=0,lastStateRunId:string|undefined;
  let journalWrites=Promise.resolve();
  let executionQueue=Promise.resolve();
  let identityLoading:Promise<void>|undefined;
  let connecting=false,attempt=0,generation=0;
  const alarmName='hanu-cloud-reconnect';
  const clearAlarm=()=>{if(cloud&&typeof chrome.alarms?.clear==='function')void chrome.alarms.clear(alarmName);};
  if(cloud&&chrome.alarms?.onAlarm)chrome.alarms.onAlarm.addListener(alarm=>{if(alarm.name===alarmName&&!stopped)void connect();});
  let pairing:{resolve:()=>void;reject:(e:Error)=>void;timer:ReturnType<typeof setTimeout>}|undefined;
  const requests=new Map<string,{resolve:(v:any)=>void;reject:(e:Error)=>void;timer:ReturnType<typeof setTimeout>}>();
  const send=(m:Record<string,unknown>)=>{if(!port)throw new Error('Cầu nối chưa kết nối.');port.postMessage({...m,protocol:PROTOCOL_VERSION,sessionId:identity.sessionId});};
  function reportExecution(){if(!adapter.execution)return;executionQueue=executionQueue.then(async()=>{if(!connected)return;const sourceRunId=lastStateRunId;const execution=await adapter.execution!();if(connected&&sourceRunId===lastStateRunId)send({type:'EXECUTION',execution,sourceRunId});}).catch(()=>undefined);}
  async function status(){await ensureIdentity();return {sessionId:identity.sessionId,extensionId:chrome.runtime.id,paired:!!identity.token,connected,error,cloud,origin};}
  async function ensureIdentity(){if(identity)return;identityLoading??=(async()=>{const s=await chrome.storage.local.get(identityKey);identity=s[identityKey]??{sessionId:crypto.randomUUID()};await chrome.storage.local.set({[identityKey]:identity});})();await identityLoading;}
  function pairingError(message:string){error=message;if(pairing){clearTimeout(pairing.timer);pairing.reject(new Error(message));pairing=undefined;}pairCode=undefined;}
  function chromeError(message:string){if(/host.*not found|specified native messaging host/i.test(message))return 'Chrome chưa tìm thấy cầu nối. Trong app, nhập đúng ID extension rồi bấm Tạo mã liên kết.';if(/forbidden|access.*denied/i.test(message))return 'ID extension chưa được cấp quyền kết nối. Tạo lại mã trong app bằng ID đang hiển thị ở đây.';if(/exited/i.test(message))return 'Không mở được cầu nối. Hãy mở app quản lý rồi thử lại.';return message;}
  function retry(){clearTimeout(reconnectTimer);if(stopped)return;const wait=cloud?[1000,2000,5000,10000,30000][Math.min(attempt++,4)]+Math.floor(Math.random()*500):3000;reconnectTimer=setTimeout(()=>void connect(),wait);if(cloud&&typeof chrome.alarms?.create==='function')void chrome.alarms.create(alarmName,{when:Date.now()+60000});}
  async function connect(){
    if(stopped||port||connecting||!cloud&&!options.connector&&typeof chrome.runtime.connectNative!=='function')return;
    connecting=true;const version=generation;
    try{await ensureIdentity();const current=await connector();if(stopped||version!==generation){current.disconnect();return;}port=current;
      current.onMessage.addListener(m=>{if(port===current)onMessage(m,current);});
      current.onDisconnect.addListener(()=>{if(port!==current)return;port=undefined;connected=false;generation++;pairingError(cloud?(current.error??'Mất kết nối website quản lý.'):chromeError(chrome.runtime.lastError?.message??'Mất kết nối app.'));for(const p of requests.values()){clearTimeout(p.timer);p.reject(new Error(error));}requests.clear();void adapter.disconnected().catch(()=>undefined).finally(retry);});
      send({...pairCode?{type:'PAIR',code:pairCode}:{type:'HELLO',token:identity.token},...(cloud?{transport:'cloud',extensionId:chrome.runtime.id,accessPolicy:1}:{})});
    }catch(e){pairingError((e as Error).message);port=undefined;retry();}finally{connecting=false;}
  }
  function onMessage(m:any,current:CoordinatorPort){
    if(m.type==='EMERGENCY_STOP'){connected=false;pairingError(m.error??'App không lưu được tiến độ. Đã dừng phiên.');void adapter.disconnected().catch(()=>undefined);return;}
    if(m.type==='PAIRED'){identity.token=m.token;if(cloud&&typeof m.sessionId==='string')identity.sessionId=m.sessionId;pairCode=undefined;connected=true;attempt=0;clearAlarm();error='';void chrome.storage.local.set({[identityKey]:identity}).then(()=>{if(pairing){clearTimeout(pairing.timer);pairing.resolve();pairing=undefined;}return adapter.reconcile();}).catch(e=>pairingError((e as Error).message));return;}
    if(m.type==='WELCOME'){connected=true;attempt=0;clearAlarm();error='';void adapter.reconcile().then(reportExecution).catch(e=>pairingError((e as Error).message));return;}
    if(m.type==='REVOKED'||m.type==='UNPAIRED'&&cloud){connected=false;stopped=true;generation++;clearAlarm();pairingError('Profile chưa liên kết hoặc đã bị ngắt. Lấy mã mới trên website để liên kết lại.');identity={sessionId:crypto.randomUUID()};void chrome.storage.local.set({[identityKey]:identity});void adapter.disconnected();port=undefined;current.disconnect();return;}
    if(m.type==='UNPAIRED'){connected=false;return;}
    if(m.type==='ERROR'){
      pairingError(m.error);
      // A reloaded worker can reconnect before the server notices its old
      // socket has gone away. End a rejected cloud handshake so the normal
      // retry loop runs, retaining the existing profile ID and token.
      if(cloud&&!connected){current.error=m.error;current.disconnect();}
      return;
    }
    if(m.type==='REPLY'){const p=requests.get(m.requestId);if(p){clearTimeout(p.timer);requests.delete(m.requestId);m.ok?p.resolve(m):p.reject(new Error(m.error));}return;}
    if(m.type!=='COMMAND'||m.protocol!==PROTOCOL_VERSION||m.sessionId!==identity.sessionId||!connected)return;
    const priority=['PAUSE','STOP','STOP_PROFILE'].includes(m.kind);
    const version=generation,epoch=commandEpoch;
    // Cancellation never waits behind a loading tab or an attachment transfer.
    // Serialize the interrupt commands with each other, preserving their order.
    const prepared=priority?claimCommand(m).then(async replay=>{
      if(replay.done)return {replay};
      if(!connected||port!==current||version!==generation)throw new Error('Kết nối đã thay đổi.');
      await (adapter.interrupt?.(m)??adapter.disconnected());commandEpoch++;return {replay};
    }).catch(error=>({error})):undefined;
    const work=async()=>{
      if(!connected||port!==current||version!==generation)return;
      try{
        if(!priority&&m.kind!=='WATCH_FACEBOOK'&&epoch!==commandEpoch)throw new Error('Lệnh đã bị hủy bởi Dừng hoặc Tạm dừng.');
        const preparation=prepared?await prepared:undefined;
        if(preparation&&'error' in preparation)throw preparation.error;
        const result=preparation?.replay.done?preparation.replay.result:await execute(m,priority);
        if(connected&&port===current&&version===generation)send({type:'RESULT',commandId:m.commandId,ok:true,result});
      }catch(e){if(connected&&port===current&&version===generation)send({type:'RESULT',commandId:m.commandId,ok:false,error:(e as Error).message});}
      if(m.kind!=='WATCH_FACEBOOK')reportExecution();
    };
    if(m.kind==='WATCH_FACEBOOK')void work();else if(priority)interrupts=interrupts.then(work).catch(()=>undefined);else queue=queue.then(work).catch(()=>undefined);
  }
  function updateJournal<T>(operation:(journal:Record<string,{done:boolean;result?:unknown}>)=>T):Promise<T>{
    const work=journalWrites.then(async()=>{
      const journal=(await chrome.storage.local.get(journalKey))[journalKey]??{};
      const result=operation(journal),keys=Object.keys(journal);for(const key of keys.slice(0,-1000))delete journal[key];
      await chrome.storage.local.set({[journalKey]:journal});return result;
    });journalWrites=work.then(()=>undefined,()=>undefined);return work;
  }
  function claimCommand(c:Command){return updateJournal(journal=>{const old=journal[c.commandId];if(old){if(old.done)return {done:true,result:old.result};throw new Error('Lệnh đã được nhận trước đó; hãy đối chiếu trạng thái, không chạy lại.');}journal[c.commandId]={done:false};return {done:false,result:undefined as unknown};});}
  async function execute(c:Command,claimed=false){
    const readOnly=['WATCH_FACEBOOK','PING','FOCUS','SCAN_FORM','READ_PROFILE','ATTACHMENT_INFO','ATTACHMENT_READ','RECONCILE'].includes(c.kind);
    if(!readOnly&&!claimed){const replay=await claimCommand(c);if(replay.done)return replay.result;}
    const p=c.payload;let result:unknown;
    if(c.kind==='PING')result={sessionId:identity.sessionId,at:new Date().toISOString(),build:'2026-10-20-session-handoff-1.7.3',capabilities:['sharedFinalQuestion','reliableRuns',...(adapter.watchFacebook?['scheduledHskLinks','facebookWatchWindow','facebookPostReady']:[]),...(cloud?['cloudCoordinator','accountAccess','extensionControls']:[])],execution:await adapter.execution?.()};
    else if(c.kind==='WATCH_FACEBOOK'){if(!adapter.watchFacebook)throw new Error('Extension chưa hỗ trợ theo dõi Facebook.');result=await adapter.watchFacebook(p);}
    else if(c.kind==='FOCUS')result=await adapter.focus();
    else if(c.kind==='READ_PROFILE')result={profile:await getProfile(),revision:await getProfileRevision()};
    else if(c.kind==='ATTACHMENT_INFO'||c.kind==='ATTACHMENT_READ'){
      const profile=await getProfile();if(!Object.values(profile.attachments).some(a=>a?.id===p.id))throw new Error('Ảnh không thuộc hồ sơ của phiên.');const blob=await getAttachment(String(p.id));if(!blob)throw new Error('Không đọc được ảnh.');
      if(c.kind==='ATTACHMENT_INFO')result={size:blob.size,hash:await sha256(await blob.arrayBuffer())};
      else{const offset=Number(p.offset),length=Number(p.length);if(!Number.isSafeInteger(offset)||offset<0||length!==CHUNK_BYTES)throw new Error('Phần ảnh không hợp lệ.');result={base64:bytesToBase64(new Uint8Array(await blob.slice(offset,offset+length).arrayBuffer()))};}
    }else if(c.kind==='ATTACHMENT_BEGIN'){
      const a=p.attachment as AttachmentRef;validateProfile({values:{},customFields:[],mappings:{},attachments:{file:a}});if(typeof p.hash!=='string'||!/^[a-f0-9]{64}$/.test(p.hash))throw new Error('Mã băm ảnh không hợp lệ.');
      await chrome.storage.local.set({[`transfer:${p.transferId}`]:{attachment:a,hash:p.hash}});result={ok:true};
    }else if(c.kind==='ATTACHMENT_CHUNK'){
      const index=Number(p.index);if(!Number.isSafeInteger(index)||index<0||typeof p.base64!=='string'||p.base64.length>Math.ceil(CHUNK_BYTES*4/3)+4)throw new Error('Phần ảnh không hợp lệ.');
      const binary=atob(p.base64);await saveAttachment(`pending:${p.transferId}:${index}`,new Blob([Uint8Array.from(binary,x=>x.charCodeAt(0))]));result={ok:true};
    }else if(c.kind==='ATTACHMENT_FINISH'){
      const key=`transfer:${p.transferId}`,t=(await chrome.storage.local.get(key))[key];if(!t)throw new Error('Phiên chuyển ảnh không tồn tại.');const parts:Blob[]=[];const count=Math.ceil(t.attachment.size/CHUNK_BYTES);for(let index=0;index<count;index++){const part=await getAttachment(`pending:${p.transferId}:${index}`);if(!part)throw new Error('Ảnh thiếu phần dữ liệu.');parts.push(part);}const blob=new Blob(parts,{type:t.attachment.type});if(blob.size!==t.attachment.size||await sha256(await blob.arrayBuffer())!==t.hash)throw new Error('Ảnh không khớp mã băm.');
      await saveAttachment(t.attachment.id,blob);for(let i=0;i<count;i++)await deleteAttachment(`pending:${p.transferId}:${i}`);await chrome.storage.local.remove(key);result={ok:true};
    }else if(c.kind==='COMMIT_PROFILE'){
      validateProfile(p.profile);if(await getProfileRevision()!==p.baseRevision)throw new Error('Extension đã sửa hồ sơ; cần giải quyết xung đột.');for(const a of Object.values(p.profile.attachments))if(a){const blob=await getAttachment(a.id);if(!blob||blob.size!==a.size)throw new Error('Ảnh chưa được ghi hoàn tất.');}await saveProfile(p.profile);result={revision:await getProfileRevision()};
    }else if(c.kind==='START')result=await adapter.start(c,identity.sessionId);
    else if(c.kind==='RECONCILE')result=await adapter.reconcile();
    else result=await adapter.control(c);
    if(!readOnly)await updateJournal(journal=>{journal[c.commandId]={done:true,result};});return result;
  }
  async function request(kind:string,run?:RunState,payload:Record<string,unknown>={}):Promise<any>{
    if(!connected)throw new Error('App mất kết nối; không cấp quyền chạy/gửi.');
    const requestId=crypto.randomUUID();
    // Controls can include profile transfer or account/page checks. Match the
    // coordinator's command budget; short submit grants keep their own limit.
    const timeout=kind==='ATTENTION_ACQUIRE'?180000:['START','RESTART','RECOVER'].includes(kind)?120000:['CONTROL','AUTO_RESUME'].includes(kind)?60000:5000;
    return new Promise((resolve,reject)=>{
      const timer=setTimeout(()=>{
        requests.delete(requestId);
        reject(new Error(kind==='SUBMIT'?'App không xác nhận; giữ khóa gửi để đối chiếu.':`App chưa xác nhận ${kind}. Kiểm tra trạng thái trước khi thử lại.`));
      },timeout);
      requests.set(requestId,{resolve,reject,timer});
      try{send({type:'REQUEST',requestId,kind,runId:run?.runId,formId:run?.formId,...payload});}
      catch(e){clearTimeout(timer);requests.delete(requestId);reject(e);}
    });
  }

  return {
    status,request,isConnected:()=>connected,
    boot:()=>void connect(),
    async pair(code:string){await ensureIdentity();if(identity.token){await connect();return status();}if(pairing)throw new Error('Đang liên kết, vui lòng chờ phản hồi.');if(!/^[A-F0-9]{12}$/.test(code.trim().toUpperCase()))throw new Error('Mã liên kết phải gồm 12 ký tự. Sao chép mã mới từ app.');pairCode=code.trim().toUpperCase();error='';stopped=false;generation++;const old=port;port=undefined;old?.disconnect();clearTimeout(reconnectTimer);const confirmation=new Promise<void>((resolve,reject)=>{pairing={resolve,reject,timer:setTimeout(()=>pairingError('Chưa xác nhận sau 10 giây. Kiểm tra trang quản lý và lấy mã mới.'),10000)};});if(connecting){await new Promise<void>(resolve=>{const timer=setInterval(()=>{if(!connecting){clearInterval(timer);resolve();}},50);});}await connect();await confirmation;return status();},
    async unlink(){await adapter.disconnected();if(cloud&&connected)await request('UNLINK');stopped=true;connected=false;generation++;clearAlarm();const old=port;port=undefined;old?.disconnect();clearTimeout(reconnectTimer);identity={sessionId:crypto.randomUUID()};await chrome.storage.local.set({[identityKey]:identity});return status();},
    state(run:RunState){if(run.managed)lastStateRunId=run.runId;if(connected&&run.managed)send({type:'STATE',run});if(connected)reportExecution();},
    profileChanged(){if(connected)send({type:'PROFILE_CHANGED'});},
    failure(run:RunState){if(connected)send({type:'LOAD_FAILURE',runId:run.runId});},
    heartbeat(){if(connected){send({type:'HEARTBEAT'});reportExecution();}}
    ,dispose(){stopped=true;connected=false;generation++;clearAlarm();clearTimeout(reconnectTimer);if(pairing){clearTimeout(pairing.timer);pairing.reject(new Error('Đã đóng kết nối.'));pairing=undefined;}const old=port;port=undefined;old?.disconnect();for(const p of requests.values()){clearTimeout(p.timer);p.reject(new Error('Đã đóng kết nối.'));}requests.clear();}
  };
}
