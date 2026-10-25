import {allowedFormUrl} from './protocol';
import {canApplyFinalQuestion,validateFinalQuestion,type FinalQuestion,type RunMode,type RunState} from './shared';

export const HSK_LEVELS=['1','2','3','4','5','6'] as const;
export type HskLevel=typeof HSK_LEVELS[number];
export const isHskLevel=(v:unknown):v is HskLevel=>typeof v==='string'&&HSK_LEVELS.includes(v as HskLevel);
/** A user can know the answer before seeing the form's question. */
export type HskVerificationAnswer=Pick<FinalQuestion,'value'>&Partial<Omit<FinalQuestion,'value'>>;
export function validateHskAnswer(value:unknown):asserts value is HskVerificationAnswer|undefined {
  if(value===undefined)return;
  const q=value as HskVerificationAnswer;
  if(!q||typeof q.value!=='string'||!q.value.trim()||q.value.length>10000)throw new Error('Nhập đáp án xác thực. Không cần biết trước câu hỏi.');
  if(q.label!==undefined)validateFinalQuestion(q);
  else if(q.kind!==undefined||q.formId!==undefined||q.questionId!==undefined)throw new Error('Đáp án nhập trước chưa được gắn với câu hỏi trên form.');
}
export function bindHskAnswer(answer:HskVerificationAnswer,run:RunState):FinalQuestion|undefined {
  const issue=run.blockingIssue;
  if(run.status!=='waiting_manual'||issue?.reason!=='verification'||!issue.questionLabel?.trim()||!run.formId)return;
  const detected=issue.question;
  const q:FinalQuestion=answer.label?{...answer,label:answer.label}:{value:answer.value,label:issue.questionLabel,formId:run.formId,
    ...(detected?.targetId?{questionId:detected.targetId}:{}),
    ...(detected&&detected.kind!=='unknown'&&detected.kind!=='file'?{kind:detected.kind}:{})};
  return canApplyFinalQuestion(run,q)?q:undefined;
}
export function initialHskQuestion(s:RegistrationSchedule,level:HskLevel):FinalQuestion|undefined {
  const q=s.finalQuestions?.[level]??(s.rehearsal?s.rehearsalAnswer:undefined);
  return q?.label?{...q,label:q.label}:q?undefined:s.finalQuestion;
}
export interface HskLink {url?:string;source:'facebook'|'manual';error?:string;observedAt:string}
export interface ScheduledMember {id:string;level:HskLevel;status:'waiting'|'starting'|'started'|'failed'|'held';error?:string;runId?:string;url?:string;requestId:string;dispatchedAt?:string;prepared?:boolean;waitingReason?:string;answerError?:string}
export interface RegistrationSchedule {
  id:string;postUrl:string;startsAt:string;expiresAt:string;prepareAt:string;watchAt:string;
  mode:RunMode;status:'armed'|'preparing'|'watching'|'running'|'finished'|'cancelled'|'expired';
  members:ScheduledMember[];links:Partial<Record<HskLevel,HskLink>>;finalQuestion?:FinalQuestion;
  finalQuestions?:Partial<Record<HskLevel,HskVerificationAnswer>>;rehearsalAnswer?:HskVerificationAnswer;linksCaptured?:boolean;watchRevision?:number;
  pausedAt?:string;manualOnly?:boolean;startOnLink?:boolean;rehearsal?:boolean;testForm?:HskLink;dateWarning?:string;watcherProfileId?:string;
  watcher?:{id:string;token:string;ready:boolean;error?:string};
  lastReadAt?:string;lastObservedAt?:string;lastError?:string;watcherError?:string;createdAt:string;updatedAt:string;
}
export const activeSchedule=(s?:RegistrationSchedule)=>!!s&&!['finished','cancelled','expired'].includes(s.status);
export function facebookPostKey(value:string):string|undefined {
  try{
    const u=new URL(value);if(u.protocol!=='https:'||!['www.facebook.com','facebook.com'].includes(u.hostname)||u.username||u.password)return;
    const story=u.searchParams.get('story_fbid'),owner=u.searchParams.get('id');
    if(u.pathname==='/story.php'&&story&&/^\d+$/.test(story)&&owner&&/^\d+$/.test(owner))return `${owner}:${story}`;
    const post=u.pathname.match(/^\/([^/]+)\/posts\/(\d+|pfbid[A-Za-z0-9]+)\/?$/);
    if(post)return `${post[1].toLowerCase()}:${post[2]}`;
  }catch{}return;
}
export function formLink(value:string):string|undefined {
  try{
    let u=new URL(value);
    if(['l.facebook.com','lm.facebook.com','www.facebook.com'].includes(u.hostname)&&u.pathname==='/l.php')u=new URL(u.searchParams.get('u')??'');
    if(!allowedFormUrl(u.href)||u.hostname==='forms.gle'&&!/^\/[A-Za-z0-9_-]+\/?$/.test(u.pathname))return;
    // Keep prefill/level parameters. Only remove known analytics decoration.
    for(const k of [...u.searchParams.keys()])if(k==='fbclid'||k.startsWith('utm_'))u.searchParams.delete(k);
    u.hash='';return u.href;
  }catch{return;}
}
const normalized=(s:string)=>s.normalize('NFKD').replace(/[\u0300-\u036f\u200b-\u200d\ufeff]/g,'').replace(/[đĐ]/g,'d').toLowerCase();
const testWords=(s:string)=>/\b(?:form\s*(?:thu|test)|mau\s*form|dien\s*thu|test\s*form)\b|测试|試填|试填/.test(normalized(s));
/** Labels bind only to their following section, never to comments or URL order. */
export function parseTestForm(text:string):{url?:string;error?:string}|undefined {
  const found=new Set<string>();let test=false,gap=0;
  for(const line of text.normalize('NFKC').split(/\r?\n/)){
    if(testWords(line)){test=true;gap=0;}
    else if(/\bHSK\s*[1-6](?:\b|级|級)/i.test(line)||registrationTime(line)!==undefined){test=false;}
    else if(line.trim()&&++gap>2)test=false;
    if(!test)continue;
    for(const m of line.matchAll(/https:\/\/[^\s<>"“”]+/gi)){const url=formLink(m[0].replace(/[),.;，。；）]+$/g,''));if(url)found.add(url);}
  }
  return found.size===1?{url:[...found][0]}:found.size?{error:'Bài có nhiều form thử khác nhau; chưa tự chọn form.'}:undefined;
}
function registrationTime(line:string):number|undefined {
  const s=normalized(line);if(!/dang ky|bao danh|报名/.test(s))return;
  const time=s.match(/\b([01]?\d|2[0-3]):([0-5]\d)\b/),cn=s.match(/(20\d{2})年(\d{1,2})月(\d{1,2})日/),date=s.match(/\b(\d{1,2})[./-](\d{1,2})[./-](20\d{2})\b/)??(cn?['',cn[3],cn[2],cn[1]]:undefined);
  if(!time||!date)return;
  return Date.parse(`${date[3]}-${date[2].padStart(2,'0')}-${date[1].padStart(2,'0')}T${time[1].padStart(2,'0')}:${time[2]}:00+07:00`);
}
export function registrationDateError(text:string,startsAt:string):string|undefined {
  const times=text.normalize('NFKC').split(/\r?\n/).map(registrationTime).filter((t):t is number=>t!==undefined);
  if(times.length&&!times.includes(Date.parse(startsAt)))return 'Giờ/ngày đăng ký trong bài khác lịch đã đặt. Giữ chờ; có thể dán link đúng vào ô HSK.';
}
export function parseHskLinks(text:string,startsAt?:string):Partial<Record<HskLevel,{url?:string;error?:string}>> {
  const lines=text.normalize('NFKC').split(/\r?\n/),hasTimes=!!startsAt&&lines.some(l=>registrationTime(l)!==undefined);
  const found=new Map<HskLevel,Set<string>>();let context:HskLevel|undefined,test=false,gap=0,windowMatches=!hasTimes;
  for(const line of lines){
    const at=registrationTime(line);if(hasTimes&&at!==undefined){windowMatches=at===Date.parse(startsAt!);context=undefined;}
    const labels=[...line.matchAll(/\bHSK\s*([1-6])(?:\b|级|級)/gi)].map(m=>m[1] as HskLevel);
    const levels=[...new Set(labels)];
    if(levels.length){context=levels.length===1?levels[0]:undefined;test=testWords(line);gap=0;}
    else if(testWords(line)){context=undefined;test=true;}
    else if(line.trim()&&++gap>2)context=undefined;
    const urls=[...line.matchAll(/https:\/\/[^\s<>"“”]+/gi)].map(m=>formLink(m[0].replace(/[),.;，。；）]+$/g,''))).filter((u):u is string=>!!u);
    if(!windowMatches||test||!context||!urls.length)continue;
    const set=found.get(context)??new Set<string>();for(const u of urls)set.add(u);found.set(context,set);
  }
  return Object.fromEntries([...found].map(([level,urls])=>[level,urls.size===1?{url:[...urls][0]}:{error:`HSK ${level} có ${urls.size} link khác nhau. Dán link đúng vào ô HSK để tiếp tục.`}]));
}
