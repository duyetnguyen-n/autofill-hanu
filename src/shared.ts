export type RunMode = "test" | "live";
export type RunStatus =
  | "idle"
  | "running"
  | "paused"
  | "waiting_manual"
  | "ready_to_submit"
  | "submitting"
  | "completed"
  | "submit_uncertain"
  | "failed";

export type ControlKind = "text" | "textarea" | "radio" | "checkbox" | "dropdown" | "date" | "file";

export interface FinalQuestion {
  label: string;
  value: string;
  kind?: Exclude<ControlKind, 'file'>;
  formId?: string;
  questionId?: string;
}
export const FINAL_QUESTION_KINDS = ['text','textarea','radio','checkbox','dropdown','date'] as const;
export function validateFinalQuestion(value: unknown): asserts value is FinalQuestion | undefined {
  if(value === undefined) return;
  const q=value as FinalQuestion;
  if(!q || typeof q.label!=='string' || !normalizeQuestionLabel(q.label) || q.label.length>4000 || typeof q.value!=='string' || !q.value.trim() || q.value.length>10000
    || q.kind!==undefined && !FINAL_QUESTION_KINDS.includes(q.kind)
    || q.formId!==undefined && (typeof q.formId!=='string' || !q.formId || q.formId.length>300)
    || q.questionId!==undefined && (typeof q.questionId!=='string' || !q.questionId || q.questionId.length>300 || !q.formId)) throw new Error('Nhập đầy đủ nội dung câu hỏi cuối và đáp án; loại trường hoặc mã câu hỏi không hợp lệ.');
}
// Match the entire title, never a fragment or the last position on a page.
export function matchesFinalQuestionLabel(label:string, expected:string):boolean {
  return normalizeQuestionLabel(label)===normalizeQuestionLabel(expected);
}

// Applying an answer must not resume a profile blocked on an earlier field.
// A verification blocker identifies the target before the answer is read;
// once a target is known, require its full label to match as well.
export function canApplyFinalQuestion(run:RunState|undefined, question?:Pick<FinalQuestion,'label'|'formId'>):boolean {
  if(!run?.runId||run.submitAttempted||!['paused','waiting_manual','ready_to_submit'].includes(run.status))return false;
  if(question?.formId&&question.formId!==run.formId)return false;
  if(run.status==='ready_to_submit')return true;
  const issue=run.blockingIssue;
  if(!issue||issue.reason==='captcha'||issue.reason==='file_upload')return false;
  return question?.label.trim()?!!issue.questionLabel&&matchesFinalQuestionLabel(issue.questionLabel,question.label):issue.reason==='verification';
}

export interface FieldRule {
  key: string;
  label: string;
  kind: ControlKind | ControlKind[];
  aliases: string[];
  optionAliases?: Record<string, string[]>;
  attachmentKey?: string;
  sensitive?: boolean;
}

export interface CustomField {
  id: string;
  label: string;
  value: string;
  aliases: string[];
}

export interface AttachmentRef {
  id: string;
  name: string;
  type: string;
  size: number;
  updatedAt: string;
}

export interface Profile {
  values: Record<string, string>;
  customFields: CustomField[];
  attachments: Record<string, AttachmentRef | undefined>;
  mappings: Record<string, string>;
}

export interface BlockingIssue {
  reason: "unknown_required" | "unsupported" | "verification" | "captcha" | "file_upload" | "validation" | "submit_uncertain" | "network" | "server_error" | "navigation" | "account" | "form_closed";
  message: string;
  questionId?: string;
  questionLabel?: string;
  candidates?: string[];
  question?:FormQuestionSummary;
}

export interface RunActivity {
  phase:'opening'|'checking_account'|'filling'|'navigating'|'uploading'|'retrying'|'waiting_user'|'reconnecting';
  message:string;
  at:string;
}
export interface RecoveryPlan {
  reason:'network'|'server_error'|'navigation';
  attempt:number;
  retryAt?:string;
  automatic:boolean;
}
export interface ManualAnswer {
  label:string;
  kind:Exclude<ControlKind,'file'>;
  values:string[];
}

export interface RunLogEntry {
  at: string;
  level: "info" | "warning" | "error" | "success";
  message: string;
}

export interface RunState {
  // Durable user intent, independent of a temporary page/network blocker.
  autoContinue?: boolean;
  transportRecovery?: boolean;
  retryOnReturn?: boolean;
  submissionEpoch?: string;
  submissionRetries?: number;
  pendingReturnedRetry?: {epoch:string;fromRetries:number};
  activity?:RunActivity;
  recovery?:RecoveryPlan;
  corrections?:Record<string,ManualAnswer>;
  finalQuestion?: FinalQuestion;
  runId?: string;
  sessionId?: string;
  managed?: boolean;
  profileSnapshot?: Profile;
  profileRevision?: number;
  attachmentHashes?:Record<string,string>;
  uploadRepairs?:Record<string,number>;
  expectedEmail?: string;
  url?: string;
  eventSeq?: number;
  contentEpoch?: string;
  recoveryRequired?: boolean;
  startedAt?: string;
  tabId: number;
  formId: string;
  mode: RunMode;
  status: RunStatus;
  pageFingerprint?: string;
  filled: string[];
  skipped: string[];
  blockingIssue?: BlockingIssue;
  logs: RunLogEntry[];
  submitAttempted: boolean;
  updatedAt: string;
}

export interface FormQuestionSummary {
  verification?:boolean;
  targetId?: string;
  id: string;
  label: string;
  required: boolean;
  kind: ControlKind | "unknown";
  filled: boolean;
  options: string[];
  dateFormat?: string;
}

export type ExtensionMessage =
  | {type:'FACEBOOK_ENABLE'}
  | {type:'FACEBOOK_STATUS'}
  | {type:'FACEBOOK_WATCH_CONFIG'}
  | {type:'FACEBOOK_WATCH_REPORT';scheduleId:string;token:string;postKey:string;text:string;error?:string}
  | { type: "NATIVE_STATUS" }
  | { type: "NATIVE_PAIR"; code: string }
  | { type: "NATIVE_UNLINK" }
  | { type: "NATIVE_OPEN_MANAGER" }
  | { type: "CLAIM_DOCUMENT"; epoch: string }
  | { type: "REQUEST_SUBMIT"; runId?: string; epoch?: string }
  | { type: "AUTO_RESUME"; runId?: string; epoch: string; source?: 'page_ready' }
  | { type: "PAGE_ACCOUNT" }
  | { type: "PAGE_HEALTH" }
  | { type: "PAGE_RUN_STATUS" }
  | { type: "PAGE_ATTENTION_ACQUIRE"; runId?:string; epoch:string; purpose:string }
  | { type: "PAGE_ATTENTION_RELEASE"; token:string }
  | { type: "GET_PANEL_STATE"; tabId?: number }
  | { type: "GET_RUN_FOR_TAB" }
  | { type: "TRUSTED_CLICK"; x: number; y: number; runId?:string; epoch?:string }
  | { type: "TRUSTED_KEYS"; keys: string[]; runId?:string; epoch?:string }
  | { type: "SAVE_PROFILE"; profile: Profile }
  | { type: "SAVE_ATTACHMENT"; attachmentKey: string; name: string; mimeType: string; dataUrl: string }
  | { type: "GET_ATTACHMENT"; attachmentId: string }
  | { type: "UPLOAD_STORED_FILE"; attachmentId: string; pickerUrl: string; requestId: string; checkOnly?: boolean; runId?:string; epoch?:string }
  | { type: "REQUEST_UPLOAD_REPAIR"; attachmentId:string; runId?:string; epoch?:string }
  | { type: "CLEAR_ALL_DATA" }
  | { type: "START_RUN"; tabId: number; mode: RunMode }
  | { type: "RESTART_RUN"; tabId:number; runId?:string; operationId?:string }
  | { type: "PAUSE_RUN"; tabId: number }
  | { type: "RESUME_RUN"; tabId: number }
  | { type: "STOP_RUN"; tabId: number }
  | { type: "SCAN_FORM"; tabId: number }
  | { type: "SAVE_MAPPING"; tabId: number; questionId: string; ruleKey: string }
  | { type: "RUN_CURRENT_PAGE"; mode: RunMode; skipQuestionId?: string; runId?: string; epoch?: string; finalQuestion?:FinalQuestion; corrections?:Record<string,ManualAnswer> }
  | { type: "HALT_RUN"; watchReturn?: boolean }
  | { type: "FORM_EVENT"; event: FormEvent; runId?: string; epoch?: string }
  | { type: "GET_PROFILE" };

export type FormEvent =
  | { type: "activity"; phase:RunActivity['phase']; message:string }
  | { type: "transient_error"; reason:RecoveryPlan['reason']; message:string }
  | { type: "corrections"; answers:Record<string,ManualAnswer> }
  | { type: "progress"; message: string; filled?: string; skipped?: string }
  | { type: "block"; issue: BlockingIssue }
  | { type: "ready_to_submit" }
  | { type: "submit_attempt" }
  | { type: "completed"; message: string }
  | { type: "failed"; message: string }
  | { type: "page_advanced"; fingerprint: string };

export function normalize(value: string): string {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/đ/g, "d")
    .replace(/Đ/g, "d")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

export function normalizeQuestionLabel(value: string): string {
  return normalize(value)
    .replace(/^[0-9]+[\s.):-]+/, "")
    .replace(/\s*\*+\s*$/, "")
    .trim();
}

export function hasExactAlias(label: string, aliases: string[]): boolean {
  const normalizedLabel = normalizeQuestionLabel(label);
  return aliases.some((alias) => {
    const normAlias = normalizeQuestionLabel(alias);
    if (normAlias === normalizedLabel) return true;

    // Tách các đoạn phân cách bởi | hoặc xuống dòng hoặc dấu gạch chéo
    const labelSegments = label.split(/[|\n\r/]+/).map(normalizeQuestionLabel).filter(Boolean);
    const aliasSegments = alias.split(/[|\n\r/]+/).map(normalizeQuestionLabel).filter(Boolean);
    if (labelSegments.some((l) => aliasSegments.some((a) => l === a))) return true;

    return false;
  });
}

export function mappingKey(formId: string, questionId: string): string {
  return `${formId}:${questionId}`;
}

export function decideNextAction(mode: RunMode, isFinalPage: boolean, hasBlocker: boolean): "pause" | "next" | "ready" | "submit" {
  if (hasBlocker) return "pause";
  if (!isFinalPage) return "next";
  return mode === "test" ? "ready" : "submit";
}

export function transitionStatus(current: RunStatus, event: "start" | "pause" | "resume" | "block" | "ready" | "submit" | "complete" | "fail" | "stop"): RunStatus {
  if (event === "stop") return "idle";
  if (event === "start" || event === "resume") return "running";
  if (event === "pause") return "paused";
  if (event === "block") return "waiting_manual";
  if (event === "ready") return "ready_to_submit";
  if (event === "submit") return "submitting";
  if (event === "complete") return "completed";
  if (event === "fail") return "failed";
  return current;
}
