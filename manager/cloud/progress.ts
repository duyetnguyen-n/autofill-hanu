import type { RunState } from '../../src/shared';

export function validCloudProgress(run: RunState): boolean {
  return !!run && Array.isArray(run.logs) && run.logs.length <= 2000 &&
    !run.logs.some(log => !log || typeof log.message !== 'string' || typeof log.at !== 'string' || !['info', 'warning', 'error', 'success'].includes(log.level)) &&
    Number.isSafeInteger(run.eventSeq) && run.eventSeq! >= 0 && run.eventSeq! <= 2147483647 &&
    typeof run.formId === 'string' && run.formId.length <= 300 && typeof run.submitAttempted === 'boolean' &&
    ['idle', 'running', 'paused', 'waiting_manual', 'ready_to_submit', 'submitting', 'completed', 'submit_uncertain', 'failed'].includes(run.status) &&
    (!run.blockingIssue || typeof run.blockingIssue.message === 'string');
}
