import { randomUUID } from 'node:crypto';
import type { WebSocket } from 'ws';
import type { DataStore } from './data-store';
import { CHUNK_BYTES, PROTOCOL_VERSION, allowedFormUrl, canonicalFormId, validateProfile, type Command, type CommandKind, type ProfileDocument, type SessionView } from '../../src/protocol';
import {canApplyFinalQuestion, validateFinalQuestion, type FinalQuestion, type RunState, type RunMode} from '../../src/shared';
import {AttentionQueue} from './attention';
import type { RunBuffer } from './run-buffer';

export class Coordinator {
  peers=new Map<string,WebSocket>();
  pending=new Map<string,{session:string;resolve:(v:any)=>void;reject:(e:Error)=>void;timer:ReturnType<typeof setTimeout>}>();
  failures=new Map<string,Map<string,number>>();
  changed=()=>{};
  progressChanged=()=>this.changed();
  unavailable=(_error:unknown)=>{};
  progressUnavailable=(error:unknown)=>this.unavailable(error);
  launchUrl='';
  private connectionWrites=new Map<string,Promise<void>>();
  private transition(id:string,operation:()=>void|Promise<void>){
    const previous=this.connectionWrites.get(id)??Promise.resolve();
    const next=previous.catch(()=>{}).then(operation);this.connectionWrites.set(id,next);
    void next.finally(()=>{if(this.connectionWrites.get(id)===next)this.connectionWrites.delete(id);}).catch(()=>{});return next;
  }
  async settledConnections(){await Promise.allSettled([...this.connectionWrites.values()]);}
  constructor(public store:DataStore,public attention=new AttentionQueue(),public cloud=false,public runBuffer?:RunBuffer) {}
  async connect(id:string,ws:WebSocket) {
    if(this.peers.has(id))throw new Error('Mã phiên đã kết nối ở cửa sổ khác.');
    this.peers.set(id,ws);
    try{await this.transition(id,()=>this.store.connected(id,true));this.changed();}catch(e){if(this.peers.get(id)===ws)this.peers.delete(id);throw e;}
  }
  async disconnect(id:string,ws:WebSocket) {
    if(this.peers.get(id)!==ws)return;this.peers.delete(id);
    this.runBuffer?.halt(id);
    const write=this.transition(id,async()=>{await this.runBuffer?.flush(id);this.runBuffer?.forget(id);await this.store.connected(id,false);});
    await this.attention.cancel(id);
    for(const [key,p]of this.pending)if(p.session===id){clearTimeout(p.timer);p.reject(new Error('Mất kết nối profile.'));this.pending.delete(key);}
    await write;this.changed();
  }
  command(id:string,kind:CommandKind,payload:Record<string,unknown>={},runId?:string,timeout=45000):Promise<any> { const peer=this.peers.get(id); if(!peer||peer.readyState!==1)return Promise.reject(new Error('Profile chưa kết nối.')); const commandId=randomUUID();const command:Command={type:'COMMAND',protocol:PROTOCOL_VERSION,sessionId:id,commandId,runId,kind,payload};return new Promise((resolve,reject)=>{const timer=setTimeout(()=>{this.pending.delete(commandId);reject(new Error(`Profile không phản hồi lệnh ${kind}.`));},timeout);this.pending.set(commandId,{session:id,resolve,reject,timer});peer.send(JSON.stringify(command));}); }
  async receive(id:string,message:any) {
    if(message.type==='RESULT'){const p=this.pending.get(message.commandId);if(!p||p.session!==id)return;clearTimeout(p.timer);this.pending.delete(message.commandId);message.ok?p.resolve(message.result):p.reject(new Error(message.error??'Lệnh thất bại.'));return;}
    if(this.runBuffer){
      const live=this.runBuffer.touch(id);
      if(live&&message.type==='HEARTBEAT')return;
      if(live&&message.type==='STATE'){await this.acceptState(id,message.run);return;}
      if(live&&message.type==='EXECUTION'){
        this.runBuffer.execution(id,message.execution??null);this.progressChanged();
        // The final execution report follows the terminal STATE. Persist it
        // after registration rather than leaving an active lease in history.
        if(this.runBuffer.finished(id))void this.runBuffer.flush(id).then(()=>this.changed()).catch(this.progressUnavailable);
        return;
      }
      if(message.type==='REQUEST'&&typeof message.requestId==='string'&&String(message.kind).startsWith('ATTENTION_')){
        try{
          const token=String(message.token??'');let result:object;
          if(message.kind==='ATTENTION_ACQUIRE'){
            if(message.rendering!=='background')throw new Error('Bản online yêu cầu extension hỗ trợ chạy nền. Cập nhật extension rồi thử lại.');
            result=await this.attention.acquire(id,String(message.runId),()=>this.peers.has(id)&&this.runBuffer!.allowed(id,String(message.runId)),'background');
          }else if(message.kind==='ATTENTION_RENEW')result={renewed:this.attention.renew(id,token)};
          else if(message.kind==='ATTENTION_RELEASE'){await this.attention.release(id,token);result={released:true};}
          else throw new Error('Yêu cầu cửa sổ không hợp lệ.');
          this.peers.get(id)?.send(JSON.stringify({type:'REPLY',requestId:message.requestId,ok:true,...result}));
        }catch(e){this.peers.get(id)?.send(JSON.stringify({type:'REPLY',requestId:message.requestId,ok:false,error:(e as Error).message}));}
        return;
      }
      if(live&&message.type==='REQUEST'&&message.kind==='CHECK_FORM'&&typeof message.requestId==='string'){
        const checked=this.runBuffer.checkedForm(id,message.runId,message.formId);
        if(checked!==undefined){this.peers.get(id)?.send(JSON.stringify({type:'REPLY',requestId:message.requestId,ok:checked,...(!checked?{error:'Lượt/form đã thay đổi hoặc đã dừng.'}:{})}));return;}
      }
      if(live&&message.type==='REQUEST'&&message.kind==='SUBMIT'&&typeof message.requestId==='string'){
        try{
          if(!this.runBuffer.canSubmit(id,message.runId))throw new Error('Lượt đã dừng hoặc không được phép gửi.');
          const snapshot=this.runBuffer.submitSnapshot(id);
          // Latest progress and the submit lock commit together. No separate
          // progress transaction or heartbeat/session reads before the grant.
          await this.store.acquireSubmit(id,message.runId,message.formId,snapshot);
          this.runBuffer.submitted(id,snapshot?.eventSeq);this.changed();
          this.peers.get(id)?.send(JSON.stringify({type:'REPLY',requestId:message.requestId,ok:true}));
        }catch(e){this.peers.get(id)?.send(JSON.stringify({type:'REPLY',requestId:message.requestId,ok:false,error:(e as Error).message}));}
        return;
      }
      // Unknown/short form URLs need the latest form ID in PostgreSQL before
      // checking its locks. Ordinary page work never crosses this barrier.
      if(live&&message.type==='REQUEST')await this.runBuffer.flush(id);
    }
    await this.store.touch(id);if(message.type==='HEARTBEAT')return;const s=await this.store.session(id);
    if(message.type==='PROFILE_CHANGED'){s.synced=false;await this.store.saveSession(s);this.changed();return;}
    if(message.type==='STATE'){await this.acceptState(id,message.run);return;}
    if(message.type==='EXECUTION'){if(JSON.stringify(s.execution??null)===JSON.stringify(message.execution??null))return;s.execution=message.execution??null;await this.store.saveSession(s);this.changed();return;}
    if(message.type==='REQUEST' && typeof message.requestId==='string'){
      try{
        if(String(message.kind).startsWith('ATTENTION_')){
          const token=String(message.token??'');let result:object;
          if(message.kind==='ATTENTION_ACQUIRE'){
            if(this.cloud&&message.rendering!=='background')throw new Error('Bản online yêu cầu extension hỗ trợ chạy nền. Cập nhật extension rồi thử lại.');
            result=await this.attention.acquire(id,String(message.runId),async()=>{const current=await this.store.session(id);return this.peers.has(id)&&!!current.run&&current.run.runId===message.runId&&current.run.status==='running'&&!current.run.submitAttempted&&!(await this.store.group(message.runId)).paused;},message.rendering==='background'?'background':'foreground');
          }
          else if(message.kind==='ATTENTION_RENEW')result={renewed:this.attention.renew(id,token)};
          else if(message.kind==='ATTENTION_FOCUSED')result={focused:await this.attention.focused(id,token)};
          else if(message.kind==='ATTENTION_RELEASE'){await this.attention.release(id,token);result={released:true};}
          else throw new Error('Yêu cầu cửa sổ không hợp lệ.');
          this.peers.get(id)?.send(JSON.stringify({type:'REPLY',requestId:message.requestId,ok:true,...result}));return;
        }
        if(message.kind==='OPEN_MANAGER'){this.peers.get(id)?.send(JSON.stringify({type:'REPLY',requestId:message.requestId,ok:true,url:this.launchUrl}));return;}
        if(message.kind==='AUTO_RESUME'){const result=await this.control(id,'RESUME',message.runId,true);this.peers.get(id)?.send(JSON.stringify({type:'REPLY',requestId:message.requestId,ok:true,result}));return;}
        if(message.kind==='CONTROL'){if(s.run?.runId!==message.runId||!['PAUSE','RESUME','STOP'].includes(message.action))throw new Error('Lệnh điều khiển không hợp lệ.');const result=await this.control(id,message.action,message.runId);this.peers.get(id)?.send(JSON.stringify({type:'REPLY',requestId:message.requestId,ok:true,result}));return;}
        if(message.kind==='CHECK_FORM'){if(s.run?.runId!==message.runId||!(await this.store.group(message.runId)).members.includes(id)||await this.store.blocked(id,message.formId))throw new Error('Form này có khóa gửi chưa được giải quyết.');}
        else if(message.kind==='SUBMIT'){
          if(this.runBuffer?.has(id)&&!this.runBuffer.canSubmit(id,message.runId))throw new Error('Lượt đã dừng hoặc không được phép gửi.');
          await this.store.acquireSubmit(id,message.runId,message.formId);this.runBuffer?.submitted(id);this.changed();
        }
        else throw new Error('Yêu cầu không được hỗ trợ.');
        this.peers.get(id)?.send(JSON.stringify({type:'REPLY',requestId:message.requestId,ok:true}));
      }catch(e){this.peers.get(id)?.send(JSON.stringify({type:'REPLY',requestId:message.requestId,ok:false,error:(e as Error).message}));}
    }
  }
  async acceptState(id:string,run:RunState) {
    const staged=this.runBuffer?.stage(id,run);
    if(staged!==undefined){
      if(staged){
        this.progressChanged();
        if(!['running','submitting'].includes(run.status)){
          void this.attention.cancel(id);
          void this.runBuffer!.flush(id).then(()=>this.changed()).catch(this.progressUnavailable);
        }
      }
      return;
    }
    if(await this.store.acceptProgress(id,run)){
      if(!['running','submitting'].includes(run.status))void this.attention.cancel(id);
      this.changed();
    }
  }
  async pull(id:string) {
    await this.runBuffer?.flush(id);
    const s=await this.store.session(id);const document:ProfileDocument=await this.command(id,'READ_PROFILE');validateProfile(document.profile);
    if(s.profile&&!s.synced&&JSON.stringify(s.profile)!==JSON.stringify(document.profile)){s.conflict=document;await this.store.saveSession(s);this.changed();return s;}
    await this.importDocument(id,document);return await this.store.session(id);
  }
  async importDocument(id:string,document:ProfileDocument){
    for(const a of Object.values(document.profile.attachments)){if(!a)continue;const info=await this.command(id,'ATTACHMENT_INFO',{id:a.id});if(info.size!==a.size)throw new Error('Dung lượng ảnh khác hồ sơ.');let chunks:Buffer[]=[];for(let offset=0;offset<a.size;offset+=CHUNK_BYTES){const part=await this.command(id,'ATTACHMENT_READ',{id:a.id,offset,length:CHUNK_BYTES});chunks.push(Buffer.from(part.base64,'base64'));}await this.store.saveAttachment(id,a.id,Buffer.concat(chunks),info.hash);}
    const current:ProfileDocument=await this.command(id,'READ_PROFILE');if(current.revision!==document.revision)throw new Error('Hồ sơ đã thay đổi trong lúc đọc; hãy đọc lại.');
    const s=await this.store.session(id);s.profile=document.profile;s.revision=document.revision;s.synced=true;s.conflict=undefined;s.error=undefined;await this.store.saveSession(s);this.changed();
  }
  async push(id:string,force=false){
    await this.runBuffer?.flush(id);
    const s=await this.store.session(id);if(!s.profile)throw new Error('Chưa có hồ sơ.');const current:ProfileDocument=await this.command(id,'READ_PROFILE');
    if(current.revision!==s.revision&&!force){s.conflict=current;await this.store.saveSession(s);this.changed();throw new Error('Extension đã thay đổi; hãy chọn bản cần giữ.');}
    for(const a of Object.values(s.profile.attachments)){if(!a)continue;const bytes=await this.store.attachment(id,a.id);const info=await this.command(id,'ATTACHMENT_INFO',{id:a.id}).catch(()=>undefined);if(info?.hash===bytes.hash)continue;const transferId=randomUUID();await this.command(id,'ATTACHMENT_BEGIN',{transferId,attachment:a,hash:bytes.hash});for(let offset=0;offset<bytes.data.length;offset+=CHUNK_BYTES)await this.command(id,'ATTACHMENT_CHUNK',{transferId,index:offset/CHUNK_BYTES,base64:bytes.data.subarray(offset,offset+CHUNK_BYTES).toString('base64')});await this.command(id,'ATTACHMENT_FINISH',{transferId});}
    const result=await this.command(id,'COMMIT_PROFILE',{profile:s.profile,baseRevision:current.revision});s.revision=result.revision;s.synced=true;s.conflict=undefined;s.error=undefined;await this.store.saveSession(s);this.changed();return s;
  }
  async edit(id:string,values:Partial<SessionView>){await this.runBuffer?.flush(id);const s=await this.store.session(id);if(values.name!==undefined)s.name=String(values.name).slice(0,100);if(values.expectedEmail!==undefined)s.expectedEmail=String(values.expectedEmail).trim().toLowerCase();if(values.profile!==undefined){validateProfile(values.profile);s.profile=values.profile;s.synced=false;}await this.store.saveSession(s);this.changed();return s;}
  async setFinalQuestion(ids:string[],finalQuestion:FinalQuestion,resume=false){
    validateFinalQuestion(finalQuestion);
    finalQuestion=finalQuestion?structuredClone(finalQuestion):finalQuestion;
    if(!finalQuestion||!Array.isArray(ids)||!ids.length||ids.length>100||new Set(ids).size!==ids.length)throw new Error('Chọn profile và nhập câu hỏi cuối.');
    return Promise.all(ids.map(async id=>{
      let updated=false;
      try{
        // Flush/read/check each member independently. A running, offline or
        // failed member must not hold up another member's SET + RESUME.
        await this.runBuffer?.flush(id);
        const before=await this.store.session(id);
        if(!this.peers.has(id)||!before.run?.runId||before.run.submitAttempted||!['paused','waiting_manual','ready_to_submit'].includes(before.run.status))return {id,ok:false,skipped:true,error:'Profile chưa sẵn sàng hoặc đã gửi; giữ nguyên lượt.'};
        if(finalQuestion.formId&&finalQuestion.formId!==before.run.formId)return {id,ok:false,skipped:true,error:'Câu hỏi đã chọn thuộc form khác; giữ nguyên lượt.'};
        if(resume&&!canApplyFinalQuestion(before.run,finalQuestion))return {id,ok:false,skipped:true,error:'Profile chưa tới câu hỏi này; có thể áp dụng sau.'};
        const runId=before.run.runId;
        await this.command(id,'SET_FINAL_QUESTION',{finalQuestion},runId);
        await this.runBuffer?.flush(id);
        const s=await this.store.session(id);
        if(!s.run||s.run.runId!==runId||s.run.submitAttempted||!['paused','waiting_manual','ready_to_submit'].includes(s.run.status)||resume&&!canApplyFinalQuestion(s.run,finalQuestion))throw new Error('Lượt đã thay đổi trong lúc cập nhật.');
        s.run.finalQuestion=structuredClone(finalQuestion);
        await this.store.saveRun(id,s.run);await this.store.saveSession(s);
        this.runBuffer?.refresh(id,s);this.changed();updated=true;
        // Each member can resume as soon as its own answer is durable. A slow
        // peer no longer holds up the group or requires a second browser request.
        if(resume)await this.control(id,'RESUME',runId);
        return {id,ok:true};
      }catch(e){return {id,ok:false,error:updated?`Đã cập nhật đáp án nhưng chưa tiếp tục được: ${(e as Error).message}`:(e as Error).message};}
    }));
  }
  async start(ids:string[],url:string,mode:RunMode,finalQuestion?:FinalQuestion){
    validateFinalQuestion(finalQuestion);
    finalQuestion=finalQuestion?structuredClone(finalQuestion):undefined;
    if(finalQuestion?.formId&&canonicalFormId(url)&&finalQuestion.formId!==canonicalFormId(url))throw new Error('Câu hỏi cuối đã chọn thuộc form khác. Đọc lại câu hỏi hoặc nhập nội dung cho form này.');
    if(!allowedFormUrl(url)||!['test','live'].includes(mode))throw new Error('Link Google Forms hoặc chế độ không hợp lệ.');if(!Array.isArray(ids)||!ids.length||ids.length>100||new Set(ids).size!==ids.length)throw new Error('Chọn các profile khác nhau.');
    await Promise.all(ids.map(id=>this.runBuffer?.flush(id)));
    if(finalQuestion)await Promise.all(ids.map(async id=>{const result=await this.command(id,'PING',{},undefined,5000),s=await this.store.session(id);if(!result?.capabilities?.includes('sharedFinalQuestion'))throw new Error(`${s.name}: Reload hoặc cập nhật extension để dùng đáp án câu hỏi cuối chung.`);if(result.execution)throw new Error(`${s.name}: còn lượt giữ profile. Bấm Xem form hoặc Dừng trên hàng profile.`);}));
    const attachmentHashes=new Map<string,Record<string,string>>();const sessions=await Promise.all(ids.map(id=>this.store.session(id)));
    // Preflight small batches concurrently, without exhausting the PG pool.
    for(let offset=0;offset<sessions.length;offset+=4)await Promise.all(sessions.slice(offset,offset+4).map(async s=>{if(!this.peers.has(s.id)||!s.synced||!s.profile||s.conflict||!/^\S+@\S+\.\S+$/.test(s.expectedEmail))throw new Error(`${s.name}: cần kết nối, đồng bộ và gán email Google.`);const form=canonicalFormId(url);if(form&&await this.store.blocked(s.id,form)||!form&&s.run?.submitAttempted&&s.run.status!=='idle')throw new Error(`${s.name}: xác minh khóa gửi trước khi chạy form này.`);if(s.execution)throw new Error(`${s.name}: còn lượt giữ profile. Bấm Xem form hoặc Dừng trên hàng profile.`);if(s.run&&!['idle','completed','ready_to_submit','failed','submit_uncertain'].includes(s.run.status))throw new Error(`${s.name}: hãy dừng lượt hiện tại trước.`);const hashes:Record<string,string>={};for(const a of Object.values(s.profile.attachments))if(a){const info=await this.store.attachmentInfo(s.id,a.id);if(info.size!==a.size)throw new Error('Dung lượng ảnh không khớp hồ sơ.');hashes[a.id]=info.hash;}attachmentHashes.set(s.id,hashes);}));
    const id=randomUUID();const group={id,url,mode,members:ids,paused:false,createdAt:new Date().toISOString()};
    for(const s of sessions){const run:RunState={runId:id,sessionId:s.id,managed:true,profileSnapshot:s.profile,finalQuestion:finalQuestion?structuredClone(finalQuestion):undefined,profileRevision:s.revision,expectedEmail:s.expectedEmail,tabId:-1,formId:'',url,mode,status:'running',filled:[],skipped:[],logs:[],submitAttempted:false,updatedAt:group.createdAt,startedAt:group.createdAt,eventSeq:0};s.run=run;s.error=undefined;}await this.store.beginGroup(group,sessions);this.runBuffer?.begin(sessions,group);this.changed();
    // Wait for dispatch, never for another profile's page load. The group gate
    // is rechecked after async preflight so Stop cannot release a late Start.
    const failed=async(session:string,error:unknown)=>{
      if(this.runBuffer?.matches(session,id))this.runBuffer.halt(session);await this.runBuffer?.flush(session);
      const current=await this.store.session(session);
      if(current.run?.runId!==id||!['running','submitting'].includes(current.run.status)||(await this.store.group(id)).paused&&!current.run.submitAttempted)return;
      current.error=(error as Error).message;current.run.status=current.run.submitAttempted?'submit_uncertain':'failed';
      await this.store.saveRun(session,current.run);await this.store.saveSession(current);this.runBuffer?.refresh(session,current);this.changed();
    };
    await Promise.all(sessions.map(async s=>{
      try{
        const latest=await this.store.session(s.id);
        if(latest.run?.runId!==id||latest.run.status!=='running'||(await this.store.group(id)).paused)return;
        if(this.runBuffer?.has(s.id)&&!this.runBuffer.allowed(s.id,id))return;
        void this.command(s.id,'START',{url,mode,finalQuestion,revision:s.revision,expectedEmail:s.expectedEmail,attachmentHashes:attachmentHashes.get(s.id)!},id,120000).catch(error=>failed(s.id,error)).catch(this.unavailable);
      }catch(error){await failed(s.id,error).catch(this.unavailable);}
    }));return group;
  }
  async control(id:string,kind:'PAUSE'|'STOP'|'RESUME',expectedRunId?:string,automatic=false) {
    if(expectedRunId&&this.runBuffer?.has(id)&&!this.runBuffer.matches(id,expectedRunId))throw new Error('Lệnh thuộc lượt cũ.');
    if(kind!=='RESUME')this.runBuffer?.halt(id);
    await this.runBuffer?.flush(id);
    const s=await this.store.session(id);if(expectedRunId&&s.run?.runId!==expectedRunId)throw new Error('Lệnh thuộc lượt cũ.');
    if(automatic&&(!expectedRunId||s.run?.status!=='waiting_manual'||s.run.recoveryRequired||!['validation','unknown_required','file_upload','unsupported'].includes(s.run.blockingIssue?.reason??'')))throw new Error('Lượt không chờ sửa dữ liệu; không tự tiếp tục.');
    if(kind!=='RESUME')await this.attention.cancel(id);
    if(kind==='STOP'){
      const result=await this.command(id,'STOP_PROFILE');const current=await this.store.session(id);
      if(current.run?.runId===s.run?.runId){if(current.run){current.run.status=current.run.submitAttempted?'submit_uncertain':'idle';current.run.blockingIssue=current.run.submitAttempted?current.run.blockingIssue:undefined;current.run.eventSeq=Math.max(current.run.eventSeq??0,result?.run?.runId===current.run.runId?(result.run.eventSeq??0):0);current.run.updatedAt=new Date().toISOString();current.run.logs.push({at:current.run.updatedAt,level:'info',message:'Đã dừng mọi lượt trong profile. Có thể bắt đầu lượt mới khi chưa khóa gửi.'});await this.store.saveRun(id,current.run);}current.error=undefined;current.execution=result?.execution??null;await this.store.saveSession(current);this.changed();}
      this.runBuffer?.refresh(id,current);return result;
    }
    if(!s.run?.runId)throw new Error('Chưa có lượt chạy.');
    if(kind==='RESUME'){
      if(s.run.submitAttempted)throw new Error('Lượt đã khóa gửi; hãy xác minh kết quả trước.');
      const group=await this.store.group(s.run.runId);
      if(automatic&&(group.paused||group.stopped))throw new Error('Nhóm đã dừng; không tự tiếp tục.');
      // Resuming one member leaves the other members halted in their extensions.
      // The group gate must allow this member to report progress and request submit.
      if(group.paused||group.stopped){group.paused=false;group.stopped=false;await this.store.saveGroup(group);this.changed();}
      if(this.runBuffer&&!this.runBuffer.has(id))this.runBuffer.begin([s],group);
      this.runBuffer?.groupGate(group);this.runBuffer?.refresh(id,s,true);
    }
    let result:any;
    try{result=await this.command(id,kind,automatic?{automatic:true}:{},s.run.runId);}catch(error){this.runBuffer?.halt(id);throw error;}
    // Persist the acknowledged state even when its separate STATE message is late.
    if(result?.runId===s.run.runId)await this.acceptState(id,result);
    if(kind==='RESUME'){
      const terminal=this.runBuffer?.finishResume(id);
      if(terminal)await this.acceptState(id,terminal);
    }
    return result;
  }
  async groupControl(id:string,kind:'PAUSE'|'STOP'|'RESUME'){if(kind!=='RESUME')this.runBuffer?.haltGroup(id);const g=await this.store.group(id);g.paused=kind!=='RESUME';if(kind==='STOP')g.stopped=true;else if(kind==='RESUME')g.stopped=false;if(kind!=='RESUME')this.runBuffer?.groupGate(g);await this.store.saveGroup(g);this.runBuffer?.groupGate(g);this.changed();return Promise.all(g.members.map(async member=>{await this.runBuffer?.flush(member);const s=await this.store.session(member);if(s.run?.runId!==id||s.run.status==='completed'||kind==='RESUME'&&s.run.submitAttempted)return {member,skipped:true};try{await this.control(member,kind,id);return {member,ok:true};}catch(e){const current=await this.store.session(member);if(current.run?.runId===id){current.error=(e as Error).message;await this.store.saveSession(current);this.changed();}return {member,ok:false,error:(e as Error).message};}}));}
  async failure(id:string,runId:string){if((await this.store.session(id)).run?.runId!==runId)return;const g=await this.store.group(runId);const failures=this.failures.get(runId)??new Map<string,number>();const now=Date.now();for(const [member,at]of failures)if(now-at>30000)failures.delete(member);failures.set(id,now);this.failures.set(runId,failures);if(!g.paused&&failures.size>=3&&failures.size>=Math.ceil(g.members.length*.25)){await this.store.audit(undefined,runId,'circuit_breaker','Tạm dừng nhóm do lỗi tải/chặn truy cập.');await this.groupControl(runId,'PAUSE');}}
  async resolve(id:string,result:'received'|'not_received'){await this.runBuffer?.flush(id);const s=await this.store.session(id);await this.command(id,'RESOLVE_SUBMISSION',{result},s.run?.runId);await this.runBuffer?.flush(id);await this.store.resolve(id,s.run!.runId!,result);this.runBuffer?.forget(id);this.changed();}
}
