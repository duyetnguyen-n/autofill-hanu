import {DIRECT_LAB_FORM_IDS} from './schema';
import type {FormEngine,RunState} from '../shared';

// LAB identity is used only for compatibility with older Direct extensions.
// Completed runs of either engine can be explicitly started again on any form.
// Pending results and repeated grants for the SAME run must remain blocked.
export function repeatableDirectLab(engine:FormEngine|undefined,formId:string):boolean {
  return engine==='direct'&&(DIRECT_LAB_FORM_IDS as readonly string[]).includes(formId);
}
export function canRepeatCompletedRun(run:RunState|undefined):boolean {
  return !!run&&run.status==='completed'&&run.submitAttempted;
}
