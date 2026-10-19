import {expect,it} from 'vitest';
import {automaticRecoveryAllowed,classifyPage,recoveryDelay,validCorrections} from '../src/recovery';
import {currentExecution} from '../src/protocol';
import {commandStatus,runStatusLabel,submissionReviewMessage} from '../src/run-presentation';
import type {RunState} from '../src/shared';
const page={text:'',hasQuestions:false,hasNavigation:false,captcha:false,online:true};
const run:RunState={runId:'run',tabId:1,formId:'form',mode:'test',status:'waiting_manual',filled:[],skipped:[],logs:[],submitAttempted:false,updatedAt:'',blockingIssue:{reason:'server_error',message:'500'},recovery:{reason:'server_error',attempt:1,automatic:true,retryAt:new Date(1000).toISOString()}};
it.each(['500. That’s an error.','502 Bad Gateway','503 Service Unavailable','504 Gateway Timeout','429 Too Many Requests'])('classifies a Google error document as retryable: %s',text=>{
 expect(classifyPage({...page,text})).toMatchObject({retryable:true,issue:{reason:'server_error'}});
});
it('does not mistake a form mentioning status codes for an error document',()=>{
 expect(classifyPage({...page,text:'500. That’s an error.',hasQuestions:true})).toEqual({});
 expect(classifyPage({...page,text:'503 Service Unavailable',hasNavigation:true})).toEqual({});
});
it('keeps CAPTCHA, closed forms and account permission failures out of automatic retries',()=>{
 for(const input of [{captcha:true},{text:'This form is no longer accepting responses.'},{text:'You need permission to access this form.'}])expect(classifyPage({...page,...input}).retryable).not.toBe(true);
 expect(classifyPage({...page,online:false,captcha:true}).issue?.reason).toBe('captcha');
 expect(classifyPage({...page,online:false})).toMatchObject({retryable:true,issue:{reason:'network'}});
});
it('uses bounded increasing delays and jitter so profiles do not retry in lockstep',()=>{
 expect([1,2,3].map(n=>recoveryDelay(n,0))).toEqual([2000,5000,12000]);
 expect(recoveryDelay(1,1)).toBe(3500);expect(recoveryDelay(99,0)).toBe(12000);
});
it('allows only a due, same-reason, unsubmitted retry with an active recovery intent',()=>{
 expect(automaticRecoveryAllowed(run,1000)).toBe(true);
 for(const change of [{submitAttempted:true},{recoveryRequired:true},{status:'idle'},{status:'paused'},{status:'completed'},{blockingIssue:{reason:'captcha',message:'wait'}},{recovery:{...run.recovery!,automatic:false}},{recovery:{...run.recovery!,attempt:4}},{recovery:{...run.recovery!,retryAt:'invalid'}}])expect(automaticRecoveryAllowed({...run,...change} as RunState,1000)).toBe(false);
 expect(automaticRecoveryAllowed(run,999)).toBe(false);
});
it('bounds saved corrections and rejects file payloads or malformed values',()=>{
 expect(validCorrections({'entry.1':{label:'Phone',kind:'text',values:['0900000000']}})).toBe(true);
 for(const value of [null,[],{'x':{label:'Photo',kind:'file',values:['path']}},{'x':{label:'Phone',kind:'text',values:[42]}},Object.fromEntries(Array.from({length:101},(_,i)=>[i,{label:'q',kind:'text',values:['v']}]))])expect(validCorrections(value)).toBe(false);
});
it('fences old managed execution reports, including null acknowledgements from old runs',()=>{
 const current={...run,runId:'new',status:'idle' as const,eventSeq:10};
 const execution={runId:'old',managed:true,tabId:1,mode:'test' as const,status:'running' as const,tabOpen:true,updatedAt:''};
 expect(currentExecution(current,execution)).toBe(false);expect(currentExecution(current,null,'old')).toBe(false);
 expect(currentExecution(current,{...execution,runId:'new',eventSeq:9})).toBe(false);
 expect(currentExecution(current,{...execution,runId:'new',eventSeq:11})).toBe(false);
 expect(currentExecution(current,null,'new')).toBe(true);
});
it('presents recovery, CAPTCHA and uncertain sends distinctly without treating them as completion',()=>{
 expect(runStatusLabel(run)).toContain('Chờ thử lại');
 expect(runStatusLabel({...run,recovery:undefined,blockingIssue:{reason:'captcha',message:'wait'}})).toBe('Chờ xác thực Google');
 expect(runStatusLabel({...run,submitAttempted:true})).toBe('Chưa rõ đã gửi');
 expect(commandStatus({commandId:'x',kind:'STOP_PROFILE',state:'pending',requestedAt:'',updatedAt:'',runId:'run'},run)).toContain('xác nhận Dừng');
 expect(commandStatus({commandId:'x',kind:'STOP_PROFILE',state:'pending',requestedAt:'',updatedAt:'',runId:'old'},run)).toBeUndefined();
});
it('explains why Restart is unavailable even after Stop of a reserved send',()=>{
 expect(submissionReviewMessage({...run,status:'submit_uncertain',submitAttempted:true,blockingIssue:undefined})).toContain('Chạy lại đang khóa');
 expect(submissionReviewMessage({...run,submitAttempted:false})).toBeUndefined();
 expect(submissionReviewMessage({...run,status:'completed',submitAttempted:true})).toBeUndefined();
 expect(submissionReviewMessage({...run,status:'idle',submitAttempted:true})).toBeUndefined();
 expect(runStatusLabel({...run,status:'idle',submitAttempted:true})).toBe('Đã xác minh chưa gửi');
});

it('requires persistent intent and a different document before allowing a bounded returned-form submission',async()=>{
 const {returnedSubmissionAllowed,pageReadyResumeAllowed}=await import('../src/recovery');
 const candidate:RunState={...run,mode:'live',status:'submit_uncertain',autoContinue:true,retryOnReturn:true,submitAttempted:true,submissionEpoch:'old',contentEpoch:'new'};
 expect(returnedSubmissionAllowed(candidate)).toBe(true);
 for(const patch of [{autoContinue:false},{retryOnReturn:false},{mode:'test'},{status:'paused'},{status:'completed'},{recoveryRequired:true},{submissionEpoch:undefined},{contentEpoch:'old'},{submissionRetries:2}])expect(returnedSubmissionAllowed({...candidate,...patch} as RunState)).toBe(false);
 expect(pageReadyResumeAllowed({...run,autoContinue:true,blockingIssue:{reason:'captcha',message:'wait'}})).toBe(true);
 expect(pageReadyResumeAllowed({...run,autoContinue:false})).toBe(false);
});
