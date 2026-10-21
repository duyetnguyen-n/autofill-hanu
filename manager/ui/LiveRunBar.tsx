import React,{useEffect,useState} from 'react';
import {Button,Select} from '@fluentui/react-components';
import {PauseRegular,PlayRegular,StopRegular} from '@fluentui/react-icons';
import type {GroupView,SessionView} from '../../src/protocol';
import {activeSchedule,type RegistrationSchedule} from '../../src/registration-schedule';
import './live-run-bar.css';

export type LiveTarget={kind:'schedule'|'group';id?:string;requestId?:string;createdAt:string};
const terminal=(s?:SessionView)=>!!s?.run&&['idle','completed','ready_to_submit'].includes(s.run.status);
export function currentLiveTarget(schedule:RegistrationSchedule|undefined,groups:GroupView[],sessions:SessionView[]):LiveTarget|undefined{
  if(schedule?.mode==='live'&&(activeSchedule(schedule)||schedule.members.some(m=>sessions.some(s=>s.id===m.id&&s.run?.runId===m.runId&&!terminal(s)))))return {kind:'schedule',id:schedule.id,createdAt:schedule.createdAt};
  const g=groups.find(g=>g.mode==='live'&&!g.stopped&&g.members.some(id=>sessions.some(s=>s.id===id&&s.run?.runId===g.id&&!terminal(s))));
  return g?{kind:'group',id:g.id,createdAt:g.createdAt}:undefined;
}
export function LiveRunBar({target,schedule,groups,sessions,connected,onTarget,request}:{target:LiveTarget;schedule?:RegistrationSchedule;groups:GroupView[];sessions:SessionView[];connected:boolean;onTarget:(t:LiveTarget)=>void;request:(path:string,body:unknown)=>Promise<any>}){
  const [now,setNow]=useState(Date.now()),[pending,setPending]=useState(''),[stopping,setStopping]=useState(false),[error,setError]=useState('');
  useEffect(()=>{const timer=setInterval(()=>setNow(Date.now()),1000);return()=>clearInterval(timer);},[]);
  useEffect(()=>{setError('');},[target.id,target.requestId]);
  const s=target.kind==='schedule'&&schedule?.id===target.id?schedule:undefined;
  const g=target.kind==='group'?groups.find(g=>target.id?g.id===target.id:g.requestId===target.requestId):undefined;
  const id=s?.id??g?.id,stopped=s?.status==='cancelled'||s?.status==='expired'||g?.stopped,paused=!!s?.pausedAt||g?.paused===true;
  const members=s?s.members.map(m=>({id:m.id,runId:m.runId,pending:['waiting','starting'].includes(m.status),failed:m.status==='failed'||m.status==='held'})):g?.members.map(member=>({id:member,runId:g.id,pending:false,failed:false}))??[];
  const matched=members.map(m=>({m,session:sessions.find(p=>p.id===m.id&&p.run?.runId===m.runId)}));
  const done=matched.filter(({session})=>session?.run?.status==='completed').length;
  const waiting=matched.filter(({m})=>m.pending).length;
  const attention=matched.filter(({m,session})=>m.failed||session?.run&&['failed','waiting_manual','submit_uncertain'].includes(session.run.status)).length;
  const active=matched.filter(({session})=>session?.run&&['running','submitting'].includes(session.run.status)).length;
  const finished=members.length>0&&!waiting&&matched.every(({m,session})=>m.failed||terminal(session));
  const end=stopped?(s?.updatedAt??matched.map(({session})=>session?.run?.updatedAt??target.createdAt).sort().at(-1)):finished?matched.map(({session})=>session?.run?.updatedAt??target.createdAt).sort().at(-1):undefined;
  const seconds=Math.max(0,Math.floor(((end?Date.parse(end):now)-Date.parse(target.createdAt))/1000));
  const clock=`${String(Math.floor(seconds/60)).padStart(2,'0')}:${String(seconds%60).padStart(2,'0')}`;
  async function control(action:'pause'|'resume'|'stop'){
    if(!id)return;setError('');if(action==='stop')setStopping(true);else setPending(action);
    try{const result=await request(s?`registration-schedule/${action}`:`groups/${id}/${action}`,s?{scheduleId:id}:{});const failed=Array.isArray(result)?result.filter(r=>r.ok===false&&!r.skipped):[];if(failed.length)throw new Error(failed.map(r=>`${sessions.find(s=>s.id===(r.id??r.member))?.name??'Profile'}: ${r.error}`).join(' · '));}
    catch(e){setError((e as Error).message);}finally{if(action==='stop')setStopping(false);else setPending('');}
  }
  const choices:LiveTarget[]=[];
  if(schedule?.mode==='live')choices.push({kind:'schedule',id:schedule.id,createdAt:schedule.createdAt});
  for(const g of groups.filter(g=>g.mode==='live'&&!schedule?.members.some(m=>m.runId===g.id)))choices.push({kind:'group',id:g.id,createdAt:g.createdAt});
  return <aside className="live-run-bar" aria-label="Điều khiển lượt Live">
    <div className="live-bar-heading"><strong><span className={`live-dot ${paused||stopped?'quiet':''}`}/>{stopped?'Đã dừng':paused?'Đã tạm dừng':finished?'Đã kết thúc':id?'Live đang hoạt động':'Đang chuẩn bị Live'}</strong><span className="live-clock" aria-label="Thời gian lượt chạy">{clock}</span></div>
    {choices.length>1&&<Select aria-label="Lượt Live cần điều khiển" value={`${target.kind}:${id??''}`} onChange={e=>{const next=choices.find(t=>`${t.kind}:${t.id}`===e.target.value);if(next)onTarget(next);}}>{choices.map(t=><option key={`${t.kind}:${t.id}`} value={`${t.kind}:${t.id}`}>{t.kind==='schedule'?'Theo HSK':'Link trực tiếp'} · {new Date(t.createdAt).toLocaleTimeString('vi-VN')} · {t.id?.slice(0,6)}</option>)}</Select>}
    <p className="live-bar-counts">{members.length} profile · {active} đang chạy{waiting?` · ${waiting} chờ link / chuẩn bị`:''}{attention?` · ${attention} cần xử lý`:''} · {done} đã gửi</p>
    {!connected&&<p className="live-bar-error" role="status">Mất kết nối quản lý. Đang kết nối lại…</p>}
    {error&&<p className="live-bar-error" role="alert">{error}</p>}
    <div className="live-bar-actions"><Button icon={paused?<PlayRegular/>:<PauseRegular/>} disabled={!connected||!id||!!pending||stopping||stopped||finished} onClick={()=>void control(paused?'resume':'pause')}>{pending?'Đang xử lý…':paused?'Tiếp tục nhóm':'Tạm dừng nhóm'}</Button><Button icon={<StopRegular/>} className="live-stop" disabled={!connected||!id||stopping||stopped} onClick={()=>void control('stop')}>{stopping?'Đang dừng…':'Dừng nhóm'}</Button></div>
  </aside>;
}
