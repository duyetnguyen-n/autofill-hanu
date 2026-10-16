import type {ControlReceipt} from './protocol';
import type {RunState} from './shared';

const labels:Record<RunState['status'],string>={idle:'Đã dừng',running:'Đang chạy',paused:'Tạm dừng',waiting_manual:'Cần bạn xử lý',ready_to_submit:'Xong Test',submitting:'Đang xác nhận gửi',completed:'Đã gửi',submit_uncertain:'Chưa rõ đã gửi',failed:'Có lỗi'};
export function runStatusLabel(run:Pick<RunState,'status'>&Partial<RunState>):string {
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
