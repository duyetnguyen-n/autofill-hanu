import {randomUUID} from 'node:crypto';
import type {SessionView,GroupView} from '../../src/protocol';
import {validateFinalQuestion} from '../../src/shared';
import {activeSchedule,facebookPostKey,formLink,isHskLevel,parseHskLinks,parseTestForm,registrationDateError,type HskLevel,type RegistrationSchedule} from '../../src/registration-schedule';

interface Hooks {
  load():Promise<RegistrationSchedule|undefined>;save(s:RegistrationSchedule):Promise<void>;
  sessions():Promise<SessionView[]>;connected(id:string):boolean;
  command(id:string,kind:'PING'|'WATCH_FACEBOOK',payload:Record<string,unknown>):Promise<any>;
  prepare(id:string):Promise<void>;
  start(id:string,url:string,s:RegistrationSchedule,valid:()=>boolean):Promise<GroupView>;
  changed():void;error(e:unknown):void;
}
/** Durable intent lives on the coordinator; no management-page timers. */
export class RegistrationScheduler {
  value?:RegistrationSchedule;
  private loaded=false;private queue=Promise.resolve();private timer?:ReturnType<typeof setInterval>;
  private preparing=new Set<string>();private prepared=new Map<string,number>();private launching=new Set<string>();
  private prepareAttempt=new Map<string,number>();
  private watcherBusy=false;private watcherSent=0;private watcherFailures=new Set<string>();
  private cancelledId?:string;private closed=false;private cancelling=false;
  constructor(private hooks:Hooks,private now=()=>Date.now()){}
  private exclusive<T>(work:()=>Promise<T>):Promise<T>{const p=this.queue.then(async()=>{if(!this.loaded){this.value=await this.hooks.load();this.loaded=true;if(this.value)this.hooks.changed();}return work();});this.queue=p.then(()=>{},()=>{});return p;}
  private async persist(){if(!this.value)return;this.value.updatedAt=new Date(this.now()).toISOString();await this.hooks.save(structuredClone(this.value));this.hooks.changed();}
  open(){this.closed=false;if(this.timer)return;this.timer=setInterval(()=>void this.tick().catch(this.hooks.error),200);this.timer.unref();void this.tick().catch(this.hooks.error);}
  close(){this.closed=true;clearInterval(this.timer);this.timer=undefined;this.watcherSent=0;}
  get active(){return !this.closed&&!this.cancelling&&this.value?.id!==this.cancelledId&&activeSchedule(this.value);}
  async arm(input:any){return this.exclusive(async()=>{
    if(this.active)throw new Error('Hủy lịch đang chờ trước khi đặt lịch khác.');
    const at=Date.parse(input.startsAt),now=this.now();
    if(!Number.isFinite(at)||at<now-30000||at>now+31*86400000)throw new Error('Chọn giờ chạy trong 31 ngày tới (giờ Việt Nam).');
    if(!facebookPostKey(String(input.postUrl??'')))throw new Error('Dùng link trực tiếp story.php hoặc /posts/ của đúng bài Facebook.');
    if(!['test','live'].includes(input.mode)||!Array.isArray(input.ids)||!input.ids.length||input.ids.length>100||new Set(input.ids).size!==input.ids.length)throw new Error('Chọn các profile và chế độ chạy hợp lệ.');
    validateFinalQuestion(input.finalQuestion);
    if(input.rehearsal!==undefined&&typeof input.rehearsal!=='boolean'||input.rehearsal&&input.mode!=='test')throw new Error('Diễn tập chỉ dùng chế độ Test, luôn dừng trước Gửi.');
    if(input.links!==undefined&&(!input.links||typeof input.links!=='object'||Array.isArray(input.links)))throw new Error('Bảng link HSK không hợp lệ.');
    for(const [level,url]of Object.entries(input.links??{}))if(!isHskLevel(level)||typeof url!=='string'||url.trim()&&!formLink(url.trim()))throw new Error(`Link HSK ${level} không hợp lệ.`);
    const sessions=await this.hooks.sessions();
    if(input.watcherProfileId!==undefined&&(typeof input.watcherProfileId!=='string'||!sessions.some(s=>s.id===input.watcherProfileId&&s.linked!==false)))throw new Error('Profile đọc Facebook không thuộc tài khoản hoặc không còn liên kết.');
    const members=input.ids.map((id:string)=>{
      const s=sessions.find(s=>s.id===id);if(!s||s.linked===false)throw new Error('Profile không còn liên kết.');
      if(!isHskLevel(s.hskLevel))throw new Error(`${s.name} chưa khai báo HSK. Chọn các profile cùng cấp độ rồi dùng Gán HSK.`);
      return {id,level:s.hskLevel,status:'waiting' as const,requestId:randomUUID()};
    });
    this.cancelling=false;this.cancelledId=undefined;this.prepared.clear();this.watcherFailures.clear();this.watcherSent=0;
    const previous=this.value;
    this.value={id:randomUUID(),postUrl:input.postUrl,startsAt:new Date(at).toISOString(),prepareAt:new Date(at-300000).toISOString(),watchAt:new Date(at-30000).toISOString(),expiresAt:new Date(at+120000).toISOString(),mode:input.mode,rehearsal:input.rehearsal===true,watcherProfileId:input.watcherProfileId,status:'armed',members,links:{},finalQuestion:input.finalQuestion,createdAt:new Date(now).toISOString(),updatedAt:new Date(now).toISOString()};
    for(const [key,url]of Object.entries(input.links??{}))if(url)this.setManual(key,url);
    try{await this.persist();}catch(e){this.value=previous;throw e;}return structuredClone(this.value);
  });}
  private setManual(level:unknown,value:unknown){
    if(!this.value||!isHskLevel(level)||typeof value!=='string')throw new Error('Link HSK không hợp lệ.');
    const url=value.trim()?formLink(value.trim()):undefined;if(value.trim()&&!url)throw new Error(`HSK ${level}: cần link Google Forms hợp lệ.`);
    if(url)this.value.links[level]={url,source:'manual',observedAt:new Date(this.now()).toISOString()};else delete this.value.links[level];
  }
  async manual(level:unknown,url:unknown){const result=await this.exclusive(async()=>{if(!this.active)throw new Error('Chưa có lịch đang chờ.');this.setManual(level,url);await this.persist();return structuredClone(this.value);});void this.tick().catch(this.hooks.error);return result;}
  async cancel(){this.cancelling=true;this.cancelledId=this.value?.id;return this.exclusive(async()=>{if(!this.value)return;this.value.status='cancelled';await this.persist();void this.stopWatcher();return structuredClone(this.value);});}
  async focusWatcher(){
    const s=this.value,w=s?.watcher;
    if(!this.active||!s||!w?.ready||!this.hooks.connected(w.id))throw new Error('Chưa có cửa sổ Facebook đang theo dõi. Kiểm tra quyền Facebook ở extension.');
    return this.hooks.command(w.id,'WATCH_FACEBOOK',{focus:true,token:w.token,scheduleId:s.id});
  }
  hold(id:string){const s=this.value,m=s?.members.find(m=>m.id===id);if(!s||!this.active||!m||!['waiting','starting'].includes(m.status))return;
    // Synchronous fence: a pending durable START also observes this before send.
    m.status='held';m.error='Đã bỏ chờ theo lệnh Dừng/Tạm dừng của profile.';void this.exclusive(()=>this.persist()).catch(this.hooks.error);
  }
  private async stopWatcher(){const w=this.value?.watcher;if(w&&this.hooks.connected(w.id))await this.hooks.command(w.id,'WATCH_FACEBOOK',{stop:true,token:w.token}).catch(()=>{});}
  async observe(id:string,payload:any){
    await this.exclusive(async()=>{
      const s=this.value,w=s?.watcher;if(!s||!this.active||!w||id!==w.id||payload.token!==w.token||payload.scheduleId!==s.id)throw new Error('Thông báo thuộc lịch/profile theo dõi cũ.');
      if(typeof payload.text!=='string'||payload.text.length>120000||payload.postKey!==facebookPostKey(s.postUrl))throw new Error('Nội dung không thuộc bài được theo dõi.');
      const at=new Date(this.now()).toISOString();s.lastObservedAt=at;
      s.dateWarning=payload.error?undefined:registrationDateError(payload.text,s.startsAt);
      s.lastError=payload.error?String(payload.error).slice(0,300):s.rehearsal?undefined:s.dateWarning;
      if(!payload.error){
        s.lastReadAt=at;
        const found=parseHskLinks(payload.text,s.rehearsal||s.dateWarning?undefined:s.startsAt),sample=parseTestForm(payload.text);
        s.testForm=sample?{...sample,source:'facebook',observedAt:at}:undefined;
        // A newer observation replaces automatic entries, including conflicts
        // and removed links. Explicit manual entries always win.
        for(const level of ['1','2','3','4','5','6'] as HskLevel[]){if(s.links[level]?.source==='manual')continue;const next=found[level];if(next)s.links[level]={...next,error:next.error??(!s.rehearsal?s.dateWarning:undefined),source:'facebook',observedAt:at};else delete s.links[level];}
        if(s.rehearsal&&!s.testForm?.url)s.lastError=s.testForm?.error??'Chưa thấy link được ghi rõ là form thử trong bài. Không mở form đăng ký thật.';
      }
      await this.persist();
    });
    void this.tick().catch(this.hooks.error);return {accepted:true};
  }
  private prepare(s:RegistrationSchedule,session:SessionView){
    const key=`${s.id}:${session.id}`,attempt=`${key}:${session.revision}`;
    if(this.preparing.has(key)||this.prepared.get(key)===session.revision&&session.synced&&!session.conflict&&!session.execution||this.now()-(this.prepareAttempt.get(attempt)??-Infinity)<5000)return;
    this.prepared.delete(key);this.prepareAttempt.set(attempt,this.now());
    this.preparing.add(key);
    void this.hooks.prepare(session.id).then(()=>this.exclusive(async()=>{
      if(this.value?.id!==s.id)return;this.prepared.set(key,session.revision);
      const m=s.members.find(m=>m.id===session.id);if(m?.status==='waiting'&&m.error){delete m.error;await this.persist();}
    })).catch(e=>this.exclusive(async()=>{if(this.value?.id===s.id){const m=s.members.find(m=>m.id===session.id);if(m?.status==='waiting')m.error=(e as Error).message;await this.persist();}})).finally(()=>this.preparing.delete(key)).catch(this.hooks.error);
  }
  private watch(s:RegistrationSchedule,sessions:SessionView[]){
    if(this.watcherBusy||this.now()-this.watcherSent<10000)return;
    let w=s.watcher;
    if(!w||!this.hooks.connected(w.id)||this.watcherFailures.has(w.id)||s.watcherProfileId&&w.id!==s.watcherProfileId){
      if(w&&this.hooks.connected(w.id))void this.hooks.command(w.id,'WATCH_FACEBOOK',{stop:true,token:w.token}).catch(()=>{});
      const next=sessions.find(p=>this.hooks.connected(p.id)&&p.linked!==false&&!this.watcherFailures.has(p.id)&&(!s.watcherProfileId||p.id===s.watcherProfileId));
      if(!next){
        // Back off after trying all peers. Resetting the timestamp to zero on
        // every failure used to cycle through every old/ungranted profile again
        // immediately, producing repeated misleading errors.
        this.watcherSent=this.now();this.watcherFailures.clear();return;
      }
      w=s.watcher={id:next.id,token:randomUUID(),ready:false};
    }
    this.watcherBusy=true;this.watcherSent=this.now();const token=w.token,id=w.id;
    void this.hooks.command(id,'WATCH_FACEBOOK',{scheduleId:s.id,token,postUrl:s.postUrl,watchAt:s.watchAt,expiresAt:s.expiresAt}).then(()=>this.exclusive(async()=>{if(this.value?.id===s.id&&s.watcher?.token===token){const oldError=s.watcher.error;s.watcher.ready=true;s.watcher.error=undefined;if(oldError&&s.lastError?.endsWith(oldError))s.lastError=undefined;await this.persist();}})).catch(e=>this.exclusive(async()=>{if(this.value?.id===s.id&&s.watcher?.token===token){s.watcher.ready=false;s.watcher.error=(e as Error).message;s.lastError=`${sessions.find(p=>p.id===id)?.name??id}: ${(e as Error).message}`;this.watcherFailures.add(id);this.watcherSent=0;await this.persist();}})).finally(()=>{this.watcherBusy=false;}).catch(this.hooks.error);
  }
  tick(){return this.exclusive(async()=>{
    const s=this.value;if(!s||!this.active)return;const now=this.now();
    if(now>=Date.parse(s.expiresAt)){s.status='expired';await this.persist();void this.stopWatcher();return;}
    if(now<Date.parse(s.prepareAt))return;
    const sessions=await this.hooks.sessions();if(!this.active)return;const old=s.status;
    s.status=now<Date.parse(s.watchAt)?'preparing':now<Date.parse(s.startsAt)?'watching':'running';
    if(old!==s.status)await this.persist();
    for(const member of s.members){const session=sessions.find(p=>p.id===member.id);if(member.status==='waiting'&&session&&this.hooks.connected(member.id))this.prepare(s,session);}
    this.watch(s,sessions);
    if(now<Date.parse(s.startsAt))return;
    const dispatch:typeof s.members=[];
    for(const member of s.members){
      if(!['waiting','starting'].includes(member.status)||this.launching.has(member.id))continue;
      const session=sessions.find(p=>p.id===member.id),link=s.links[member.level];
      if(!session||!this.hooks.connected(member.id)||!session.synced||session.conflict||!session.profile||this.prepared.get(`${s.id}:${session.id}`)!==session.revision)continue;
      if(!link?.url||link.error||link.source==='facebook'&&(s.lastError||now-Date.parse(s.lastObservedAt??'')>10000))continue;
      if(s.rehearsal&&(s.mode!=='test'||!s.testForm?.url||s.testForm.error||s.lastError||now-Date.parse(s.testForm.observedAt)>10000))continue;
      // Persist individual intent before dispatch. Slow peers never gate others.
      member.status='starting';member.url??=s.rehearsal?s.testForm!.url!:link.url;member.dispatchedAt??=new Date(now).toISOString();
      dispatch.push(member);
    }
    // One durable write for link routing, then independent STARTs. Do not put
    // ten serial database round trips in front of the tenth profile.
    if(dispatch.length)await this.persist();
    for(const member of dispatch){
      this.launching.add(member.id);
      const valid=()=>this.value?.id===s.id&&this.active&&member.status==='starting'&&this.now()<Date.parse(s.expiresAt);
      void (async()=>{
        if(!valid())return;
        const group=await this.hooks.start(member.id,member.url!,s,valid);
        await this.exclusive(async()=>{if(this.value?.id!==s.id)return;member.runId=group.id;member.status='started';member.error=undefined;await this.persist();});
      })().catch(e=>this.exclusive(async()=>{if(this.value?.id===s.id&&member.status==='starting'){member.status='failed';member.error=(e as Error).message;await this.persist();}})).finally(()=>this.launching.delete(member.id)).catch(this.hooks.error);
    }
    if(s.members.every(m=>['started','failed','held'].includes(m.status))){s.status='finished';await this.persist();void this.stopWatcher();}
  });}
}
