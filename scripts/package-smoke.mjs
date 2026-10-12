import {spawn} from 'node:child_process';
import {mkdtemp,readFile,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import assert from 'node:assert/strict';
const root=resolve(process.argv[2]??'releases/HANU-mac-arm64/HANU Coordinator.app/Contents/Resources');
const dir=await mkdtemp(join(tmpdir(),'hanu-package-'));const runtime=join(root,'runtime/node'),env={...process.env,HANU_DATA_DIR:dir,PATH:'/usr/bin:/bin'};
let manager,bridge;
const wait=async(fn)=>{const deadline=Date.now()+10000;while(Date.now()<deadline){const result=await fn();if(result)return result;await new Promise(r=>setTimeout(r,50));}throw new Error('Package smoke timeout');};
try{
  manager=spawn(runtime,[join(root,'server/main.mjs'),'--serve','--no-open'],{env,stdio:['ignore','pipe','pipe']});let output='';manager.stdout.on('data',data=>output+=data);
  await wait(()=>output.includes('HANU đang chạy'));const descriptor=JSON.parse(await readFile(join(dir,'connection.json'),'utf8')),origin=`http://127.0.0.1:${descriptor.port}`,token=new URL(descriptor.launchUrl).hash.slice(7);
  assert.equal((await fetch(origin)).status,200);const auth=await fetch(`${origin}/api/auth`,{method:'POST',headers:{Origin:origin,'Content-Type':'application/json'},body:JSON.stringify({token})});assert.equal(auth.status,200);const cookie=auth.headers.get('set-cookie').split(';')[0];
  const pair=await(await fetch(`${origin}/api/pair`,{method:'POST',headers:{Origin:origin,Cookie:cookie,'Content-Type':'application/json'},body:'{}'})).json();await writeFile(join(dir,'allowed-extensions.json'),JSON.stringify(['a'.repeat(32)]));
  bridge=spawn(join(root,'native-host'),[`chrome-extension://${'a'.repeat(32)}/`],{env,stdio:['pipe','pipe','pipe']});let bytes=Buffer.alloc(0),paired=false;
  const send=message=>{const body=Buffer.from(JSON.stringify(message)),prefix=Buffer.alloc(4);prefix.writeUInt32LE(body.length);bridge.stdin.write(Buffer.concat([prefix,body]));};
  bridge.stdout.on('data',chunk=>{bytes=Buffer.concat([bytes,chunk]);while(bytes.length>=4&&bytes.length>=bytes.readUInt32LE()+4){const length=bytes.readUInt32LE(),message=JSON.parse(bytes.subarray(4,4+length));bytes=bytes.subarray(4+length);if(message.type==='PAIRED')paired=true;if(message.kind==='READ_PROFILE')send({type:'RESULT',protocol:1,sessionId:'fixture-package-session',commandId:message.commandId,ok:true,result:{profile:{values:{},mappings:{},customFields:[],attachments:{}},revision:0}});}});
  send({type:'PAIR',protocol:1,sessionId:'fixture-package-session',code:pair.code});await wait(()=>paired);
  const state=await wait(async()=>{const s=await(await fetch(`${origin}/api/state`,{headers:{Cookie:cookie}})).json();return s.sessions[0]?.synced?s:null;});assert.equal(state.sessions[0].connected,true);
  const reopen=spawn(runtime,[join(root,'server/main.mjs'),'--serve','--no-open'],{env,stdio:'ignore'});assert.equal(await new Promise(r=>reopen.on('exit',r)),0);assert.equal(JSON.parse(await readFile(join(dir,'connection.json'),'utf8')).pid,manager.pid);
  console.log('PASS: packaged arm64 runtime, authenticated UI, packaged native bridge, pairing/import, single-instance reopen.');
}finally{bridge?.kill('SIGTERM');if(manager){const exit=new Promise(r=>manager.once('exit',r));manager.kill('SIGTERM');await exit;}await rm(dir,{recursive:true,force:true});}
