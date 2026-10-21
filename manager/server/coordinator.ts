import { randomUUID,createHash } from 'node:crypto';
import { isDeepStrictEqual } from 'node:util';
import type { WebSocket } from 'ws';
import type { DataStore } from './data-store';
import { currentExecution, sameExecution, CHUNK_BYTES, PROTOCOL_VERSION, allowedFormUrl, canonicalFormId, canStartSeparateTest, validateProfile, type Command, type CommandKind, type ProfileDocument, type SessionView, type ControlReceipt } from '../../src/protocol';
import {canApplyFinalQuestion, validateFinalQuestion, type FinalQuestion, type RunState, type RunMode,type FormQuestionSummary} from '../../src/shared';
import {automaticRecoveryAllowed,pageReadyResumeAllowed} from '../../src/recovery';
import {AttentionQueue} from './attention';
import type { RunBuffer } from './run-buffer';
import {RegistrationScheduler} from './registration-scheduler';
import {bindHskAnswer,initialHskQuestion,isHskLevel,type HskLevel} from '../../src/registration-schedule';

export class Coordinator {
  readonly scheduler:RegistrationScheduler;
  peers=new Map<string,WebSocket>();
  pending=new Map<string,{session:string;resolve:(v:any)=>void;reject:(e:Error)=>void;timer:ReturnType<typeof setTimeout>}>();
  private facebookPeers=new Map<string,{peer:WebSocket;capabilities:string[]}>();
  failures=new Map<string,Map<string,number>>();
  changed=()=>{};
  progressChanged=()=>this.changed();
  unavailable=(_error:unknown)=>{};
  progressUnavailable=(error:unknown)=>this.unavailable(error);
  launchUrl='';
  private receiptClock=0;
  private intents=new Map<string,number>();
  private restarts=new Map<string,Promise<import('../../src/protocol').GroupView>>();
  private starts=new Map<string,Promise<import('../../src/protocol').GroupView>>();
  private controls=new Map<string,Promise<any>>();
  private async receipt(id:string,value:ControlReceipt,initial=false){
    if(this.store.saveControl){await this.store.saveControl(id,value,initial);this.changed();return;}
    const s=await this.store.session(id);
    if(initial&&s.control&&s.control.requestedAt>value.requestedAt)return;
    if(!initial&&s.control?.commandId!==value.commandId)return;
    if(value.runId&&s.run?.runId!==value.runId)return;
    s.control=structuredClone(value);await this.store.saveSession(s);this.changed();
  }
  private connectionWrites=new Map<string,Promise<void>>();
  private transition(id:string,operation:()=>void|Promise<void>){
    const previous=this.connectionWrites.get(id)??Promise.resolve();
    const next=previous.catch(()=>{}).then(operation);this.connectionWrites.set(id,next);
    void next.finally(()=>{if(this.connectionWrites.get(id)===next)this.connectionWrites.delete(id);}).catch(()=>{});return next;
  }
  async settledConnections(){await Promise.allSettled([...this.connectionWrites.values()]);}
  constructor(public store:DataStore,public attention=new AttentionQueue(),public cloud=false,public runBuffer?:RunBuffer) {
    this.scheduler=new RegistrationScheduler({
      load:async()=>store.registrationSchedule?.(),
      save:async s=>{if(!store.saveRegistrationSchedule)throw new Error('Server chưa hỗ trợ lưu lịch.');await store.saveRegistrationSchedule(s);},
      sessions:async()=>store.sessions(),connected:id=>this.peers.has(id),
      command:(id,kind,payload)=>this.command(id,kind,payload,undefined,5000),
      prepare:async id=>{
        const ping=await this.command(id,'PING',{},undefined,5000);if(!ping?.capabilities?.includes('scheduledHskLinks'))throw new Error('Cập nhật extension để dùng lịch HSK.');
        let s=await store.session(id);if(!s.synced)s=await this.pull(id);
        if(!s.profile)throw new Error('Chưa có hồ sơ thí sinh.');
        if(s.conflict)throw new Error('Giải quyết xung đột hồ sơ trước khi chạy.');
        if(!/^\S+@\S+\.\S+$/.test(s.expectedEmail))throw new Error('Chưa gán email Google cho profile.');
        if(s.execution)throw new Error('Lượt cũ còn giữ profile. Bấm Dừng trên hàng profile.');
        await Promise.all(Object.values(s.profile.attachments).filter(a=>!!a).map(async a=>{const info=await this.command(id,'ATTACHMENT_INFO',{id:a.id},undefined,5000);if(info.size!==a.size)throw new Error('Ảnh chưa sẵn sàng.');}));
        if(ping.capabilities.includes('preparedFormTab'))await this.command(id,'PREPARE_FORM',{},undefined,5000);
        return s.revision;
      },
      reset:async member=>{
        await this.runBuffer?.flush(member.id);const current=await store.session(member.id);
        const group=await store.groupForRequest?.(member.requestId);
        const expected=member.runId??group?.id;if(!expected)return;
        if(current.run?.runId!==expected)throw new Error('Profile đã chuyển sang lượt khác. Giữ nguyên lượt hiện tại.');
        if(current.run.submitAttempted)throw new Error('Lượt đã khóa gửi. Xác minh kết quả trước khi đổi link.');
        await this.control(member.id,'STOP',current.run.runId);
      },
      start:(id,url,s,guard)=>this.start([id],url,s.mode,initialHskQuestion(s,s.members.find(m=>m.id===id)!.level),s.members.find(m=>m.id===id)!.requestId,undefined,guard),
      started:(id,runId)=>{void (async()=>{await this.runBuffer?.flush(id);const session=await store.session(id);if(session.run?.runId===runId)this.queueScheduledAnswer(id,session.run);})().catch(this.unavailable);},
      changed:()=>this.changed(),error:e=>this.unavailable(e)
    });
  }
  async connect(id:string,ws:WebSocket) {
    if(this.peers.has(id))throw new Error('Mã phiên đã kết nối ở cửa sổ khác.');
    this.peers.set(id,ws);
    try{await this.transition(id,()=>this.store.connected(id,true));this.changed();}catch(e){if(this.peers.get(id)===ws)this.peers.delete(id);throw e;}
  }
  async disconnect(id:string,ws:WebSocket) {
    if(this.peers.get(id)!==ws)return;this.peers.delete(id);
    this.facebookPeers.delete(id);
    this.runBuffer?.halt(id);
    const write=this.transition(id,async()=>{await this.runBuffer?.flush(id);this.runBuffer?.forget(id);await this.store.connected(id,false);});
    await this.attention.cancel(id);
    for(const [key,p]of this.pending)if(p.session===id){clearTimeout(p.timer);p.reject(new Error('Mất kết nối profile.'));this.pending.delete(key);}
    await write;this.changed();
  }
  async command(id:string,kind:CommandKind,payload:Record<string,unknown>={},runId?:string,timeout=45000):Promise<any> {
    const peer=this.peers.get(id);if(!peer||peer.readyState!==1)throw new Error('Profile chưa kết nối.');
    if(kind==='WATCH_FACEBOOK'){
      let verified=this.facebookPeers.get(id);
      if(verified?.peer!==peer){
        const ping=await this.command(id,'PING',{},undefined,5000);
        if(this.peers.get(id)!==peer)throw new Error('Kết nối profile đã thay đổi.');
        const capabilities=Array.isArray(ping?.capabilities)?ping.capabilities.filter((v:unknown)=>typeof v==='string'):[];
        verified={peer,capabilities};this.facebookPeers.set(id,verified);
      }
      // Older extensions route unknown commands to form controls. Never let a
      // watcher command reach that fallback, including cleanup and focus.
      if(!verified.capabilities.includes('scheduledHskLinks'))throw new Error('Extension của profile này chưa hỗ trợ săn link. Cập nhật/Reload extension 1.7.1 trong đúng profile.');
      if(payload.focus&&!verified.capabilities.includes('facebookWatchWindow'))throw new Error('Cập nhật/Reload extension 1.7.1 để mở cửa sổ Facebook nhỏ.');
    }
    const commandId=randomUUID(),at=new Date(this.receiptClock=Math.max(Date.now(),this.receiptClock+1)).toISOString();
    const tracked=['START','PAUSE','RESUME','STOP','STOP_PROFILE'].includes(kind);
    const receipt:ControlReceipt={commandId,kind:kind as ControlReceipt['kind'],runId,state:'pending',requestedAt:at,updatedAt:at};
    if(tracked)await this.receipt(id,receipt,true);
    const command:Command={type:'COMMAND',protocol:PROTOCOL_VERSION,sessionId:id,commandId,runId,kind,payload};
    try{
      const result=await new Promise<any>((resolve,reject)=>{
        const timer=setTimeout(()=>{this.pending.delete(commandId);reject(new Error(`Profile chưa xác nhận ${kind}. Đối chiếu trạng thái trước khi thử lại.`));},timeout);
        this.pending.set(commandId,{session:id,resolve,reject,timer});
        try{if(this.peers.get(id)!==peer||peer.readyState!==1)throw new Error('Mất kết nối profile.');peer.send(JSON.stringify(command));}
        catch(e){clearTimeout(timer);this.pending.delete(commandId);reject(e);}
      });
      if(tracked)await this.receipt(id,{...receipt,state:'acknowledged',updatedAt:new Date().toISOString()});
      return result;
    }catch(e){
      const error=(e as Error).message;
      if(tracked)await this.receipt(id,{...receipt,state:/chưa xác nhận|Mất kết nối/.test(error)?'uncertain':'failed',error,updatedAt:new Date().toISOString()}).catch(this.unavailable);
      throw e;
    }
  }
  async receive(id:string,message:any) {
    if(message.type==='RESULT'){const p=this.pending.get(message.commandId);if(!p||p.session!==id)return;clearTimeout(p.timer);this.pending.delete(message.commandId);message.ok?p.resolve(message.result):p.reject(new Error(message.error??'Lệnh thất bại.'));return;}
    if(message.type==='REQUEST'&&message.kind==='FACEBOOK_OBSERVATION'&&typeof message.requestId==='string'){
      try{const result=await this.scheduler.observe(id,message);this.peers.get(id)?.send(JSON.stringify({type:'REPLY',requestId:message.requestId,ok:true,...result}));}
      catch(e){this.peers.get(id)?.send(JSON.stringify({type:'REPLY',requestId:message.requestId,ok:false,error:(e as Error).message}));}return;
    }
    if(this.runBuffer){
      const live=this.runBuffer.touch(id);
      if(live&&message.type==='HEARTBEAT')return;
      if(live&&message.type==='STATE'){await this.acceptState(id,message.run);return;}
      if(live&&message.type==='EXECUTION'){
        this.runBuffer.execution(id,message.execution??null,message.sourceRunId);this.progressChanged();
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
    if(message.type==='PROFILE_CHANGED'){if(s.synced)s.managerDraft=false;s.synced=false;await this.store.saveSession(s);this.changed();return;}
    if(message.type==='STATE'){await this.acceptState(id,message.run);return;}
    if(message.type==='EXECUTION'){const ex=message.execution??null;if(!currentExecution(s.run,ex,message.sourceRunId)||sameExecution(s.execution,ex))return;s.execution=ex;await this.store.saveSession(s);this.changed();return;}
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
        if(message.kind==='START'){
          if(!this.cloud)throw new Error('Lệnh bắt đầu không được hỗ trợ.');
          if(!allowedFormUrl(message.url)||!['test','live'].includes(message.mode))throw new Error('Link Google Forms hoặc chế độ không hợp lệ.');
          if(s.execution||s.run&&!['idle','completed','ready_to_submit','failed'].includes(s.run.status)&&!canStartSeparateTest(s.run,message.url,message.mode))throw new Error('Profile đang có lượt chạy. Dừng lượt hiện tại trước.');
          // Same import, account quotas, Live permission and durable start gate
          // as the manager. The authenticated socket can start only its profile.
          const imported=await this.pull(id);
          if(imported.conflict)throw new Error('Hồ sơ có thay đổi ở cả website và extension. Chọn bản cần giữ trong Chi tiết trên website trước khi chạy.');
          await this.start([id],message.url,message.mode,undefined,message.operationId);
          this.peers.get(id)?.send(JSON.stringify({type:'REPLY',requestId:message.requestId,ok:true,run:(await this.store.session(id)).run}));return;
        }
        if(message.kind==='RESTART'){const group=await this.restart(id,message.runId,message.operationId);this.peers.get(id)?.send(JSON.stringify({type:'REPLY',requestId:message.requestId,ok:true,group,run:(await this.store.session(id)).run}));return;}
        if(message.kind==='RECOVER'){if(s.run?.recovery?.attempt!==message.attempt)throw new Error('Yêu cầu phục hồi đã cũ.');const result=await this.control(id,'RESUME',message.runId,'recovery');this.peers.get(id)?.send(JSON.stringify({type:'REPLY',requestId:message.requestId,ok:true,result}));return;}
        if(message.kind==='AUTO_RESUME'&&message.source==='returned_submit'){const result=await this.retryReturnedForm(id,message.runId,message.epoch,message.retries);this.peers.get(id)?.send(JSON.stringify({type:'REPLY',requestId:message.requestId,ok:true,result}));return;}
        if(message.kind==='AUTO_RESUME'){const result=await this.control(id,'RESUME',message.runId,message.source==='reconnect'?'reconnect':message.source==='page_ready'?'page_ready':true);this.peers.get(id)?.send(JSON.stringify({type:'REPLY',requestId:message.requestId,ok:true,result}));return;}
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
        this.queueScheduledAnswer(id,run);
        if(!['running','submitting'].includes(run.status)){
          void this.attention.cancel(id);
          void this.runBuffer!.flush(id).then(()=>this.changed()).catch(this.progressUnavailable);
        }
      }
      return;
    }
    if(await this.store.acceptProgress(id,run)){
      if(!['running','submitting'].includes(run.status))void this.attention.cancel(id);
      this.changed();this.queueScheduledAnswer(id,run);
    }
  }
  async pull(id:string) {
    await this.runBuffer?.flush(id);
    const s=await this.store.session(id);const document:ProfileDocument=await this.command(id,'READ_PROFILE');validateProfile(document.profile);
    if(s.profile&&!s.synced&&s.managerDraft!==false&&!isDeepStrictEqual(s.profile,document.profile)){s.conflict=document;await this.store.saveSession(s);this.changed();return s;}
    await this.importDocument(id,document);return await this.store.session(id);
  }
  async importDocument(id:string,document:ProfileDocument){
    for(const a of Object.values(document.profile.attachments)){if(!a)continue;const info=await this.command(id,'ATTACHMENT_INFO',{id:a.id});if(info.size!==a.size)throw new Error('Dung lượng ảnh khác hồ sơ.');let chunks:Buffer[]=[];for(let offset=0;offset<a.size;offset+=CHUNK_BYTES){const part=await this.command(id,'ATTACHMENT_READ',{id:a.id,offset,length:CHUNK_BYTES});chunks.push(Buffer.from(part.base64,'base64'));}await this.store.saveAttachment(id,a.id,Buffer.concat(chunks),info.hash);}
    const current:ProfileDocument=await this.command(id,'READ_PROFILE');if(current.revision!==document.revision)throw new Error('Hồ sơ đã thay đổi trong lúc đọc; hãy đọc lại.');
    const s=await this.store.session(id);s.profile=document.profile;s.revision=document.revision;s.synced=true;s.managerDraft=undefined;s.conflict=undefined;s.error=undefined;await this.store.saveSession(s);this.changed();
  }
  async push(id:string,force=false){
    await this.runBuffer?.flush(id);
    const s=await this.store.session(id);if(!s.profile)throw new Error('Chưa có hồ sơ.');const current:ProfileDocument=await this.command(id,'READ_PROFILE');
    if(current.revision!==s.revision&&!force){s.conflict=current;await this.store.saveSession(s);this.changed();throw new Error('Extension đã thay đổi; hãy chọn bản cần giữ.');}
    for(const a of Object.values(s.profile.attachments)){if(!a)continue;const bytes=await this.store.attachment(id,a.id);const info=await this.command(id,'ATTACHMENT_INFO',{id:a.id}).catch(()=>undefined);if(info?.hash===bytes.hash)continue;const transferId=randomUUID();await this.command(id,'ATTACHMENT_BEGIN',{transferId,attachment:a,hash:bytes.hash});for(let offset=0;offset<bytes.data.length;offset+=CHUNK_BYTES)await this.command(id,'ATTACHMENT_CHUNK',{transferId,index:offset/CHUNK_BYTES,base64:bytes.data.subarray(offset,offset+CHUNK_BYTES).toString('base64')});await this.command(id,'ATTACHMENT_FINISH',{transferId});}
    const result=await this.command(id,'COMMIT_PROFILE',{profile:s.profile,baseRevision:current.revision});s.revision=result.revision;s.synced=true;s.managerDraft=undefined;s.conflict=undefined;s.error=undefined;await this.store.saveSession(s);this.changed();return s;
  }
  async edit(id:string,values:Partial<Omit<SessionView,'hskLevel'>>&{hskLevel?:HskLevel|null}){await this.runBuffer?.flush(id);const s=await this.store.session(id);if(values.hskLevel!==undefined){if(values.hskLevel===null)delete s.hskLevel;else{if(!isHskLevel(values.hskLevel))throw new Error('HSK phải từ 1 đến 6.');s.hskLevel=values.hskLevel;}}if(values.name!==undefined)s.name=String(values.name).slice(0,100);if(values.expectedEmail!==undefined)s.expectedEmail=String(values.expectedEmail).trim().toLowerCase();if(values.profile!==undefined){validateProfile(values.profile);s.profile=values.profile;s.synced=false;s.managerDraft=true;}await this.store.saveSession(s);this.changed();return s;}
  async assignHsk(ids:string[],level:unknown){if(!Array.isArray(ids)||!ids.length||ids.length>100||new Set(ids).size!==ids.length||level!==null&&!isHskLevel(level))throw new Error('Chọn profile và cấp độ HSK hợp lệ.');return Promise.all(ids.map(async id=>{try{await this.edit(id,{hskLevel:level});return {id,ok:true};}catch(e){return {id,ok:false,error:(e as Error).message};}}));}
  async stopScheduledRuns(expectedId?:string){
    const schedule=await this.scheduler.cancel(expectedId);if(!schedule)return [];
    await this.scheduler.settleLaunches();
    return Promise.all(schedule.members.map(async m=>{try{
      const s=await this.store.session(m.id),g=this.store.groupForRequest?await this.store.groupForRequest(m.requestId):undefined;
      if(!s.run?.runId||s.run.runId!==(m.runId??g?.id))return {id:m.id,ok:true,skipped:true};
      await this.control(m.id,'STOP',s.run.runId);return {id:m.id,ok:true};
    }catch(e){return {id:m.id,ok:false,error:(e as Error).message};}}));
  }
  async scheduledControl(expectedId:string,kind:'PAUSE'|'RESUME'){
    if(typeof expectedId!=='string'||!expectedId)throw new Error('Thiếu mã lịch cần điều khiển.');this.scheduler.assertSchedule(expectedId);if(!this.scheduler.value)throw new Error('Chưa có lịch.');
    if(kind==='PAUSE')await this.scheduler.setPaused(true,expectedId);
    await this.scheduler.settleLaunches();
    const schedule=this.scheduler.value;
    if(!schedule||schedule.id!==expectedId||['cancelled','expired'].includes(schedule.status)||!schedule.pausedAt)return [];
    const groups=await Promise.all(schedule.members.map(async m=>m.runId??(await this.store.groupForRequest?.(m.requestId))?.id));
    const results=await Promise.all([...new Set(groups.filter((id):id is string=>!!id))].map(id=>this.groupControl(id,kind)));
    if(kind==='RESUME'&&this.scheduler.value===schedule&&!['cancelled','expired'].includes(schedule.status)){
      await this.scheduler.setPaused(false,expectedId);for(const m of schedule.members){const session=await this.store.session(m.id);if(session.run&&session.run.runId===m.runId)this.queueScheduledAnswer(m.id,session.run);}void this.scheduler.tick().catch(this.unavailable);
    }
    return results.flat();
  }
  private answering=new Set<string>();
  private answerAttempts=new Map<string,string>();
  private queueScheduledAnswer(id:string,run:RunState){
    const s=this.scheduler.value,m=s?.members.find(m=>m.id===id&&m.runId===run.runId);
    const configured=m&&(s?.finalQuestions?.[m.level]??(s?.rehearsal?s.rehearsalAnswer:undefined));
    const q=configured&&bindHskAnswer(configured,run);
    if(!m||m.status!=='started'||!s||!!s.pausedAt||['cancelled','expired'].includes(s.status)||!q||run.status!=='waiting_manual'||run.blockingIssue?.reason!=='verification'||!canApplyFinalQuestion(run,q)||this.answering.has(id))return;
    const key=JSON.stringify([run.runId,run.blockingIssue.questionLabel,q]);if(this.answerAttempts.get(id)===key)return;
    this.answerAttempts.set(id,key);this.answering.add(id);
    // Do not block the extension's STATE/command queue on its own SET response.
    void this.setFinalQuestion([id],q,true,run.runId).then(results=>this.scheduler.answerResult(id,run.runId!,results[0]?.ok||results[0]?.skipped?undefined:results[0]?.error)).finally(()=>this.answering.delete(id)).catch(this.unavailable);
  }
  async scanVerification(id:string){
    const s=await this.store.session(id);if(!this.peers.has(id))throw new Error('Profile chưa kết nối. Mở Chrome profile rồi lấy lại câu xác thực.');
    let result:any;
    try{result=await this.command(id,'SCAN_FORM',{verificationOnly:true},s.run?.runId,2000);}catch(e){if((e as Error).message.includes('chưa xác nhận SCAN_FORM'))throw new Error('Không lấy được câu xác thực trong 2 giây. Kiểm tra profile và bấm Lấy câu xác thực để thử lại.');throw e;}
    await this.runBuffer?.flush(id);const current=await this.store.session(id);
    if(current.run?.runId!==s.run?.runId||result.runId&&result.runId!==s.run?.runId)throw new Error('Lượt đã thay đổi trong lúc đọc. Bấm lấy lại câu xác thực.');
    if(current.run?.formId&&result.formId!==current.run.formId)throw new Error('Câu hỏi đọc được thuộc form khác. Kiểm tra lại profile.');
    const candidates=(Array.isArray(result.questions)?result.questions:[]).filter((q:FormQuestionSummary)=>q.verification&&q.kind!=='file'&&q.kind!=='unknown') as FormQuestionSummary[];
    // Repair an incomplete blocker only from the exact current form's readable verification.
    if(current.run?.status==='waiting_manual'&&current.run.blockingIssue?.reason==='verification'&&!current.run.blockingIssue.questionLabel&&candidates.length===1){
      const q=candidates[0];current.run.blockingIssue={...current.run.blockingIssue,questionId:q.id,questionLabel:q.label,question:q};
      await this.store.saveRun(id,current.run);await this.store.saveSession(current);this.runBuffer?.refresh(id,current);this.changed();this.queueScheduledAnswer(id,current.run);
    }
    return result;
  }
  async scheduledAnswer(level:unknown,question:unknown){
    const s=await this.scheduler.answer(level,question);
    if(question)for(const m of s.members.filter(m=>level==='test'&&s.rehearsal||m.level===level)){this.answerAttempts.delete(m.id);const session=await this.store.session(m.id);if(session.run)this.queueScheduledAnswer(m.id,session.run);}
    return s;
  }
  async setFinalQuestion(ids:string[],finalQuestion:FinalQuestion,resume=false,expectedRunId?:string){
    validateFinalQuestion(finalQuestion);
    finalQuestion=finalQuestion?structuredClone(finalQuestion):finalQuestion;
    if(!finalQuestion||!Array.isArray(ids)||!ids.length||ids.length>100||new Set(ids).size!==ids.length)throw new Error('Chọn profile và nhập câu hỏi cuối.');
    return Promise.all(ids.map(async id=>{
      let updated=false;const intent=this.intents.get(id)??0;
      try{
        // Flush/read/check each member independently. A running, offline or
        // failed member must not hold up another member's SET + RESUME.
        await this.runBuffer?.flush(id);
        const before=await this.store.session(id);
        if(expectedRunId&&before.run?.runId!==expectedRunId)return {id,ok:false,skipped:true,error:'Lượt đã thay đổi.'};
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
        if(resume){if((this.intents.get(id)??0)!==intent||expectedRunId&&['cancelled','expired'].includes(this.scheduler.value?.status??''))throw new Error('Đã dừng; không tự tiếp tục.');await this.control(id,'RESUME',runId);}
        return {id,ok:true};
      }catch(e){return {id,ok:false,error:updated?`Đã cập nhật đáp án nhưng chưa tiếp tục được: ${(e as Error).message}`:(e as Error).message};}
    }));
  }
  async restart(id:string,expectedRunId?:string,requestId?:string){
    if(requestId!==undefined&&(typeof requestId!=='string'||!/^[-a-zA-Z0-9]{8,100}$/.test(requestId)))throw new Error('Mã yêu cầu không hợp lệ.');
    if(this.restarts.has(id))return this.restarts.get(id)!;
    const work=(async()=>{
      if(requestId){const old=(this.store.groupForRequest?await this.store.groupForRequest(requestId):(await this.store.groups()).find(g=>g.requestId===requestId));if(old){if(old.members.length!==1||old.members[0]!==id||expectedRunId&&old.restartOf!==expectedRunId)throw new Error('Mã yêu cầu đã dùng cho thao tác khác.');return old;}}
      await this.runBuffer?.flush(id);const s=await this.store.session(id);
      if(expectedRunId&&s.run?.runId!==expectedRunId)throw new Error('Lượt đã thay đổi. Đọc lại trạng thái trước khi chạy lại.');
      if(!s.run?.runId||!s.run.url||!allowedFormUrl(s.run.url))throw new Error('Chưa có link của lượt cũ. Nhập link rồi Bắt đầu.');
      if(s.run.submitAttempted||await this.store.blocked(id,s.run.formId||canonicalFormId(s.run.url)||''))throw new Error('Lượt đã có khóa gửi. Xác minh kết quả trước khi chạy lại.');
      if(!this.peers.has(id)||s.conflict)throw new Error(s.conflict?'Giải quyết xung đột hồ sơ trước khi chạy lại.':'Profile chưa kết nối.');
      const stopping=this.control(id,'STOP',s.run.runId),intent=this.intents.get(id);await stopping;
      const stopped=await this.store.session(id);
      if(stopped.run?.runId!==s.run.runId||stopped.run?.status!=='idle'||stopped.execution)throw new Error('Chưa xác nhận profile đã dừng. Đối chiếu trạng thái trước khi chạy lại.');
      if(!stopped.synced){const imported=await this.pull(id);if(imported.conflict)throw new Error('Hồ sơ đã thay đổi. Chọn bản cần giữ trước khi chạy lại.');}
      if(this.intents.get(id)!==intent)throw new Error('Đã hủy Chạy lại vì có lệnh Dừng hoặc Tạm dừng mới.');
      return this.start([id],s.run.url,s.run.mode,s.run.finalQuestion,requestId,s.run.runId);
    })();
    this.restarts.set(id,work);try{return await work;}finally{if(this.restarts.get(id)===work)this.restarts.delete(id);}
  }
  async start(ids:string[],url:string,mode:RunMode,finalQuestion?:FinalQuestion,requestId?:string,restartOf?:string,guard?:()=>boolean){
    if(guard&&!guard())throw new Error('Lịch đã hủy hoặc profile đã bỏ chờ.');
    if(requestId!==undefined&&(typeof requestId!=='string'||!/^[-a-zA-Z0-9]{8,100}$/.test(requestId)))throw new Error('Mã yêu cầu không hợp lệ.');
    const intents=new Map((Array.isArray(ids)?ids:[]).map(id=>[id,this.intents.get(id)??0]));
    const signature=createHash('sha256').update(JSON.stringify({ids:Array.isArray(ids)?[...ids].sort():ids,url,mode,finalQuestion})).digest('hex');
    if(requestId){
      const old=(this.store.groupForRequest?await this.store.groupForRequest(requestId):(await this.store.groups()).find(g=>g.requestId===requestId));
      if(old){if(old.requestSignature!==signature)throw new Error('Mã yêu cầu đã dùng cho thao tác khác.');return old;}
      const pending=this.starts.get(requestId);if(pending){const g=await pending;if(g.requestSignature!==signature)throw new Error('Mã yêu cầu đã dùng cho thao tác khác.');return g;}
    }
    const work=this.startGroup(ids,url,mode,finalQuestion,requestId,signature,restartOf,intents,guard);
    if(requestId)this.starts.set(requestId,work);
    try{return await work;}finally{if(requestId&&this.starts.get(requestId)===work)this.starts.delete(requestId);}
  }
  private async startGroup(ids:string[],url:string,mode:RunMode,finalQuestion:FinalQuestion|undefined,requestId:string|undefined,requestSignature:string,restartOf:string|undefined,intents:Map<string,number>,guard?:()=>boolean){
    validateFinalQuestion(finalQuestion);
    finalQuestion=finalQuestion?structuredClone(finalQuestion):undefined;
    if(finalQuestion?.formId&&canonicalFormId(url)&&finalQuestion.formId!==canonicalFormId(url))throw new Error('Câu hỏi cuối đã chọn thuộc form khác. Đọc lại câu hỏi hoặc nhập nội dung cho form này.');
    if(!allowedFormUrl(url)||!['test','live'].includes(mode))throw new Error('Link Google Forms hoặc chế độ không hợp lệ.');if(!Array.isArray(ids)||!ids.length||ids.length>100||new Set(ids).size!==ids.length)throw new Error('Chọn các profile khác nhau.');
    const id=randomUUID();const group={id,url,mode,members:ids,paused:false,createdAt:new Date().toISOString(),requestId,requestSignature,restartOf};
    // Persist the group gate before preparation. Each member then crosses its
    // own fenced transaction and dispatches immediately, without a batch barrier.
    await this.store.beginGroup(group,[]);this.changed();
    const failed=async(session:string,error:unknown,undispatched=false)=>{
      if(this.runBuffer?.matches(session,id))this.runBuffer.halt(session);await this.runBuffer?.flush(session);
      const current=await this.store.session(session);
      if(current.run?.runId!==id||!['running','submitting'].includes(current.run.status)||!undispatched&&(await this.store.group(id)).paused&&!current.run.submitAttempted)return;
      current.error=undispatched?undefined:(error as Error).message;current.run.status=current.run.submitAttempted?'submit_uncertain':undispatched?'idle':'failed';
      await this.store.saveRun(session,current.run);await this.store.saveSession(current);this.runBuffer?.refresh(session,current);this.changed();
    };
    const results=await Promise.all(ids.map(member=>(async()=>{
      try{
        await this.runBuffer?.flush(member);
        if(finalQuestion){const result=await this.command(member,'PING',{},undefined,5000);if(!result?.capabilities?.includes('sharedFinalQuestion'))throw new Error('Reload hoặc cập nhật extension để dùng đáp án câu hỏi cuối chung.');if(result.execution)throw new Error('Còn lượt giữ profile. Bấm Xem form hoặc Dừng trên hàng profile.');}
        const s=await this.store.session(member);
        if(!this.peers.has(member)||!s.synced||!s.profile||s.conflict||!/^\S+@\S+\.\S+$/.test(s.expectedEmail))throw new Error('Cần kết nối, đồng bộ và gán email Google.');
        const form=canonicalFormId(url);
        if(form&&await this.store.blocked(member,form)||!form&&s.run?.submitAttempted&&s.run.status!=='idle')throw new Error('Xác minh khóa gửi trước khi chạy form này.');
        if(s.execution)throw new Error('Còn lượt giữ profile. Bấm Xem form hoặc Dừng trên hàng profile.');
        if(s.run&&!['idle','completed','ready_to_submit','failed'].includes(s.run.status)&&!canStartSeparateTest(s.run,url,mode))throw new Error('Hãy dừng lượt hiện tại hoặc xác minh kết quả trước.');
        const hashes:Record<string,string>={};
        await Promise.all(Object.values(s.profile.attachments).filter(a=>!!a).map(async a=>{const info=await this.store.attachmentInfo(member,a.id);if(info.size!==a.size)throw new Error('Dung lượng ảnh không khớp hồ sơ.');hashes[a.id]=info.hash;}));
        if((this.intents.get(member)??0)!==intents.get(member)||guard&&!guard())throw new Error('Đã hủy Bắt đầu vì lịch đã hủy hoặc có lệnh Dừng/Tạm dừng mới.');
        s.run={runId:id,sessionId:member,managed:true,profileSnapshot:s.profile,autoContinue:true,retryOnReturn:true,finalQuestion:finalQuestion?structuredClone(finalQuestion):undefined,profileRevision:s.revision,expectedEmail:s.expectedEmail,tabId:-1,formId:'',url,mode,status:'running',filled:[],skipped:[],logs:[],submitAttempted:false,updatedAt:group.createdAt,startedAt:group.createdAt,eventSeq:0};s.error=undefined;
        await this.store.beginGroup(group,[s],true);this.runBuffer?.begin([s],group);this.changed();
        const gate=await this.store.group(id);this.runBuffer?.groupGate(gate);
        if((this.intents.get(member)??0)!==intents.get(member)||gate.paused||guard&&!guard()){await failed(member,new Error('Đã hủy trước khi mở form vì có lệnh Dừng mới.'),true);return {id:member,ok:false,error:'Đã dừng trước khi mở form.'};}
        if(this.runBuffer?.has(member)&&!this.runBuffer.allowed(member,id))return {id:member,ok:false,error:'Lượt đã dừng.'};
        void this.command(member,'START',{url,mode,finalQuestion,revision:s.revision,expectedEmail:s.expectedEmail,attachmentHashes:hashes},id,120000).catch(error=>failed(member,error)).catch(this.unavailable);
        return {id:member,ok:true};
      }catch(error){await failed(member,error).catch(this.unavailable);return {id:member,ok:false,error:(error as Error).message};}
    })().then(async result=>{await this.store.recordStartResult(id,result);this.changed();return result;})));
    if(results.length===1&&!results[0].ok)throw new Error(results[0].error);
    return {...await this.store.group(id),startResults:results};
  }
  private async retryReturnedForm(id:string,runId:string,epoch:string,retries:number){
    const intent=this.intents.get(id)??0;
    await this.runBuffer?.flush(id);
    if(!this.store.authorizeReturnedRetry)throw new Error('Server chưa hỗ trợ thử lại trên form khôi phục.');
    await this.store.authorizeReturnedRetry(id,runId,epoch,retries);
    if((this.intents.get(id)??0)!==intent)throw new Error('Có lệnh Dừng mới; hủy thử lại.');
    const s=await this.store.session(id);this.runBuffer?.refresh(id,s);
    return this.control(id,'RESUME',runId,'returned_submit');
  }
  async control(id:string,kind:'PAUSE'|'STOP'|'RESUME',expectedRunId?:string,automatic:boolean|'recovery'|'page_ready'|'returned_submit'|'reconnect'=false) {
    if(kind!=='RESUME'&&!automatic)this.scheduler.hold(id);
    if(kind!=='RESUME')this.intents.set(id,(this.intents.get(id)??0)+1);
    const key=JSON.stringify([id,kind,expectedRunId,automatic]);const pending=this.controls.get(key);if(pending)return pending;
    const work=this.controlOne(id,kind,expectedRunId,automatic);this.controls.set(key,work);
    try{return await work;}finally{if(this.controls.get(key)===work)this.controls.delete(key);}
  }
  private async controlOne(id:string,kind:'PAUSE'|'STOP'|'RESUME',expectedRunId?:string,automatic:boolean|'recovery'|'page_ready'|'returned_submit'|'reconnect'=false) {
    const intent=this.intents.get(id)??0;
    if(expectedRunId&&this.runBuffer?.has(id)&&!this.runBuffer.matches(id,expectedRunId))throw new Error('Lệnh thuộc lượt cũ.');
    if(kind!=='RESUME')this.runBuffer?.halt(id);
    await this.runBuffer?.flush(id);
    const s=await this.store.session(id);if(expectedRunId&&s.run?.runId!==expectedRunId)throw new Error('Lệnh thuộc lượt cũ.');
    if(automatic==='reconnect'&&(!expectedRunId||s.run?.status!=='paused'||!s.run.transportRecovery||s.run.autoContinue===false||s.run.submitAttempted))throw new Error('Lượt không còn chờ nối lại kết nối.');
    if(automatic==='recovery'&&(!expectedRunId||!automaticRecoveryAllowed(s.run)))throw new Error('Lượt không còn chờ phục hồi hoặc chưa tới thời điểm thử lại.');
    if((automatic==='page_ready'||automatic==='returned_submit')&&(!expectedRunId||!pageReadyResumeAllowed(s.run)))throw new Error('Form không còn chờ tự tiếp tục.');
    if(automatic===true&&(!expectedRunId||s.run?.status!=='waiting_manual'||s.run.recoveryRequired||!['validation','unknown_required','file_upload','unsupported'].includes(s.run.blockingIssue?.reason??'')))throw new Error('Lượt không chờ sửa dữ liệu; không tự tiếp tục.');
    if(kind!=='RESUME')await this.attention.cancel(id);
    if(kind==='STOP'){
      const result=await this.command(id,'STOP_PROFILE',{},s.run?.runId);
      if(this.store.acknowledgeStop){await this.runBuffer?.flush(id);const current=await this.store.acknowledgeStop(id,s.run?.runId,result);this.runBuffer?.refresh(id,current);this.changed();return result;}
      const current=await this.store.session(id);
      if(current.run?.runId===s.run?.runId){if(current.run){current.run.autoContinue=false;current.run.status=current.run.submitAttempted?'submit_uncertain':'idle';current.run.blockingIssue=current.run.submitAttempted?current.run.blockingIssue:undefined;current.run.eventSeq=Math.max(current.run.eventSeq??0,result?.run?.runId===current.run.runId?(result.run.eventSeq??0):0);current.run.updatedAt=new Date().toISOString();current.run.logs.push({at:current.run.updatedAt,level:'info',message:'Đã dừng mọi lượt trong profile. Có thể bắt đầu lượt mới khi chưa khóa gửi.'});await this.store.saveRun(id,current.run);}current.error=undefined;current.execution=result?.execution??null;await this.store.saveSession(current);this.changed();}
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
    try{
      if(kind==='RESUME')await this.store.authorizeResume?.(id);
      if(kind==='RESUME'&&(this.intents.get(id)??0)!==intent)throw new Error('Có lệnh Dừng mới; hủy Tiếp tục.');
      const payload:Record<string,unknown>=automatic==='reconnect'?{reconnect:true}:automatic==='recovery'?{recovery:true}:automatic?{automatic:true}:{};
      if(kind==='RESUME'&&(automatic==='returned_submit'||s.run.pendingReturnedRetry))payload.retryReturned={epoch:s.run.contentEpoch,retries:s.run.submissionRetries};
      result=await this.command(id,kind,payload,s.run.runId,kind==='RESUME'?90000:45000);
      if(kind==='RESUME'&&(this.intents.get(id)??0)!==intent)throw new Error('Có lệnh Dừng mới; bỏ phản hồi Tiếp tục cũ.');
    }catch(error){
      this.runBuffer?.halt(id);
      if(kind==='RESUME'&&this.store.cancelResume){await this.store.cancelResume(id,s.run.runId);this.runBuffer?.refresh(id,await this.store.session(id));}
      throw error;
    }
    // Persist the acknowledged state even when its separate STATE message is late.
    if(result?.runId===s.run.runId)await this.acceptState(id,result);
    if(kind==='RESUME'){
      const terminal=this.runBuffer?.finishResume(id);
      if(terminal)await this.acceptState(id,terminal);
    }
    return result;
  }
  async groupControl(id:string,kind:'PAUSE'|'STOP'|'RESUME'){if(kind!=='RESUME')this.runBuffer?.haltGroup(id);const g=await this.store.group(id);g.paused=kind!=='RESUME';if(kind==='STOP')g.stopped=true;else if(kind==='RESUME')g.stopped=false;if(kind!=='RESUME')this.runBuffer?.groupGate(g);await this.store.saveGroup(g);this.runBuffer?.groupGate(g);this.changed();return Promise.all(g.members.map(async member=>{await this.runBuffer?.flush(member);const s=await this.store.session(member);if(s.run?.runId!==id||s.run.status==='completed'||kind==='RESUME'&&s.run.submitAttempted)return {member,skipped:true};try{await this.control(member,kind,id);return {member,ok:true};}catch(e){const current=await this.store.session(member);if(current.run?.runId===id){current.error=(e as Error).message;await this.store.saveSession(current);this.changed();}return {member,ok:false,error:(e as Error).message};}}));}
  async failure(id:string,runId:string){
    if((await this.store.session(id)).run?.runId!==runId)return;
    const failures=this.failures.get(runId)??new Map<string,number>(),now=Date.now();
    for(const [member,at]of failures)if(now-at>30000)failures.delete(member);
    failures.set(id,now);this.failures.set(runId,failures);
    await this.store.audit(id,runId,'load_failure',`Lỗi tải ở ${failures.size} profile trong 30 giây. Profile lỗi phục hồi có giới hạn; các profile khác giữ nguyên.`);
  }
  async resolve(id:string,result:'received'|'not_received'){await this.runBuffer?.flush(id);const s=await this.store.session(id);await this.command(id,'RESOLVE_SUBMISSION',{result},s.run?.runId);await this.runBuffer?.flush(id);await this.store.resolve(id,s.run!.runId!,result);this.runBuffer?.forget(id);this.changed();}
}
