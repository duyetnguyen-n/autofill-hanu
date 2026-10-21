import {expect,it} from 'vitest';
import {bindHskAnswer,validateHskAnswer} from '../src/registration-schedule';
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
