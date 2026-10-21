import React,{useEffect,useRef,useState} from 'react';
import {Button,Field,Input,Select} from '@fluentui/react-components';
import type {SessionView} from '../../src/protocol';
import type {FinalQuestion,FormQuestionSummary} from '../../src/shared';
import type {HskLevel,HskVerificationAnswer} from '../../src/registration-schedule';

type ReadForm={formId:string;questions:FormQuestionSummary[]};
/** Answers may be entered before the question is known; identity comes from the actual form. */
export function HskVerification({level,sessions,saved,scope,busy,onDraft,save,scan,shared=false,currentRunIds}:{level:HskLevel;sessions:SessionView[];saved?:HskVerificationAnswer;scope:string;busy:boolean;shared?:boolean;currentRunIds?:Record<string,string>;onDraft:(q:HskVerificationAnswer|undefined,valid:boolean)=>void;save?:(q:HskVerificationAnswer|undefined)=>Promise<unknown>;scan:(id:string)=>Promise<ReadForm>}){
  const [draft,setDraft]=useState<HskVerificationAnswer>(saved??{value:''}),[detected,setDetected]=useState<FinalQuestion>(),[choices,setChoices]=useState<{formId:string;questions:FormQuestionSummary[]}>(),[error,setError]=useState(''),[working,setWorking]=useState(false),[message,setMessage]=useState('');
  const generation=useRef(0),edited=useRef(false);
  useEffect(()=>{generation.current++;edited.current=false;setDraft(saved??{value:''});setDetected(undefined);setChoices(undefined);setMessage('');setError('');setWorking(false);},[scope]);
  useEffect(()=>{if(saved&&!edited.current)setDraft(saved);},[saved]);
  const current=sessions.filter(s=>!currentRunIds||!!s.run?.runId&&currentRunIds[s.id]===s.run.runId);
  const waiting=current.filter(s=>s.run?.status==='waiting_manual'&&s.run.blockingIssue?.reason==='verification');
  const arrived=waiting.find(s=>s.run?.blockingIssue?.questionLabel||s.run?.blockingIssue?.question?.label)?.run;
  const issue=arrived?.blockingIssue,summary=issue?.question;
  const label=issue?.questionLabel||summary?.label;
  const previous=current.find(s=>s.run?.finalQuestion&&(!s.run.finalQuestion.formId||s.run.finalQuestion.formId===s.run.formId))?.run?.finalQuestion;
  const actual:FinalQuestion|undefined=label?{label,value:draft.value,formId:arrived!.formId,...(summary?.targetId?{questionId:summary.targetId}:{}),...(summary&&summary.kind!=='unknown'&&summary.kind!=='file'?{kind:summary.kind}:{})}:detected??previous??(draft.label?{...draft,label:draft.label}:undefined);
  const valid=!!draft.value.trim();
  const answer:HskVerificationAnswer=actual?{...actual,value:draft.value}:{value:draft.value};
  const unreadable=waiting.filter(s=>!s.run?.blockingIssue?.questionLabel?.trim()&&!s.run?.blockingIssue?.question?.label?.trim());
  const missing=unreadable.length?`Profile đã tới câu xác thực nhưng không đọc được nội dung (${unreadable.map(s=>s.name).join(', ')}). Bấm Lấy câu xác thực ngay.`:'';
  const options=summary?.options??choices?.questions.find(q=>q.label===actual?.label)?.options??[];
  const changed=useRef(onDraft);changed.current=onDraft;
  useEffect(()=>{changed.current(valid?{value:draft.value}:undefined,true);},[scope,answer.label,answer.value,answer.kind,answer.formId,answer.questionId,valid]);
  const title=shared?'Câu xác thực form thử':`Câu xác thực HSK ${level}`,answerLabel=shared?'Đáp án form thử':`Đáp án HSK ${level}`;
  function edit(value:string){edited.current=true;setMessage('');setDraft(d=>({...d,value}));}
  async function select(q:FormQuestionSummary,formId:string){
    const gen=generation.current;
    const next:FinalQuestion={value:draft.value,label:q.label,formId,...(q.targetId?{questionId:q.targetId}:{}),...(q.kind!=='unknown'&&q.kind!=='file'?{kind:q.kind}:{})};
    setDetected(next);setError('');
    if(save&&draft.value.trim()){await save(next);if(gen!==generation.current)return;edited.current=false;setDraft(next);setMessage('Đã lấy câu và áp dụng đáp án đã nhập.');}
  }
  async function read(){
    setError('');setMessage('');
    const source=unreadable.find(s=>s.connected)??waiting.find(s=>s.connected)??sessions.find(s=>s.connected);
    if(!source){setError('Không có profile đang kết nối để lấy câu xác thực. Mở Chrome profile hoặc kiểm tra kết nối.');return;}
    const gen=generation.current;setWorking(true);
    try{
      let timer:ReturnType<typeof setTimeout>|undefined;
      const result=await Promise.race([scan(source.id),new Promise<ReadForm>((_,reject)=>{timer=setTimeout(()=>reject(new Error('Không lấy được câu xác thực trong 2,5 giây. Kiểm tra kết nối và bấm lấy lại.')),2500);})]).finally(()=>clearTimeout(timer));if(gen!==generation.current)return;
      if(source.run?.formId&&result.formId!==source.run.formId)throw new Error('Profile đang mở form khác. Kiểm tra đúng form rồi lấy lại câu.');
      if(!Array.isArray(result.questions))throw new Error('Form không trả được nội dung câu hỏi. Bấm Lấy câu xác thực để thử lại.');
      const blocker=source.run?.blockingIssue;
      const candidates=result.questions.filter(q=>q.kind!=='file'&&q.kind!=='unknown'&&(q.verification===true||blocker?.reason==='verification'&&(q.id===blocker.questionId||q.label===blocker.questionLabel)));
      setChoices({formId:result.formId,questions:candidates});
      if(!candidates.length)throw new Error('Không đọc được câu xác thực trên trang hiện tại. Kiểm tra form; bạn vẫn có thể nhập và lưu đáp án trước.');
      if(candidates.length>1)throw new Error('Form có nhiều câu xác thực. Chọn đúng câu trong danh sách ngay bên dưới.');
      await select(candidates[0],result.formId);
    }catch(e){if(gen===generation.current)setError((e as Error).message);}finally{if(gen===generation.current)setWorking(false);}
  }
  async function apply(){if(!valid||!save)return;const gen=generation.current;setWorking(true);setError('');try{await save(answer);if(gen!==generation.current)return;edited.current=false;setDraft(answer);setMessage(actual?'Đã lưu. Các profile cùng cấp đến sau sẽ tự dùng đáp án này.':'Đã lưu đáp án trước. Tới câu xác thực sẽ tự ghép và áp dụng.');}catch(e){if(gen===generation.current)setError((e as Error).message);}finally{if(gen===generation.current)setWorking(false);}}
  return <div className="hsk-verification">
    <div className="hsk-question-title"><strong>{title}</strong><span>{waiting.length?`${waiting.length} profile đã tới câu xác thực`:shared?'Dùng chung cho form diễn tập':'Nhập đáp án trước, không cần biết câu hỏi'}</span></div>
    <div className="hsk-question-preview" role="status">{actual?.label||'Chưa tới câu xác thực. Bạn có thể nhập sẵn đáp án ngay bên dưới.'}</div>
    {(error||missing)&&<p className="schedule-error" role="alert">{error||missing}</p>}
    <div className="hsk-answer-line"><Field label={answerLabel} hint="Biết đáp án thì nhập trước. Không cần nhập nội dung câu hỏi.">
      {options.length&&['radio','dropdown','checkbox'].includes(actual?.kind??'')?<Select value={draft.value} onChange={e=>edit(e.target.value)}><option value="">Chọn đáp án</option>{draft.value&&!options.includes(draft.value)&&<option value={draft.value}>{draft.value}</option>}{options.map(o=><option key={o} value={o}>{o}</option>)}</Select>:<Input value={draft.value} placeholder="Nhập sẵn đáp án · Enter để lưu" onChange={(_,d)=>edit(d.value)} onKeyDown={e=>{if(e.key==='Enter'){e.preventDefault();void apply();}}}/>}</Field>
      {save&&<Button appearance="primary" disabled={busy||working||!valid} onClick={()=>void apply()}>{working?'Đang xử lý…':actual?'Lưu & tự tiếp tục':'Lưu đáp án trước'}</Button>}
      <Button appearance={missing||error?'primary':'subtle'} disabled={busy||working} onClick={()=>void read()}>{working?'Đang lấy câu…':'Lấy câu xác thực'}</Button>
    </div>
    {choices&&choices.questions.length>1&&<Field label="Chọn câu xác thực trên form"><Select value={actual?.label??''} onChange={e=>{const q=choices.questions.find(q=>q.label===e.target.value);if(q){setWorking(true);void select(q,choices.formId).catch(e=>setError(e.message)).finally(()=>setWorking(false));}}}><option value="">Chọn đúng câu</option>{choices.questions.map(q=><option key={q.id} value={q.label}>{q.label}</option>)}</Select></Field>}
    {save&&saved&&<Button appearance="subtle" size="small" disabled={busy||working} onClick={()=>{setWorking(true);void save(undefined).then(()=>{edited.current=false;setDraft({value:''});setMessage('Đã xóa đáp án.');}).catch(e=>setError(e.message)).finally(()=>setWorking(false));}}>Xóa đáp án {shared?'form thử':`HSK ${level}`}</Button>}
    {message&&<p className="schedule-feedback" role="status">{message}</p>}
  </div>;
}
