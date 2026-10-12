import { randomUUID } from 'node:crypto';
import type { WebSocket } from 'ws';
import { Store } from './store';
import { CHUNK_BYTES, PROTOCOL_VERSION, allowedFormUrl, canonicalFormId, validateProfile, type Command, type CommandKind, type ProfileDocument, type SessionView } from '../../src/protocol';
import type { RunState, RunMode } from '../../src/shared';

export class Coordinator {
  peers=new Map<string,WebSocket>();
  pending=new Map<string,{session:string;resolve:(v:any)=>void;reject:(e:Error)=>void;timer:ReturnType<typeof setTimeout>}>();
  failures=new Map<string,Map<string,number>>();
  changed=()=>{};
  launchUrl='';
  constructor(public store:Store) {}
  connect(id:string,ws:WebSocket) { if(this.peers.has(id)) throw new Error('Mã phiên đã kết nối ở cửa sổ khác.'); this.peers.set(id,ws); const s=this.store.session(id); s.connected=true;s.lastSeen=new Date().toISOString();this.store.saveSession(s);this.changed(); }
  disconnect(id:string,ws:WebSocket) { if(this.peers.get(id)!==ws)return;this.peers.delete(id);const s=this.store.session(id);s.connected=false;s.error='Mất kết nối. Mở lại profile và đối chiếu trước khi tiếp tục.';if(s.run&&!['completed','idle','ready_to_submit'].includes(s.run.status)){s.run.status=s.run.submitAttempted?'submit_uncertain':'paused';s.run.recoveryRequired=true;this.store.saveRun(id,s.run);}this.store.saveSession(s);for(const [key,p]of this.pending)if(p.session===id){clearTimeout(p.timer);p.reject(new Error('Mất kết nối profile.'));this.pending.delete(key);}this.changed(); }
  command(id:string,kind:CommandKind,payload:Record<string,unknown>={},runId?:string,timeout=45000):Promise<any> { const peer=this.peers.get(id); if(!peer||peer.readyState!==1)return Promise.reject(new Error('Profile chưa kết nối.')); const commandId=randomUUID();const command:Command={type:'COMMAND',protocol:PROTOCOL_VERSION,sessionId:id,commandId,runId,kind,payload};return new Promise((resolve,reject)=>{const timer=setTimeout(()=>{this.pending.delete(commandId);reject(new Error(`Profile không phản hồi lệnh ${kind}.`));},timeout);this.pending.set(commandId,{session:id,resolve,reject,timer});peer.send(JSON.stringify(command));}); }
  async receive(id:string,message:any) {
    const s=this.store.session(id);s.lastSeen=new Date().toISOString();this.store.saveSession(s);
    if(message.type==='RESULT'){const p=this.pending.get(message.commandId);if(!p||p.session!==id)return;clearTimeout(p.timer);this.pending.delete(message.commandId);message.ok?p.resolve(message.result):p.reject(new Error(message.error??'Lệnh thất bại.'));return;}
    if(message.type==='PROFILE_CHANGED'){s.synced=false;this.store.saveSession(s);this.changed();return;}
    if(message.type==='STATE'){await this.acceptState(id,message.run);return;}
    if(message.type==='REQUEST' && typeof message.requestId==='string'){
      try{
        if(message.kind==='OPEN_MANAGER'){this.peers.get(id)?.send(JSON.stringify({type:'REPLY',requestId:message.requestId,ok:true,url:this.launchUrl}));return;}
        if(message.kind==='CONTROL'){if(s.run?.runId!==message.runId||!['PAUSE','RESUME','STOP'].includes(message.action))throw new Error('Lệnh điều khiển không hợp lệ.');const result=await this.control(id,message.action,message.runId);this.peers.get(id)?.send(JSON.stringify({type:'REPLY',requestId:message.requestId,ok:true,result}));return;}
        if(message.kind==='CHECK_FORM'){if(s.run?.runId!==message.runId||!this.store.group(message.runId).members.includes(id)||this.store.blocked(id,message.formId))throw new Error('Form này có khóa gửi chưa được giải quyết.');}
        else if(message.kind==='SUBMIT'){this.store.acquireSubmit(id,message.runId,message.formId);this.changed();}
        else throw new Error('Yêu cầu không được hỗ trợ.');
        this.peers.get(id)?.send(JSON.stringify({type:'REPLY',requestId:message.requestId,ok:true}));
      }catch(e){this.peers.get(id)?.send(JSON.stringify({type:'REPLY',requestId:message.requestId,ok:false,error:(e as Error).message}));}
    }
  }
  async acceptState(id:string,run:RunState) {
    const s=this.store.session(id);if(!run||!s.run||run.runId!==s.run.runId||run.sessionId!==id||!Number.isSafeInteger(run.eventSeq)||(run.eventSeq??0)<=(s.run.eventSeq??0))return;
    if(s.run.submitAttempted&&!run.submitAttempted)return;
    // A delayed running event cannot restart a paused/stopped group.
    const group=this.store.group(run.runId!);if(group.paused&&run.status==='running')return;
    const snapshot=s.run.profileSnapshot; s.run={...run,profileSnapshot:snapshot};
    if(run.submitAttempted&&run.formId)this.store.db.prepare('INSERT OR IGNORE INTO locks VALUES(?,?,?,?,?)').run(id,run.formId,run.runId!,'local_reserved',new Date().toISOString());
    if(run.status==='completed'&&run.submitAttempted)this.store.db.prepare("UPDATE locks SET resolution='received' WHERE session=? AND run=?").run(id,run.runId!);
    s.error=run.blockingIssue?.message??(run.status==='failed'?run.logs.at(-1)?.message:undefined);this.store.saveRun(id,s.run);this.store.saveSession(s);this.changed();
  }
  async pull(id:string) {
    const s=this.store.session(id);const document:ProfileDocument=await this.command(id,'READ_PROFILE');validateProfile(document.profile);
    if(s.profile&&!s.synced&&JSON.stringify(s.profile)!==JSON.stringify(document.profile)){s.conflict=document;this.store.saveSession(s);this.changed();return s;}
    await this.importDocument(id,document);return this.store.session(id);
  }
  async importDocument(id:string,document:ProfileDocument){
    for(const a of Object.values(document.profile.attachments)){if(!a)continue;const info=await this.command(id,'ATTACHMENT_INFO',{id:a.id});if(info.size!==a.size)throw new Error('Dung lượng ảnh khác hồ sơ.');let chunks:Buffer[]=[];for(let offset=0;offset<a.size;offset+=CHUNK_BYTES){const part=await this.command(id,'ATTACHMENT_READ',{id:a.id,offset,length:CHUNK_BYTES});chunks.push(Buffer.from(part.base64,'base64'));}this.store.saveAttachment(id,a.id,Buffer.concat(chunks),info.hash);}
    const current:ProfileDocument=await this.command(id,'READ_PROFILE');if(current.revision!==document.revision)throw new Error('Hồ sơ đã thay đổi trong lúc đọc; hãy đọc lại.');
    const s=this.store.session(id);s.profile=document.profile;s.revision=document.revision;s.synced=true;s.conflict=undefined;s.error=undefined;this.store.saveSession(s);this.changed();
  }
  async push(id:string,force=false){
    const s=this.store.session(id);if(!s.profile)throw new Error('Chưa có hồ sơ.');const current:ProfileDocument=await this.command(id,'READ_PROFILE');
    if(current.revision!==s.revision&&!force){s.conflict=current;this.store.saveSession(s);this.changed();throw new Error('Extension đã thay đổi; hãy chọn bản cần giữ.');}
    for(const a of Object.values(s.profile.attachments)){if(!a)continue;const bytes=this.store.attachment(id,a.id);const info=await this.command(id,'ATTACHMENT_INFO',{id:a.id}).catch(()=>undefined);if(info?.hash===bytes.hash)continue;const transferId=randomUUID();await this.command(id,'ATTACHMENT_BEGIN',{transferId,attachment:a,hash:bytes.hash});for(let offset=0;offset<bytes.data.length;offset+=CHUNK_BYTES)await this.command(id,'ATTACHMENT_CHUNK',{transferId,index:offset/CHUNK_BYTES,base64:bytes.data.subarray(offset,offset+CHUNK_BYTES).toString('base64')});await this.command(id,'ATTACHMENT_FINISH',{transferId});}
    const result=await this.command(id,'COMMIT_PROFILE',{profile:s.profile,baseRevision:current.revision});s.revision=result.revision;s.synced=true;s.conflict=undefined;s.error=undefined;this.store.saveSession(s);this.changed();return s;
  }
  edit(id:string,values:Partial<SessionView>){const s=this.store.session(id);if(values.name!==undefined)s.name=String(values.name).slice(0,100);if(values.expectedEmail!==undefined)s.expectedEmail=String(values.expectedEmail).trim().toLowerCase();if(values.profile!==undefined){validateProfile(values.profile);s.profile=values.profile;s.synced=false;}this.store.saveSession(s);this.changed();return s;}
  async start(ids:string[],url:string,mode:RunMode){
    if(!allowedFormUrl(url)||!['test','live'].includes(mode))throw new Error('Link Google Forms hoặc chế độ không hợp lệ.');if(!ids.length||new Set(ids).size!==ids.length)throw new Error('Chọn các profile khác nhau.');
    const sessions=ids.map(id=>this.store.session(id));for(const s of sessions){if(!this.peers.has(s.id)||!s.synced||!s.profile||s.conflict||!/^\S+@\S+\.\S+$/.test(s.expectedEmail))throw new Error(`${s.name}: cần kết nối, đồng bộ và gán email Google.`);const form=canonicalFormId(url);if(form&&this.store.blocked(s.id,form)||!form&&s.run?.submitAttempted&&s.run.status!=='idle')throw new Error(`${s.name}: xác minh khóa gửi trước khi chạy form này.`);if(s.run&&!['idle','completed','ready_to_submit','failed','submit_uncertain'].includes(s.run.status))throw new Error(`${s.name}: hãy dừng lượt hiện tại trước.`);for(const a of Object.values(s.profile.attachments))if(a)this.store.attachment(s.id,a.id);}
    const id=randomUUID();const group={id,url,mode,members:ids,paused:false,createdAt:new Date().toISOString()};
    this.store.transaction(()=>{this.store.saveGroup(group);for(const s of sessions){const run:RunState={runId:id,sessionId:s.id,managed:true,profileSnapshot:s.profile,profileRevision:s.revision,expectedEmail:s.expectedEmail,tabId:-1,formId:'',url,mode,status:'running',filled:[],skipped:[],logs:[],submitAttempted:false,updatedAt:group.createdAt,startedAt:group.createdAt,eventSeq:0};s.run=run;s.error=undefined;this.store.saveRun(s.id,run);this.store.saveSession(s);}});this.changed();
    // Schedule every command before awaiting any profile's page load.
    void Promise.allSettled(sessions.map(async s=>{try{const attachmentHashes=Object.fromEntries(Object.values(s.profile!.attachments).filter(Boolean).map(a=>[a!.id,this.store.attachment(s.id,a!.id).hash]));await this.command(s.id,'START',{url,mode,revision:s.revision,expectedEmail:s.expectedEmail,attachmentHashes},id,120000);}catch(e){const current=this.store.session(s.id);if(current.run?.runId!==id)return;current.error=(e as Error).message;if(current.run.submitAttempted){current.run.status='submit_uncertain';}else{current.run.status='failed';}this.store.saveRun(s.id,current.run);this.store.saveSession(current);this.changed();}}));return group;
  }
  async control(id:string,kind:'PAUSE'|'STOP'|'RESUME',expectedRunId?:string) {const s=this.store.session(id);if(!s.run?.runId)throw new Error('Chưa có lượt chạy.');if(expectedRunId&&s.run.runId!==expectedRunId)throw new Error('Lệnh thuộc lượt cũ.');const group=this.store.group(s.run.runId);if(kind==='RESUME'&&(group.paused||group.stopped))throw new Error('Nhóm đang dừng; hãy tiếp tục nhóm hoặc tạo lượt mới.');return this.command(id,kind,{},s.run.runId);}
  async groupControl(id:string,kind:'PAUSE'|'STOP'|'RESUME'){const g=this.store.group(id);if(kind==='RESUME'&&g.stopped)throw new Error('Nhóm đã dừng hẳn. Tạo lượt mới để chạy tiếp.');g.paused=kind!=='RESUME';if(kind==='STOP')g.stopped=true;this.store.saveGroup(g);this.changed();return Promise.all(g.members.map(async member=>{const s=this.store.session(member);if(s.run?.runId!==id||s.run.status==='completed'||kind==='RESUME'&&s.run.submitAttempted)return {member,skipped:true};try{await this.control(member,kind,id);return {member,ok:true};}catch(e){s.error=(e as Error).message;this.store.saveSession(s);this.changed();return {member,ok:false,error:s.error};}}));}
  async failure(id:string,runId:string){if(this.store.session(id).run?.runId!==runId)return;const g=this.store.group(runId);const failures=this.failures.get(runId)??new Map<string,number>();const now=Date.now();for(const [member,at]of failures)if(now-at>30000)failures.delete(member);failures.set(id,now);this.failures.set(runId,failures);if(!g.paused&&failures.size>=3&&failures.size>=Math.ceil(g.members.length*.25)){this.store.audit(undefined,runId,'circuit_breaker','Tạm dừng nhóm do lỗi tải/chặn truy cập.');await this.groupControl(runId,'PAUSE');}}
  async resolve(id:string,result:'received'|'not_received'){const s=this.store.session(id);await this.command(id,'RESOLVE_SUBMISSION',{result},s.run?.runId);this.store.resolve(id,s.run!.runId!,result);this.changed();}
}
