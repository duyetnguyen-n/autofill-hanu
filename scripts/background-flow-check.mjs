import {createServer} from 'node:https';
import {mkdtemp,mkdir,cp,readFile,writeFile,rm} from 'node:fs/promises';
import {tmpdir,cpus,totalmem} from 'node:os';
import {join,resolve,basename,sep} from 'node:path';
import {spawn,execFileSync,execFile} from 'node:child_process';
import {WebSocket} from 'ws';
import {chromium} from '@playwright/test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {build as esbuild} from 'esbuild';
import {serve} from '../build/server/main.mjs';

// Real, initially minimized browser windows. Only the service workers are
// inspected while running: attaching Playwright to form pages masks occlusion.
// Replace the native pipe with a fixture bridge; NativeClient and Coordinator
// are unchanged, and no Windows native-host registration or real profile is used.
const count=Number(process.argv.find(a=>a.startsWith('--profiles='))?.split('=')[1]??3);
const controls=process.argv.includes('--controls'),faults=process.argv.includes('--faults');
const pickerFixture=process.argv.includes('--picker');
const baselineRef=process.argv.find(a=>a.startsWith('--baseline-ref='))?.slice(15);
assert(!baselineRef||/^[0-9a-f]{7,40}$/.test(baselineRef));
const baseline=Boolean(baselineRef)||process.argv.includes('--baseline-head');
const baselineCommit=baseline?execFileSync('git',['rev-parse','--verify',`${baselineRef??'HEAD'}^{commit}`],{encoding:'utf8'}).trim():undefined;
assert(!pickerFixture||!faults&&!controls,'Picker fixture has separate upload checks; use the native fixture for recovery/control scenarios.');
const latencyMs=Number(process.argv.find(a=>a.startsWith('--latency-ms='))?.split('=')[1]??0),assetDelayMs=Number(process.argv.find(a=>a.startsWith('--asset-delay-ms='))?.split('=')[1]??0);
assert(Number.isFinite(latencyMs)&&latencyMs>=0&&latencyMs<=10000&&Number.isFinite(assetDelayMs)&&assetDelayMs>=0&&assetDelayMs<=60000);
const faultPolicies=new Map(),documentRequests=[],faultResults=[];
const serial=process.argv.includes('--serial'),sharedFinal=process.argv.includes('--final-question'),cloud=process.argv.includes('--cloud');
assert(count>=2&&count<=20);
const dir=await mkdtemp(join(tmpdir(),'hanu-background-flow-')),profiles=[],steps=new Map(),submissions=new Map(),observations=[],focusEvents=[];
assert(resolve(dir).startsWith(resolve(tmpdir())+sep)&&basename(dir).startsWith('hanu-background-flow-'));
const reportName=process.argv.find(a=>a.startsWith('--report='))?.slice(9);
assert(!reportName||/^[a-zA-Z0-9_-]+$/.test(reportName));
const output=reportName??(cloud?`${faults?'cloud-reliability':controls?'cloud-controls':'cloud-background'}-flow-${count}`:sharedFinal?`shared-final-question-flow-${count}`:`${serial?'serial':'parallel'}-background-flow-${count}`);
const timingSamples=new Map();let measuring=false;
let app,fixtureServer,sampler,stopping=false;
let peakRssMb=0,peakCpuPercent=0,sampling=false;
function sampleResources(){
 if(process.platform==='win32'||sampling||stopping)return;
 sampling=true;execFile('ps',['-axo','pid=,ppid=,rss=,%cpu='],(error,out)=>{try{
  if(error)return;
  const rows=out.trim().split('\n').map(line=>line.trim().split(/\s+/).map(Number));
  const pids=new Set([process.pid,...profiles.map(p=>p.child.pid)]);
  let changed=true;while(changed){changed=false;for(const [pid,parent]of rows)if(pids.has(parent)&&!pids.has(pid)){pids.add(pid);changed=true;}}
  let rss=0,cpu=0;for(const [pid,,memory,usage]of rows)if(pids.has(pid)){rss+=memory;cpu+=usage;}
  peakRssMb=Math.max(peakRssMb,Math.round(rss/1024));peakCpuPercent=Math.max(peakCpuPercent,Math.round(cpu));
 }finally{sampling=false;}});
}
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
async function wait(fn,ms=120000){const end=Date.now()+ms;while(!await fn()){if(Date.now()>end)throw new Error('Background fixture timed out');await sleep(50);}}
async function complete(status){await wait(async()=>{const sessions=await app.store.sessions();for(const s of sessions){if(measuring&&s.run?.status===status&&!timingSamples.has(s.id))timingSamples.set(s.id,Date.now());if(['waiting_manual','failed','paused','submit_uncertain'].includes(s.run?.status)&&!(faults&&s.run?.recovery?.automatic))throw new Error(`${s.name}: ${s.run.blockingIssue?.message??s.error??s.run.status}`);}return sessions.every(s=>s.run?.status===status);});}
function peak(intervals){const points=intervals.flatMap(([start,end])=>[[start,1],[end,-1]]).sort((a,b)=>a[0]-b[0]||a[1]-b[1]);let active=0,max=0;for(const [,change]of points){active+=change;max=Math.max(max,active);}return max;}
class CDP {
  constructor(ws){this.ws=ws;this.seq=0;this.pending=new Map();ws.on('message',raw=>{const m=JSON.parse(String(raw));if(m.id){const p=this.pending.get(m.id);if(p){clearTimeout(p.timer);this.pending.delete(m.id);m.error?p.reject(new Error(m.error.message)):p.resolve(m.result);}}});ws.on('close',()=>this.cancelPending());}
  static async connect(url){const ws=new WebSocket(url);await new Promise((r,j)=>{ws.once('open',r);ws.once('error',j);});return new CDP(ws);}
  send(method,params={},sessionId){if(this.ws.readyState!==1)return Promise.reject(new Error('Fixture browser closed'));const id=++this.seq;return new Promise((resolve,reject)=>{const timer=setTimeout(()=>{this.pending.delete(id);reject(new Error('CDP timeout: '+method));},20000);this.pending.set(id,{resolve,reject,timer});this.ws.send(JSON.stringify({id,method,params,sessionId}));});}
  async evaluate(sessionId,expression){const r=await this.send('Runtime.evaluate',{expression,awaitPromise:true,returnByValue:true},sessionId);if(r.exceptionDetails)throw new Error(r.exceptionDetails.exception?.description??r.exceptionDetails.text);return r.result.value;}
  cancelPending(){for(const p of this.pending.values()){clearTimeout(p.timer);p.reject(new Error('Fixture browser closed'));}this.pending.clear();}
  close(){this.cancelPending();this.ws.close();}
}
const fixtureHtml=(index,step)=>{
const field=step===0?'<div role="checkbox" tabindex="0" aria-label="Record your email" aria-checked="false">Record your email</div>':step===1?'<div role="listitem"><div role="heading">TÔI CAM KẾT本人保证 *</div><div id="pledge"></div></div>':step===2?'<div role="listitem"><div role="heading">Họ và tên *</div><input id="name" type="text" name="name" required></div><div role="listitem"><div role="heading">GIỚI TÍNH | 性别 *</div><div role="listbox" tabindex="0" aria-expanded="false"><div jsname="LgbsSe">Choose</div><div jsname="V68bde" class="OA0qNb" style="display:none"></div></div><input id="gender" type="hidden" name="gender"></div><div role="listitem"><div role="heading">Ảnh giấy tờ tùy thân *</div>'+(pickerFixture?'<button id="open-file" type="button">Thêm tệp</button><span id="file-name"></span>':'<input id="file" type="file">')+'</div>':'<div role="listitem"><div role="heading">Số điện thoại *</div><input id="phone" type="text" name="phone" pattern="[0-9]{10}" required></div><div role="listitem"><div role="heading">TÔI CAM KẾT | 本人保证 *</div><input type="radio" name="terms" aria-label="本人已详细阅读并同意接受以上条款限制。"><input type="radio" name="terms" aria-label="Tôi đã đọc và đồng ý với những điều khoản trên và sẽ chịu trách nhiệm với thông tin dự thi của mình."></div>';
return `<!doctype html><meta charset="utf-8"><style>body{margin:0;width:100%;font:18px Arial}form{width:calc(100% - 48px);max-width:640px;margin:20px auto}div[role=listitem]{padding:16px;border:1px solid #ddd;margin:15px 0;box-sizing:border-box;width:100%}[role=option],button,[role=radio],[role=checkbox],[jsname=LgbsSe]{padding:12px}input{font:inherit}</style>${assetDelayMs?`<img src="/slow-asset?profile=${index}&page=${step}" width="1" height="1" alt="">`:""}<div data-google-account="nick${index}@example.test">nick${index}@example.test</div><h1>Background fixture ${index} — page ${step}</h1><form method="POST" action="/forms/u/0/d/e/background-fixture/formResponse">${field}${sharedFinal&&step===3?'<div role="listitem" data-item-id="last-question"><div role="heading">Năm nay là năm bao nhiêu? *</div><input type="text" name="entry.9000" required></div>':''}<div role="alert"></div><button type="button">${step<3?'Next':'Submit'}</button></form><script>
const observe=kind=>fetch('/observe',{method:'POST',body:JSON.stringify({index:${index},step:${step},kind,width:innerWidth,height:innerHeight,visibility:document.visibilityState,focused:document.hasFocus(),at:Date.now()})});observe('load');window.addEventListener('error',e=>fetch('/observe',{method:'POST',body:JSON.stringify({index:${index},kind:'fixture-error',message:e.message,at:Date.now()})}));document.addEventListener('visibilitychange',()=>observe('visibility'));
const checkbox=document.querySelector('[role=checkbox]');if(checkbox)checkbox.onclick=()=>checkbox.setAttribute('aria-checked','true');
if(${step}===1)requestAnimationFrame(()=>setTimeout(()=>{document.querySelector('#pledge').innerHTML='<div role="radio" aria-checked="false" data-value="Tôi cam kết không thuê người đăng ký dự thi kỳ thi lần này.">Tôi cam kết không thuê người đăng ký dự thi kỳ thi lần này.</div>';const r=document.querySelector('[role=radio]');r.onclick=()=>r.setAttribute('aria-checked','true');observe('pledge-ready');},300));
const list=document.querySelector('[role=listbox]'),popup=document.querySelector('.OA0qNb');if(list){document.querySelector('[jsname=LgbsSe]').onclick=()=>{list.setAttribute('aria-expanded','true');popup.style.display='block';observe('opened');requestAnimationFrame(()=>setTimeout(()=>{popup.innerHTML='<div role="option" tabindex="0" data-value="">Choose</div><div role="option" tabindex="-1" data-value="Nam">Nam</div><div role="option" tabindex="-1" data-value="Nữ">Nữ</div>';observe('options-ready');},1800));};popup.onclick=e=>{const o=e.target.closest('[role=option]');if(o){document.querySelector('#gender').value=o.dataset.value;list.setAttribute('aria-valuetext',o.dataset.value);document.querySelector('[jsname=LgbsSe]').textContent=o.dataset.value;list.setAttribute('aria-expanded','false');popup.style.display='none';observe('selected');}};}
if(${faultPolicies.get(index)?.uploadError===true})document.querySelector('#file')?.addEventListener('change',()=>{document.querySelector('#file').value='';document.querySelector('#file').setCustomValidity('Synthetic upload failed');observe('upload-failed');});
if(${pickerFixture}&&${step}===2){
 document.querySelector('#open-file').onclick=()=>{observe('picker-open');const frame=document.createElement('iframe');frame.src='/picker?hostId=file-upload&rpcService=fixture-${index}&rpctoken='+crypto.randomUUID();frame.style.cssText='position:fixed;inset:0;width:90vw;height:90vh;background:white;z-index:100';document.body.append(frame);window.addEventListener('message',function receive(event){if(event.origin!==location.origin||event.source!==frame.contentWindow||event.data?.kind!=='fixture-picker-commit')return;window.removeEventListener('message',receive);window.fixtureCommittedFile=event.data.name;document.querySelector('#file-name').textContent=event.data.name;const remove=document.createElement('button');remove.type='button';remove.setAttribute('aria-label','Remove file');remove.textContent='Remove file';document.querySelector('#file-name').append(remove);frame.remove();observe('picker-committed');});};
}
document.querySelector('form > button').onclick=()=>{const valid=${step}===0?checkbox.getAttribute('aria-checked')==='true':${step}===1?document.querySelector('[role=radio]')?.getAttribute('aria-checked')==='true':${step}===2?document.querySelector('#name').value&&document.querySelector('#gender').value&&(${pickerFixture}?window.fixtureCommittedFile:document.querySelector('#file').files.length):document.querySelector('#phone').value&&document.querySelector('input[name=terms]:checked');if(!valid){document.querySelector('[role=alert]').textContent='Đây là một câu hỏi bắt buộc';observe('invalid-next');return;}if(${step}===2){const f=document.createElement('input');f.name='file';f.type='hidden';f.value=${pickerFixture}?window.fixtureCommittedFile:document.querySelector('#file').files[0].name;document.querySelector('form').append(f);}observe('advance');document.querySelector('form').submit();};</script>`;
};
try{
sampler=setInterval(sampleResources,1000);
for(let s=0;s<4;s++)new Function(fixtureHtml(0,s).match(/<script>([\s\S]*)<\/script>/)[1]);
let cloudFixture;
if(cloud){
  const {httpFixture,users}=await import('../tests/cloud/fixture.ts');
  cloudFixture=await httpFixture(resolve('build/cloud-ui'));await cloudFixture.api('state');
  const runtime=cloudFixture.app.runtimes.get(users[0]);
  // Cloud progress is intentionally buffered until registration ends. Observe
  // the dashboard's live overlay rather than a stale DB checkpoint. This test
  // polls at 50 ms; use the internal view to avoid the HTTP API's rate limit.
  app={store:{sessions:async()=>runtime.coordinator.runBuffer.overlay(await runtime.store.sessions())},coordinator:runtime.coordinator,origin:cloudFixture.config.origin,url:cloudFixture.config.origin,close:()=>cloudFixture.close()};
  process.env.PUBLIC_ORIGIN=app.origin;process.env.HANU_CLOUD_DEV='1';process.env.HANU_CLOUD_OUT_DIR=join(dir,'cloud-build');await import('./build-cloud.mjs');
  if(baseline){
    // Read committed source into isolation; never reset the workspace or load
    // an old build into any real user profile.
    const source=join(dir,'baseline-source');await mkdir(source);
    execFileSync('tar',['-xf','-','-C',source],{input:execFileSync('git',['archive',baselineCommit,'src'])});
    for(const entry of ['background','content'])await esbuild({entryPoints:[join(source,'src',`${entry}.ts`)],bundle:true,format:'iife',target:'es2022',minify:true,outfile:join(process.env.HANU_CLOUD_OUT_DIR,`${entry}.js`),define:{__HANU_CLOUD_ORIGIN__:JSON.stringify(app.origin)}});
  }
}
const extension=join(dir,'extension'),data=join(dir,'app');await cp(cloud?process.env.HANU_CLOUD_OUT_DIR:'dist',extension,{recursive:true});await mkdir(data,{recursive:true});
const harness=cloud?`(()=>{const listeners=[];globalThis.__fixture={ask:m=>new Promise(resolve=>listeners.forEach(fn=>fn(m,{},resolve)))};const original=chrome.runtime.onMessage.addListener.bind(chrome.runtime.onMessage);chrome.runtime.onMessage.addListener=fn=>{listeners.push(fn);original(fn)};})();\n`:`(()=>{const ports=new Map(),listeners=[],out=[];let id=0;globalThis.__fixture={out,deliver:(id,m)=>ports.get(id)?.messages.forEach(fn=>fn(m)),ask:m=>new Promise(resolve=>listeners.forEach(fn=>fn(m,{},resolve)))};const original=chrome.runtime.onMessage.addListener.bind(chrome.runtime.onMessage);chrome.runtime.onMessage.addListener=fn=>{listeners.push(fn);original(fn)};chrome.runtime.connectNative=()=>{const p={id:++id,messages:[],disconnects:[],onMessage:{addListener:fn=>p.messages.push(fn)},onDisconnect:{addListener:fn=>p.disconnects.push(fn)},postMessage:m=>out.push({id:p.id,kind:'message',message:m}),disconnect:()=>{out.push({id:p.id,kind:'close'});p.disconnects.forEach(fn=>fn())}};ports.set(p.id,p);out.push({id:p.id,kind:'open'});return p;};})();\n`;
await writeFile(join(extension,'background.js'),harness+await readFile(join(extension,'background.js'),'utf8'));
const openssl=process.platform==='win32'?'C:/Program Files/Git/usr/bin/openssl.exe':'openssl';execFileSync(openssl,['req','-x509','-newkey','rsa:2048','-nodes','-keyout',join(dir,'key.pem'),'-out',join(dir,'cert.pem'),'-days','1','-subj','/CN=docs.google.com'],{stdio:'ignore'});
fixtureServer=createServer({key:await readFile(join(dir,'key.pem')),cert:await readFile(join(dir,'cert.pem'))},async(req,res)=>{const i=Number(req.headers.cookie?.match(/fixtureprofile=(\d+)/)?.[1]??0);let body='';for await(const c of req)body+=c;if(req.url==='/observe'){observations.push(JSON.parse(body));res.end('OK');return;}if(req.url.startsWith('/recaptcha/fixture')){res.end('Synthetic human checkpoint');return;}
if(pickerFixture&&req.url.startsWith('/picker?')){res.setHeader('content-type','text/html; charset=utf-8');res.end(`<!doctype html><input type="file" accept="image/png"><div>Local synthetic Picker, not Google</div><script>
const started=Date.now();setTimeout(()=>{const old=document.querySelector('input'),input=old.cloneNode();old.replaceWith(input);input.onchange=async()=>{const f=input.files[0];if(!f)return;const hash=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',await f.arrayBuffer()))).map(v=>v.toString(16).padStart(2,'0')).join('');await fetch('/observe',{method:'POST',body:JSON.stringify({index:${i},kind:'picker-handoff',name:f.name,hash,documentAgeMs:Date.now()-started,at:Date.now()})});setTimeout(()=>parent.postMessage({kind:'fixture-picker-commit',name:f.name},location.origin),500);};},800);</script>`);return;}
if(req.url.startsWith('/slow-asset')){const timer=setTimeout(()=>res.end('fixture resource'),assetDelayMs);res.once('close',()=>clearTimeout(timer));return;}
const policy=faultPolicies.get(i);if(latencyMs&&req.url.includes('/forms/'))await sleep(latencyMs);if(req.method==='GET'&&policy?.resetOnRecovery&&steps.get(i)){steps.set(i,0);policy.resetOnRecovery=false;}if(req.url.includes('/forms/'))documentRequests.push({index:i,method:req.method,at:Date.now(),step:steps.get(i)??0});
if(req.method==='GET'&&req.url.includes('/forms/')&&policy?.statuses?.length){const code=policy.statuses.shift();res.statusCode=code;res.end(`<html><title>${code}</title><body>${code}. That’s an error. Service Unavailable</body></html>`);return;}
if(req.method==='GET'&&req.url.includes('/forms/')&&policy?.captcha){res.end('<html><body>Verify you are human<iframe src="/recaptcha/fixture"></iframe></body></html>');return;}
if(req.method==='POST'){const step=steps.get(i)??0;if(policy?.hangNext&&step===0){policy.hangNext=false;steps.set(i,step+1);res.setHeader('Content-Type','text/html');res.write('<!doctype html><head><title>Incomplete navigation</title>');const timer=setTimeout(()=>res.end('</head><body>Delayed body</body>'),45000);res.once('close',()=>clearTimeout(timer));return;}if(policy?.delayNext&&step===0){const delay=policy.delayNext;policy.delayNext=0;await sleep(delay);}if(step===2){const p=new URLSearchParams(body);assert.equal(p.get('name'),`SYNTHETIC PROFILE ${i}`);assert.equal(p.get('gender'),'Nam');assert.equal(p.get('file'),`synthetic-${i}.png`);}if(step===3){if(sharedFinal)assert.equal(new URLSearchParams(body).get('entry.9000'),'2026');submissions.set(i,(submissions.get(i)??0)+1);if(policy?.ambiguousSubmit){res.statusCode=500;res.end('<html><body>500. Internal Server Error</body></html>');return;}res.end('<html>Your response has been recorded</html>');return;}steps.set(i,step+1);}res.setHeader('Content-Type','text/html; charset=utf-8');res.end(fixtureHtml(i,steps.get(i)??0));});await new Promise((r,j)=>{fixtureServer.once('error',j);fixtureServer.listen(0,'127.0.0.1',r);});
const fixtureUrl=`https://docs.google.com${pickerFixture?'':':'+fixtureServer.address().port}/forms/d/e/background-fixture/viewform`;
if(!cloud)app=await serve({dir:data,uiDir:resolve('build/manager-ui')});const originalAcquire=app.coordinator.attention.acquire.bind(app.coordinator.attention);app.coordinator.attention.acquire=async(...args)=>{if(serial)args[3]='foreground';const v=await originalAcquire(...args);focusEvents.push({kind:'acquire',session:args[0],run:args[1],token:v.token,mode:v.mode,at:Date.now()});return v;};const originalRelease=app.coordinator.attention.release.bind(app.coordinator.attention);app.coordinator.attention.release=async(...args)=>{await originalRelease(...args);focusEvents.push({kind:'release',session:args[0],token:args[1],at:Date.now()});};
for(let i=0;i<count;i++){
const profileDir=join(dir,'profile-'+i);await mkdir(join(profileDir,'Default'),{recursive:true});await writeFile(join(profileDir,'Default','Preferences'),JSON.stringify({extensions:{ui:{developer_mode:true}}}));const exe=process.platform==='win32'?'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe':chromium.executablePath();const child=spawn(exe,[`--user-data-dir=${profileDir}`,'--no-first-run','--no-default-browser-check','--disable-background-networking','--remote-debugging-port=0',`--disable-extensions-except=${extension}`,`--load-extension=${extension}`,`--host-resolver-rules=MAP docs.google.com 127.0.0.1${pickerFixture?':'+fixtureServer.address().port:''}`,'--ignore-certificate-errors','--no-proxy-server',...(process.platform==='win32'?[]:['--no-sandbox']),'about:blank'],{windowsHide:false,stdio:'ignore'});const p={child,profileDir,ports:new Map(),index:i};profiles.push(p);
let endpoint;
await wait(async()=>{try{const [port,path]=(await readFile(join(profileDir,'DevToolsActivePort'),'utf8')).trim().split('\n');endpoint=`ws://127.0.0.1:${port}${path}`;return true;}catch{return false;}});
p.cdp=await CDP.connect(endpoint);let target;
// New Chromium builds also run component extensions named background.js.
// Identify our isolated harness instead of attaching to the first worker.
await wait(async()=>{
 const candidates=(await p.cdp.send('Target.getTargets')).targetInfos.filter(t=>t.type==='service_worker'&&t.url.startsWith('chrome-extension://')&&t.url.endsWith('/background.js'));
 for(const candidate of candidates){
  const session=(await p.cdp.send('Target.attachToTarget',{targetId:candidate.targetId,flatten:true})).sessionId;
  try{if(await p.cdp.evaluate(session,'typeof globalThis.__fixture!=="undefined"')){target=candidate;p.worker=session;return true;}}
  finally{if(p.worker!==session)await p.cdp.send('Target.detachFromTarget',{sessionId:session}).catch(()=>{});}
 }
 return false;
},20000);
const extId=new URL(target.url).host;await writeFile(join(data,'allowed-extensions.json'),JSON.stringify([extId]));p.eval=e=>p.cdp.evaluate(p.worker,e);
await p.cdp.send('Runtime.enable',{},p.worker);console.log(`Connected fixture worker ${i+1}`);
await p.cdp.send('Storage.setCookies',{cookies:[{url:fixtureUrl,name:'fixtureprofile',value:String(i)}]});
let polling=false;if(!cloud)p.poller=setInterval(()=>{if(polling||stopping)return;polling=true;void p.eval('__fixture.out.splice(0)').then(out=>{for(const e of out){if(e.kind==='open'){const ws=new WebSocket(`${app.origin.replace('http','ws')}/native`,{headers:{'x-bridge-token':app.bridgeToken,'x-extension-origin':`chrome-extension://${extId}/`}}),port={ws,pending:[]};p.ports.set(e.id,port);ws.on('open',()=>{for(const m of port.pending)ws.send(JSON.stringify(m));port.pending=[];});ws.on('message',m=>void p.eval(`__fixture.deliver(${e.id},${String(m)})`).catch(()=>{}));ws.on('error',()=>{});}else if(e.kind==='close')p.ports.get(e.id)?.ws.close();else{const port=p.ports.get(e.id);if(port?.ws.readyState===1)port.ws.send(JSON.stringify(e.message));else port?.pending.push(e.message);}}}).catch(()=>{}).finally(()=>polling=false);},25);
const image=[...await readFile('tests/upload-fixture.png'),...(pickerFixture?[i]:[])];await p.eval(`(async()=>{const profile={values:{recordGoogleEmail:'true',firstCommitment:'true',termsCommitment:'true',fullName:'SYNTHETIC PROFILE ${i}',gender:'Nam',phone:'0900000000'},customFields:[],mappings:{},attachments:{identityDocument:{id:'image-${i}',name:'synthetic-${i}.png',type:'image/png',size:${image.length},updatedAt:new Date().toISOString()}}};await chrome.storage.local.set({profile,profileRevision:1});const req=indexedDB.open('hanu-hsk-autofill',1);req.onupgradeneeded=()=>req.result.createObjectStore('attachments');const db=await new Promise((r,j)=>{req.onsuccess=()=>r(req.result);req.onerror=()=>j(req.error)});await new Promise((r,j)=>{const tx=db.transaction('attachments','readwrite');tx.objectStore('attachments').put(new Blob([Uint8Array.from(${JSON.stringify(image)})],{type:'image/png'}),'image-${i}');tx.oncomplete=r;tx.onerror=j;});db.close();})()`);
console.log(`Seeded fixture profile ${i+1}`);const pair=cloud?await cloudFixture.repository.pairCode('11111111-1111-4111-8111-111111111111'):app.store.pairCode();await p.eval(`void __fixture.ask({type:'NATIVE_PAIR',code:${JSON.stringify(pair)}})`);await wait(async()=>{const sessions=await app.store.sessions();return sessions.length===i+1&&sessions.every(s=>s.synced)});p.id=(await app.store.sessions()).at(-1).id;await app.coordinator.edit(p.id,{name:`Profile test ${i+1}`,expectedEmail:`nick${i}@example.test`});await p.eval(`(async()=>{for(const w of await chrome.windows.getAll())await chrome.windows.update(w.id,{state:'minimized'});})()`);console.log(`Prepared minimized profile ${i+1}/${count}`);
}
const start=Date.now();measuring=true;const group=await app.coordinator.start(profiles.map(p=>p.id),fixtureUrl,'test');let sharedQuestion;if(sharedFinal){await wait(async()=>(await app.store.sessions()).every(s=>s.run?.status==='waiting_manual'));for(const s of await app.store.sessions())assert.equal(s.run.blockingIssue.reason,'verification');const scan=await app.coordinator.command(profiles[0].id,'SCAN_FORM');const q=scan.questions.find(q=>q.label.includes('Năm nay'));assert.equal(q.targetId,'entry.9000');assert.equal(q.kind,'text');sharedQuestion={label:q.label,value:'2026',kind:q.kind,formId:scan.formId,questionId:q.targetId};const results=await app.coordinator.setFinalQuestion(profiles.map(p=>p.id),sharedQuestion);assert(results.every(r=>r.ok));await Promise.all(profiles.map(p=>app.coordinator.control(p.id,'RESUME')));}await complete('ready_to_submit');assert.equal([...submissions.values()].reduce((a,b)=>a+b,0),0);assert.equal(observations.filter(o=>o.kind==='invalid-next').length,0);
const testCompleteAt=Date.now();measuring=false;const benchmarkTimings=profiles.map(p=>({profile:p.index+1,readyMs:timingSamples.get(p.id)-start,firstLoadMs:observations.find(o=>o.index===p.index&&o.kind==='load')?.at-start,pages:observations.filter(o=>o.index===p.index&&o.kind==='load'&&o.at<=testCompleteAt).map(o=>({page:o.step,loadedMs:o.at-start}))}));
console.log('BENCHMARK '+JSON.stringify(benchmarkTimings));
for(const p of profiles){const actual=await p.eval(`(async()=>{const r=(await chrome.storage.local.get('managedRun')).managedRun;return {status:r.status,filled:r.filled,window:await chrome.windows.get((await chrome.tabs.get(r.tabId)).windowId),debuggerAttached:(await chrome.debugger.getTargets()).some(t=>t.tabId===r.tabId&&t.attached)};})()`);assert.equal(actual.status,'ready_to_submit');assert.notEqual(actual.window.state,'minimized');assert(actual.filled.some(id=>id.includes('gioi tinh')));assert(actual.filled.some(id=>id.includes('cam ket')));assert.equal(actual.debuggerAttached,false);}
const intervals=focusEvents.filter(e=>e.kind==='acquire'&&e.run===group.id).map(a=>[a.at,focusEvents.find(e=>e.kind==='release'&&e.token===a.token&&e.at>=a.at)?.at??testCompleteAt]);
const menuIntervals=observations.filter(e=>e.kind==='opened'&&e.at<=testCompleteAt).map(a=>[a.at,observations.find(e=>e.index===a.index&&e.kind==='selected'&&e.at>=a.at)?.at??testCompleteAt]);
const leasePeak=peak(intervals),menuPeak=peak(menuIntervals);assert.equal(serial?leasePeak===1:leasePeak>=2,true);assert.equal(serial?menuPeak===1:menuPeak>=2,true);
const testMs=Date.now()-start;
console.log(`PASS: ${count} initially minimized profiles complete delayed required controls, rAF dropdown + 1.8s menu, upload and full document navigation without viewing any form; Test submits zero.`);
const manager=await chromium.launch({channel:process.platform==='win32'?'msedge':'chromium',headless:true});try{const page=await manager.newPage({viewport:{width:1440,height:1050}});if(cloud)await page.context().addCookies([{name:'test-account',value:'account-a',url:app.origin,httpOnly:true,sameSite:'Lax'}]);await page.goto(app.url);await page.getByText('Xong Test',{exact:false}).first().waitFor();await page.screenshot({path:`test-results/${output}-manager.png`,fullPage:true});}finally{await manager.close();}
if(faults){assert(cloud&&!sharedFinal);const {reliabilityScenarios}=await import('./reliability-scenarios.mjs');await reliabilityScenarios({app,profiles,steps,faultPolicies,documentRequests,submissions,faultResults,fixtureUrl,wait,sleep,complete,cloudFixture,CDP});}
if(controls){
  assert(cloud&&!sharedFinal,'Controls fixture uses cloud mode without a shared verification question');
  const ask=(p,type)=>p.eval(`(async()=>{const r=(await chrome.storage.local.get('managedRun')).managedRun;return __fixture.ask({type:${JSON.stringify(type)},tabId:r.tabId,mode:'test'});})()`);
  const first=profiles[0];
  assert.equal((await ask(first,'PAUSE_RUN')).status,'paused');
  assert.equal((await ask(first,'RESUME_RUN')).status,'running');
  await complete('ready_to_submit');
  assert.equal((await ask(first,'STOP_RUN')).status,'idle');
  for(const p of profiles)await app.coordinator.control(p.id,'STOP');
  steps.clear();
  for(const p of profiles)await p.eval(`(async()=>{const profile=(await chrome.storage.local.get('profile')).profile;profile.values.phone='wrong';return __fixture.ask({type:'SAVE_PROFILE',profile});})()`);
  const starts=await Promise.all(profiles.map(p=>ask(p,'START_RUN')));
  assert(starts.every(r=>r.status==='running'),JSON.stringify(starts));
  await wait(async()=>(await app.store.sessions()).every(s=>s.run?.status==='waiting_manual'));
  for(const s of await app.store.sessions())assert.equal(s.run.blockingIssue.reason,'validation');
  const correct=p=>p.eval(`(async()=>{const r=(await chrome.storage.local.get('managedRun')).managedRun;await chrome.scripting.executeScript({target:{tabId:r.tabId},func:()=>{const input=document.querySelector('#phone');input.value='0911111111';input.dispatchEvent(new Event('input',{bubbles:true}));}});})()`);
  await Promise.all(profiles.map(correct));
  await wait(async()=>(await app.store.sessions()).every(s=>s.run?.status==='ready_to_submit'),15000);
  for(const p of profiles){
    const actual=await p.eval(`(async()=>{const r=(await chrome.storage.local.get('managedRun')).managedRun;return (await chrome.scripting.executeScript({target:{tabId:r.tabId},func:()=>document.querySelector('#phone').value}))[0].result;})()`);
    assert.equal(actual,'0911111111');
  }
  assert.equal([...submissions.values()].reduce((a,b)=>a+b,0),0);
  assert.equal((await ask(first,'PAUSE_RUN')).status,'paused');
  await correct(first);await sleep(900);
  assert.equal((await first.eval("chrome.storage.local.get('managedRun')")).managedRun.status,'paused');
  assert.equal((await ask(first,'RESUME_RUN')).status,'running');await complete('ready_to_submit');
  for(const p of profiles){
    await app.coordinator.control(p.id,'STOP');
    await p.eval(`(async()=>{const profile=(await chrome.storage.local.get('profile')).profile;profile.values.phone='0900000000';return __fixture.ask({type:'SAVE_PROFILE',profile});})()`);
    await app.coordinator.pull(p.id);
  }
  console.log('PASS: real extension Start/Pause/Resume/Stop matches manager controls; three invalid fields resume after valid typing without blur; explicit Pause remains paused; Test sends zero.');
}
for(const p of profiles)await app.coordinator.control(p.id,'STOP');steps.clear();if(faults)faultPolicies.set(0,{ambiguousSubmit:true});const live=await app.coordinator.start(profiles.map(p=>p.id),fixtureUrl,'live',sharedQuestion);if(faults){await wait(async()=>{const ss=await app.store.sessions();return ss.every(s=>s.run?.status===(s.id===profiles[0].id?'submit_uncertain':'completed'));});for(const p of profiles){assert.equal(submissions.get(p.index),1);await assert.rejects(()=>app.coordinator.restart(p.id,live.id,crypto.randomUUID()));await assert.rejects(()=>app.coordinator.control(p.id,'RESUME'));}await sleep(4000);assert.equal(submissions.get(0),1);await app.coordinator.resolve(profiles[0].id,'received');faultResults.push({case:'accepted-response-lost-confirmation',passed:true,submissions:1});}else await complete('completed');for(const p of profiles){assert.equal(submissions.get(p.index),1);await assert.rejects(()=>app.coordinator.control(p.id,'RESUME'));assert.equal(submissions.get(p.index),1);}
if(cloud){
  await Promise.all(profiles.map(p=>app.coordinator.runBuffer.flush(p.id)));
  for(const p of profiles){
    const persisted=await app.coordinator.store.session(p.id);
    assert.equal(persisted.run.status,'completed');assert.equal(persisted.run.submitAttempted,true);
    assert.equal((await app.coordinator.store.history(p.id))[0].status,'completed');
    assert.equal(await app.coordinator.store.blocked(p.id,'background-fixture'),true);
  }
}
if(pickerFixture){const handoffs=observations.filter(o=>o.kind==='picker-handoff');assert.equal(handoffs.length,count*2);assert.equal(observations.filter(o=>o.kind==='picker-committed').length,count*2);const base=await readFile('tests/upload-fixture.png');for(const p of profiles){const own=handoffs.filter(o=>o.index===p.index);assert.equal(own.length,2);for(const o of own){assert.equal(o.name,`synthetic-${p.index}.png`);assert.equal(o.hash,createHash('sha256').update(Buffer.concat([base,Buffer.from([p.index])])).digest('hex'));assert(o.documentAgeMs>=5000);}}}
const report={pickerFixture,baseline,baselineCommit,latencyMs,assetDelayMs,peakRssMb,peakCpuPercent,resourceScope:'Test harness and its isolated browsers only; summed RSS may count shared pages more than once. CPU 100% is one core; sampled every second.',hardware:{cpu:cpus()[0]?.model,cores:cpus().length,ramGb:totalmem()/1024**3},benchmarkTimings,scope:cloud?'Isolated headed Chromium windows; production cloud extension with real WebSocket, PostgreSQL (PGlite), coordinator and renderer leases.':'Isolated headed Chromium windows; production content/background with a fixture-only native pipe shim; actual coordinator and renderer leases. Page rendering is kept active by the extension under test, not the harness. No Playwright attachment/focus emulation or throttling-suppression flags on form browsers.',execution:serial?'serial':'parallel',sharedFinalQuestion:sharedFinal,extensionControls:controls,faultResults,profiles:count,testMs,totalMs:Date.now()-start,leasePeak,menuPeak,testRun:group.id,liveRun:live.id,testStoppedBeforeSend:true,liveSubmissions:[...submissions.values()],invalidNext:observations.filter(o=>o.kind==='invalid-next').length,observations,focusEvents};await writeFile(`test-results/${output}.json`,JSON.stringify(report,null,2));await rm(`test-results/${output}-error.json`,{force:true});console.log(`PASS: ${serial?'Serial':'Parallel'} Test ${testMs} ms; ${leasePeak} simultaneous leases, ${menuPeak} overlapping dropdowns. Live exactly once/profile; Resume cannot submit twice.`);
}catch(e){const diagnostics=[];for(const p of profiles)try{diagnostics.push(await p.eval(`(async()=>{const r=(await chrome.storage.local.get('managedRun')).managedRun;if(!r||r.tabId<0)return;return {window:await chrome.windows.get((await chrome.tabs.get(r.tabId)).windowId),page:await chrome.scripting.executeScript({target:{tabId:r.tabId},func:()=>({width:innerWidth,height:innerHeight,hidden:document.hidden,focused:document.hasFocus(),cards:[...document.querySelectorAll('[role=listitem]')].map(e=>({text:e.textContent,width:e.getBoundingClientRect().width,controls:e.querySelectorAll('input,[role=radio],[role=listbox]').length}))})})};})()`));}catch{}await writeFile('test-results/background-flow-error.json',JSON.stringify({error:String(e),sessions:app?await app.store.sessions():undefined,observations,focusEvents,diagnostics},null,2));throw e;}finally{
stopping=true;clearInterval(sampler);for(const p of profiles){clearInterval(p.poller);for(const port of p.ports.values())port.ws.terminate();try{await p.cdp?.send('Browser.close');}catch{}p.cdp?.close();if(!p.child.killed)p.child.kill();}if(app)await app.close();if(fixtureServer)await new Promise(r=>fixtureServer.close(r));await rm(dir,{recursive:true,force:true,maxRetries:10,retryDelay:100}).catch(()=>{});
}

