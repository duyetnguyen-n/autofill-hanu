import type {BlockingIssue,ManualAnswer,RunState} from './shared';

export const MAX_RECOVERY_ATTEMPTS=3;
export const NAVIGATION_SLOW_MS=5000;
export const NAVIGATION_LIMIT_MS=25000;
export const recoveryDelay=(attempt:number,random=Math.random()):number=>
  [2000,5000,12000][Math.max(0,Math.min(attempt-1,2))]+Math.floor(Math.max(0,Math.min(random,1))*1500);

export interface PageHealth {issue?:BlockingIssue;retryable?:boolean;ready?:boolean}
export function classifyPage(input:{text:string;title?:string;hasQuestions:boolean;hasNavigation:boolean;captcha:boolean;online:boolean}):PageHealth {
  if(input.captcha)return {issue:{reason:'captcha',message:'Google yêu cầu xác thực. Hãy tự xử lý rồi bấm Tiếp tục; extension giữ nguyên lượt.'}};
  if(!input.online)return {issue:{reason:'network',message:'Mất kết nối mạng. Đang chờ thử lại có giới hạn.'},retryable:true};
  if(input.hasQuestions||input.hasNavigation)return {};
  const text=`${input.title??''}\n${input.text}`.replace(/\s+/g,' ').slice(0,12000);
  if(/(?:^|\s)404(?:[. :]|$)|requested (?:file|document).*not exist|no longer accepting responses|không còn nhận câu trả lời|không còn chấp nhận phản hồi|form (?:is )?closed|biểu mẫu.*(?:đã đóng|đã ngừng)/i.test(text))return {issue:{reason:'form_closed',message:'Form đã ngừng nhận đăng ký. Không tự thử lại.'}};
  if(/(?:^|\s)403(?:[. :]|$)|forbidden|you need permission|bạn cần có quyền|access denied|quyền truy cập bị từ chối|sign in to continue|đăng nhập để tiếp tục/i.test(text))return {issue:{reason:'account',message:'Google yêu cầu đăng nhập hoặc cấp quyền truy cập. Xử lý tài khoản rồi bấm Tiếp tục.'}};
  if(/(?:^|\s)(?:429|500|502|503|504)(?:[. :]|$)|too many requests|service unavailable|internal server error|bad gateway|gateway time.?out|that.s an error|unusual traffic|lỗi máy chủ|quá nhiều yêu cầu/i.test(text))return {issue:{reason:'server_error',message:'Google đang lỗi hoặc giới hạn truy cập. Đang chờ thử lại có giới hạn.'},retryable:true};
  if(/ERR_(?:INTERNET_DISCONNECTED|NETWORK_CHANGED|CONNECTION|TIMED_OUT|NAME_NOT_RESOLVED)|this site can.t be reached|không thể truy cập trang web/i.test(text))return {issue:{reason:'network',message:'Không tải được Google Forms. Đang chờ thử lại có giới hạn.'},retryable:true};
  return {};
}

export function automaticRecoveryAllowed(run:RunState|undefined,now=Date.now()):boolean {
  return !!run?.runId&&!run.submitAttempted&&!run.recoveryRequired&&run.status==='waiting_manual'&&!!run.recovery?.automatic&&
    run.recovery.attempt>=1&&run.recovery.attempt<=MAX_RECOVERY_ATTEMPTS&&run.blockingIssue?.reason===run.recovery.reason&&
    Number.isFinite(Date.parse(run.recovery.retryAt??''))&&Date.parse(run.recovery.retryAt!)<=now;
}

export function validCorrections(value:unknown):value is Record<string,ManualAnswer>{
  if(!value||typeof value!=='object'||Array.isArray(value)||Object.keys(value).length>100)return false;
  return Object.entries(value).every(([key,a])=>key.length<=800&&!!a&&typeof a==='object'&&typeof a.label==='string'&&a.label.length<=4000&&['text','textarea','date','radio','checkbox','dropdown'].includes(a.kind)&&Array.isArray(a.values)&&a.values.length<=30&&a.values.every((v:unknown)=>typeof v==='string'&&v.length<=10000));
}
