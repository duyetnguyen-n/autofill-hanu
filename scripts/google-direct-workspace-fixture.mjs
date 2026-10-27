// Local UI/protocol fixture. No Google requests and no real profiles.
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {serve} from '../build/server/main.mjs';
const dir=mkdtempSync(join(tmpdir(),'hanu-direct-workspace-'));
const app=await serve({dir,uiDir:resolve('build/manager-ui'),port:4187});
const commands=[];
for(let n=1;n<=3;n++){
 const id=`direct-fixture-profile-${n}`;app.store.pair(id,app.store.pairCode());
 const s=app.store.session(id);Object.assign(s,{name:`Profile thử ${n}`,hskLevel:n===3?'5':'4',expectedEmail:`fixture${n}@example.test`,connected:true,synced:true,profile:{values:{fullName:`THI SINH GIA ${n}`},customFields:[],mappings:{},attachments:{}}});app.store.saveSession(s);
 app.coordinator.peers.set(id,{readyState:1,terminate(){}});
}
app.coordinator.command=async(id,kind,payload={},runId)=>{
 commands.push({id,kind,engine:payload.engine,runId});
 if(kind==='PING')return {capabilities:['googleDirect','preparedFormTab','scheduledHskLinks','sharedFinalQuestion'],execution:null};
 if(kind==='PREPARE_FORM')return {tabId:101};
 if(kind==='STOP_PROFILE'||kind==='PAUSE'){
  const s=app.store.session(id);if(s.run){s.run={...s.run,status:kind==='PAUSE'?'paused':'idle',eventSeq:(s.run.eventSeq??0)+1,updatedAt:new Date().toISOString(),autoContinue:false};app.store.saveRun(id,s.run);app.store.saveSession(s);}
  app.coordinator.changed();return {run:s.run,execution:null};
 }
 if(kind==='START'){
  const s=app.store.session(id);if(s.run){s.run={...s.run,formId:payload.url.match(/\/d\/e\/([^/]+)/)?.[1]??'',eventSeq:1,status:'running',updatedAt:new Date().toISOString()};app.store.saveRun(id,s.run);app.store.saveSession(s);app.coordinator.changed();}return s.run;
 }
 return {};
};
console.log('Fixture: '+app.url.replace('/#','/google-direct#'));
process.on('SIGINT',()=>{void app.close().finally(()=>{rmSync(dir,{recursive:true,force:true});process.exit();});});
