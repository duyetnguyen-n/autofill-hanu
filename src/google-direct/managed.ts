import type {Command,ExecutionView} from '../protocol';
import {getProfile,getProfileRevision,getAttachment} from '../storage';
import {sha256} from '../protocol';
import {matchesFinalQuestionLabel,type RunState,validateFinalQuestion} from '../shared';
import {directQuestionSummary} from './verification';
import {DirectExecutor} from './executor';
import {directLabFormId,parseDirectSchema} from './schema';
import {readExecutionPage,cancelExecutionPage} from './execute-page';
import {showDirectRecovery,restoreDirectNativePage,armDirectManualSubmit,disarmDirectManualSubmit} from './recovery-page';
import {DirectPageDialogs} from './dialogs';

const KEY='googleDirectManagedRun';
const ended=(r:RunState)=>['idle','completed','failed','ready_to_submit','submit_uncertain'].includes(r.status);
type Bridge={connected():boolean;state(r:RunState):void;request(kind:string,r:RunState,extra?:Record<string,unknown>):Promise<unknown>};
/** Separate executor/storage. The existing coordinator supplies profile/group/schedule controls. */
export class ManagedDirect {
  private controller?:AbortController;
  private task?:Promise<void>;
  private writes=Promise.resolve();
  private stopped=new Set<string>();
  private manualBusy=false;
  private manualSubmission?:{runId:string;documentKey:string};
  constructor(private bridge:Bridge){}
  async run():Promise<RunState|undefined>{return (await chrome.storage.local.get(KEY))[KEY];}
  async owns(c?:Command){const r=await this.run();return !!r&&(!c?.runId||c.runId===r.runId);}
  private save(r:RunState){
    const work=this.writes.then(async()=>{
      r={...r,updatedAt:new Date().toISOString(),eventSeq:(r.eventSeq??0)+1};
      await chrome.storage.local.set({[KEY]:r,googleDirectLease:{runId:r.runId,active:!ended(r),tabId:r.tabId}});
      this.bridge.state(r);void this.pageLoaded(r.tabId).catch(()=>{});return r;
    });this.writes=work.then(()=>{},()=>{});return work;
  }
  async start(c:Command,sessionId:string){
    if(!['test','live'].includes(String(c.payload.mode)))throw new Error('Chế độ chạy không hợp lệ.');
    const formId=directLabFormId(String(c.payload.url));validateFinalQuestion(c.payload.finalQuestion);
    if(!c.runId)throw new Error('Thiếu mã lượt thử nghiệm.');
    if(this.stopped.has(c.runId))throw new Error('Lượt đã bị Dừng trước khi bắt đầu.');
    const previous=await this.run();
    if(previous?.runId===c.runId)return previous;
    if(this.task||previous&&!ended(previous))throw new Error('Còn lượt thử nghiệm giữ profile. Dừng trước khi chạy mới.');
    if(await getProfileRevision()!==c.payload.revision)throw new Error('Hồ sơ chưa đồng bộ phiên bản.');
    const profile=await getProfile(),hashes=c.payload.attachmentHashes as Record<string,string>??{};
    for(const a of Object.values(profile.attachments))if(a){const blob=await getAttachment(a.id);if(!blob||blob.size!==a.size||await sha256(await blob.arrayBuffer())!==hashes[a.id])throw new Error('Ảnh chưa đồng bộ đầy đủ.');}
    const run:RunState={engine:'direct',runId:c.runId,sessionId,managed:true,profileSnapshot:structuredClone(profile),profileRevision:Number(c.payload.revision),expectedEmail:String(c.payload.expectedEmail),
      url:String(c.payload.url),formId,tabId:-1,mode:c.payload.mode as 'test'|'live',status:'running',autoContinue:true,finalQuestion:c.payload.finalQuestion,
      filled:[],skipped:[],logs:[],submitAttempted:false,eventSeq:0,startedAt:new Date().toISOString(),updatedAt:new Date().toISOString()};
    const saved=await navigator.locks.request('hanu-profile-start',async()=>{
      if(this.stopped.has(c.runId!))throw new Error('Lượt đã bị Dừng.');
      if((await chrome.storage.local.get('executionLease')).executionLease?.active)throw new Error('Google Forms cũ đang giữ profile. Dừng lượt đó trước.');
      return this.save(run);
    });
    this.launch(saved,false);return (await this.run())!;
  }
  private launch(initial:RunState,resume:boolean,manualFinal?:string){
    const controller=new AbortController();this.controller=controller;
    const work=(async()=>{
      let r=initial;
      const valid=async()=>{
        if(controller.signal.aborted||this.stopped.has(r.runId!)||!this.bridge.connected())throw new Error('Lượt đã dừng hoặc mất kết nối điều phối.');
        const latest=await this.run();if(latest?.runId!==r.runId)throw new Error('Lượt đã thay đổi.');
      };
      try{
        let overrides:Record<string,string>={};
        // Resolve verification from the configured question on the actual schema,
        // never infer the fee from a numeric validation expression.
        const resolveOverrides=async(tabId:number)=>{
          const page=(await chrome.scripting.executeScript({target:{tabId},func:readExecutionPage}))[0]?.result;
          if(!page?.script||!r.finalQuestion)return;
          const questions=parseDirectSchema(page.script).sections.flatMap(s=>s.questions);
          const matches=questions.filter(q=>r.finalQuestion?.questionId?[q.id,`entry.${q.entryId}`].includes(r.finalQuestion.questionId):matchesFinalQuestionLabel(q.label,r.finalQuestion!.label??''));
          if(matches.length!==1)throw new Error('Chưa ghép duy nhất câu xác thực đã khai báo.');
          overrides={[matches[0].id]:r.finalQuestion.value};
        };
        // Executor opens and waits for the responder before resolving its schema.
        const result=await new DirectExecutor().run({tabId:r.tabId,url:r.url,runId:r.runId,mode:r.mode,resume,manualFinal,managed:true,profile:r.profileSnapshot!,overrides,expectedEmail:r.expectedEmail,
          signal:controller.signal,assertActive:valid,
          onTab:async tabId=>{await valid();r=await this.save({...r,tabId});},
          onSchema:async(tabId)=>{await resolveOverrides(tabId);return overrides;},
          onProgress:async message=>{if(controller.signal.aborted)return;await valid();r=await this.save({...r,activity:{phase:'filling',message,at:new Date().toISOString()},logs:[...r.logs,{at:new Date().toISOString(),level:'info' as const,message}].slice(-150)});},
          beforeSubmit:async()=>{
            await valid();await this.bridge.request('SUBMIT',r);
            // A granted request is durable even if Stop arrived while awaiting it.
            r=await this.save({...r,submitAttempted:true,status:'submitting'});await valid();
          }});
        const aborted=controller.signal.aborted;
        const status=result.status==='received'?'completed':r.submitAttempted?'submit_uncertain':aborted?'paused':result.status==='ready'?'ready_to_submit':result.status==='waiting'?'waiting_manual':'failed';
        const latest=await this.run();
        if(latest?.runId===r.runId){r={...r,...(aborted?{autoContinue:false}:{}),status,blockingIssue:result.issue,activity:undefined,logs:[...r.logs,{at:new Date().toISOString(),level:status==='failed'?'error':'info',message:result.message}]};await this.save(r);}
      }catch(error){
        const latest=await this.run();if(latest?.runId===r.runId)await this.save({...r,status:r.submitAttempted?'submit_uncertain':controller.signal.aborted?'paused':'failed',activity:undefined,logs:[...r.logs,{at:new Date().toISOString(),level:'error',message:(error as Error).message}]});
      }
    })();
    this.task=work;void work.finally(()=>{if(this.task===work){this.task=undefined;this.controller=undefined;void this.run().then(r=>r&&this.pageLoaded(r.tabId)).catch(()=>{});}});
  }
  async interrupt(c?:Command){
    if(c?.runId)this.stopped.add(c.runId);
    const r=await this.run();if(!r||c?.runId&&r.runId!==c.runId)return;
    this.controller?.abort();
    if(r.tabId>=0)await chrome.scripting.executeScript({target:{tabId:r.tabId},world:'MAIN',func:cancelExecutionPage}).catch(()=>{});
  }
  async control(c:Command){
    let r=await this.run();if(!r||c.runId&&r.runId!==c.runId)throw new Error('Lệnh thuộc lượt thử nghiệm cũ.');
    if(['STOP','STOP_PROFILE','PAUSE'].includes(c.kind)){
      await this.interrupt(c);await this.task;r=(await this.run())!;
      const status=r.status==='completed'?'completed':r.submitAttempted?'submit_uncertain':c.kind==='PAUSE'?'paused':'idle';
      r=await this.save({...r,status,autoContinue:false,activity:undefined});
      return c.kind==='STOP_PROFILE'?{run:r,execution:await this.execution()}:r;
    }
    if(c.kind==='SCAN_FORM'){
      if(r.tabId<0)throw new Error('Chưa mở form thử nghiệm.');
      const page=(await chrome.scripting.executeScript({target:{tabId:r.tabId},func:readExecutionPage}))[0]?.result;
      if(!page?.script||directLabFormId(page.url)!==r.formId)throw new Error('Tab đã rời form thử nghiệm.');
      return {runId:r.runId,formId:r.formId,url:page.url,questions:parseDirectSchema(page.script).sections.flatMap(s=>s.questions).map(directQuestionSummary)};
    }
    if(c.kind==='RESUME'){
      if(r.submitAttempted)throw new Error('Đã khóa gửi. Xác minh kết quả trước khi tiếp tục.');
      if(this.task)throw new Error('Lượt chưa dừng xong.');
      if(c.payload.automatic&&r.manualTakeover)throw new Error('Bạn đang tiếp quản; tool không tự tiếp tục.');
      const manual=this.manualSubmission?.runId===r.runId?this.manualSubmission:undefined;this.manualSubmission=undefined;
      this.stopped.delete(r.runId!);r=await this.save({...r,status:'running',manualTakeover:!!manual,autoContinue:!manual,recoveryRequired:false});this.launch(r,true,manual?.documentKey);return r;
    }
    if(c.kind==='SET_FINAL_QUESTION'){
      validateFinalQuestion(c.payload.finalQuestion);
      if(!c.payload.finalQuestion||this.manualBusy||r.manualTakeover||r.submitAttempted||!['paused','waiting_manual','ready_to_submit'].includes(r.status))throw new Error('Chỉ đổi đáp án khi đang chờ và chưa gửi.');
      const question=c.payload.finalQuestion as RunState['finalQuestion'];if(question?.formId&&question.formId!==r.formId)throw new Error('Câu hỏi thuộc form khác.');
      r=await this.save({...r,finalQuestion:question});return r;
    }
    if(c.kind==='RESOLVE_SUBMISSION'){
      const result=c.payload.result;
      if(!r.submitAttempted||!['received','not_received'].includes(String(result)))throw new Error('Không có kết quả cần xác minh.');
      if(result==='not_received'){const key=`googleDirectSubmit:${r.formId}:${r.expectedEmail?.toLowerCase()}`;const lock=(await chrome.storage.local.get(key))[key];if(lock?.runId===r.runId&&lock.status==='pending')await new DirectExecutor().resolveNotReceived(r.runId!,r.formId);}
      return this.save({...r,status:result==='received'?'completed':'idle'});
    }
    throw new Error('Điều khiển thử nghiệm chưa hỗ trợ lệnh này.');
  }
  async disconnected(){await this.interrupt();await this.task;const r=await this.run();if(r&&!ended(r))await this.save({...r,status:r.submitAttempted?'submit_uncertain':'paused',autoContinue:false,recoveryRequired:true});}
  async reconcile(){
    let r=await this.run();if(!r)return undefined;
    if(!this.task&&!ended(r))r=await this.save({...r,status:r.submitAttempted?'submit_uncertain':'paused',recoveryRequired:true,autoContinue:false});
    this.bridge.state(r);void this.pageLoaded(r.tabId).catch(()=>{});return {run:r};
  }
  async pageLoaded(tabId:number){
    const r=await this.run();if(!r||r.tabId!==tabId)return;
    const page=(await chrome.scripting.executeScript({target:{tabId},func:readExecutionPage}))[0]?.result;
    if(!page||page.account.toLowerCase()!==r.expectedEmail?.toLowerCase()||directLabFormId(page.url)!==r.formId)return;
    const current=await this.run();if(!current||current.runId!==r.runId||current.eventSeq!==r.eventSeq)return;
    await chrome.scripting.executeScript({target:{tabId},world:'MAIN',func:['idle','completed'].includes(r.status)?disarmDirectManualSubmit:armDirectManualSubmit});
    await chrome.scripting.executeScript({target:{tabId},func:showDirectRecovery,args:[{runId:r.runId!,formId:r.formId,account:r.expectedEmail!,status:r.status,mode:r.mode,eventSeq:r.eventSeq,preservePrepared:this.manualBusy||!!this.task,manual:!!r.manualTakeover,message:r.blockingIssue?.message??r.activity?.message??r.logs.at(-1)?.message??'Giữ nguyên dữ liệu; có thể tiếp quản trên form.'}]});
  }
  async manual(action:'takeover'|'resume'|'submit',runId:string,documentKey:string,tabId:number){
    if(this.manualBusy)throw new Error('Đang xử lý thao tác trước. Giữ nguyên form.');
    this.manualBusy=true;
    try{return await navigator.locks.request('hanu-profile-start',async()=>{
      const leases=await chrome.storage.local.get(['executionLease','googleDirectLease']);
      if(leases.executionLease?.active||leases.googleDirectLease?.active&&leases.googleDirectLease.runId!==runId)throw new Error('Một lượt khác đang giữ profile; chưa thể tiếp quản.');
      let r=await this.run();
      if(!r||r.runId!==runId||r.tabId!==tabId||r.submitAttempted||['idle','completed','submit_uncertain'].includes(r.status))throw new Error('Lượt đã đổi hoặc đã khóa gửi. Đối chiếu kết quả trước.');
      const page=(await chrome.scripting.executeScript({target:{tabId},func:readExecutionPage}))[0]?.result;
      if(!page||page.documentKey!==documentKey||directLabFormId(page.url)!==r.formId||page.account.toLowerCase()!==r.expectedEmail?.toLowerCase())throw new Error('Trang hoặc tài khoản Google đã thay đổi.');
      if(action==='takeover'){
        await this.interrupt();await this.task;r=(await this.run())!;
        if(r.runId!==runId||r.submitAttempted)throw new Error('Đã bắt đầu gửi; cần đối chiếu kết quả trước khi tiếp quản.');
        r=await this.save({...r,status:'paused',manualTakeover:true,autoContinue:false,recoveryRequired:false,activity:undefined,logs:[...r.logs,{at:new Date().toISOString(),level:'info',message:'Bạn đã tiếp quản trên Google Form. Tool không tự điền hoặc tự tiếp tục.'}]});
        const dialogs=new DirectPageDialogs(tabId,new AbortController().signal);
        try{
          await dialogs.connect();dialogs.posting(true);
          const result=(await chrome.scripting.executeScript({target:{tabId},world:'MAIN',func:restoreDirectNativePage,args:[{formId:r.formId,documentKey}]}))[0]?.result;
          if(result){const deadline=Date.now()+15000;while(Date.now()<deadline){await new Promise(resolve=>setTimeout(resolve,250));try{const next=(await chrome.scripting.executeScript({target:{tabId},func:readExecutionPage}))[0]?.result;if(next&&next.documentKey!==documentKey)break;}catch{}}}
        }finally{await dialogs.close();}
        await this.pageLoaded(tabId);return {ok:true};
      }
      if(this.task)throw new Error('Tool đang xử lý. Bấm Tiếp quản trước khi nhập tay.');
      if(action==='submit'){
        if(r.mode!=='live')throw new Error('Chế độ Test dừng trước Gửi.');
        if(page.hasNext||!page.hasSubmit)throw new Error('Chưa tới trang Gửi của Google.');
        r=await this.save({...r,manualTakeover:true,autoContinue:false});
        this.manualSubmission={runId,documentKey};
      }
      try{await this.bridge.request('CONTROL',r,{action:'RESUME'});}catch(error){this.manualSubmission=undefined;throw error;}
      return {ok:true};
    });}finally{this.manualBusy=false;void this.pageLoaded(tabId).catch(()=>{});}
  }
  async execution():Promise<ExecutionView|null>{
    const r=await this.run();if(!r||ended(r))return null;
    const tab=r.tabId>=0?await chrome.tabs.get(r.tabId).catch(()=>undefined):undefined;
    return {runId:r.runId,tabId:r.tabId,mode:r.mode,status:r.status,managed:true,tabOpen:!!tab,active:!!this.task,eventSeq:r.eventSeq,message:r.activity?.message,startedAt:r.startedAt,updatedAt:r.updatedAt};
  }
  async focus(){const r=await this.run();if(!r||r.tabId<0)throw new Error('Chưa mở tab thử nghiệm.');const tab=await chrome.tabs.update(r.tabId,{active:true});if(tab?.windowId!==undefined)await chrome.windows.update(tab.windowId,{focused:true});return {tabId:r.tabId};}
}
