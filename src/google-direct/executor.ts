import {blobToDataUrl,getAttachment} from '../storage';
import {StoredPickerUploads} from '../stored-picker-upload';
import {hasSubmissionConfirmation} from '../submission-confirmation';
import {directQuestionSummary} from './verification';
import type {BlockingIssue,Profile} from '../shared';
import {DIRECT_LAB_FORM_ID,DIRECT_LAB_URL,directLabFormId,directSchemaFingerprint,parseDirectSchema} from './schema';
import {buildDirectPlan} from './plan';
import {readExecutionPage,postExecutionPage,inspectExecutionUpload,refreshExecutionDraft,beginExecutionSession,cancelExecutionPage,resetExecutionPage,prepareUploadAnswer,type ExecutionPage,type PagePost} from './execute-page';
import {DirectPageDialogs} from './dialogs';
import {directManualReady,armDirectManualSubmit,prepareDirectNativeSubmit} from './recovery-page';

export interface DirectRunResult {runId:string;status:'received'|'failed'|'uncertain'|'stopped'|'ready'|'waiting';issue?:BlockingIssue;message:string;postCount:number}
export interface DirectRunInput {tabId:number;profile:Profile;overrides:Record<string,string>;expectedScript?:string;url?:string;mode?:'test'|'live';runId?:string;expectedEmail?:string;resume?:boolean;managed?:boolean;onTab?:(tabId:number)=>Promise<void>;onSchema?:(tabId:number)=>Promise<Record<string,string>>;beforeSubmit?:()=>Promise<void>;assertActive?:()=>Promise<void>;file?:{name:string;type:string;blob:Blob};onProgress:(text:string)=>void|Promise<void>;manualFinal?:string;signal:AbortSignal}
const delay=(ms:number)=>new Promise(resolve=>setTimeout(resolve,ms));

export class DirectExecutor {
  async run(input:DirectRunInput):Promise<DirectRunResult> {
    const runId=input.runId??crypto.randomUUID(),url=input.url??DIRECT_LAB_URL,formId=directLabFormId(url);
    let expectedSchema=input.expectedScript?directSchemaFingerprint(parseDirectSchema(input.expectedScript)):undefined;
    return navigator.locks.request(`hanu-direct:${formId}`,{ifAvailable:true},async lock=>{
      if(!lock)throw new Error('Có một lượt Direct khác đang chạy trên form này.');
      let attempted=false,posts=0,account='',lockKey='';
      let tabId=input.tabId;
      let dialogs:DirectPageDialogs|undefined;
      let removeStop=()=>{};
      const uploads=new StoredPickerUploads();
      const guard=async()=>{
        if(input.signal.aborted)throw new Error('Đã dừng lượt Direct.');
        await input.assertActive?.();
        const data=await chrome.storage.local.get(['executionLease','submissionLocks','googleDirectLease']);
        if(data.googleDirectLease?.active&&data.googleDirectLease.runId!==runId)throw new Error('Lượt thử nghiệm khác đang giữ profile.');
        if(data.executionLease?.active)throw new Error('Luồng Google Forms cũ đang chạy; dừng lượt đó trước khi dùng Direct.');
        if(Object.values(data.submissionLocks??{}).some((v:any)=>v.formId===formId&&v.resolution!=='not_received'))throw new Error('Luồng cũ đang giữ khóa gửi của form này.');
      };
      const read=async()=>{
        await guard();
        const results=await chrome.scripting.executeScript({target:{tabId},func:readExecutionPage});
        let page=results[0]?.result;
        if(results.length!==1||!page||!page.url.includes(`/d/e/${formId}/`))throw new Error('Executor Lab chỉ chạy trên đúng form test đã cung cấp.');
        if(page.blocked)throw new Error('Google đang yêu cầu xác thực hoặc form không nhận phản hồi.');
        if(page.draftRefresh&&!attempted){
          await input.onProgress('Google có bản nháp mới hơn. Tool đang đối chiếu lại trước khi áp dụng snapshot hồ sơ.');
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
        if(!input.managed)await navigator.locks.request('hanu-profile-start',async()=>{await guard();await chrome.storage.local.set({googleDirectLease:{runId,tabId,active:true}});});
        if(!input.resume&&chrome.tabs?.create){
          const fresh=await chrome.tabs.create({url,active:true});
          if(fresh.id===undefined)throw new Error('Không mở được tab form mới.');
          tabId=fresh.id;
        }
        await input.onTab?.(tabId);
        const stop=()=>{void chrome.scripting.executeScript({target:{tabId},world:'MAIN',func:cancelExecutionPage}).catch(()=>{});};
        input.signal.addEventListener('abort',stop,{once:true});
        removeStop=()=>input.signal.removeEventListener('abort',stop);
        await guard();
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
        expectedSchema??=directSchemaFingerprint(parseDirectSchema(page.script));
        if(directSchemaFingerprint(parseDirectSchema(page.script))!==expectedSchema)throw new Error('Schema form đã thay đổi. Đọc lại form trước khi gửi.');
        account=page.account;
        if(input.expectedEmail&&account.toLowerCase()!==input.expectedEmail.toLowerCase())throw new Error('Tài khoản Google không khớp email đã gán cho profile.');
        if(!account)throw new Error('Chưa xác định được tài khoản Google của form.');
        lockKey=`googleDirectSubmit:${formId}:${account.toLowerCase()}`;
        const prior=(await chrome.storage.local.get(lockKey))[lockKey];
        if(prior&&!['received','not_received'].includes(prior.status))throw new Error('Lượt Direct trước chưa rõ kết quả. Đối chiếu phản hồi trước khi tạo lượt mới.');
        await chrome.scripting.executeScript({target:{tabId},world:'MAIN',func:resetExecutionPage});
        const effectiveOverrides=await input.onSchema?.(tabId)??input.overrides;
        const schema=parseDirectSchema(page.script);
        if(input.manualFinal){
          if(page.documentKey!==input.manualFinal)throw new Error('Trang đã thay đổi sau thao tác Gửi; kiểm tra lại trước khi tiếp tục.');
          if(page.hasNext||!page.hasSubmit)throw new Error('Chưa tới trang Gửi. Tiếp tục các trang trên Google trước.');
          if(!(await chrome.scripting.executeScript({target:{tabId},func:directManualReady,args:[input.manualFinal]}))[0]?.result)throw new Error('Google chưa kiểm tra dữ liệu cho thao tác Gửi này.');
        }
        const plan=buildDirectPlan(schema,input.profile,formId,effectiveOverrides);
        const prepareNativeSection=async(section:typeof schema.sections[number])=>{
          for(const q of section.questions.filter(q=>q.kind!=='file')){
            const answer=plan.answers.find(a=>a.questionId===q.id)!;
            if(answer.issue||!answer.values.length&&!q.required)continue;
            let done=false;const deadline=Date.now()+5000;
            while(Date.now()<deadline){
              await guard();const state=(await chrome.scripting.executeScript({target:{tabId},func:prepareUploadAnswer,args:[{questionId:q.id,entryId:q.entryId!,label:q.label,kind:q.kind,value:answer.values[0]??''}]}))[0]?.result;
              if(state?.done){done=true;break;}
              if(state?.keys){await dialogs!.keys(state.keys);await delay(100);continue;}
              if(state?.x===undefined||state.y===undefined)throw new Error(`Chưa chuẩn bị được ${q.label}.`);
              await dialogs!.click(state.x,state.y);await delay(100);
            }
            if(!done)throw new Error(`Chưa xác nhận được ${q.label}. Bạn có thể tiếp quản trên form.`);
          }
        };
        const problems=plan.answers.filter(a=>a.issue&&!schema.sections.flatMap(s=>s.questions).some(q=>q.id===a.questionId&&q.kind==='file'));
        if(plan.blockers.some(b=>/nhánh|Nhánh|vòng lặp/.test(b)))throw new Error(problems.map(a=>`${a.label}: ${a.issue}`).join(' · ')||'Chưa xác định được lộ trình form.');
        const fileQuestions=schema.sections.flatMap(s=>s.questions).filter(q=>q.kind==='file'&&plan.answers.some(a=>a.questionId===q.id));
        if(fileQuestions.length>1)throw new Error('Bản Lab hiện hỗ trợ một câu tải ảnh trên nhánh đã chọn.');
        const fileQuestion=fileQuestions[0];
        const answer=fileQuestion&&plan.answers.find(a=>a.questionId===fileQuestion.id);
        const ref=answer?.attachmentId?Object.values(input.profile.attachments).find(a=>a?.id===answer.attachmentId):undefined;
        const file=input.file??(ref?{name:ref.name,type:ref.type,blob:await getAttachment(ref.id)}:undefined);
        if(fileQuestion?.required&&!file?.blob)throw new Error('Thiếu ảnh đã lưu. Chọn ảnh fixture hoặc ảnh đã lưu trước khi chạy.');
        // The first native Next yields Google's real draft revision. Every later
        // request preserves the current server state rather than fabricating it.
        if((page.history.at(-1)??0)===0&&schema.sections[0].questions.length===0){
          await guard();dialogs.posting(true);
          await chrome.scripting.executeScript({target:{tabId},world:'MAIN',func:beginExecutionSession,args:[formId]});
          page=await changed(page);dialogs.posting(false);
        }
        let committedUpload=!!input.resume&&fileQuestion!==undefined&&plan.pageHistory.indexOf(page.history.at(-1)!)>plan.pageHistory.indexOf(schema.sections.findIndex(s=>s.questions.some(q=>q.id===fileQuestion.id)));
        const seen=new Map<number,number>();
        for(let step=0;step<schema.sections.length*3+1;step++){
          await guard();
          if(!page.hasForm){
            const received=hasSubmissionConfirmation({text:page.text,hasQuestions:false,hasNavigation:page.hasNext||page.hasSubmit,blocked:page.blocked});
            if(!attempted||!received)throw new Error('Google chưa trả xác nhận đã ghi lại phản hồi.');
            await chrome.storage.local.set({[lockKey]:{runId,status:'received',at:new Date().toISOString()}});
            await input.onProgress('Google xác nhận đã ghi lại phản hồi.');
            return {runId,status:'received',message:'Google xác nhận đã ghi lại phản hồi.',postCount:posts};
          }
          if(attempted)throw new Error('Google trả lại trang form sau request Gửi; giữ khóa và đối chiếu phản hồi, không tự gửi lại.');
          if(!page.script||directSchemaFingerprint(parseDirectSchema(page.script))!==expectedSchema)throw new Error('Schema form thay đổi trong lúc chạy.');
          const index=page.history.at(-1)??0;
          const visits=seen.get(index)??0;
          if(visits&&(!page.draftUpdated||visits>=3))throw new Error(`Google trả lại trang ${index+1}; kiểm tra dữ liệu/validation, chưa tự gửi lại.`);
          seen.set(index,visits+1);
          if(!plan.pageHistory.includes(index))throw new Error('Google chuyển sang nhánh khác với dữ liệu đã chuẩn bị.');
          const section=schema.sections[index];
          if(!section)throw new Error('Không xác định được trang hiện tại.');
          const problem=!input.manualFinal&&problems.find(a=>section.questions.some(q=>q.id===a.questionId));
          if(problem){
            const q=directQuestionSummary(section.questions.find(q=>q.id===problem.questionId)!);
            return {runId,status:'waiting',postCount:posts,message:`${problem.label}: ${problem.issue}`,issue:{reason:q.verification?'verification':'unknown_required',message:problem.issue!,questionId:q.id,questionLabel:q.label,question:q}};
          }
          await input.onProgress(`Trang ${index+1}/${schema.sections.length}: chuẩn bị request.`);
          if(fileQuestion&&file?.blob&&section.questions.some(q=>q.id===fileQuestion.id)){
            await input.onProgress('Đang tự tải ảnh đã lưu qua Google Picker…');
            const uploadInput={questionId:fileQuestion.id,entryId:fileQuestion.entryId!,label:fileQuestion.label,name:file.name,open:true};
            const deadline=Date.now()+130000;
            let opened=false,ready=false,checkedExisting=false;
            while(Date.now()<deadline){
              await guard();
              const state=(await chrome.scripting.executeScript({target:{tabId},func:inspectExecutionUpload,args:[{...uploadInput,open:!opened,replaceExisting:!checkedExisting}]}))[0]?.result;
              checkedExisting=true;
              if(state?.x!==undefined&&state.y!==undefined){await guard();await dialogs.click(state.x,state.y);await delay(100);continue;}
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
            await input.onProgress('Google đã nhận đúng ảnh. Đang xác nhận trạng thái upload của Google.');
            await prepareNativeSection(section);
            await guard();dialogs.posting(true);
            await chrome.scripting.executeScript({target:{tabId},world:'MAIN',func:beginExecutionSession,args:[formId]});
            page=await changed(page);dialogs.posting(false);committedUpload=true;continue;
          }
          const final=!page.hasNext&&page.hasSubmit;
          // After upload, let Google commit its own draft and navigate the real
          // page. Waiting/error states are therefore usable without the tool.
          if(committedUpload){
            if(!input.manualFinal)await prepareNativeSection(section);
            if(!final){
              await guard();dialogs.posting(true);
              await chrome.scripting.executeScript({target:{tabId},world:'MAIN',func:beginExecutionSession,args:[formId]});
              page=await changed(page);dialogs.posting(false);continue;
            }
          }
          if(final&&input.mode==='test'){
            await input.onProgress('Xong Test: đã chuẩn bị dữ liệu, dừng trước Gửi.');
            return {runId,status:'ready',message:'Chế độ Test không gửi phản hồi.',postCount:posts};
          }
          if(!page.hasNext&&!final)throw new Error('Chưa thấy bước Tiếp hoặc Gửi của Google.');
          if(final&&committedUpload&&!input.manualFinal){
            await guard();await chrome.scripting.executeScript({target:{tabId},world:'MAIN',func:armDirectManualSubmit});
            const checked=(await chrome.scripting.executeScript({target:{tabId},world:'MAIN',func:prepareDirectNativeSubmit,args:[page.documentKey]}))[0]?.result;
            if(!checked?.ready){
              const q=section.questions[0],summary=q&&directQuestionSummary(q);
              return {runId,status:'waiting',postCount:posts,message:checked?.message??'Google chưa kiểm tra xong dữ liệu.',issue:{reason:summary?.verification?'verification':'validation',message:checked?.message??'Kiểm tra trực tiếp trên Google Form.',questionId:q?.id,questionLabel:q?.label,question:summary}};
            }
          }
          const current=plan.answers.filter(a=>section.questions.some(q=>q.id===a.questionId));
          const request:PagePost={formId,documentKey:page.documentKey,account,requestId:`${runId}:${index}`,final,
            entries:input.manualFinal?[]:current.filter(a=>!a.issue&&!fileQuestions.some(q=>q.id===a.questionId)).flatMap(a=>(a.values.length?a.values:['']).map(v=>[`entry.${a.entryId}`,v] as [string,string])),
            sentinels:section.questions.filter(q=>['checkbox','radio','dropdown'].includes(q.kind)).map(q=>q.entryId!),
            uploadEntries:fileQuestions.filter(q=>q.kind==='file'&&(q.required||!!file?.blob)&&plan.pageHistory.indexOf(index)>=plan.pageHistory.indexOf(schema.sections.findIndex(s=>s.questions.some(item=>item.id===q.id)))).map(q=>q.entryId!),
            history:page.history,native:final&&committedUpload,manualReady:final&&committedUpload,route:plan.pageHistory,questionLabels:Object.fromEntries(section.questions.map(q=>[q.id,q.label]))};
          if(final){
            await guard();
            const verified=(await chrome.scripting.executeScript({target:{tabId},world:'MAIN',func:postExecutionPage,args:[{...request,validateOnly:true}]}))[0]?.result;
            if(!verified?.scheduled||verified.error)throw new Error(verified?.error??'Chưa xác nhận được dữ liệu Gửi.');
            await input.beforeSubmit?.();await guard();attempted=true;
            await chrome.storage.local.set({[lockKey]:{runId,status:'pending',at:new Date().toISOString()}});
            await input.onProgress('Đã khóa gửi. Đang gửi request cuối tới Google…');
          }
          posts++;
          dialogs.posting(true);
          const posted=await chrome.scripting.executeScript({target:{tabId},world:final||committedUpload?'MAIN':'ISOLATED',func:postExecutionPage,args:[request]});
          const injectionError=(posted[0] as {error?:unknown})?.error;
          if(injectionError)throw new Error(`Không thực thi được request trong trang Google: ${typeof injectionError==='object'&&injectionError&&'message' in injectionError?String(injectionError.message):String(injectionError)}`);
          if(posted[0]?.result?.error)throw new Error(posted[0].result.error);
          if(!posted[0]?.result?.scheduled)throw new Error('Google chưa xác nhận bộ gửi đã xử lý request; không tự gửi lại.');
          if(final&&request.native){page=await changed(page);dialogs.posting(false);continue;}
          if(final){
            const result=posted[0]?.result?.finalResult;
            if(!result?.received)throw new Error(result?.message??'Chưa nhận được kết quả request Gửi. Giữ khóa để đối chiếu.');
            await chrome.storage.local.set({[lockKey]:{runId,status:'received',at:new Date().toISOString()}});
            await input.onProgress(result.message);
            return {runId,status:'received',message:result.message,postCount:posts};
          }
          page=await changed(page);
          dialogs.posting(false);
        }
        throw new Error('Vượt số bước dự kiến của form.');
      }catch(error){
        const message=(error as Error).message;
        return {runId,status:attempted?'uncertain':input.signal.aborted?'stopped':'failed',message,postCount:posts};
      }finally{removeStop();uploads.cancel(tabId);await dialogs?.close();if(!input.managed){const lease=(await chrome.storage.local.get('googleDirectLease')).googleDirectLease;if(lease?.runId===runId)await chrome.storage.local.set({googleDirectLease:{...lease,active:false}});}}
    });
  }
  async resolveNotReceived(runId:string,formId:string=DIRECT_LAB_FORM_ID){
    return navigator.locks.request(`hanu-direct:${formId}`,async()=>{
      const data=await chrome.storage.local.get(null);
      const matches=Object.entries(data).filter(([key,value])=>key.startsWith(`googleDirectSubmit:${formId}:`)&&value?.runId===runId&&value.status==='pending');
      if(matches.length!==1)throw new Error('Không còn đúng khóa gửi chưa rõ của lượt này.');
      const [key,value]=matches[0];
      await chrome.storage.local.set({[key]:{...value,status:'not_received',resolvedAt:new Date().toISOString()}});
    });
  }
}
