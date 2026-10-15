import React,{useEffect,useState,useRef} from 'react';
import {Button,Field,Input,Select,Textarea} from '@fluentui/react-components';
import type {SessionView} from '../../src/protocol';
import {canonicalFormId} from '../../src/protocol';
import {canApplyFinalQuestion,FINAL_QUESTION_KINDS,normalize,type FinalQuestion,type FormQuestionSummary} from '../../src/shared';

const kindLabels:Record<string,string>={text:'Trả lời ngắn',textarea:'Đoạn văn',radio:'Chọn một đáp án',checkbox:'Hộp kiểm (một đáp án)',dropdown:'Danh sách chọn',date:'Ngày',unknown:'Chưa nhận diện',file:'Upload tệp'};
type Scan={formId:string;url:string;questions:FormQuestionSummary[]};
const supported=(q:FormQuestionSummary)=>q.kind!=='unknown'&&q.kind!=='file';
export function FinalQuestionEditor({url,sessions,busy,onChange,scan,apply}:{url:string;sessions:SessionView[];busy:boolean;onChange:(q:FinalQuestion|undefined,valid:boolean)=>void;scan:(id:string)=>Promise<Scan>;apply:(q:FinalQuestion)=>void}){
  const [draft,setDraft]=useState<FinalQuestion>({label:'',value:''}),[source,setSource]=useState(''),[read,setRead]=useState<Scan>(),[error,setError]=useState(''),[reading,setReading]=useState(false);
  const readGeneration=useRef(0);
  useEffect(()=>{readGeneration.current++;setDraft({label:'',value:''});setRead(undefined);setError('');setReading(false);},[url]);
  const enabled=!!draft.label.trim()||!!draft.value.trim(),valid=!enabled||!!draft.label.trim()&&!!draft.value.trim();
  useEffect(()=>onChange(enabled?draft:undefined,valid),[enabled,draft,valid,onChange]);
  const connected=sessions.filter(s=>s.connected);
  const suggested=connected.find(s=>s.run?.status==='waiting_manual'&&s.run.blockingIssue?.reason==='verification')??connected.find(s=>!['running','submitting'].includes((s.execution??s.run)?.status??''))??connected[0];
  const selectedSource=connected.find(s=>s.id===source);
  const sourceId=selectedSource&&!['running','submitting'].includes((selectedSource.execution??selectedSource.run)?.status??'')?source:suggested?.id;
  const sourceSession=connected.find(s=>s.id===sourceId),sourceRun=sourceSession?.execution??sourceSession?.run;
  const sourceRunning=!!sourceRun&&['running','submitting'].includes(sourceRun.status);
  const waiting=sessions.filter(s=>s.connected&&canApplyFinalQuestion(s.run,enabled?draft:undefined)).length;
  const hasRuns=sessions.some(s=>s.run&&s.run.status!=='idle');
  function selectQuestion(q:FormQuestionSummary,result:Scan){
    setDraft(old=>({...old,label:q.label,kind:q.kind as FinalQuestion['kind'],formId:result.formId,questionId:q.targetId}));
  }
  async function readQuestions(){
    if(!sourceId)return;setReading(true);setError('');
    const generation=++readGeneration.current;
    try{
      const result=await scan(sourceId),form=canonicalFormId(url);
      if(generation!==readGeneration.current)return;
      if(form&&form!==result.formId)throw new Error('Profile đang mở form khác với link đăng ký. Mở đúng form rồi đọc lại.');
      // Prefer the precise verification blocker. Older scanners append account-email checkboxes.
      const issue=sourceSession?.run?.blockingIssue;
      const blocked=issue?.reason==='verification'?result.questions.find(q=>q.id===issue.questionId||q.label===issue.questionLabel):undefined;
      const questions=result.questions.filter(q=>!/^record .+ as the email to be included with my response$/i.test(q.label)&&!/^luu lai .+ duoi dang email de them vao cau tra loi cua toi$/.test(normalize(q.label)));
      const q=blocked??questions.at(-1);
      setRead(result);
      if(!q)throw new Error('Chưa đọc được câu hỏi. Mở trang chứa câu cuối rồi đọc lại.');
      if(!supported(q))throw new Error(`Câu cuối là ${kindLabels[q.kind].toLowerCase()}, chưa hỗ trợ đáp án chung. Chọn câu khác trong mục bên dưới nếu cần.`);
      selectQuestion(q,result);
    }catch(e){if(generation===readGeneration.current){setDraft(old=>({...old,label:'',kind:undefined,formId:undefined,questionId:undefined}));setError((e as Error).message);}}finally{if(generation===readGeneration.current)setReading(false);}
  }
  const chosen=read?.questions.find(q=>draft.questionId?q.targetId===draft.questionId:q.label===draft.label);
  const chosenIndex=read?.questions.findIndex(q=>draft.questionId?q.targetId===draft.questionId:q.label===draft.label)??-1;
  function clear(){setDraft({label:'',value:''});setRead(undefined);setError('');}
  return <section className="final-question" aria-label="Câu hỏi cuối dùng chung">
    <div className="final-question-heading"><div><strong>Câu hỏi cuối</strong><p>Một đáp án cho {sessions.length?sessions.length:'các'} profile đã chọn.</p></div><Button disabled={busy||reading||!sourceId||sourceRunning} onClick={()=>void readQuestions()}>{reading?'Đang đọc':'Đọc câu hỏi trên form'}</Button></div>
    <div className="final-question-simple">
      <div className="final-question-preview" role="status">{draft.label?<><span>Câu hỏi đã nhận diện · {draft.kind?kindLabels[draft.kind]:'Tự nhận diện loại'}</span><strong>{draft.label}</strong></>:<p>Chọn các profile rồi bấm Đọc câu hỏi trên form. Câu cuối và loại trường sẽ hiện ở đây.</p>}</div>
      <Field label="Đáp án chung">
        {chosen?.options.length&&['radio','checkbox','dropdown'].includes(chosen.kind)?<Select value={draft.value} onChange={e=>setDraft(old=>({...old,value:e.target.value}))}><option value="">Chọn đáp án</option>{!chosen.options.includes(draft.value)&&draft.value&&<option value={draft.value}>{draft.value}</option>}{chosen.options.map(value=><option key={value} value={value}>{value}</option>)}</Select>:draft.kind==='textarea'?<Textarea value={draft.value} placeholder="Nhập đáp án chung" onChange={(_,d)=>setDraft(old=>({...old,value:d.value}))}/>:<Input value={draft.value} placeholder="Ví dụ: 2026" onChange={(_,d)=>setDraft(old=>({...old,value:d.value}))}/>}
      </Field>
    </div>
    <div className="final-question-footer"><span>{sourceSession?`Đọc từ ${sourceSession.name}.`:'Chọn ít nhất một profile đang kết nối.'} {hasRuns?`${waiting}/${sessions.length} profile đã tới câu hỏi này. Profile còn lại giữ nguyên, có thể áp dụng sau. Test dừng trước Gửi; Live tiếp tục theo chế độ của lượt.`:sourceRunning?'Tạm dừng lượt trước khi đọc.':'Đáp án sẽ áp dụng khi bắt đầu lượt.'}</span>{hasRuns&&<Button appearance="primary" disabled={busy||!enabled||!valid||!waiting} onClick={()=>apply(draft)}>Áp dụng và tiếp tục {waiting} profile đã tới câu cuối</Button>}</div>
    {error&&<p className="final-question-error" role="alert">{error}</p>}
    <details className="final-question-options"><summary>Chọn câu khác / nhập trước</summary><div className="final-question-fields">
      <Field label="Profile để đọc câu hỏi"><Select value={sourceId??''} disabled={!connected.length||reading} onChange={e=>setSource(e.target.value)}>{!connected.length&&<option value="">Chọn profile đang kết nối</option>}{connected.map(s=><option key={s.id} value={s.id}>{s.name}</option>)}</Select></Field>
      <Field label="Nội dung chính xác của câu hỏi cuối"><Textarea value={draft.label} placeholder="Nhập nội dung nếu bạn đã biết trước" onChange={(_,d)=>setDraft(old=>({...old,label:d.value,questionId:undefined,formId:undefined}))}/></Field>
      <Field label="Loại trường câu hỏi cuối"><Select value={draft.kind??''} onChange={e=>setDraft(old=>({...old,kind:(e.target.value||undefined) as FinalQuestion['kind']}))}><option value="">Tự nhận diện trên form</option>{FINAL_QUESTION_KINDS.map(k=><option key={k} value={k}>{kindLabels[k]}</option>)}</Select></Field>
    </div>
    {read&&read.questions.length>1&&<Field label="Chọn câu hỏi khác"><Select value={chosenIndex<0?'':String(chosenIndex)} onChange={e=>{const q=read.questions[Number(e.target.value)];if(q){selectQuestion(q,read);setError('');}}}>{read.questions.map((q,i)=><option key={i} value={i} disabled={!supported(q)}>{q.label} · {kindLabels[q.kind]}</option>)}</Select></Field>}
    <Button appearance="subtle" onClick={clear}>Không dùng đáp án chung</Button></details>
  </section>;
}
