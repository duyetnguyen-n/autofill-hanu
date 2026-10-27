import React,{useEffect,useRef,useState} from 'react';
import {Button,Select} from '@fluentui/react-components';
import {PauseRegular,PlayRegular,StopRegular,ChevronUpRegular,ChevronDownRegular,DismissRegular} from '@fluentui/react-icons';
import type {GroupView,SessionView} from '../../src/protocol';
import {activeSchedule,type RegistrationSchedule} from '../../src/registration-schedule';
import {Notice} from './Notice';
import './live-run-bar.css';

export type LiveTarget={kind:'schedule'|'group';id?:string;requestId?:string;createdAt:string};
const terminal=(s?:SessionView)=>!!s?.run&&!s.execution&&['idle','completed','ready_to_submit'].includes(s.run.status);
export function currentRunTarget(schedule:RegistrationSchedule|undefined,groups:GroupView[],sessions:SessionView[]):LiveTarget|undefined{
  if(schedule&&(activeSchedule(schedule)||schedule.members.some(m=>sessions.some(s=>s.id===m.id&&s.run?.runId===m.runId&&!terminal(s)))))return {kind:'schedule',id:schedule.id,createdAt:schedule.createdAt};
  const g=groups.find(g=>g.members.some(id=>sessions.some(s=>s.id===id&&s.run?.runId===g.id&&!terminal(s))));
  return g?{kind:'group',id:g.id,createdAt:g.createdAt}:undefined;
}
export function LiveRunBar({target,schedule,groups,sessions,connected,onTarget,onDismiss,request}:{target:LiveTarget;schedule?:RegistrationSchedule;groups:GroupView[];sessions:SessionView[];connected:boolean;onTarget:(t:LiveTarget)=>void;onDismiss:()=>void;request:(path:string,body:unknown)=>Promise<any>}){
  const [now,setNow]=useState(Date.now()),[pending,setPending]=useState(''),[stopping,setStopping]=useState(false),[error,setError]=useState(''),[collapsed,setCollapsed]=useState(false);
  const generation=useRef(0);
  useEffect(()=>{const timer=setInterval(()=>setNow(Date.now()),1000);return()=>clearInterval(timer);},[]);
  useEffect(()=>{generation.current++;setError('');setPending('');setStopping(false);return()=>{generation.current++;};},[target.id,target.requestId]);
  const s=target.kind==='schedule'&&schedule?.id===target.id?schedule:undefined;
  const g=target.kind==='group'?groups.find(g=>target.id?g.id===target.id:g.requestId===target.requestId):undefined;
  const id=s?.id??g?.id,stopped=s?.status==='cancelled'||s?.status==='expired'||g?.stopped,paused=!!s?.pausedAt||g?.paused===true;
  const members=s?s.members.map(m=>({id:m.id,runId:m.runId,pending:['waiting','starting'].includes(m.status),failed:m.status==='failed'||m.status==='held'})):g?.members.map(member=>({id:member,runId:g.id,pending:false,failed:false}))??[];
  const matched=members.map(m=>({m,session:sessions.find(p=>p.id===m.id&&p.run?.runId===m.runId)}));
  const done=matched.filter(({session})=>session?.run?.status==='completed').length;
  const waiting=stopped?0:matched.filter(({m})=>m.pending).length;
  const attention=matched.filter(({m,session})=>m.failed||session?.run&&['failed','waiting_manual','submit_uncertain'].includes(session.run.status)).length;
  const active=matched.filter(({session})=>session&&(session.execution?['running','submitting'].includes(session.execution.status):['running','submitting'].includes(session.run?.status??''))).length;
  const finished=members.length>0&&!waiting&&matched.every(({m,session})=>session?terminal(session):m.failed||stopped&&m.pending);
  const end=finished?matched.map(({session})=>session?.run?.updatedAt??target.createdAt).sort().at(-1):undefined;
  const seconds=Math.max(0,Math.floor(((end?Date.parse(end):now)-Date.parse(target.createdAt))/1000));
  const clock=`${String(Math.floor(seconds/60)).padStart(2,'0')}:${String(seconds%60).padStart(2,'0')}`;
  async function control(action:'pause'|'resume'|'stop'){
    if(!id)return;const gen=generation.current;setError('');if(action==='stop')setStopping(true);else setPending(action);
    try{const result=await request(s?`registration-schedule/${action}`:`groups/${id}/${action}`,s?{scheduleId:id}:{});const failed=Array.isArray(result)?result.filter(r=>r.ok===false&&!r.skipped):[];if(failed.length)throw new Error(failed.map(r=>`${sessions.find(s=>s.id===(r.id??r.member))?.name??'Profile'}: ${r.error}`).join(' · '));}
    catch(e){if(gen===generation.current)setError((e as Error).message);}finally{if(gen===generation.current){if(action==='stop')setStopping(false);else setPending('');}}
  }
  const choices:LiveTarget[]=[];
  if(schedule)choices.push({kind:'schedule',id:schedule.id,createdAt:schedule.createdAt});
  for(const group of groups.filter(group=>!schedule?.members.some(m=>m.runId===group.id)))choices.push({kind:'group',id:group.id,createdAt:group.createdAt});
  const mode=(s?.mode??g?.mode)==='live'?'Live':'Test';
  const status=stopped?(finished?'Đã dừng':'Còn profile chưa xác nhận dừng'):finished?'Đã kết thúc':paused?'Đã tạm dừng':id?'Đang hoạt động':'Đang chuẩn bị';
  return <section id="run-monitor" className={`live-run-bar ${collapsed?'is-collapsed':''}`} aria-label="Theo dõi và điều khiển lượt chạy">
    <div className="live-bar-heading"><div><span className="run-mode-label">{mode} · {s?'Theo HSK':'Nhóm trực tiếp'}</span><h2>{status}</h2></div><div className="run-monitor-tools"><span className="live-clock" aria-label="Thời gian lượt chạy">{clock}</span><Button appearance="subtle" icon={collapsed?<ChevronDownRegular/>:<ChevronUpRegular/>} aria-label={collapsed?'Mở rộng theo dõi':'Thu gọn theo dõi'} aria-expanded={!collapsed} onClick={()=>setCollapsed(v=>!v)}/><Button appearance="subtle" icon={<DismissRegular/>} aria-label="Ẩn bảng theo dõi" onClick={onDismiss}/></div></div>
    {!collapsed&&<>
      {choices.length>1&&<Select aria-label="Lượt cần điều khiển" value={`${target.kind}:${id??''}`} onChange={e=>{const next=choices.find(t=>`${t.kind}:${t.id}`===e.target.value);if(next)onTarget(next);}}>{choices.map(t=><option key={`${t.kind}:${t.id}`} value={`${t.kind}:${t.id}`}>{t.kind==='schedule'?'Theo HSK':'Nhóm trực tiếp'} · {new Date(t.createdAt).toLocaleTimeString('vi-VN',{timeZone:'Asia/Ho_Chi_Minh'})}</option>)}</Select>}
      <p className="live-bar-counts">{members.length} profile · {active} đang chạy{waiting?` · ${waiting} đang chờ`:''}{attention?` · ${attention} cần xử lý`:''} · {done} đã gửi</p>
    </>}
    {!connected&&<Notice intent="warning">Mất kết nối quản lý. Đang kết nối lại…</Notice>}
    {error&&<Notice intent="error" onDismiss={()=>setError('')}>{error}</Notice>}
    <div className="live-bar-actions"><Button icon={paused?<PlayRegular/>:<PauseRegular/>} disabled={!connected||!id||!!pending||stopping||stopped||finished} onClick={()=>void control(paused?'resume':'pause')}>{pending?'Đang xử lý…':paused?'Tiếp tục lượt':'Tạm dừng lượt'}</Button><Button icon={<StopRegular/>} className="live-stop" disabled={!connected||!id||stopping||finished} onClick={()=>void control('stop')}>{stopping?'Đang dừng…':stopped?'Thử dừng lại':'Dừng toàn bộ lượt'}</Button></div>
  </section>;
}
