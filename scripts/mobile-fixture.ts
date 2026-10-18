import {resolve} from 'node:path';
import {createHash} from 'node:crypto';
import {httpFixture,users} from '../tests/cloud/fixture';
import {fixtureImage} from './fixture.mjs';
import type {RunState} from '../src/shared';

// Isolated PostgreSQL-in-WASM and synthetic accounts, never production data.
export async function mobileFixture(){
  const app=await httpFixture(resolve('build/cloud-ui'));
  await app.pool.query("UPDATE hanu.accounts SET role='admin' WHERE user_id=$1",[users[0]]);
  const names=['Nguyễn Minh Anh','Trần Khánh Linh','Lê Hoàng Nam','Phạm Ngọc Hà','Vũ Thu Trang','Đỗ Quang Huy'];
  const sessions=[];
  for(let i=0;i<names.length;i++){
    const paired=await app.pair(users[0]);
    const s=await paired.store.session(paired.sessionId);
    s.name=i===0?'Hà Nội · 01':i===1?'Lớp HSK cuối tuần · 02':`Profile ${String(i+1).padStart(2,'0')}`;
    s.expectedEmail=`hsk.profile.${i+1}@example.test`;
    s.profile!.values={...s.profile!.values,fullName:names[i],identityNumber:`TEST-DOCUMENT-${i+1}`,phone:`090234560${i}`,email:s.expectedEmail,firstCommitment:'true',termsCommitment:'true',birthDate:'2002-06-26'};
    const bytes=fixtureImage(),id=crypto.randomUUID();
    s.profile!.attachments.identityDocument={id,name:`anh-thu-nghiem-${i+1}.png`,type:'image/png',size:bytes.length,updatedAt:new Date().toISOString()};
    await paired.store.saveAttachment(s.id,id,bytes,createHash('sha256').update(bytes).digest('hex'));
    if(i===3){s.connected=false;s.error='Mất kết nối. Mở lại profile và đối chiếu trước khi tiếp tục.';}
    await paired.store.saveSession(s);sessions.push(s);
  }
  await app.api('state');
  const runtime=app.app.runtimes.get(users[0])!,commands:{id:string;kind:string}[]=[];
  const documents=new Map(sessions.map(s=>[s.id,{profile:structuredClone(s.profile!),revision:s.revision}]));
  sessions.filter(s=>s.connected).forEach(s=>runtime.coordinator.peers.set(s.id,{readyState:1,terminate(){}} as any));
  runtime.coordinator.command=async(id,kind,payload)=>{
    commands.push({id,kind});const document=documents.get(id)!;
    if(kind==='READ_PROFILE')return document;
    if(kind==='COMMIT_PROFILE'){document.profile=structuredClone(payload.profile as typeof document.profile);document.revision++;return {revision:document.revision};}
    if(kind==='ATTACHMENT_INFO'){const file=await app.repository.store(users[0]).attachment(id,String(payload.id));return {size:file.data.length,hash:file.hash};}
    if(kind==='ATTACHMENT_READ'){const file=await app.repository.store(users[0]).attachment(id,String(payload.id));return {base64:file.data.subarray(Number(payload.offset),Number(payload.offset)+Number(payload.length)).toString('base64')};}
    if(kind==='STOP_PROFILE')return {execution:null};
    if(['PAUSE','RESUME','STOP'].includes(kind)){
      const s=await app.repository.store(users[0]).session(id);
      return {...s.run,status:kind==='STOP'?'idle':kind==='PAUSE'?'paused':'running',blockingIssue:undefined,eventSeq:(s.run?.eventSeq??0)+1} as RunState;
    }
    return {};
  };
  return {...app,sessions,commands};
}
