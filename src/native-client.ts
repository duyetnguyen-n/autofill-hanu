import { CHUNK_BYTES, NATIVE_HOST, PROTOCOL_VERSION, bytesToBase64, sha256, validateProfile, type Command, type ExecutionView } from './protocol';
import { getProfile, getProfileRevision, getAttachment, saveAttachment, deleteAttachment, saveProfile } from './storage';
import type { RunState, AttachmentRef } from './shared';

interface Identity {sessionId:string;token?:string}
interface Adapter {
  start(command:Command,sessionId:string):Promise<unknown>;
  control(command:Command):Promise<unknown>;
  focus():Promise<unknown>;
  disconnected():Promise<void>;
  reconcile():Promise<unknown>;
  execution?():Promise<ExecutionView|null>;
}
export function createNativeClient(adapter:Adapter){
  let port:chrome.runtime.Port|undefined,identity:Identity,connected=false,error='',pairCode:string|undefined,stopped=false;
  let queue=Promise.resolve(),reconnectTimer:ReturnType<typeof setTimeout>|undefined;
  let executionQueue=Promise.resolve();
  let identityLoading:Promise<void>|undefined;
  let pairing:{resolve:()=>void;reject:(e:Error)=>void;timer:ReturnType<typeof setTimeout>}|undefined;
  const requests=new Map<string,{resolve:(v:any)=>void;reject:(e:Error)=>void;timer:ReturnType<typeof setTimeout>}>();
  const send=(m:Record<string,unknown>)=>{if(!port)throw new Error('Cầu nối chưa kết nối.');port.postMessage({...m,protocol:PROTOCOL_VERSION,sessionId:identity.sessionId});};
  function reportExecution(){if(!adapter.execution)return;executionQueue=executionQueue.then(async()=>{if(!connected)return;const execution=await adapter.execution!();if(connected)send({type:'EXECUTION',execution});}).catch(()=>undefined);}
  async function status(){await ensureIdentity();return {sessionId:identity.sessionId,extensionId:chrome.runtime.id,paired:!!identity.token,connected,error};}
  async function ensureIdentity(){if(identity)return;identityLoading??=(async()=>{const s=await chrome.storage.local.get('coordinatorIdentity');identity=s.coordinatorIdentity??{sessionId:crypto.randomUUID()};await chrome.storage.local.set({coordinatorIdentity:identity});})();await identityLoading;}
  function pairingError(message:string){error=message;if(pairing){clearTimeout(pairing.timer);pairing.reject(new Error(message));pairing=undefined;}pairCode=undefined;}
  function chromeError(message:string){if(/host.*not found|specified native messaging host/i.test(message))return 'Chrome chưa tìm thấy cầu nối. Trong app, nhập đúng ID extension rồi bấm Tạo mã liên kết.';if(/forbidden|access.*denied/i.test(message))return 'ID extension chưa được cấp quyền kết nối. Tạo lại mã trong app bằng ID đang hiển thị ở đây.';if(/exited/i.test(message))return 'Không mở được cầu nối. Hãy mở app quản lý rồi thử lại.';return message;}
  async function connect(){if(stopped||port||typeof chrome.runtime.connectNative!=='function')return;await ensureIdentity();if(port)return;try{const current=chrome.runtime.connectNative(NATIVE_HOST);port=current;current.onMessage.addListener(m=>{if(port===current)onMessage(m);});current.onDisconnect.addListener(()=>{if(port!==current)return;port=undefined;connected=false;pairingError(chromeError(chrome.runtime.lastError?.message??'Mất kết nối app.'));for(const p of requests.values()){clearTimeout(p.timer);p.reject(new Error(error));}requests.clear();void adapter.disconnected().catch(()=>undefined);clearTimeout(reconnectTimer);reconnectTimer=setTimeout(()=>void connect(),3000);});send(pairCode?{type:'PAIR',code:pairCode}:{type:'HELLO',token:identity.token});}catch(e){pairingError((e as Error).message);port=undefined;reconnectTimer=setTimeout(()=>void connect(),3000);}}
  function onMessage(m:any){
    if(m.type==='EMERGENCY_STOP'){connected=false;pairingError(m.error??'App không lưu được tiến độ. Đã dừng phiên.');void adapter.disconnected().catch(()=>undefined);return;}
    if(m.type==='PAIRED'){identity.token=m.token;pairCode=undefined;connected=true;error='';void chrome.storage.local.set({coordinatorIdentity:identity}).then(()=>{if(pairing){clearTimeout(pairing.timer);pairing.resolve();pairing=undefined;}return adapter.reconcile();}).catch(e=>pairingError((e as Error).message));return;}
    if(m.type==='WELCOME'){connected=true;error='';void adapter.reconcile().then(reportExecution);return;}
    if(m.type==='UNPAIRED'){connected=false;return;}
    if(m.type==='ERROR'){pairingError(m.error);return;}
    if(m.type==='REPLY'){const p=requests.get(m.requestId);if(p){clearTimeout(p.timer);requests.delete(m.requestId);m.ok?p.resolve(m):p.reject(new Error(m.error));}return;}
    if(m.type!=='COMMAND'||m.protocol!==PROTOCOL_VERSION||m.sessionId!==identity.sessionId||!connected)return;
    // Interrupt a running page immediately even if another command is awaiting a load.
    if(['PAUSE','STOP','STOP_PROFILE'].includes(m.kind))void adapter.disconnected();
    queue=queue.then(async()=>{try{const result=await execute(m);send({type:'RESULT',commandId:m.commandId,ok:true,result});}catch(e){send({type:'RESULT',commandId:m.commandId,ok:false,error:(e as Error).message});}reportExecution();}).catch(()=>undefined);
  }
  async function execute(c:Command){
    const readOnly=['PING','FOCUS','SCAN_FORM','READ_PROFILE','ATTACHMENT_INFO','ATTACHMENT_READ','RECONCILE'].includes(c.kind);
    let journal:Record<string,{done:boolean;result?:unknown}>=(await chrome.storage.local.get('nativeJournal')).nativeJournal??{};
    if(!readOnly&&journal[c.commandId]){if(journal[c.commandId].done)return journal[c.commandId].result;throw new Error('Lệnh đã được nhận trước đó; hãy đối chiếu trạng thái, không chạy lại.');}
    if(!readOnly){journal[c.commandId]={done:false};const keys=Object.keys(journal);for(const k of keys.slice(0,-1000))delete journal[k];await chrome.storage.local.set({nativeJournal:journal});}
    const p=c.payload;let result:unknown;
    if(c.kind==='PING')result={sessionId:identity.sessionId,at:new Date().toISOString(),build:'2026-10-13-shared-final-question',capabilities:['sharedFinalQuestion'],execution:await adapter.execution?.()};
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
    if(!readOnly){journal[c.commandId]={done:true,result};await chrome.storage.local.set({nativeJournal:journal});}return result;
  }
  async function request(kind:string,run?:RunState,payload:Record<string,unknown>={}):Promise<any>{if(!connected)throw new Error('App mất kết nối; không cấp quyền chạy/gửi.');const requestId=crypto.randomUUID();return new Promise((resolve,reject)=>{const timer=setTimeout(()=>{requests.delete(requestId);reject(new Error('App không xác nhận; giữ khóa gửi để đối chiếu.'));},kind==='ATTENTION_ACQUIRE'?180000:5000);requests.set(requestId,{resolve,reject,timer});send({type:'REQUEST',requestId,kind,runId:run?.runId,formId:run?.formId,...payload});});}
  return {
    status,request,isConnected:()=>connected,
    boot:()=>void connect(),
    async pair(code:string){await ensureIdentity();if(identity.token){await connect();return status();}if(pairing)throw new Error('Đang liên kết, vui lòng chờ phản hồi.');if(!/^[A-F0-9]{12}$/.test(code.trim().toUpperCase()))throw new Error('Mã liên kết phải gồm 12 ký tự. Sao chép mã mới từ app.');pairCode=code.trim().toUpperCase();error='';stopped=false;const old=port;port=undefined;old?.disconnect();clearTimeout(reconnectTimer);const confirmation=new Promise<void>((resolve,reject)=>{pairing={resolve,reject,timer:setTimeout(()=>pairingError('App chưa xác nhận sau 10 giây. Kiểm tra app đang mở và lấy mã mới.'),10000)};});await connect();await confirmation;return status();},
    async unlink(){await adapter.disconnected();stopped=true;port?.disconnect();identity={sessionId:crypto.randomUUID()};await chrome.storage.local.set({coordinatorIdentity:identity});return status();},
    state(run:RunState){if(connected&&run.managed)send({type:'STATE',run});if(connected)reportExecution();},
    profileChanged(){if(connected)send({type:'PROFILE_CHANGED'});},
    failure(run:RunState){if(connected)send({type:'LOAD_FAILURE',runId:run.runId});},
    heartbeat(){if(connected){send({type:'HEARTBEAT'});reportExecution();}}
    ,dispose(){stopped=true;connected=false;clearTimeout(reconnectTimer);if(pairing){clearTimeout(pairing.timer);pairing.reject(new Error('Đã đóng kết nối.'));pairing=undefined;}const old=port;port=undefined;old?.disconnect();for(const p of requests.values()){clearTimeout(p.timer);p.reject(new Error('Đã đóng kết nối.'));}requests.clear();}
  };
}
