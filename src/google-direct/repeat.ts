import {DIRECT_LAB_FORM_IDS} from './schema';
import type {FormEngine,RunState} from '../shared';

// An explicit new Direct run may repeat a completed LAB submission. Pending
// results still block, and the old run remains received in the audit history.
export function repeatableDirectLab(engine:FormEngine|undefined,formId:string):boolean {
  return engine==='direct'&&(DIRECT_LAB_FORM_IDS as readonly string[]).includes(formId);
}
export function canRepeatCompletedLab(run:RunState|undefined):boolean {
  return !!run&&run.status==='completed'&&run.submitAttempted&&repeatableDirectLab(run.engine,run.formId);
}
