import {expect,it} from 'vitest';
import {directFormId} from '../src/google-direct/schema';
import {repeatableDirectLab,canRepeatCompletedRun} from '../src/google-direct/repeat';
import type {RunState} from '../src/shared';

it.each([undefined,'classic','direct'] as const)('offers Restart for confirmed completion regardless of engine or LAB ID (%s)',engine=>{
 const run={engine,formId:'any-registration-form',status:'completed',submitAttempted:true} as RunState;
 expect(canRepeatCompletedRun(run)).toBe(true);
 expect(canRepeatCompletedRun({...run,status:'submit_uncertain'})).toBe(false);
 expect(canRepeatCompletedRun({...run,submitAttempted:false})).toBe(false);
 expect(canRepeatCompletedRun(undefined)).toBe(false);
});

it.each(['fresh-form-A','fresh_form_B','1FAIpQLSdwGr_cZjiXs_AapAIHmP1cdHp5q4_tLWI3fNytLWHtUJW5JQ'])('accepts an unfamiliar Google responder ID %s',id=>{
  expect(directFormId(`https://docs.google.com/forms/d/e/${id}/viewform?usp=header`)).toBe(id);
  expect(directFormId(`https://docs.google.com/forms/u/2/d/e/${id}/formResponse?pli=1`)).toBe(id);
  expect(repeatableDirectLab('direct',id)).toBe(false);
});
it.each(['not-a-url','http://docs.google.com/forms/d/e/x/viewform','https://example.com/forms/d/e/x/viewform','https://docs.google.com.evil.test/forms/d/e/x/viewform','https://user:password@docs.google.com/forms/d/e/x/viewform','https://docs.google.com/forms/d/e/x/edit','https://docs.google.com/forms/d/e/x/viewform/extra','https://docs.google.com/forms/d/e/x%2Fy/viewform'])('rejects invalid or mismatched responder target %s',url=>{
  expect(()=>directFormId(url)).toThrow();
});
