import type {ControlReceipt,ExecutionView} from './protocol';
import type {RunState} from './shared';

export function displayedRun(run:RunState|undefined,execution:ExecutionView|null|undefined):RunState|ExecutionView|undefined {
  if(!execution)return run;
  // The coordinator starts the clock before preflight/opening. A matching
  // extension execution reports a later local start; keep the full duration.
  if(execution.managed&&execution.runId===run?.runId&&run?.startedAt)return {...execution,startedAt:run.startedAt};
  return execution;
}

export function runElapsed(run:(Pick<RunState,'startedAt'|'status'|'updatedAt'>&Partial<Pick<RunState,'logs'>>)|undefined,now=Date.now()):string {
  if(!run?.startedAt)return '⋯';
  // Rebinding a document updates updatedAt even after Stop. The final log
  // records when execution stopped; later page bookkeeping is not run time.
  const stopped=['idle','completed','failed','ready_to_submit'].includes(run.status);
  const end=['running','submitting'].includes(run.status)?now:Date.parse(stopped?(run.logs?.at(-1)?.at??run.updatedAt):run.updatedAt);
  const start=Date.parse(run.startedAt);
  if(!Number.isFinite(end)||!Number.isFinite(start))return '⋯';
  const seconds=Math.max(0,Math.floor((end-start)/1000));
  return `${Math.floor(seconds/60)}:${String(seconds%60).padStart(2,'0')}`;
}

const labels:Record<RunState['status'],string>={idle:'Đã dừng',running:'Đang chạy',paused:'Tạm dừng',waiting_manual:'Cần bạn xử lý',ready_to_submit:'Xong Test',submitting:'Đang xác nhận gửi',completed:'Đã gửi',submit_uncertain:'Chưa rõ đã gửi',failed:'Có lỗi'};
export function submissionReviewMessage(run:Pick<RunState,'status'|'submitAttempted'|'blockingIssue'>|undefined):string|undefined {
  if(!run?.submitAttempted||run.status==='completed'||run.status==='idle')return;
  return `${run.blockingIssue?.message??'Lượt đã giữ khóa gửi, chưa có xác nhận từ Google.'} Chạy lại đang khóa để tránh nộp trùng. Mở Xem form rồi Xác minh kết quả; không chọn “chưa gửi” chỉ vì trang lỗi hoặc CAPTCHA.`;
}
export function runStatusLabel(run:Pick<RunState,'status'>&Partial<RunState>):string {
  if(run.submitAttempted&&run.status==='idle')return 'Đã xác minh chưa gửi';
  if(run.submitAttempted&&run.status!=='completed')return run.status==='submitting'?'Đang xác nhận gửi':'Chưa rõ đã gửi';
  if(run.status==='waiting_manual'){
    if(run.recovery?.automatic)return `Chờ thử lại ${run.recovery.attempt}/3`;
    const reason=run.blockingIssue?.reason;
    if(reason==='captcha')return 'Chờ xác thực Google';
    if(reason==='verification')return 'Chờ câu xác thực';
    if(reason==='form_closed')return 'Form đã đóng';
    if(reason==='account')return 'Cần kiểm tra tài khoản';
    if(reason==='file_upload')return 'Cần kiểm tra ảnh';
  }
  if(run.status==='paused'&&run.recoveryRequired)return 'Cần đối chiếu sau gián đoạn';
  if(run.status==='running'){
    if(run.activity?.phase==='opening')return 'Đang mở form';
    if(run.activity?.phase==='checking_account')return 'Đang kiểm tra tài khoản';
    if(run.activity?.phase==='navigating')return 'Chờ Google chuyển trang';
    if(run.activity?.phase==='uploading')return 'Đang tải ảnh';
  }
  return labels[run.status]??'Cần đối chiếu';
}
export function commandStatus(receipt:ControlReceipt|undefined,run?:Pick<RunState,'runId'>):string|undefined {
  if(!receipt||receipt.runId&&run?.runId&&receipt.runId!==run.runId)return;
  const label={START:'Bắt đầu',PAUSE:'Tạm dừng',STOP:'Dừng',STOP_PROFILE:'Dừng',RESUME:'Tiếp tục'}[receipt.kind];
  if(receipt.state==='pending')return `Đang chờ extension xác nhận ${label}.`;
  if(receipt.state==='uncertain')return `Chưa xác nhận ${label}. Mở form để đối chiếu trạng thái.`;
  if(receipt.state==='failed')return receipt.error??`${label} chưa thực hiện được.`;
}
