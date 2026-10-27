import {blobToDataUrl,getAttachment} from '../storage';
import {StoredPickerUploads} from '../stored-picker-upload';
import {hasSubmissionConfirmation} from '../submission-confirmation';
import type {Profile} from '../shared';
import {DIRECT_LAB_FORM_ID,DIRECT_LAB_URL,parseDirectSchema} from './schema';
import {buildDirectPlan} from './plan';
import {readExecutionPage,postExecutionPage,inspectExecutionUpload,refreshExecutionDraft,type ExecutionPage,type PagePost} from './execute-page';
import {DirectPageDialogs} from './dialogs';

export interface DirectRunResult {runId:string;status:'received'|'failed'|'uncertain'|'stopped';message:string;postCount:number}
export interface DirectRunInput {tabId:number;profile:Profile;overrides:Record<string,string>;expectedScript:string;file?:{name:string;type:string;blob:Blob};onProgress:(text:string)=>void;signal:AbortSignal}
const delay=(ms:number)=>new Promise(resolve=>setTimeout(resolve,ms));

export class DirectExecutor {
  async run(input:DirectRunInput):Promise<DirectRunResult> {
    const runId=crypto.randomUUID();
    const expectedSchema=JSON.stringify(parseDirectSchema(input.expectedScript));
    return navigator.locks.request(`hanu-direct:${DIRECT_LAB_FORM_ID}`,{ifAvailable:true},async lock=>{
      if(!lock)throw new Error('Có một lượt Direct khác đang chạy trên form này.');
      let attempted=false,posts=0,account='',lockKey='';
      let tabId=input.tabId;
      let dialogs:DirectPageDialogs|undefined;
      const uploads=new StoredPickerUploads();
      const guard=async()=>{
        if(input.signal.aborted)throw new Error('Đã dừng lượt Direct.');
        const data=await chrome.storage.local.get(['executionLease','submissionLocks']);
        if(data.executionLease?.active)throw new Error('Luồng Google Forms cũ đang chạy; dừng lượt đó trước khi dùng Direct.');
        if(Object.values(data.submissionLocks??{}).some((v:any)=>v.formId===DIRECT_LAB_FORM_ID&&v.resolution!=='not_received'))throw new Error('Luồng cũ đang giữ khóa gửi của form này.');
      };
      const read=async()=>{
        await guard();
        const results=await chrome.scripting.executeScript({target:{tabId},func:readExecutionPage});
        let page=results[0]?.result;
        if(results.length!==1||!page||!page.url.includes(`/d/e/${DIRECT_LAB_FORM_ID}/`))throw new Error('Executor Lab chỉ chạy trên đúng form test đã cung cấp.');
        if(page.blocked)throw new Error('Google đang yêu cầu xác thực hoặc form không nhận phản hồi.');
        if(page.draftRefresh&&!attempted){
          input.onProgress('Google có bản nháp mới hơn. Tool đang đối chiếu lại trước khi áp dụng snapshot hồ sơ.');
          await chrome.scripting.executeScript({target:{tabId},func:refreshExecutionDraft});
          const draftDeadline=Date.now()+15000;
          while(Date.now()<draftDeadline){
            await delay(300);await guard();
            const updated=(await chrome.scripting.executeScript({target:{tabId},func:readExecutionPage}))[0]?.result;
            if(updated&&!updated.draftRefresh){page={...updated,draftUpdated:true};break;}
          }
          if(page.draftRefresh)throw new Error('Google chưa cập nhật xong bản nháp mới hơn. Chưa gửi form.');
        }
        if(account&&page.hasForm&&page.account.toLowerCase()!==account.toLowerCase())throw new Error('Tài khoản Google đã đổi trong lúc chạy.');
        return page;
      };
      const changed=async(before:ExecutionPage)=>{
        const deadline=Date.now()+35000;
        while(Date.now()<deadline){
          await delay(250);await guard();
          let page:ExecutionPage;
          try{page=await read();}catch(e){if(/Cannot access|removed|frame was|context was destroyed|Frame with ID/i.test((e as Error).message))continue;throw e;}
          if(page.documentKey!==before.documentKey&&(!page.hasForm||page.script&&page.history.length))return page;
        }
        throw new Error('Google chưa chuyển trang/trả kết quả trong 35 giây. Không tự gửi request lần hai.');
      };
      try{
        await guard();
        if(chrome.tabs?.create){
          const fresh=await chrome.tabs.create({url:DIRECT_LAB_URL,active:true});
          if(fresh.id===undefined)throw new Error('Không mở được tab form mới.');
          tabId=fresh.id;
        }
        dialogs=new DirectPageDialogs(tabId,input.signal);
        await dialogs.connect();
        // Google Picker needs an active, rendered form tab. Keep the new Lab
        // page's controller running while the responder owns the foreground.
        if(chrome.tabs?.update){
          const tab=await chrome.tabs.update(tabId,{active:true});
          if(tab?.windowId!==undefined&&chrome.windows?.update)await chrome.windows.update(tab.windowId,{focused:true});
        }
        let page:ExecutionPage|undefined;
        const initialDeadline=Date.now()+30000;
        while(Date.now()<initialDeadline){
          try{const candidate=await read();if(candidate.hasForm&&candidate.script){page=candidate;break;}}
          catch(error){if(!/Cannot access|removed|frame was|context was destroyed|Frame with ID|Tab đã rời|Executor Lab chỉ chạy/i.test((error as Error).message))throw error;}
          await delay(250);
        }
        if(!page)throw new Error('Form chưa tải xong sau 30 giây. Kiểm tra đăng nhập hoặc mạng.');
        if(!page.hasForm||!page.script)throw new Error('Mở trang đầu form test trước khi bắt đầu.');
        if(JSON.stringify(parseDirectSchema(page.script))!==expectedSchema)throw new Error('Schema form đã thay đổi. Đọc lại form trước khi gửi.');
        account=page.account;
        if(!account)throw new Error('Chưa xác định được tài khoản Google của form.');
        lockKey=`googleDirectSubmit:${DIRECT_LAB_FORM_ID}:${account.toLowerCase()}`;
        const prior=(await chrome.storage.local.get(lockKey))[lockKey];
        if(prior&&!['received','not_received'].includes(prior.status))throw new Error('Lượt Direct trước chưa rõ kết quả. Đối chiếu phản hồi trước khi tạo lượt mới.');
        const schema=parseDirectSchema(page.script),plan=buildDirectPlan(schema,input.profile,DIRECT_LAB_FORM_ID,input.overrides);
        const problems=plan.answers.filter(a=>a.issue&&!schema.sections.flatMap(s=>s.questions).some(q=>q.id===a.questionId&&q.kind==='file'));
        if(problems.length||plan.blockers.some(b=>/nhánh|Nhánh|vòng lặp/.test(b)))throw new Error(problems.map(a=>`${a.label}: ${a.issue}`).join(' · ')||'Chưa xác định được lộ trình form.');
        const fileQuestions=schema.sections.flatMap(s=>s.questions).filter(q=>q.kind==='file'&&plan.answers.some(a=>a.questionId===q.id));
        if(fileQuestions.length>1)throw new Error('Bản Lab hiện hỗ trợ một câu tải ảnh trên nhánh đã chọn.');
        const fileQuestion=fileQuestions[0];
        const answer=fileQuestion&&plan.answers.find(a=>a.questionId===fileQuestion.id);
        const ref=answer?.attachmentId?Object.values(input.profile.attachments).find(a=>a?.id===answer.attachmentId):undefined;
        const file=input.file??(ref?{name:ref.name,type:ref.type,blob:await getAttachment(ref.id)}:undefined);
        if(fileQuestion?.required&&!file?.blob)throw new Error('Thiếu ảnh đã lưu. Chọn ảnh fixture hoặc ảnh đã lưu trước khi chạy.');
        const seen=new Map<number,number>();
        for(let step=0;step<schema.sections.length*3+1;step++){
          await guard();
          if(!page.hasForm){
            const received=hasSubmissionConfirmation({text:page.text,hasQuestions:false,hasNavigation:page.hasNext||page.hasSubmit,blocked:page.blocked});
            if(!attempted||!received)throw new Error('Google chưa trả xác nhận đã ghi lại phản hồi.');
            await chrome.storage.local.set({[lockKey]:{runId,status:'received',at:new Date().toISOString()}});
            input.onProgress('Google xác nhận đã ghi lại phản hồi.');
            return {runId,status:'received',message:'Google xác nhận đã ghi lại phản hồi.',postCount:posts};
          }
          if(attempted)throw new Error('Google trả lại trang form sau request Gửi; giữ khóa và đối chiếu phản hồi, không tự gửi lại.');
          if(!page.script||JSON.stringify(parseDirectSchema(page.script))!==expectedSchema)throw new Error('Schema form thay đổi trong lúc chạy.');
          const index=page.history.at(-1)??0;
          const visits=seen.get(index)??0;
          if(visits&&(!page.draftUpdated||visits>=3))throw new Error(`Google trả lại trang ${index+1}; kiểm tra dữ liệu/validation, chưa tự gửi lại.`);
          seen.set(index,visits+1);
          if(!plan.pageHistory.includes(index))throw new Error('Google chuyển sang nhánh khác với dữ liệu đã chuẩn bị.');
          const section=schema.sections[index];
          if(!section)throw new Error('Không xác định được trang hiện tại.');
          input.onProgress(`Trang ${index+1}/${schema.sections.length}: chuẩn bị request.`);
          if(fileQuestion&&file?.blob&&section.questions.some(q=>q.id===fileQuestion.id)){
            input.onProgress('Đang tự tải ảnh đã lưu qua Google Picker…');
            const uploadInput={questionId:fileQuestion.id,entryId:fileQuestion.entryId!,label:fileQuestion.label,name:file.name,open:true};
            const deadline=Date.now()+130000;
            let opened=false,ready=false;
            while(Date.now()<deadline){
              await guard();
              const state=(await chrome.scripting.executeScript({target:{tabId},func:inspectExecutionUpload,args:[{...uploadInput,open:!opened}]}))[0]?.result;
              if(state?.opened)opened=true;
              if(state?.state==='conflict')throw new Error('Câu upload đang có tệp khác, không tự thay ảnh.');
              if(state?.state==='ready'){ready=true;break;}
              if(state?.pickerUrl){
                opened=true;
                const result=await uploads.upload({tabId,key:runId,runId,pickerUrl:state.pickerUrl,requestId:runId,name:file.name,type:file.type,
                  assertActive:guard,prepare:async()=>{const started=performance.now();const dataUrl=await blobToDataUrl(file.blob!);return {dataUrl,readMs:0,encodeMs:performance.now()-started};}});
                if(result.state==='error')throw new Error(result.error);
              }
              await delay(300);
            }
            uploads.cancel(tabId);
            if(!ready)throw new Error('Google Picker chưa nhận ảnh sau 130 giây. Chưa gửi form.');
            input.onProgress('Google đã nhận đúng ảnh. Đang tiếp tục request.');
          }
          // Once Google's file reference is ready, all remaining answers are
          // already in the frozen plan. Submit the full route in one POST;
          // do not navigate/rehydrate the later draft pages just to fill them.
          const atUpload=!!fileQuestion&&section.questions.some(q=>q.id===fileQuestion.id);
          const final=atUpload||!fileQuestion||!page.hasNext&&page.hasSubmit;
          if(!page.hasNext&&!final)throw new Error('Chưa thấy bước Tiếp hoặc Gửi của Google.');
          const current=final?plan.answers:plan.answers.filter(a=>section.questions.some(q=>q.id===a.questionId));
          const request:PagePost={formId:DIRECT_LAB_FORM_ID,documentKey:page.documentKey,account,requestId:`${runId}:${index}`,final,
            entries:current.filter(a=>!a.issue&&!fileQuestions.some(q=>q.id===a.questionId)).flatMap(a=>(a.values.length?a.values:['']).map(v=>[`entry.${a.entryId}`,v] as [string,string])),
            sentinels:section.questions.filter(q=>['checkbox','radio','dropdown'].includes(q.kind)).map(q=>q.entryId!),
            uploadEntries:(final?fileQuestions:section.questions).filter(q=>q.kind==='file'&&(q.required||!!file?.blob)).map(q=>q.entryId!),
            history:final?plan.pageHistory:undefined};
          if(final){
            await guard();attempted=true;
            await chrome.storage.local.set({[lockKey]:{runId,status:'pending',at:new Date().toISOString()}});
            input.onProgress('Đã khóa gửi. Đang gửi request cuối tới Google…');
          }
          posts++;
          dialogs.posting(true);
          const posted=await chrome.scripting.executeScript({target:{tabId},world:final?'MAIN':'ISOLATED',func:postExecutionPage,args:[request]});
          if(final){
            const result=posted[0]?.result?.finalResult;
            if(!result?.received)throw new Error(result?.message??'Chưa nhận được kết quả request Gửi. Giữ khóa để đối chiếu.');
            await chrome.storage.local.set({[lockKey]:{runId,status:'received',at:new Date().toISOString()}});
            input.onProgress(result.message);
            return {runId,status:'received',message:result.message,postCount:posts};
          }
          page=await changed(page);
          dialogs.posting(false);
        }
        throw new Error('Vượt số bước dự kiến của form.');
      }catch(error){
        const message=(error as Error).message;
        return {runId,status:attempted?'uncertain':input.signal.aborted?'stopped':'failed',message,postCount:posts};
      }finally{uploads.cancel(tabId);await dialogs?.close();}
    });
  }
  async resolveNotReceived(runId:string){
    return navigator.locks.request(`hanu-direct:${DIRECT_LAB_FORM_ID}`,async()=>{
      const data=await chrome.storage.local.get(null);
      const matches=Object.entries(data).filter(([key,value])=>key.startsWith(`googleDirectSubmit:${DIRECT_LAB_FORM_ID}:`)&&value?.runId===runId&&value.status==='pending');
      if(matches.length!==1)throw new Error('Không còn đúng khóa gửi chưa rõ của lượt này.');
      const [key,value]=matches[0];
      await chrome.storage.local.set({[key]:{...value,status:'not_received',resolvedAt:new Date().toISOString()}});
    });
  }
}
