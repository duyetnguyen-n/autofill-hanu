import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {chromium} from '@playwright/test';

// Invoked only by background-flow-check's isolated HTTPS form and synthetic
// Chromium profiles. No Google traffic, real account or production writes.
export async function reliabilityScenarios(x){
 const {app,profiles,steps,faultPolicies,documentRequests,submissions,faultResults,fixtureUrl,wait,sleep,complete}=x;
 const sessions=()=>app.store.sessions();
 const session=async p=>(await sessions()).find(s=>s.id===p.id);
 const ask=(p,type,extra={})=>p.eval(`(async()=>{const r=(await chrome.storage.local.get('managedRun')).managedRun;return __fixture.ask({type:${JSON.stringify(type)},tabId:r.tabId,mode:'test',...${JSON.stringify(extra)}});})()`);
 const form=(p,body)=>p.eval(`(async()=>{const r=(await chrome.storage.local.get('managedRun')).managedRun;return (await chrome.scripting.executeScript({target:{tabId:r.tabId},func:()=>{${body}}}))[0].result;})()`);
 const activateHistory=async p=>{
  const target=(await p.cdp.send('Target.getTargets')).targetInfos.find(t=>t.type==='page'&&t.url.includes('/forms/'));
  assert(target);const attached=(await p.cdp.send('Target.attachToTarget',{targetId:target.targetId,flatten:true})).sessionId;
  try{
   const point=await p.cdp.evaluate(attached,`(()=>{const e=document.querySelector('h1')??document.body;const b=e.getBoundingClientRect();return {x:b.left+10,y:b.top+10,history:history.length,url:location.href};})()`);
   console.log('History fixture '+JSON.stringify(point));
   await p.cdp.send('Input.dispatchMouseEvent',{type:'mousePressed',x:point.x,y:point.y,button:'left',clickCount:1},attached);
   await p.cdp.send('Input.dispatchMouseEvent',{type:'mouseReleased',x:point.x,y:point.y,button:'left',clickCount:1},attached);
  }finally{await p.cdp.send('Target.detachFromTarget',{sessionId:attached}).catch(()=>{});}
 };
 const checkpoint=async(name,fn)=>{const selected=process.argv.find(a=>a.startsWith('--fault-case='))?.split('=')[1];if(selected&&!selected.split(',').some(part=>name.includes(part)))return;const start=Date.now();await fn();faultResults.push({case:name,passed:true,ms:Date.now()-start});console.log('PASS fault: '+name);};
 const reset=async()=>{
  for(const p of profiles)await app.coordinator.control(p.id,'STOP');
  for(const p of profiles)await p.eval(`(async()=>{const tabs=await chrome.tabs.query({});for(const t of tabs)if(t.url?.includes('/forms/'))await chrome.tabs.remove(t.id);})()`);
  steps.clear();faultPolicies.clear();documentRequests.length=0;
 };
 const start=()=>app.coordinator.start(profiles.map(p=>p.id),fixtureUrl,'test',undefined,randomUUID());
 await checkpoint('pre-submit-reload-restores-profile-and-allows-manager-restart',async()=>{
  await reset();const p=profiles[0];faultPolicies.set(0,{delayNext:2500});await start();
  await wait(()=>documentRequests.some(r=>r.index===0&&r.method==='POST'&&r.step===0));
  const runId=(await session(p)).run.runId;
  steps.set(0,0);
  await p.eval(`(async()=>{const r=(await chrome.storage.local.get('managedRun')).managedRun;await chrome.tabs.update(r.tabId,{url:${JSON.stringify(fixtureUrl)}});})()`);
  await complete('ready_to_submit');
  assert.equal((await session(p)).run.runId,runId);
  assert.equal((await session(p)).run.submitAttempted,false);
  assert.equal(await form(p,"return document.querySelector('#phone').value;"),'0900000000');
  const peers=await Promise.all(profiles.slice(1).map(session));
  steps.set(0,0);await app.coordinator.restart(p.id,runId,randomUUID());await complete('ready_to_submit');
  assert.notEqual((await session(p)).run.runId,runId);
  for(const peer of peers)assert.equal((await sessions()).find(s=>s.id===peer.id).run.runId,peer.run.runId);
  assert.equal([...submissions.values()].reduce((a,b)=>a+b,0),0);
 });
 await checkpoint('simultaneous-hung-document-captcha-upload-error-and-healthy-profiles',async()=>{
  if(profiles.length<4)return;
  await reset();faultPolicies.set(0,{hangNext:true,resetOnRecovery:true});faultPolicies.set(1,{captcha:true});faultPolicies.set(2,{uploadError:true});
  const began=Date.now();await start();
  await wait(async()=>{const ss=await sessions();return profiles.slice(3).every(p=>ss.find(s=>s.id===p.id)?.run?.status==='ready_to_submit');},20000);
  const healthyMs=Date.now()-began;
  await wait(async()=>(await session(profiles[1])).run?.blockingIssue?.reason==='captcha'&&['file_upload','validation'].includes((await session(profiles[2])).run?.blockingIssue?.reason),15000);
  const uploadErrorReason=(await session(profiles[2])).run?.blockingIssue?.reason;
  await wait(async()=>(await session(profiles[0])).run?.status==='ready_to_submit',45000);
  const recoveryMs=Date.now()-began,requests=documentRequests.filter(r=>r.index===0),getAfterHang=requests.find((r,i)=>i>0&&r.method==='GET');
  assert(getAfterHang,'A hung POST document must recover through a safe GET');
  assert.equal(requests.filter(r=>r.method==='POST'&&r.step===0&&r.at<getAfterHang.at).length,1);
  assert.equal((await session(profiles[1])).run.blockingIssue.reason,'captcha');
  // Fix only the synthetic failed upload. Its frozen profile and all already
  // finished peers stay intact; CAPTCHA is still waiting for human action.
  faultPolicies.delete(2);await profiles[2].eval(`(async()=>{const r=(await chrome.storage.local.get('managedRun')).managedRun;await chrome.tabs.update(r.tabId,{url:${JSON.stringify(fixtureUrl)}});})()`);
  await sleep(600);await app.coordinator.control(profiles[2].id,'RESUME');
  await wait(async()=>(await session(profiles[2])).run?.status==='ready_to_submit');
  faultResults.push({case:'mixed-fault-timing',passed:true,healthyProfiles:profiles.length-3,healthyMs,hungRecoveryMs:recoveryMs,uploadErrorReason});
 });
 await checkpoint('500-503-429-bounded-recovery-and-profile-isolation',async()=>{
  await reset();faultPolicies.set(0,{statuses:[500,503,429]});await start();await complete('ready_to_submit');
  assert.equal(faultPolicies.get(0).statuses.length,0);
  assert.equal(documentRequests.filter(r=>r.index===0&&r.method==='GET').length,4);
  assert.equal((await session(profiles[0])).run.recovery,undefined);
 });
 await checkpoint('persistent-500-exhausts-three-retries-and-stop-cancels-timer',async()=>{
  await reset();faultPolicies.set(0,{statuses:Array(10).fill(500)});await start();
  await wait(async()=>{const ss=await sessions();return ss.every(s=>s.id===profiles[0].id?s.run?.status==='waiting_manual'&&s.run.recovery?.attempt===4:ss.find(t=>t.id===s.id).run?.status==='ready_to_submit');});
  assert.equal((await session(profiles[0])).run.recovery.automatic,false);
  const requests=documentRequests.filter(r=>r.index===0).length;await sleep(3500);assert.equal(documentRequests.filter(r=>r.index===0).length,requests);
  await app.coordinator.control(profiles[0].id,'STOP');faultPolicies.clear();
  const r=await app.coordinator.restart(profiles[0].id,(await session(profiles[0])).run.runId,randomUUID());
  await wait(async()=>(await session(profiles[0])).run?.status==='ready_to_submit');assert.equal((await session(profiles[0])).run.runId,r.id);
  // A separate run proves cancellation while a retry is still scheduled.
  await reset();faultPolicies.set(0,{statuses:[500,500]});await start();
  await wait(async()=>(await session(profiles[0])).run?.recovery?.automatic===true);
  await app.coordinator.control(profiles[0].id,'STOP');const stoppedRequests=documentRequests.filter(r=>r.index===0).length;
  await sleep(4500);assert.equal(documentRequests.filter(r=>r.index===0).length,stoppedRequests);assert.equal((await session(profiles[0])).run.status,'idle');
 });
 await checkpoint('captcha-unavailable-recovers-automatically-without-refresh-loop',async()=>{
  await reset();faultPolicies.set(0,{captcha:true});await start();
  await wait(async()=>(await session(profiles[0])).run?.blockingIssue?.reason==='captcha');
  const requests=documentRequests.filter(r=>r.index===0).length;await sleep(4500);assert.equal(documentRequests.filter(r=>r.index===0).length,requests);
  assert.notEqual((await session(profiles[0])).run.recovery?.automatic,true);
  // A recovered form resumes the existing intent without solving a CAPTCHA.
  faultPolicies.clear();await profiles[0].eval(`(async()=>{const r=(await chrome.storage.local.get('managedRun')).managedRun;await chrome.tabs.update(r.tabId,{url:${JSON.stringify(fixtureUrl)}});})()`);
  await wait(async()=>(await session(profiles[0])).run.status==='ready_to_submit');await complete('ready_to_submit');
 });
 await checkpoint('captcha-back-and-forward-restores-intent-without-refilling',async()=>{
  await reset();await start();await complete('ready_to_submit');const p=profiles[0];
  // Use a GET document so this case tests history recovery independently of
  // Chromium's native POST-resubmission confirmation dialog.
  await p.eval(`(async()=>{const r=(await chrome.storage.local.get('managedRun')).managedRun;await chrome.tabs.update(r.tabId,{url:${JSON.stringify(fixtureUrl)}});})()`);
  await wait(()=>p.eval(`(async()=>{const r=(await chrome.storage.local.get('managedRun')).managedRun;return (await chrome.tabs.get(r.tabId)).status==='complete';})()`));
  await app.coordinator.control(p.id,'RESUME');await complete('ready_to_submit');const run=(await session(p)).run;
  // Mark a synthetic unavailable CAPTCHA, then leave the filled form through
  // real browser history. No actual Google challenge is generated/solved.
  await p.eval(`(async()=>{const r=(await chrome.storage.local.get('managedRun')).managedRun;await chrome.scripting.executeScript({target:{tabId:r.tabId},args:[r],func:r=>{window.addEventListener('pageshow',e=>{document.documentElement.dataset.fixturePersisted=String(e.persisted)});return chrome.runtime.sendMessage({type:'FORM_EVENT',runId:r.runId,epoch:r.contentEpoch,event:{type:'block',issue:{reason:'captcha',message:'Synthetic CAPTCHA unavailable'}}});}});})()`);
  await wait(async()=>(await session(p)).run.status==='waiting_manual');
  faultPolicies.set(0,{captcha:true});
  await p.eval(`(async()=>{const r=(await chrome.storage.local.get('managedRun')).managedRun;await chrome.scripting.executeScript({target:{tabId:r.tabId},args:[${JSON.stringify(fixtureUrl+'?checkpoint=unavailable')}],func:url=>setTimeout(()=>location.assign(url),0)});})()`);
  await wait(()=>p.eval(`(async()=>{const r=(await chrome.storage.local.get('managedRun')).managedRun,t=await chrome.tabs.get(r.tabId);return t.status==='complete'&&t.url.includes('checkpoint=unavailable');})()`));
  faultPolicies.delete(0);await activateHistory(p);
  const began=Date.now();await p.eval(`(async()=>{const r=(await chrome.storage.local.get('managedRun')).managedRun;await chrome.scripting.executeScript({target:{tabId:r.tabId},func:()=>{setTimeout(()=>history.back(),0)}});})()`);
  await wait(async()=>(await session(p)).run.status==='ready_to_submit');await complete('ready_to_submit');
  const values=await form(p,"return {phone:document.querySelector('#phone')?.value,persisted:document.documentElement.dataset.fixturePersisted};");
  assert.equal(values.phone,'0900000000');assert.equal((await session(p)).run.runId,run.runId);
  faultResults.push({case:'back-recovery-timing',passed:true,ms:Date.now()-began,bfcache:values.persisted==='true'});
  // A user Pause remains final even when the same history events repeat.
  await app.coordinator.control(p.id,'PAUSE');await activateHistory(p);
  await p.eval(`(async()=>{const r=(await chrome.storage.local.get('managedRun')).managedRun;await chrome.scripting.executeScript({target:{tabId:r.tabId},func:()=>{setTimeout(()=>history.forward(),0)}});})()`);await sleep(300);await activateHistory(p);
  await p.eval(`(async()=>{const r=(await chrome.storage.local.get('managedRun')).managedRun;await chrome.scripting.executeScript({target:{tabId:r.tabId},func:()=>{setTimeout(()=>history.back(),0)}});})()`);await sleep(700);
  assert.equal((await session(p)).run.status,'paused');await app.coordinator.control(p.id,'RESUME');await complete('ready_to_submit');
 });
 await checkpoint('manual-correction-survives-reload-with-frozen-profile',async()=>{
  await reset();const p=profiles[0];
  await p.eval(`(async()=>{const profile=(await chrome.storage.local.get('profile')).profile;profile.values.phone='wrong';await __fixture.ask({type:'SAVE_PROFILE',profile});})()`);await app.coordinator.pull(p.id);
  await start();await wait(async()=>(await session(p)).run?.blockingIssue?.reason==='validation');
  await form(p,"const i=document.querySelector('#phone');i.value='0911111111';i.dispatchEvent(new Event('input',{bubbles:true}));");
  await wait(async()=>(await session(p)).run?.status==='ready_to_submit');await complete('ready_to_submit');assert(Object.keys((await session(p)).run.corrections??{}).length>0);
  steps.set(p.index,0);await p.eval(`(async()=>{const r=(await chrome.storage.local.get('managedRun')).managedRun;await chrome.tabs.update(r.tabId,{url:${JSON.stringify(fixtureUrl)}});})()`);
  await sleep(1000);await app.coordinator.control(p.id,'RESUME');await complete('ready_to_submit');
  assert.equal(await form(p,"return document.querySelector('#phone').value;"),'0911111111');
  assert.equal((await p.eval("chrome.storage.local.get('profile')")).profile.values.phone,'wrong');
  assert.equal((await session(p)).run.profileSnapshot.values.phone,'wrong');
  await app.coordinator.control(p.id,'STOP');await p.eval(`(async()=>{const profile=(await chrome.storage.local.get('profile')).profile;profile.values.phone='0900000000';await __fixture.ask({type:'SAVE_PROFILE',profile});})()`);await app.coordinator.pull(p.id);
 });
 await checkpoint('slow-next-22-seconds-has-no-double-navigation',async()=>{
  await reset();faultPolicies.set(0,{delayNext:22000});await start();
  await wait(async()=>(await session(profiles[1])).run?.status==='ready_to_submit');
  assert.notEqual((await session(profiles[0])).run.status,'ready_to_submit');await complete('ready_to_submit');
  assert.equal(documentRequests.filter(r=>r.index===0&&r.step===0&&r.method==='POST').length,1);
 });
 await checkpoint('disconnect-reconnect-parks-until-explicit-resume',async()=>{
  await reset();faultPolicies.set(0,{delayNext:5000});await start();
  await wait(()=>documentRequests.some(r=>r.index===0&&r.step===0&&r.method==='POST'));
  app.coordinator.peers.get(profiles[0].id).close();
  await wait(async()=>{const s=await session(profiles[0]);return s.connected&&s.run?.recoveryRequired;});
  await sleep(5500);const s=await session(profiles[0]);assert(['paused','waiting_manual'].includes(s.run.status));
  assert.equal(s.run.recoveryRequired,true);await app.coordinator.control(profiles[0].id,'RESUME');await complete('ready_to_submit');
 });
 await checkpoint('extension-worker-reload-parks-and-reconciles-same-profile',async()=>{
  await reset();const p=profiles[0];faultPolicies.set(0,{delayNext:5000});await start();
  await wait(()=>documentRequests.some(r=>r.index===0&&r.method==='POST'&&r.step===0));
  const settings=await p.cdp.send('Target.createTarget',{url:'chrome://extensions'});
  const settingsSession=(await p.cdp.send('Target.attachToTarget',{targetId:settings.targetId,flatten:true})).sessionId;
  await wait(()=>p.cdp.evaluate(settingsSession,"typeof chrome.developerPrivate?.updateProfileConfiguration==='function'"));
  await p.cdp.evaluate(settingsSession,'chrome.developerPrivate.updateProfileConfiguration({inDeveloperMode:true})');
  const configuration=await p.cdp.evaluate(settingsSession,'new Promise(r=>chrome.developerPrivate.getProfileConfiguration(r))');assert.equal(configuration.inDeveloperMode,true);
  const workerUrl=await p.eval('location.href');
  const old=(await p.cdp.send('Target.getTargets')).targetInfos.find(t=>t.url===workerUrl);
  const panelUrl=await p.eval("chrome.runtime.getURL('sidepanel.html')");
  await p.eval('setTimeout(()=>chrome.runtime.reload(),50)');
  await p.cdp.send('Target.detachFromTarget',{sessionId:p.worker});
  await sleep(250);const wake=await p.cdp.send('Target.createTarget',{url:panelUrl});
  await wait(async()=>{
   const candidates=(await p.cdp.send('Target.getTargets')).targetInfos.filter(t=>t.type==='service_worker'&&t.url===workerUrl&&t.targetId!==old.targetId);
   for(const target of candidates){
    const attached=await p.cdp.send('Target.attachToTarget',{targetId:target.targetId,flatten:true});
    try{if(await p.cdp.evaluate(attached.sessionId,'typeof globalThis.__fixture!=="undefined"')){p.worker=attached.sessionId;return true;}}
    catch{}await p.cdp.send('Target.detachFromTarget',{sessionId:attached.sessionId}).catch(()=>{});
   }return false;
  },20000);
  await wait(async()=>{const s=await session(p);return s.connected&&s.run.recoveryRequired&&['paused','waiting_manual'].includes(s.run.status);});
  assert.equal((await p.eval("__fixture.ask({type:'NATIVE_STATUS'})")).sessionId,p.id);
  await p.cdp.send('Target.closeTarget',{targetId:wake.targetId});await p.cdp.send('Target.closeTarget',{targetId:settings.targetId});
  await sleep(5500);assert.equal((await session(p)).run.recoveryRequired,true);
  await app.coordinator.control(p.id,'RESUME');await complete('ready_to_submit');
 });
 await checkpoint('restart-double-click-and-stale-stop-are-fenced',async()=>{
  await reset();await start();await complete('ready_to_submit');const p=profiles[0],old=(await session(p)).run.runId;steps.set(p.index,0);
  const [a,b]=await Promise.all([ask(p,'RESTART_RUN',{runId:old,operationId:randomUUID()}),ask(p,'RESTART_RUN',{runId:old,operationId:randomUUID()})]);
  assert(!a.error,JSON.stringify(a));assert.notEqual(a.runId,old);
  assert(b.runId===a.runId||b.ok===false&&/thay đổi/.test(b.error),JSON.stringify([a,b]));
  await assert.rejects(()=>app.coordinator.control(p.id,'STOP',old));await complete('ready_to_submit');assert.equal((await session(p)).run.runId,a.runId);
 });
 await checkpoint('actual-panel-buttons-and-manager-restart-parity',async()=>{
  const p=profiles[0],r=(await session(p)).run;
  const panelUrl=await p.eval("chrome.runtime.getURL('sidepanel.html')");
  const target=await p.cdp.send('Target.createTarget',{url:panelUrl+'?tabId='+r.tabId});
  const attached=await p.cdp.send('Target.attachToTarget',{targetId:target.targetId,flatten:true});
  const evaluate=expression=>p.cdp.evaluate(attached.sessionId,expression);
  try{
   await wait(()=>evaluate("!!document.querySelector('#restartRun')&&!document.querySelector('#restartRun').hidden"));
   await evaluate("document.querySelector('#pauseRun').click()");await wait(async()=>(await session(p)).run.status==='paused');
   await wait(()=>evaluate("!document.querySelector('#resumeRun').disabled"));await evaluate("document.querySelector('#resumeRun').click()");await wait(async()=>(await session(p)).run.status==='ready_to_submit');await complete('ready_to_submit');
   await evaluate("document.querySelector('#stopRun').click()");await wait(async()=>(await session(p)).run.status==='idle');
   steps.set(p.index,0);await wait(()=>evaluate("!document.querySelector('#startRun').disabled"));await evaluate("document.querySelector('#startRun').click()");await complete('ready_to_submit');
   const before=(await session(p)).run.runId;steps.set(p.index,0);
   await wait(()=>evaluate("!document.querySelector('#restartRun').disabled"));await evaluate("document.querySelector('#restartRun').click()");
   await wait(async()=>(await session(p)).run.runId!==before);await complete('ready_to_submit');
   assert.match(await evaluate("document.querySelector('#actionStatus').textContent"),/phản hồi/);
  }finally{await p.cdp.send('Target.closeTarget',{targetId:target.targetId});}
  const browser=await chromium.launch({channel:process.platform==='win32'?'msedge':'chromium',headless:true});
  try{
   const context=await browser.newContext({viewport:{width:1440,height:1000}});await context.addCookies([{name:'test-account',value:'account-a',url:app.origin}]);
   const page=await context.newPage();await page.goto(app.url);
   const row=page.getByRole('row').filter({has:page.getByText('Profile test 1',{exact:true})});
   const before=(await session(p)).run.runId;steps.set(p.index,0);
   await row.getByRole('button',{name:'Chạy lại',exact:true}).click();
   await wait(async()=>(await session(p)).run.runId!==before);await complete('ready_to_submit');
   await page.screenshot({path:'test-results/reliability-manager-buttons.png',fullPage:true});
  }finally{await browser.close();}
 });
 assert.equal([...x.submissions.values()].reduce((a,b)=>a+b,0),0,'No Test may submit');
 await reset();
}
