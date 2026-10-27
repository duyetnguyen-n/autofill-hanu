import {expect,it} from 'vitest';
import {bindHskAnswer,hskVerificationCandidates,validateHskAnswer} from '../src/registration-schedule';
import type {RunState} from '../src/shared';
const run:RunState={runId:'run',tabId:1,formId:'four',mode:'test',status:'waiting_manual',filled:[],skipped:[],logs:[],submitAttempted:false,updatedAt:'',blockingIssue:{reason:'verification',questionLabel:'Câu xác thực HSK 4?',message:'Cần đáp án',question:{id:'local',targetId:'entry.40',label:'Câu xác thực HSK 4?',required:true,kind:'text',filled:false,options:[],verification:true}}};
it('accepts an answer without knowing the question, and binds only when the exact verification blocker arrives',()=>{
 expect(()=>validateHskAnswer({value:'HANU'})).not.toThrow();
 expect(bindHskAnswer({value:'HANU'},run)).toEqual({value:'HANU',label:'Câu xác thực HSK 4?',formId:'four',questionId:'entry.40',kind:'text'});
});
it.each(['captcha','file_upload','unknown_required'] as const)('never binds an answer-only draft to %s',reason=>{
 expect(bindHskAnswer({value:'HANU'},{...run,blockingIssue:{reason,message:'Cần xử lý',questionLabel:'Câu khác'}})).toBeUndefined();
});
it('rejects incomplete data and preserves existing explicit question/form checks',()=>{
 for(const q of [{value:''},{value:1},{value:'A',formId:'other'},{value:'A',label:''}])expect(()=>validateHskAnswer(q)).toThrow();
 expect(bindHskAnswer({label:'Câu khác',value:'A'},run)).toBeUndefined();
 expect(bindHskAnswer({value:'A'},{...run,submitAttempted:true})).toBeUndefined();
 expect(bindHskAnswer({value:'A'},{...run,blockingIssue:{reason:'verification',message:'Không đọc được câu'}})).toBeUndefined();
});
const unknownRun:RunState={...run,blockingIssue:{...run.blockingIssue!,reason:'unknown_required',question:{...run.blockingIssue!.question!,verification:false}}};
const selected={value:'HANU',label:'Câu xác thực HSK 4?',formId:'four',questionId:'entry.40',kind:'text' as const};
it('allows an explicit form/entry/type selection of the exact unknown blocker',()=>{
 expect(bindHskAnswer(selected,unknownRun)).toEqual(selected);
 expect(bindHskAnswer({value:'HANU'},unknownRun)).toBeUndefined();
});
it.each([{formId:'five'},{questionId:'entry.other'},{kind:'radio' as const},{label:'Câu khác'},{questionId:undefined},{kind:undefined},{formId:undefined}])('rejects an unknown target with mismatched or incomplete identity: %j',extra=>{
 expect(bindHskAnswer({...selected,...extra},unknownRun)).toBeUndefined();
});
it.each(['captcha','file_upload','account'] as const)('never applies an explicit fallback across %s',reason=>{
 expect(bindHskAnswer(selected,{...unknownRun,blockingIssue:{...unknownRun.blockingIssue!,reason}})).toBeUndefined();
});
it('offers only the exact unknown blocker and recognized verification, excluding unrelated/unsupported fields',()=>{
 const q=unknownRun.blockingIssue!.question!;
 const other={...q,id:'other',targetId:'entry.other'};
 expect(hskVerificationCandidates([q,other,{...q,id:'file',kind:'file'},{...q,id:'captcha',kind:'unknown'}],unknownRun.blockingIssue)).toEqual([q]);
 expect(hskVerificationCandidates([q,other])).toEqual([]);
 expect(hskVerificationCandidates([{...other,verification:true}],unknownRun.blockingIssue)).toHaveLength(1);
});
it('preserves verification reads from older blockers with only a label or local ID',()=>{
 const q={...run.blockingIssue!.question!,verification:false};
 expect(hskVerificationCandidates([q],{reason:'verification',message:'Cần đáp án',questionLabel:q.label})).toEqual([q]);
 expect(hskVerificationCandidates([q],{reason:'verification',message:'Cần đáp án',questionId:q.id})).toEqual([q]);
});
