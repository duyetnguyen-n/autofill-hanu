import {randomUUID} from 'node:crypto';
import type {SessionView,GroupView} from '../../src/protocol';
import {validateFinalQuestion} from '../../src/shared';
import {validateHskAnswer,activeSchedule,facebookPostKey,formLink,isHskLevel,parseHskLinks,parseTestForm,registrationDateError,type HskLevel,type RegistrationSchedule} from '../../src/registration-schedule';

interface Hooks {
  load():Promise<RegistrationSchedule|undefined>;save(s:RegistrationSchedule):Promise<void>;
  sessions():Promise<SessionView[]>;connected(id:string):boolean;
  command(id:string,kind:'PING'|'WATCH_FACEBOOK',payload:Record<string,unknown>):Promise<any>;
  prepare(id:string):Promise<number|void>;
  reset?(member:RegistrationSchedule['members'][number]):Promise<void>;
  start(id:string,url:string,s:RegistrationSchedule,valid:()=>boolean):Promise<GroupView>;
  started?(id:string,runId:string):void;
  changed():void;error(e:unknown):void;
}
/** Durable intent lives on the coordinator; no management-page timers. */
export class RegistrationScheduler {
  value?:RegistrationSchedule;
  private loaded=false;private queue=Promise.resolve();private timer?:ReturnType<typeof setInterval>;
  private preparing=new Set<string>();private prepared=new Map<string,number>();private launching=new Set<string>();
  private replacing=false;
  private launches=new Map<string,Promise<unknown>>();
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
    if(this.active||this.replacing||this.value?.pausedAt&&!['cancelled','expired'].includes(this.value.status))throw new Error('Hủy lịch đang chờ trước khi đặt lịch khác.');
    const manualOnly=input.manualOnly===true||input.rehearsal===true&&typeof input.testFormUrl==='string'&&!!input.testFormUrl.trim();
    const now=this.now(),at=manualOnly?now:Date.parse(input.startsAt);
    if(!Number.isFinite(at)||at<now-30000||at>now+31*86400000)throw new Error('Chọn giờ chạy trong 31 ngày tới (giờ Việt Nam).');
    if(!manualOnly&&!facebookPostKey(String(input.postUrl??'')))throw new Error('Dùng link trực tiếp story.php hoặc /posts/ của đúng bài Facebook.');
    if(!['test','live'].includes(input.mode)||!Array.isArray(input.ids)||!input.ids.length||input.ids.length>100||new Set(input.ids).size!==input.ids.length)throw new Error('Chọn các profile và chế độ chạy hợp lệ.');
    validateFinalQuestion(input.finalQuestion);
    if(input.finalQuestions!==undefined&&(!input.finalQuestions||typeof input.finalQuestions!=='object'||Array.isArray(input.finalQuestions)))throw new Error('Đáp án theo HSK không hợp lệ.');
    for(const [level,q]of Object.entries(input.finalQuestions??{})){if(!isHskLevel(level))throw new Error('HSK không hợp lệ.');validateHskAnswer(q);}
    validateHskAnswer(input.rehearsalAnswer);
    if(input.startOnLink!==undefined&&typeof input.startOnLink!=='boolean')throw new Error('Chế độ chạy khi có link không hợp lệ.');
    if(input.rehearsal!==undefined&&typeof input.rehearsal!=='boolean'||input.rehearsal&&input.mode!=='test')throw new Error('Diễn tập chỉ dùng chế độ Test, luôn dừng trước Gửi.');
    if(input.testFormUrl!==undefined&&(typeof input.testFormUrl!=='string'||input.testFormUrl.trim()&&!formLink(input.testFormUrl.trim())))throw new Error('Link form thử không hợp lệ.');
    if(input.rehearsal&&input.manualOnly&&!input.testFormUrl?.trim())throw new Error('Dán link form thử để diễn tập.');
    if(input.links!==undefined&&(!input.links||typeof input.links!=='object'||Array.isArray(input.links)))throw new Error('Bảng link HSK không hợp lệ.');
    for(const [level,url]of Object.entries(input.links??{}))if(!isHskLevel(level)||typeof url!=='string'||url.trim()&&!formLink(url.trim()))throw new Error(`Link HSK ${level} không hợp lệ.`);
    const sessions=await this.hooks.sessions();
    if(input.watcherProfileId!==undefined&&(typeof input.watcherProfileId!=='string'||!sessions.some(s=>s.id===input.watcherProfileId&&s.linked!==false)))throw new Error('Profile đọc Facebook không thuộc tài khoản hoặc không còn liên kết.');
    const members=input.ids.map((id:string)=>{
      const s=sessions.find(s=>s.id===id);if(!s||s.linked===false)throw new Error('Profile không còn liên kết.');
      if(!isHskLevel(s.hskLevel))throw new Error(`${s.name} chưa khai báo HSK. Chọn HSK tại cột HSK trong danh sách profile.`);
      return {id,level:s.hskLevel,status:'waiting' as const,requestId:randomUUID()};
    });
    this.cancelling=false;this.cancelledId=undefined;this.prepared.clear();this.watcherFailures.clear();this.watcherSent=0;
    const previous=this.value;
    this.value={id:randomUUID(),postUrl:manualOnly?'':input.postUrl,manualOnly,startsAt:new Date(at).toISOString(),prepareAt:new Date(at-300000).toISOString(),watchAt:new Date(at-30000).toISOString(),expiresAt:new Date(at+(manualOnly?1800000:120000)).toISOString(),mode:input.mode,startOnLink:true,rehearsal:input.rehearsal===true,testForm:input.rehearsal&&input.testFormUrl?.trim()?{url:formLink(input.testFormUrl.trim())!,source:'manual',observedAt:new Date(now).toISOString()}:undefined,watcherProfileId:input.watcherProfileId,status:'armed',members,links:{},finalQuestion:input.finalQuestion,finalQuestions:structuredClone(input.finalQuestions??{}),rehearsalAnswer:structuredClone(input.rehearsalAnswer),createdAt:new Date(now).toISOString(),updatedAt:new Date(now).toISOString()};
    for(const [key,url]of Object.entries(input.links??{}))if(url&&members.some((m:{level:string})=>m.level===key))this.setManual(key,url);
    try{await this.persist();}catch(e){this.value=previous;throw e;}return structuredClone(this.value);
  });}
  private setManual(level:unknown,value:unknown){
    if(!this.value||!isHskLevel(level)||typeof value!=='string')throw new Error('Link HSK không hợp lệ.');
    const url=value.trim()?formLink(value.trim()):undefined;if(value.trim()&&!url)throw new Error(`HSK ${level}: cần link Google Forms hợp lệ.`);
    if(url)this.value.links[level]={url,source:'manual',observedAt:new Date(this.now()).toISOString()};else delete this.value.links[level];
  }
  async manual(level:unknown,url:unknown){const result=await this.exclusive(async()=>{if(!this.active)throw new Error('Chưa có lịch đang chờ.');if(this.value!.members.some(m=>m.level===level&&m.status!=='waiting'))throw new Error('HSK này đã phát lệnh. Dùng Đổi link & chạy lại để dừng đúng lượt cũ.');this.setManual(level,url);await this.persist();return structuredClone(this.value);});void this.tick().catch(this.hooks.error);return result;}
  async answer(level:unknown,question:unknown){return this.exclusive(async()=>{
    if(!this.value||!isHskLevel(level)&&!(level==='test'&&this.value.rehearsal))throw new Error('Chưa có lịch hoặc HSK không hợp lệ.');
    validateHskAnswer(question);this.value.finalQuestions??={};
    for(const m of this.value.members.filter(m=>level==='test'&&this.value!.rehearsal||m.level===level))delete m.answerError;
    if(level==='test')this.value.rehearsalAnswer=structuredClone(question);
    else if(isHskLevel(level)){if(question)this.value.finalQuestions[level]=structuredClone(question);else delete this.value.finalQuestions[level];}
    await this.persist();return structuredClone(this.value);
  });}
  async answerResult(id:string,runId:string,error?:string){return this.exclusive(async()=>{const m=this.value?.members.find(m=>m.id===id&&m.runId===runId);if(!m||m.answerError===error)return;m.answerError=error;await this.persist();});}
  async replace(level:unknown,value:unknown){
    if(this.replacing)throw new Error('Đang đổi link. Chờ thao tác hiện tại hoàn tất.');
    this.replacing=true;try{return await this.replaceLevel(level,value);}finally{this.replacing=false;}
  }
  private async replaceLevel(level:unknown,value:unknown){
    const test=level==='test'&&this.value?.rehearsal===true;
    if(!test&&!isHskLevel(level)||typeof value!=='string'||value.trim()&&!formLink(value.trim()))throw new Error('Cần link Google Forms hợp lệ.');
    const selectedLevel=level as HskLevel;
    const schedule=await this.exclusive(async()=>{
      const s=this.value;if(!s||['cancelled','expired'].includes(s.status))throw new Error('Bật lịch mới để chạy tiếp.');
      if(this.cancelling)throw new Error('Đang hủy lịch.');
      if(!test&&!s.members.some(m=>m.level===level))throw new Error('Lịch không có profile thuộc HSK này.');
      for(const m of s.members.filter(m=>test||m.level===level)){m.status='held';m.waitingReason='Đang dừng link cũ';}
      // Fence any START already waiting for a durable write before awaiting it.
      await this.persist();return s;
    });
    const members=schedule.members.filter(m=>test||m.level===level);
    await Promise.allSettled(members.map(m=>this.launches.get(m.id)));
    const results=await Promise.all(members.map(async m=>{try{if(!this.hooks.reset)throw new Error('Server chưa hỗ trợ đổi link.');await this.hooks.reset(m);return {id:m.id,ok:true};}catch(e){return {id:m.id,ok:false,error:(e as Error).message};}}));
    await this.exclusive(async()=>{
      if(this.value!==schedule||this.cancelling)throw new Error('Lịch đã thay đổi trong lúc dừng.');
      if(test){
        schedule.testForm={url:formLink(value.trim()),source:'manual',observedAt:new Date(this.now()).toISOString(),...(!value.trim()?{error:'Đã loại link form thử. Dán link đúng để chạy tiếp.'}:{})};
        for(const l of Object.keys(schedule.finalQuestions??{}) as HskLevel[]){const q=schedule.finalQuestions![l];if(q)schedule.finalQuestions![l]={value:q.value};}
      }else{
        if(schedule.links[selectedLevel]?.url!==formLink(value.trim())&&schedule.finalQuestions)delete schedule.finalQuestions[selectedLevel];
        this.setManual(level,value);
        if(!value.trim())schedule.links[selectedLevel]={source:'manual',observedAt:new Date(this.now()).toISOString(),error:'Đã loại link. Dán link đúng để chạy tiếp.'};
      }
      for(const m of members){const r=results.find(r=>r.id===m.id)!;m.error=r.error;m.prepared=false;delete m.waitingReason;
        if(r.ok){m.status='waiting';m.requestId=randomUUID();delete m.url;delete m.runId;delete m.dispatchedAt;this.prepared.delete(`${schedule.id}:${m.id}`);for(const key of this.prepareAttempt.keys())if(key.startsWith(`${schedule.id}:${m.id}:`))this.prepareAttempt.delete(key);}}
      schedule.status='preparing';schedule.expiresAt=new Date(Math.max(Date.parse(schedule.expiresAt),this.now()+120000)).toISOString();
      schedule.linksCaptured=false;schedule.watchRevision=(schedule.watchRevision??0)+1;this.watcherSent=0;await this.persist();
    });
    await this.tick();return results;
  }
  assertSchedule(expectedId?:string){if(expectedId&&this.value?.id!==expectedId)throw new Error('Lịch đã thay đổi. Tải lại trạng thái trước khi điều khiển.');}
  async settleLaunches(){await Promise.allSettled([...this.launches.values()]);}
  async setPaused(paused:boolean,expectedId:string){
    this.assertSchedule(expectedId);const s=this.value!;
    if(['cancelled','expired'].includes(s.status))throw new Error('Lịch đã dừng hoặc hết hạn.');
    if(paused&&!s.pausedAt)s.pausedAt=new Date(this.now()).toISOString();
    if(paused&&s.watcher){const w=s.watcher;delete s.watcher;if(this.hooks.connected(w.id))void this.hooks.command(w.id,'WATCH_FACEBOOK',{stop:true,token:w.token}).catch(this.hooks.error);}
    return this.exclusive(async()=>{this.assertSchedule(expectedId);if(!paused&&s.pausedAt){s.expiresAt=new Date(Date.parse(s.expiresAt)+Math.max(0,this.now()-Date.parse(s.pausedAt))).toISOString();delete s.pausedAt;}s.watchRevision=(s.watchRevision??0)+1;this.watcherSent=0;await this.persist();return structuredClone(s);});
  }
  async cancel(expectedId?:string){this.assertSchedule(expectedId);this.cancelling=true;this.cancelledId=this.value?.id;return this.exclusive(async()=>{if(!this.value)return;this.value.status='cancelled';await this.persist();void this.stopWatcher();return structuredClone(this.value);});}
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
      if(!payload.error&&!s.linksCaptured){
        s.lastReadAt=at;
        const found=s.rehearsal?{}:parseHskLinks(payload.text,s.dateWarning?undefined:s.startsAt),sample=s.rehearsal?parseTestForm(payload.text):undefined;
        if(s.rehearsal&&s.testForm?.source!=='manual')s.testForm=sample?{...sample,source:'facebook',observedAt:at}:undefined;
        // A newer observation replaces automatic entries, including conflicts
        // and removed links. Explicit manual entries always win.
        for(const level of new Set(s.members.map(m=>m.level))){if(s.links[level]?.source==='manual')continue;const next=found[level];if(next)s.links[level]={...next,error:next.error??(!s.rehearsal?s.dateWarning:undefined),source:'facebook',observedAt:at};else delete s.links[level];}
        if(s.rehearsal&&!s.testForm?.url)s.lastError=s.testForm?.error??'Chưa thấy link được ghi rõ là form thử trong bài. Không mở form đăng ký thật.';
      }
      await this.persist();
    });
    await this.tick();return {accepted:true,pauseReload:!!this.value?.pausedAt||this.value?.linksCaptured===true,watchRevision:this.value?.watchRevision??0};
  }
  private prepare(s:RegistrationSchedule,session:SessionView){
    const key=`${s.id}:${session.id}`,attempt=`${key}:${session.revision}`,requestId=s.members.find(m=>m.id===session.id)?.requestId;
    if(this.preparing.has(key)||this.prepared.get(key)===session.revision&&session.synced&&!session.conflict&&!session.execution||this.now()-(this.prepareAttempt.get(attempt)??-Infinity)<5000)return;
    this.prepared.delete(key);this.prepareAttempt.set(attempt,this.now());
    this.preparing.add(key);
    void this.hooks.prepare(session.id).then(revision=>this.exclusive(async()=>{
      if(this.value?.id!==s.id||s.members.find(m=>m.id===session.id)?.requestId!==requestId)return;this.prepared.set(key,revision??session.revision);
      const m=s.members.find(m=>m.id===session.id);if(m?.status==='waiting'){m.prepared=true;delete m.error;await this.persist();}
    })).catch(e=>this.exclusive(async()=>{if(this.value?.id===s.id){const m=s.members.find(m=>m.id===session.id);if(m?.status==='waiting')m.error=(e as Error).message;await this.persist();}})).finally(()=>{this.preparing.delete(key);void this.tick().catch(this.hooks.error);}).catch(this.hooks.error);
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
    void this.hooks.command(id,'WATCH_FACEBOOK',{scheduleId:s.id,token,postUrl:s.postUrl,watchAt:s.watchAt,expiresAt:s.expiresAt,pauseReload:!!s.pausedAt||s.linksCaptured===true,watchRevision:s.watchRevision??0}).then(()=>this.exclusive(async()=>{if(this.value?.id===s.id&&s.watcher?.token===token){const oldError=s.watcher.error;s.watcher.ready=true;s.watcher.error=undefined;if(oldError&&s.lastError?.endsWith(oldError))s.lastError=undefined;await this.persist();}})).catch(e=>this.exclusive(async()=>{if(this.value?.id===s.id&&s.watcher?.token===token){s.watcher.ready=false;s.watcher.error=(e as Error).message;s.lastError=`${sessions.find(p=>p.id===id)?.name??id}: ${(e as Error).message}`;this.watcherFailures.add(id);this.watcherSent=0;await this.persist();}})).finally(()=>{this.watcherBusy=false;}).catch(this.hooks.error);
  }
  tick(){return this.exclusive(async()=>{
    const s=this.value;if(!s||!this.active)return;const now=this.now();
    if(s.pausedAt)return;
    if(now>=Date.parse(s.expiresAt)){s.status='expired';await this.persist();void this.stopWatcher();return;}
    const sessions=await this.hooks.sessions();if(!this.active)return;const old=s.status;
    s.status=now<Date.parse(s.watchAt)?'preparing':now<Date.parse(s.startsAt)?'watching':'running';
    let dirty=old!==s.status;
    for(const member of s.members){const session=sessions.find(p=>p.id===member.id);if(member.status==='waiting'&&session&&this.hooks.connected(member.id))this.prepare(s,session);}
    const needsLinks=s.rehearsal?(!s.testForm?.url||!!s.testForm.error):s.members.some(m=>['waiting','starting'].includes(m.status)&&s.links[m.level]?.source!=='manual'&&(!s.links[m.level]?.url||!!s.links[m.level]?.error));
    const captured=!needsLinks;
    if(s.linksCaptured!==captured){s.linksCaptured=captured;s.watchRevision=(s.watchRevision??0)+1;this.watcherSent=0;dirty=true;}
    if(!s.manualOnly&&(!captured||s.watcher))this.watch(s,sessions);
    const dispatch:typeof s.members=[];let reasonsChanged=false;
    for(const member of s.members){
      if(!['waiting','starting'].includes(member.status)||this.launching.has(member.id))continue;
      const session=sessions.find(p=>p.id===member.id),link=s.rehearsal?s.testForm:s.links[member.level];
      const reason=!session||!this.hooks.connected(member.id)?'Mở Chrome profile để kết nối':session.conflict?'Giải quyết xung đột hồ sơ':!session.synced?'Đang đồng bộ hồ sơ':!session.profile?'Chưa có hồ sơ':this.prepared.get(`${s.id}:${session.id}`)!==session.revision?(member.error??'Đang kiểm tra ảnh và chuẩn bị tab'):!link?.url||link.error?(link?.error??(s.rehearsal?'Chưa có form thử hợp lệ':'Chưa có link HSK hợp lệ')):s.rehearsal&&(!s.testForm?.url||s.testForm.error)?'Chưa có form thử hợp lệ':undefined;
      if(member.waitingReason!==reason){member.waitingReason=reason;reasonsChanged=true;}
      if(reason||s.pausedAt)continue;
      // A loading/error observation does not revoke previously verified links.
      // Only a readable newer post can remove or invalidate a specific HSK URL.
      if(!link?.url||link.error)continue;
      if(s.rehearsal&&(s.mode!=='test'||!s.testForm?.url||s.testForm.error))continue;
      // Persist individual intent before dispatch. Slow peers never gate others.
      member.status='starting';member.url??=s.rehearsal?s.testForm!.url!:link.url;member.dispatchedAt??=new Date(now).toISOString();
      dispatch.push(member);
    }
    // One durable write for link routing, then independent STARTs. Do not put
    // ten serial database round trips in front of the tenth profile.
    if(dispatch.length||reasonsChanged||dirty)await this.persist();
    for(const member of dispatch){
      this.launching.add(member.id);
      const valid=()=>this.value?.id===s.id&&this.active&&member.status==='starting'&&this.now()<Date.parse(s.expiresAt);
      const launch=(async()=>{
        if(!valid())return;
        const group=await this.hooks.start(member.id,member.url!,s,valid);
        await this.exclusive(async()=>{if(this.value?.id!==s.id)return;member.runId=group.id;if(member.status==='starting')member.status='started';member.error=undefined;await this.persist();});
        this.hooks.started?.(member.id,group.id);
      })().catch(e=>this.exclusive(async()=>{if(this.value?.id===s.id&&member.status==='starting'){member.status='failed';member.error=(e as Error).message;await this.persist();}})).finally(()=>{this.launching.delete(member.id);this.launches.delete(member.id);void this.tick().catch(this.hooks.error);}).catch(this.hooks.error);
      this.launches.set(member.id,launch);
    }
    if(s.members.every(m=>['started','failed','held'].includes(m.status))){s.status='finished';s.lastError=undefined;await this.persist();void this.stopWatcher();}
  });}
}
