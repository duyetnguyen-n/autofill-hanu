import {normalize,type FormQuestionSummary} from '../shared';
import type {DirectQuestion} from './schema';
export function directVerification(label:string):boolean {
  return /câu hỏi xác thực|verification|captcha|robot|bot|năm nay là năm bao nhiêu|今年是哪一年/i.test(label)
    || /\ble phi thi\b.*\bhsk\s*[1-6]?\b.*\bbao nhieu\b/.test(normalize(label));
}
export function directQuestionSummary(q:DirectQuestion):FormQuestionSummary {
  return {id:q.id,targetId:q.entryId?`entry.${q.entryId}`:q.id,label:q.label,required:q.required,
    kind:q.kind==='unsupported'?'unknown':q.kind,filled:false,options:q.options.map(o=>o.value),verification:directVerification(q.label)};
}
