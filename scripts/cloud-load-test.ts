import { spawn, type ChildProcess } from 'node:child_process';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { performance } from 'node:perf_hooks';
import { WebSocket } from 'ws';
import { CHUNK_BYTES, PROTOCOL_VERSION, canonicalFormId } from '../src/protocol';
import type { Profile, RunState } from '../src/shared';

const option = (name: string) => process.argv.find(arg=>arg.startsWith(`--${name}=`))?.slice(name.length+3);
function integer(value: string | undefined, fallback: number, min: number, max: number) {
  const n = value === undefined ? fallback : Number(value);
  if(!Number.isInteger(n)||n<min||n>max)throw new Error(`Expected an integer in ${min}..${max}.`);return n;
}
const users=integer(option('users'),10,1,20), rounds=integer(option('rounds'),12,1,100);
const interval=integer(option('interval-ms'),200,0,5000), attachmentKB=integer(option('attachment-kb'),64,0,1024);
const remote=option('origin'), sizes=(option('profiles-per-user')??(remote?'10':'5,10')).split(',').map(value=>integer(value,5,1,20));
const constrained=process.argv.includes('--constrained');
const cpus=Number(option('cpus')??'0.1'),dbDelay=integer(option('db-delay-ms'),0,0,1000);
if(!Number.isFinite(cpus)||cpus<.1||cpus>2)throw new Error('cpus must be 0.1..2.');
if(remote&&constrained)throw new Error('Choose --origin or --constrained.');
if(remote&&sizes.length!==1)throw new Error('Use one scenario per fresh remote test server.');
const deadline=5000, output=option('output')??'test-results/cloud-load-report.json';
const sleep=(ms:number)=>new Promise(resolve=>setTimeout(resolve,ms));
async function within<T>(work:Promise<T>,ms:number,message:string):Promise<T>{
  let timer!:ReturnType<typeof setTimeout>;
  try{return await Promise.race([work,new Promise<never>((_,reject)=>{timer=setTimeout(()=>reject(new Error(message)),ms);})]);}
  finally{clearTimeout(timer);}
}
function distribution(values:number[]) {
  const s=[...values].sort((a,b)=>a-b), p=(fraction:number)=>s.length?Math.round(s[Math.max(0,Math.ceil(s.length*fraction)-1)]*100)/100:0;
  return {count:s.length,p50Ms:p(.5),p95Ms:p(.95),p99Ms:p(.99),maxMs:p(1)};
}
interface Outcome {ok:boolean;elapsedMs:number;timedOut:boolean;error?:string}
interface Target {origin:string;key:string;child?:ChildProcess;close():Promise<void>}
async function docker(args:string[],env:NodeJS.ProcessEnv,quiet=false){
  await new Promise<void>((resolve,reject)=>{
    const child=spawn('docker',args,{env,windowsHide:true,stdio:['ignore','pipe','pipe']});let tail='';
    const output=(chunk:Buffer)=>{tail=(tail+chunk.toString()).slice(-4000);if(!quiet)process.stdout.write(chunk);};
    child.stdout!.on('data',output);child.stderr!.on('data',output);
    child.once('error',reject);child.once('exit',code=>code===0?resolve():reject(new Error(`Docker command failed (${code}). ${tail}`)));
  });
}
function headers(target:Target,user=0) {return {Authorization:`Bearer ${target.key}`,'x-hanu-load-user':String(user),Origin:target.origin,'Content-Type':'application/json'};}
async function json(target:Target,path:string,user=0,data?:unknown) {
  const response=await fetch(target.origin+path,{method:data===undefined?'GET':'POST',headers:headers(target,user),body:data===undefined?undefined:JSON.stringify(data),signal:AbortSignal.timeout(30000)});
  const value=await response.json();if(!response.ok)throw new Error(`Load request ${path} failed (${response.status}): ${value.error??'unknown error'}`);return value;
}
async function target():Promise<Target> {
  if(remote){
    const u=new URL(remote);
    if(u.username||u.password||u.pathname!=='/'||u.search||u.hash||u.protocol!=='https:'&&!(u.protocol==='http:'&&['localhost','127.0.0.1'].includes(u.hostname)))throw new Error('Use an HTTPS origin or localhost HTTP.');
    const key=process.env.HANU_LOAD_TEST_KEY??'';
    if(!/^[a-f0-9]{64}$/.test(key))throw new Error('Remote test requires HANU_LOAD_TEST_KEY.');
    return {origin:u.origin,key,async close(){}};
  }
  const key=randomBytes(32).toString('hex');
  if(constrained){
    const project=`hanu-load-${randomBytes(5).toString('hex')}`,port=integer(option('port'),33001,1024,65535);
    const args=['compose','-f','deploy/load/compose.yaml','--project-name',project];
    const env={...process.env,HANU_LOAD_TEST_KEY:key,HANU_LOAD_USERS:String(users),HANU_LOAD_PORT:String(port),HANU_LOAD_CPUS:String(cpus),HANU_LOAD_DB_DELAY_MS:String(dbDelay)};
    const close=async()=>{await docker([...args,'down','--timeout','3'],env,true);};
    console.log(`Starting isolated Docker backend: ${cpus} CPU / 512 MiB, separate PostgreSQL, ${dbDelay} ms injected DB round trip.`);
    try{await docker([...args,'up','--detach','--build','--wait','--wait-timeout','90'],env);}
    catch(error){await close().catch(()=>{});throw error;}
    return {origin:`http://127.0.0.1:${port}`,key,close};
  }
  const child=spawn(process.execPath,['node_modules/tsx/dist/cli.mjs','scripts/cloud-load-server.ts'],{
    stdio:['ignore','pipe','pipe'],windowsHide:true,env:{...process.env,HANU_LOAD_TEST_KEY:key,HANU_LOAD_USERS:String(users),
      HANU_LOAD_DB_DELAY_MS:String(dbDelay),HANU_LOAD_ORIGIN:'http://127.0.0.1:0',HOST:'127.0.0.1',PORT:'0'} });
  let stdout='',stderr='';child.stderr!.on('data',chunk=>{stderr=(stderr+String(chunk)).slice(-3000);});
  async function close(){if(child.exitCode!==null)return;child.kill('SIGTERM');await Promise.race([new Promise(r=>child.once('exit',r)),sleep(3000)]);if(child.exitCode===null)child.kill('SIGKILL');}
  try{
    const origin=await new Promise<string>((resolve,reject)=>{
      const timer=setTimeout(()=>reject(new Error('Load fixture startup timed out.')),30000);
      child.stdout!.on('data',chunk=>{
        stdout+=String(chunk);const match=stdout.match(/HANU_LOAD_READY (.+)\r?\n/);
        if(match){clearTimeout(timer);resolve(JSON.parse(match[1]).origin);}
      });
      child.once('error',error=>{clearTimeout(timer);reject(error);});
      child.once('exit',()=>{clearTimeout(timer);reject(new Error(`Isolated fixture exited before ready. ${stderr}`));});
    });
    return {origin,key,child,close};
  }catch(error){await close();throw error;}
}

class Peer {
  ws:WebSocket;id=randomUUID();run?:RunState;
  profile:Profile; revision=1; startedAt?:number; lateReplies=0;errors:string[]=[];
  pending=new Map<string,{resolve:(v:Outcome)=>void;timer:ReturnType<typeof setTimeout>;start:number;expired:boolean}>();
  ready:Promise<void>; private readyResolve!:()=>void; private readyReject!:(e:Error)=>void;
  paired:Promise<void>;private pairResolve!:()=>void;private pairReject!:(e:Error)=>void;
  constructor(public target:Target,public user:number,public index:number,private bytes:Buffer,private hash:string){
    this.profile={values:{fullName:`SYNTHETIC ${user}-${index}`,gender:'Nam',phone:'0900000000'},customFields:[],mappings:{},
      attachments:bytes.length?{identityDocument:{id:`load-file-${randomUUID()}`,name:'synthetic.bin',type:'application/octet-stream',size:bytes.length,updatedAt:new Date().toISOString()}}:{}};
    this.ready=new Promise((resolve,reject)=>{this.readyResolve=resolve;this.readyReject=reject;});this.ready.catch(()=>{});
    this.paired=new Promise((resolve,reject)=>{this.pairResolve=resolve;this.pairReject=reject;});this.paired.catch(()=>{});
    this.ws=new WebSocket(target.origin.replace(/^http/,'ws')+'/extensions',{headers:{...headers(target,user),Origin:'chrome-extension://'+'a'.repeat(32)}});
    this.ws.on('message',raw=>{void this.message(JSON.parse(raw.toString())).catch(e=>{this.errors.push(String(e));this.readyReject(e);});});
    this.ws.on('error',e=>{this.errors.push(e.message);this.pairReject(e);this.readyReject(e);});
    this.ws.on('close',()=>{for(const [id,p] of this.pending){clearTimeout(p.timer);p.resolve({ok:false,timedOut:false,elapsedMs:performance.now()-p.start,error:'Connection closed'});this.pending.delete(id);}});
  }
  send(message:any){if(this.ws.readyState!==WebSocket.OPEN)throw new Error('Synthetic peer disconnected.');this.ws.send(JSON.stringify({protocol:PROTOCOL_VERSION,sessionId:this.id,...message}));}
  async pair(code:string){
    await new Promise<void>((resolve,reject)=>{if(this.ws.readyState===WebSocket.OPEN)resolve();else{this.ws.once('open',resolve);this.ws.once('error',reject);}});
    this.send({type:'PAIR',transport:'cloud',accessPolicy:1,extensionId:'a'.repeat(32),code});
    await within(this.paired,15000,'Pairing timed out.');
  }
  request(kind:string,extra:Record<string,unknown>={}):Promise<Outcome>{
    const requestId=randomUUID(),start=performance.now();
    return new Promise(resolve=>{
      const p={resolve,start,expired:false,timer:setTimeout(()=>{p.expired=true;resolve({ok:false,timedOut:true,elapsedMs:performance.now()-start,error:'5 second client deadline'});},deadline)};
      this.pending.set(requestId,p);
      this.send({type:'REQUEST',requestId,kind,runId:this.run?.runId,formId:this.run?.formId,...extra});
    });
  }
  progress(status:RunState['status']='running',attempted=false){
    if(!this.run)throw new Error('START not received.');
    this.run={...this.run,status,submitAttempted:attempted,eventSeq:(this.run.eventSeq??0)+1,updatedAt:new Date().toISOString(),
      logs:[...this.run.logs,{at:new Date().toISOString(),level:'info',message:`Synthetic progress ${this.run.eventSeq??0}`}],
      filled:[...this.run.filled,`synthetic-field-${this.run.eventSeq??0}`]};
    this.send({type:'STATE',run:this.run});
    this.send({type:'EXECUTION',execution:['completed','submit_uncertain'].includes(status)?null:{runId:this.run.runId,tabId:this.index+1,mode:'live',status,managed:true,tabOpen:true,active:true,updatedAt:this.run.updatedAt}});
  }
  async page():Promise<Outcome>{
    const reply=await this.request('ATTENTION_ACQUIRE',{rendering:'background'});
    // Token is recorded by the REPLY handler; release the exact matching lease.
    if(reply.ok)await this.request('ATTENTION_RELEASE',{token:this.lastToken});return reply;
  }
  private lastToken?:string;
  private async message(m:any){
    if(m.type==='PAIRED'){this.id=m.sessionId;this.pairResolve();return;}
    if(m.type==='ERROR'||m.type==='EMERGENCY_STOP'||m.type==='REVOKED'){this.errors.push(m.error??m.type);this.pairReject(new Error(m.error??m.type));this.readyReject(new Error(m.error??m.type));return;}
    if(m.type==='REPLY'){
      const p=this.pending.get(m.requestId);if(!p)return;clearTimeout(p.timer);this.pending.delete(m.requestId);
      if(m.token)this.lastToken=m.token;
      if(p.expired)this.lateReplies++;
      p.resolve({ok:m.ok===true,timedOut:false,elapsedMs:performance.now()-p.start,error:m.error});return;
    }
    if(m.type!=='COMMAND')return;
    let result:any={};
    if(m.kind==='READ_PROFILE')result={profile:this.profile,revision:this.revision};
    else if(m.kind==='ATTACHMENT_INFO')result={size:this.bytes.length,hash:this.hash};
    else if(m.kind==='ATTACHMENT_READ')result={base64:this.bytes.subarray(m.payload.offset,m.payload.offset+CHUNK_BYTES).toString('base64')};
    else if(m.kind==='PING')result={capabilities:['sharedFinalQuestion','cloudCoordinator']};
    else if(m.kind==='START'){
      this.startedAt=performance.now();
      this.run={runId:m.runId,sessionId:this.id,managed:true,tabId:this.index+1,formId:canonicalFormId(m.payload.url)!,url:m.payload.url,
        mode:'live',status:'running',filled:[],skipped:[],logs:[],submitAttempted:false,eventSeq:0,updatedAt:new Date().toISOString(),
        startedAt:new Date().toISOString(),profileSnapshot:this.profile,profileRevision:this.revision,expectedEmail:m.payload.expectedEmail};
      this.progress();
      const checked=await this.request('CHECK_FORM');
      if(!checked.ok)throw new Error('Initial CHECK_FORM rejected.');
      result=this.run;this.readyResolve();
    }
    this.send({type:'RESULT',commandId:m.commandId,ok:true,result});
  }
  close(){for(const p of this.pending.values())clearTimeout(p.timer);this.pending.clear();this.ws.terminate();}
}

async function scenario(perUser:number){
  const t=await target(),peers:Peer[]=[],dashboards:WebSocket[]=[];
  let isolationErrors=0,dashboardFrames=0,dashboardBytes=0;
  const phases:Record<string,any>={};let result:any;
  try{
    // Read-only identity probe first: pointing at production cannot start a test.
    const info=await json(t,'/__load/info');
    if(info.scope!=='hanu-isolated-load-v1'||info.realGoogleForms!==false||info.realSupabaseAuth!==false||info.profileCount!==0||info.users!==users)
      throw new Error('Target is not a fresh, matching isolated load fixture. No profiles were created.');
    console.log(`Preparing ${users} users x ${perUser} profiles (${info.database}, ${info.databaseConnections} DB connections).`);
    const bytes=Buffer.alloc(attachmentKB*1024,0x61),hash=createHash('sha256').update(bytes).digest('hex');
    for(let index=0;index<perUser;index++)await Promise.all(Array.from({length:users},async(_,user)=>{
      const code=(await json(t,'/api/pair',user,{})).code,peer=new Peer(t,user,index,bytes,hash);peers.push(peer);await peer.pair(code);
    }));
    for(let user=0;user<users;user++){
      const own=peers.filter(p=>p.user===user);let state:any;
      const until=Date.now()+30000;
      do{state=await json(t,'/api/state',user);if(state.sessions.length===perUser&&state.sessions.every((s:any)=>s.synced))break;await sleep(100);}while(Date.now()<until);
      if(state.sessions.length!==perUser||!state.sessions.every((s:any)=>s.synced))throw new Error('Profile synchronization did not finish.');
      await Promise.all(own.map(async p=>{
        const response=await fetch(t.origin+`/api/sessions/${p.id}`,{method:'PATCH',headers:headers(t,user),body:JSON.stringify({expectedEmail:`synthetic-${user}-${p.index}@example.test`})});
        if(!response.ok)throw new Error('Profile setup failed.');
      }));
      const ticket=(await json(t,'/api/events-ticket',user,{})).ticket;
      const ws=new WebSocket(t.origin.replace(/^http/,'ws')+'/events',{headers:headers(t,user)});dashboards.push(ws);
      await new Promise<void>((resolve,reject)=>{ws.once('open',resolve);ws.once('error',reject);});
      const ids=new Set(own.map(p=>p.id));
      let first!:()=>void;const received=new Promise<void>(resolve=>first=resolve);
      ws.on('message',raw=>{const m=JSON.parse(raw.toString());if(m.type==='STATE'){
        dashboardFrames++;dashboardBytes+=Buffer.byteLength(raw.toString());
        if(m.owner!==info.owners[user]||m.sessions.some((s:any)=>!ids.has(s.id)))isolationErrors++;
        first();
      }});
      ws.send(JSON.stringify({type:'AUTH',ticket}));await within(received,5000,'Dashboard handshake timed out.');
    }
    if(users>1){
      const foreign=peers.find(p=>p.user===1)!;
      const denied=await fetch(t.origin+`/api/sessions/${foreign.id}/ping`,{method:'POST',headers:headers(t,0),body:'{}'});
      if(denied.status!==404)isolationErrors++;
    }
    // All users click Start together; fake extensions never open Google Forms.
    await json(t,'/__load/reset-metrics',0,{});
    const start=performance.now(),formId=`hanu-load-${randomUUID()}`,url=`https://docs.google.com/forms/d/e/${formId}/viewform`;
    const starts=await Promise.all(Array.from({length:users},async(_,user)=>{
      const begin=performance.now();await json(t,'/api/start',user,{ids:peers.filter(p=>p.user===user).map(p=>p.id),url,mode:'live'});
      return performance.now()-begin;
    }));
    await within(Promise.all(peers.map(p=>p.ready)),30000,'START dispatch timed out.');
    phases.start={api:distribution(starts),dispatch:distribution(peers.map(p=>p.startedAt!-start)),metrics:await json(t,'/__load/metrics')};
    console.log(`START dispatch p95 ${phases.start.dispatch.p95Ms} ms.`);
    await json(t,'/__load/reset-metrics',0,{});
    const attention:Outcome[]=[];
    for(let round=0;round<rounds;round++){
      for(const p of peers)p.progress();
      if(round%2===0)attention.push(...await Promise.all(peers.map(p=>p.page())));
      if(interval)await sleep(interval);
    }
    phases.filling={attention:distribution(attention.map(r=>r.elapsedMs)),errors:attention.filter(r=>!r.ok).length,
      timeouts:attention.filter(r=>r.timedOut).length,metrics:await json(t,'/__load/metrics')};
    console.log(`Page permission p95 ${phases.filling.attention.p95Ms} ms; ${phases.filling.metrics.queries} SQL calls while filling.`);
    await json(t,'/__load/reset-metrics',0,{});
    for(const p of peers)p.progress('submitting',true);
    const grant=await Promise.all(peers.map(p=>p.request('SUBMIT')));
    phases.submit={latency:distribution(grant.map(r=>r.elapsedMs)),granted:grant.filter(r=>r.ok).length,
      timeouts:grant.filter(r=>r.timedOut).length,rejected:grant.filter(r=>!r.ok&&!r.timedOut).length,metrics:await json(t,'/__load/metrics')};
    // A fresh request ID must not obtain a second durable submit permission.
    const duplicate=await Promise.all(peers.map((p,i)=>grant[i].ok?p.request('SUBMIT'):Promise.resolve(undefined)));
    const duplicateGrants=duplicate.filter(r=>r?.ok).length;
    for(let i=0;i<peers.length;i++)peers[i].progress(grant[i].ok?'completed':'submit_uncertain',true);
    let checkpoint:any;const until=Date.now()+30000;
    do{checkpoint=await json(t,'/__load/checkpoint');
      if(checkpoint.sessions.length===peers.length&&checkpoint.sessions.every((s:any)=>['completed','submit_uncertain'].includes(s.status))&&
        checkpoint.runs.length===peers.length&&checkpoint.runs.every((r:any)=>['completed','submit_uncertain'].includes(r.status)))break;
      await sleep(200);
    }while(Date.now()<until);
    const receivedLocks=checkpoint.locks.filter((l:any)=>l.resolution==='received').length;
    const completed=checkpoint.sessions.filter((s:any)=>s.status==='completed').length;
    const durable=completed===phases.submit.granted&&receivedLocks===phases.submit.granted&&checkpoint.locks.length===peers.length&&
      checkpoint.runs.every((r:any)=>['completed','submit_uncertain'].includes(r.status));
    result={users,profilesPerUser:perUser,totalProfiles:peers.length,database:info.database,databaseConnections:info.databaseConnections,
      embeddedDatabase:info.embeddedDatabase,injectedDbDelayMs:info.injectedDbDelayMs,resourceLimit:constrained?{cpus,memoryMiB:512}:null,clientDeadlineMs:deadline,rounds,attachmentKB,phases,
      dashboardFrames,dashboardMiB:Math.round(dashboardBytes/1048576*100)/100,isolationErrors,duplicateGrants,
      lateReplies:peers.reduce((sum,p)=>sum+p.lateReplies,0),protocolErrors:peers.flatMap(p=>p.errors),
      durableResult:{completed,receivedLocks,totalLocks:checkpoint.locks.length,verified:durable},
      passed:phases.filling.errors===0&&phases.submit.granted===peers.length&&isolationErrors===0&&duplicateGrants===0&&durable&&peers.every(p=>!p.errors.length)};
    console.log(`${result.passed?'PASS':'FAIL'} ${peers.length} profiles: ${phases.submit.granted} grants, submit p95 ${phases.submit.latency.p95Ms} ms, ${phases.submit.timeouts} timeouts, ${duplicateGrants} duplicate grants.`);
    return result;
  }finally{for(const p of peers)p.close();for(const ws of dashboards)ws.terminate();await t.close();}
}
const report:any={generatedAt:new Date().toISOString(),scope:remote?'Isolated staging backend':constrained?'Local Docker backend with CPU/RAM limits':'Local backend in a separate Node process',
  limitations:['Synthetic extension clients; no Chrome or Google Forms requests.','Synthetic authentication and in-memory object storage; no real Supabase Auth/Storage latency.',
    `${users} independent user IPs are simulated in the authenticated test harness.`,
    constrained?'Docker enforces the configured CPU/RAM limits; host hardware and local network still differ from Render.':remote?'Verify CPU/RAM limits on the staging host.':'Local CPU/RAM are not constrained to Render Free.',
    'When embedded PGlite is used, measurements include database CPU/RAM and transactions are serialized.'],scenarios:[]};
for(const size of sizes){try{report.scenarios.push(await scenario(size));}catch(error){report.scenarios.push({users,profilesPerUser:size,totalProfiles:users*size,passed:false,error:(error as Error).message});console.error(`FAIL ${users*size} profile scenario: ${(error as Error).message}`);}}
await mkdir('test-results',{recursive:true});await writeFile(output,JSON.stringify(report,null,2)+'\n');
if(!report.scenarios.every((s:any)=>s.passed))process.exitCode=1;
console.log(`Report: ${output}`);
