import {chromium} from '@playwright/test';
import {mkdtemp,mkdir,cp,writeFile,readFile,rm,statfs} from 'node:fs/promises';
import {createServer} from 'node:https';
import {execFileSync} from 'node:child_process';
import {performance} from 'node:perf_hooks';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import assert from 'node:assert/strict';
import {serve} from '../build/server/main.mjs';
import {fixtureImage,fixtureHtml} from './fixture.mjs';

const count=Number(process.argv.find(a=>a.startsWith('--profiles='))?.split('=')[1]??2);
assert(Number.isInteger(count)&&count>=2&&count<=24);
const rehearsal=process.argv.includes('--rehearsal');
const levelFor=index=>index%2?'5':rehearsal?'3':'4';
const answerFor=index=>index%2?'2026':rehearsal?'1620000':'HANU';
const testOnly=process.argv.includes('--test-only'),scheduledVerification=process.argv.includes('--scheduled-verification');assert(!scheduledVerification||testOnly,'Scheduled verification fixture only runs Test.');
assert(!rehearsal||scheduledVerification,'Use --rehearsal with --scheduled-verification --test-only');
const disk=await statfs(tmpdir());if(disk.bavail*disk.bsize<(128+count*64)*1024**2)throw new Error(`Không đủ dung lượng trống cho ${count} profile fixture. Cần ít nhất ${128+count*64} MB; chưa mở profile thử.`);
let previousCpu=new Map(),previousSample=performance.now(),peakRssMb=0,peakCpuPercent=0;
function sampleResources(){
  if(process.platform==='win32')return;
  const now=performance.now(),rows=execFileSync('ps',['-axo','pid=,ppid=,rss=,time=,comm='],{encoding:'utf8'}).trim().split('\n').map(line=>{const fields=line.trim().split(/\s+/);const times=fields[3].split(':').map(Number);let seconds=0;for(const t of times)seconds=seconds*60+t;return {pid:Number(fields[0]),parent:Number(fields[1]),rss:Number(fields[2]),cpu:seconds};});
  const owned=new Set([process.pid]);let changed=true;while(changed){changed=false;for(const row of rows)if(owned.has(row.parent)&&!owned.has(row.pid)){owned.add(row.pid);changed=true;}}
  let rss=0,delta=0;const current=new Map();for(const row of rows)if(owned.has(row.pid)){rss+=row.rss;current.set(row.pid,row.cpu);if(previousCpu.has(row.pid))delta+=Math.max(0,row.cpu-previousCpu.get(row.pid));}
  peakRssMb=Math.max(peakRssMb,rss/1024);peakCpuPercent=Math.max(peakCpuPercent,delta*100000/(now-previousSample));previousCpu=current;previousSample=now;
}
const sampler=setInterval(sampleResources,1000);
const dir=await mkdtemp(join(tmpdir(),'hanu-browser-'));const contexts=[];let app,fixtureServer;
await mkdir('test-results',{recursive:true});
async function wait(predicate,timeout=20000){const deadline=Date.now()+timeout;while(Date.now()<deadline){if(await predicate())return;await new Promise(r=>setTimeout(r,100));}throw new Error('Browser check timed out.');}
try{
  const data=join(dir,'app'),extension=join(dir,'extension');await mkdir(data,{recursive:true});await cp('dist',extension,{recursive:true});
  execFileSync('openssl',['req','-x509','-newkey','rsa:2048','-nodes','-keyout',join(dir,'key.pem'),'-out',join(dir,'cert.pem'),'-days','1','-subj','/CN=docs.google.com'],{stdio:'ignore'});
  const receivedByProfile=new Map();
  fixtureServer=createServer({key:await readFile(join(dir,'key.pem')),cert:await readFile(join(dir,'cert.pem'))},async(req,res)=>{const index=Number(req.headers.cookie?.match(/fixtureprofile=(\d+)/)?.[1]??0);if(req.method==='POST'){let body='';for await(const chunk of req)body+=chunk;const entries=receivedByProfile.get(index)??[];entries.push(body);receivedByProfile.set(index,entries);res.end('OK');return;}res.setHeader('Content-Type','text/html; charset=utf-8');let html=fixtureHtml(`nick${index}@example.test`,index,index===1);if(scheduledVerification){const question=`<div role="listitem" data-item-id="verify-${index}"><div role="heading">Câu hỏi xác thực HSK ${levelFor(index)}? *</div><input type="text" name="entry.verify" required></div>`;html=html.replace("document.querySelector('#next').textContent='Submit';",`document.querySelector('#next').insertAdjacentHTML('beforebegin',${JSON.stringify(question)});document.querySelector('#next').textContent='Submit';`);}res.end(html);});
  await new Promise(r=>fixtureServer.listen(0,'127.0.0.1',r));const fixtureUrl=`https://docs.google.com:${fixtureServer.address().port}/forms/d/e/local-fixture/viewform`;
  app=await serve({dir:data,uiDir:resolve('build/manager-ui')});
  const nativeHost=join(dir,'native-host');const shellQuote=s=>`'${s.replaceAll("'","'\\''")}'`;
  await writeFile(nativeHost,`#!/bin/sh\nexport HANU_DATA_DIR=${shellQuote(data)}\nexec ${shellQuote(process.execPath)} ${shellQuote(resolve('build/server/bridge.cjs'))} --bridge "$@"\n`,{mode:0o755});
  const image=fixtureImage();let extensionId;const profileResults=[];const firstState=new Map();const observe=()=>{const accept=app.coordinator.acceptState.bind(app.coordinator);app.coordinator.acceptState=async(id,run)=>{if(run?.runId&&!firstState.has(`${run.runId}:${id}`))firstState.set(`${run.runId}:${id}`,Date.now());return accept(id,run);};};observe();
  for(let i=0;i<count;i++){
    const profileDir=join(dir,`profile-${i}`);await mkdir(profileDir,{recursive:true});
    const context=await chromium.launchPersistentContext(profileDir,{channel:'chromium',headless:true,args:[`--disable-extensions-except=${extension}`,`--load-extension=${extension}`,'--host-resolver-rules=MAP docs.google.com 127.0.0.1','--ignore-certificate-errors','--no-proxy-server']});contexts.push(context);
    const worker=context.serviceWorkers()[0]??await context.waitForEvent('serviceworker');extensionId=new URL(worker.url()).host;
    await writeFile(join(data,'allowed-extensions.json'),JSON.stringify([extensionId]));
    // Native manifests are installed only in isolated Chrome test user-data directories.
    await mkdir(join(profileDir,'NativeMessagingHosts'),{recursive:true});await writeFile(join(profileDir,'NativeMessagingHosts','vn.hanu.autofill.json'),JSON.stringify({name:'vn.hanu.autofill',description:'Local HANU fixture',path:nativeHost,type:'stdio',allowed_origins:[`chrome-extension://${extensionId}/`]}));
    await worker.evaluate(async({index,image})=>{
      const profile={values:{fullName:`THI SINH THU ${index}`,identityNumber:`00000000000${index}`},customFields:[],attachments:{identityDocument:{id:`image-${index}`,name:`fixture-${index}.png`,type:'image/png',size:image.length,updatedAt:new Date().toISOString()}},mappings:{}};
      await chrome.storage.local.set({profile,profileRevision:1});
      const request=indexedDB.open('hanu-hsk-autofill',1);request.onupgradeneeded=()=>request.result.createObjectStore('attachments');const db=await new Promise((r,j)=>{request.onsuccess=()=>r(request.result);request.onerror=()=>j(request.error);});await new Promise((r,j)=>{const tx=db.transaction('attachments','readwrite');tx.objectStore('attachments').put(new Blob([Uint8Array.from(image)],{type:'image/png'}),`image-${index}`);tx.oncomplete=r;tx.onerror=j;});db.close();
    },{index:i,image:[...image]});
    const panel=await context.newPage();await panel.goto(`chrome-extension://${extensionId}/sidepanel.html`);
    const code=app.store.pairCode();await panel.locator('#pairCode').fill(code);await panel.locator('#pairProfile').click();
    await wait(()=>app.store.sessions().length===i+1&&app.store.sessions().every(s=>s.synced),25000);
    const session=app.store.sessions().at(-1);assert.equal(session.profile.values.fullName,`THI SINH THU ${i}`);assert.equal(app.store.attachment(session.id,`image-${i}`).data.length,image.length);
    await app.coordinator.edit(session.id,{name:`Profile thử ${i+1}`,expectedEmail:`nick${i}@example.test`});
    const received=[];receivedByProfile.set(i,received);await context.addCookies([{name:'fixtureprofile',value:String(i),url:fixtureUrl}]);
    profileResults.push({context,worker,panel,id:session.id,index:i,received});console.log(`Linked fixture profile ${i+1}/${count}`);
  }
  for(const r of profileResults){const prepared=await app.coordinator.command(r.id,'PREPARE_FORM',{});r.preparedTab=prepared.tabId;assert.equal((await app.coordinator.command(r.id,'PREPARE_FORM',{})).tabId,r.preparedTab);const tab=await r.worker.evaluate(id=>chrome.tabs.get(id),r.preparedTab);assert.equal(tab.url,`chrome-extension://${extensionId}/ready.html`);}
  const startedAt=Date.now();let group;
  if(scheduledVerification){
    for(const r of profileResults)await app.coordinator.edit(r.id,{hskLevel:levelFor(r.index)});
    const schedule=await app.coordinator.scheduler.arm({manualOnly:true,mode:'test',ids:profileResults.map(r=>r.id),rehearsal,testFormUrl:rehearsal?fixtureUrl:undefined,links:rehearsal?{}:{'4':fixtureUrl,'5':fixtureUrl},finalQuestions:Object.fromEntries(profileResults.map(r=>[levelFor(r.index),{value:answerFor(r.index)}]))});group={id:schedule.id};
  }else group=await app.coordinator.start(profileResults.map(r=>r.id),fixtureUrl,'test');
  await wait(()=>{const sessions=app.store.sessions(),failed=sessions.find(s=>['failed','waiting_manual','paused'].includes(s.run?.status));if(failed&&!(scheduledVerification&&failed.run?.blockingIssue?.reason==='verification'))throw new Error(JSON.stringify({profile:failed.name,status:failed.run?.status,error:failed.error,issue:failed.run?.blockingIssue,activity:failed.run?.activity,logs:failed.run?.logs.slice(-5)}));return sessions.every(s=>s.run?.status==='ready_to_submit');},60000);
  const timings=[];for(const r of profileResults){r.runId=app.store.session(r.id).run.runId;if(scheduledVerification){const final=app.store.session(r.id).run.finalQuestion;assert.equal(final.value,answerFor(r.index));assert(final.label.includes(`HSK ${levelFor(r.index)}`));const page=r.context.pages().find(p=>p.url().startsWith(fixtureUrl));assert.equal(await page.locator('[name="entry.verify"]').inputValue(),final.value);}assert.equal(app.store.session(r.id).run.tabId,r.preparedTab);assert.equal(await r.worker.evaluate(async()=> (await chrome.storage.local.get('preparedFormTab')).preparedFormTab),undefined);const page=r.context.pages().find(p=>p.url().startsWith(fixtureUrl));const result=await page.evaluate(()=>window.fixture);assert.equal(result.submissions,0);assert.equal(result.uploads,1);assert.equal(result.uploadSize,image.length);assert.equal(result.answers.name,`THI SINH THU ${r.index}`);assert.equal(result.answers.file,`fixture-${r.index}.png`);timings.push({profile:r.index+1,commandReceivedMs:firstState.get(`${r.runId}:${r.id}`)-startedAt,formLoadedMs:result.loadedAt-startedAt,uploadMs:result.uploadedAt-result.loadedAt,finalPageMs:result.finalPageAt-startedAt});}
  // Re-send exactly the same START command twice to the actual background.
  for(const r of profileResults){const journal=await r.worker.evaluate(async()=>{return (await chrome.storage.local.get('nativeJournal')).nativeJournal;});const commandId=Object.entries(journal).find(([,entry])=>entry.result?.runId===r.runId)?.[0];assert(commandId);const before=r.context.pages().length;const session=app.store.session(r.id),attachmentHashes=Object.fromEntries(Object.values(session.profile.attachments).map(a=>[a.id,app.store.attachment(r.id,a.id).hash]));const command={type:'COMMAND',protocol:1,sessionId:r.id,runId:r.runId,commandId,kind:'START',payload:{url:fixtureUrl,mode:'test',revision:session.revision,expectedEmail:session.expectedEmail,attachmentHashes}};for(let i=0;i<2;i++)app.coordinator.peers.get(r.id).send(JSON.stringify(command));await new Promise(resolve=>setTimeout(resolve,150));assert.equal(r.context.pages().length,before);assert.equal(app.store.session(r.id).run.status,'ready_to_submit');}
  if(!testOnly){
  for(const r of profileResults){await app.coordinator.control(r.id,'STOP');}
  const live=await app.coordinator.start(profileResults.map(r=>r.id),fixtureUrl,'live');
  await wait(()=>app.store.sessions().some(s=>s.run?.status==='completed')&&app.store.sessions().some(s=>s.run?.status==='submit_uncertain'),35000);
  for(const r of profileResults){assert.equal(r.received.length,1);const response=await app.coordinator.control(r.id,'RESUME').catch(e=>e);assert(response instanceof Error);assert.equal(r.received.length,1);}
  await app.close();app=await serve({dir:data,uiDir:resolve('build/manager-ui')});observe();await wait(()=>app.store.sessions().every(s=>s.connected),20000);assert(app.store.sessions().some(s=>s.run?.status==='submit_uncertain'));for(const r of profileResults)assert.equal(r.received.length,1);
  }
  const browser=await chromium.launch({channel:'chromium',headless:true});contexts.push(browser);const page=await browser.newPage({viewport:{width:1440,height:1000}});const errors=[];page.on('pageerror',e=>errors.push(e.message));await page.goto(app.url);await page.getByRole('heading',{name:'Quản lý các phiên'}).waitFor();await page.screenshot({path:'test-results/manager-light.png',fullPage:true});await page.getByRole('button',{name:'Chi tiết'}).first().click();await page.getByRole('button',{name:'Kiểm tra kết nối'}).click();await page.getByRole('status').filter({hasText:'Kết nối tốt'}).waitFor();await page.screenshot({path:'test-results/manager-detail.png',fullPage:true});await page.getByRole('button',{name:'Đóng chi tiết'}).first().click();await page.getByRole('button',{name:'Đổi giao diện sáng tối'}).click();await page.screenshot({path:'test-results/manager-dark.png',fullPage:true});await page.setViewportSize({width:390,height:844});await page.screenshot({path:'test-results/manager-mobile.png',fullPage:true});assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);assert.deepEqual(errors,[]);
  sampleResources();const report={scheduledVerification,rehearsal,kind:'isolated Chrome for Testing instances; Google hostname mapped to localhost; synthetic image; not real Google performance',profiles:count,imageBytes:image.length,test:true,liveConfirmed:testOnly?null:count-1,liveUncertain:testOnly?null:1,submissionsPerProfile:profileResults.map(r=>r.received.length),timings,peakRssMb:Math.round(peakRssMb),peakCpuPercent:Math.round(peakCpuPercent),resourceScope:'harness + isolated Chrome instances + native bridges; summed RSS may double-count shared pages; sampled every second; 100% = one CPU core',stuck:app.store.sessions().filter(s=>!['completed','submit_uncertain','ready_to_submit'].includes(s.run?.status)).length,uiErrors:errors};await writeFile(`test-results/browser-${count}.json`,JSON.stringify(report,null,2));if(!testOnly)await writeFile('test-results/browser-check.json',JSON.stringify(report,null,2));
  console.log(`PASS: ${count} isolated profiles, native pairing, prepared-tab reuse, images, duplicate START${scheduledVerification?", per-HSK answers entered before either question is known":""}, Test${testOnly?'':', Live uncertainty + app restart'}, UI light/dark/mobile.`);
}catch(e){const pages=[];for(const c of contexts)for(const p of c.pages?.()??[]){pages.push({url:p.url(),html:await p.content().catch(()=>''),account:await p.evaluate(()=>[...document.querySelectorAll('[data-google-account]')].map(e=>({text:e.textContent,rect:e.getBoundingClientRect().toJSON()}))).catch(()=>[])});}await writeFile('test-results/browser-error.json',JSON.stringify({error:String(e),sessions:app?.store.sessions(),pages},null,2));throw e;}finally{clearInterval(sampler);for(const c of contexts)await c.close().catch(()=>{});if(app)await app.close();if(fixtureServer)await new Promise(r=>fixtureServer.close(r));await rm(dir,{recursive:true,force:true});}
