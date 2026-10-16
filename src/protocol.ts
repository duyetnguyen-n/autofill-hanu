import type { Profile, RunMode, RunState } from './shared';

export const PROTOCOL_VERSION = 1;
export const NATIVE_HOST = 'vn.hanu.autofill';
export const CHUNK_BYTES = 64 * 1024;
export type CommandKind = 'PING' | 'FOCUS' | 'SCAN_FORM' | 'SET_FINAL_QUESTION' | 'READ_PROFILE' | 'ATTACHMENT_INFO' | 'ATTACHMENT_READ' | 'ATTACHMENT_BEGIN' | 'ATTACHMENT_CHUNK' | 'ATTACHMENT_FINISH' | 'COMMIT_PROFILE' | 'START' | 'PAUSE' | 'RESUME' | 'STOP' | 'STOP_PROFILE' | 'RECONCILE' | 'RESOLVE_SUBMISSION';
export interface Command {
  type: 'COMMAND'; protocol: 1; sessionId: string; commandId: string;
  runId?: string; kind: CommandKind; payload: Record<string, unknown>;
}
export interface ProfileDocument { profile: Profile; revision: number }
export interface ExecutionView {runId?:string;tabId:number;mode:RunMode;status:RunState['status'];managed:boolean;tabOpen:boolean;active?:boolean;eventSeq?:number;message?:string;startedAt?:string;updatedAt:string}
export function currentExecution(run:RunState|undefined,execution:ExecutionView|null,sourceRunId?:string):boolean {
  if(sourceRunId&&run?.runId&&sourceRunId!==run.runId)return false;
  if(!execution||!run)return true;
  if(execution.managed&&execution.runId!==run.runId)return false;
  if(execution.runId!==run.runId)return true;
  if(execution.eventSeq!==undefined&&execution.eventSeq<(run.eventSeq??0))return false;
  return !(['idle','completed','failed','ready_to_submit'].includes(run.status)&&['running','submitting','paused','waiting_manual'].includes(execution.status));
}
export function sameExecution(a:ExecutionView|null|undefined,b:ExecutionView|null|undefined):boolean{
  if(a==null||b==null)return a==null&&b==null;
  const fields:Record<keyof ExecutionView,true>={runId:true,tabId:true,mode:true,status:true,managed:true,tabOpen:true,active:true,eventSeq:true,message:true,startedAt:true,updatedAt:true};
  return (Object.keys(fields) as (keyof ExecutionView)[]).every(key=>a[key]===b[key]);
}
export interface SessionView {
  id: string; name: string; expectedEmail: string; connected: boolean;
  /** Cloud token remains linked even while the Chrome profile is offline. */
  linked?: boolean;
  /** Distinguish pending manager edits from an extension-only profile change. */
  managerDraft?: boolean;
  lastSeen: string; profile?: Profile; revision: number; synced: boolean;
  conflict?: ProfileDocument; error?: string; run?: RunState; execution?:ExecutionView|null;
  control?: ControlReceipt;
}
export interface ControlReceipt {
  commandId:string;
  kind:'START'|'PAUSE'|'RESUME'|'STOP'|'STOP_PROFILE';
  runId?:string;
  state:'pending'|'acknowledged'|'failed'|'uncertain';
  requestedAt:string;
  updatedAt:string;
  error?:string;
}
export interface GroupView { id: string; mode: RunMode; url: string; members: string[]; paused: boolean; stopped?:boolean; createdAt: string; requestId?:string; requestSignature?:string; restartOf?:string }
export function canonicalFormId(url: string): string | undefined {
  try {
    const u = new URL(url);
    if (u.protocol !== 'https:' || u.hostname !== 'docs.google.com') return;
    // Signed-in Forms posts to /forms/u/0/... even when the address bar is
    // later rewritten to /forms/d/.... MessageSender.url retains that route.
    return u.pathname.match(/^\/forms\/(?:u\/\d+\/)?d\/(?:e\/)?([^/]+)\/(?:viewform|formResponse)(?:\/|$)/)?.[1];
  } catch { return; }
}
export function allowedFormUrl(url: string): boolean {
  try {
    const u = new URL(url);
    return u.protocol === 'https:' && !u.username && !u.password &&
      (u.hostname === 'forms.gle' || Boolean(canonicalFormId(url)));
  } catch { return false; }
}
export function validateProfile(value: unknown): asserts value is Profile {
  const p = value as Profile;
  if (!p || typeof p !== 'object' || !p.values || !p.attachments || !p.mappings || !Array.isArray(p.customFields)) throw new Error('Hồ sơ không hợp lệ.');
  for (const map of [p.values, p.mappings]) {
    if (typeof map !== 'object' || Array.isArray(map) || Object.values(map).some(v => typeof v !== 'string')) throw new Error('Giá trị hồ sơ phải là chuỗi.');
  }
  for (const f of p.customFields) if (!f || typeof f.id !== 'string' || typeof f.label !== 'string' || typeof f.value !== 'string' || !Array.isArray(f.aliases) || f.aliases.some(a => typeof a !== 'string')) throw new Error('Trường tùy chỉnh không hợp lệ.');
  for (const a of Object.values(p.attachments)) if (a && (typeof a.id !== 'string' || typeof a.name !== 'string' || typeof a.type !== 'string' || !Number.isSafeInteger(a.size) || a.size < 0)) throw new Error('Tham chiếu ảnh không hợp lệ.');
}
export async function sha256(bytes: ArrayBuffer): Promise<string> {
  return [...new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))].map(n => n.toString(16).padStart(2, '0')).join('');
}
export function bytesToBase64(bytes: Uint8Array): string {
  let s = ''; for (let i = 0; i < bytes.length; i += 8192) s += String.fromCharCode(...bytes.subarray(i, i + 8192));
  return btoa(s);
}
