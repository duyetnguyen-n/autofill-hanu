import {afterEach,expect,it} from 'vitest';
import {httpFixture,users} from './fixture';
const cleanups:(()=>Promise<void>)[]=[];
afterEach(async()=>{for(const close of cleanups.splice(0).reverse())await close();});
const post='https://www.facebook.com/story.php?story_fbid=123&id=456';
it('persists HSK in bulk and schedules per owner without altering profile sync',async()=>{
  const f=await httpFixture();cleanups.push(f.close);const a=await f.pair(),b=await f.pair(users[1]);
  const before=await a.store.session(a.sessionId);
  const levels=await f.api('hsk-levels',0,{ids:[a.sessionId],level:'4'});expect(levels.status).toBe(200);
  expect(await a.store.session(a.sessionId)).toMatchObject({hskLevel:'4',synced:before.synced,revision:before.revision,profile:before.profile});
  const startsAt=new Date(Date.now()+600000).toISOString();
  const response=await f.api('registration-schedule',0,{ids:[a.sessionId],postUrl:post,startsAt,mode:'test'});expect(response.status).toBe(200);
  const saved=await response.json();expect(saved.members).toMatchObject([{id:a.sessionId,level:'4',status:'waiting'}]);
  expect((await a.store.registrationSchedule())?.id).toBe(saved.id);expect(await b.store.registrationSchedule()).toBeUndefined();
  const state=await(await f.api('state')).json();expect(state.registrationSchedule.id).toBe(saved.id);
  const other=await(await f.api('state',1)).json();expect(other.registrationSchedule).toBeUndefined();
  expect((await f.api('registration-schedule/answer',0,{level:'4',finalQuestion:{value:'Đáp án biết trước'}})).status).toBe(200);
  expect((await a.store.registrationSchedule())?.finalQuestions?.['4']).toEqual({value:'Đáp án biết trước'});
  expect((await f.api('registration-schedule/answer',0,{level:'4',finalQuestion:{value:''}})).status).toBe(400);
  const q={label:'Câu HSK 4?',value:'HANU'};
  expect((await f.api('registration-schedule/answer',0,{level:'4',finalQuestion:q})).status).toBe(200);
  expect((await a.store.registrationSchedule())?.finalQuestions?.['4']).toEqual(q);
  expect((await f.api('registration-schedule/answer',1,{level:'4',finalQuestion:q})).status).toBe(400);
  expect(await b.store.registrationSchedule()).toBeUndefined();
  expect((await f.api('registration-schedule/replace',1,{level:'4',url:'https://forms.gle/Other'})).status).toBe(400);
  expect((await f.api('registration-schedule/pause',0,{scheduleId:saved.id})).status).toBe(200);
  expect((await a.store.registrationSchedule())?.pausedAt).toBeTruthy();
  expect((await f.api('registration-schedule/pause',1,{scheduleId:saved.id})).status).toBe(400);
  expect((await f.api('registration-schedule/stop',0,{scheduleId:'stale'})).status).toBe(400);
  expect((await a.store.registrationSchedule())?.status).not.toBe('cancelled');
  expect((await f.api('registration-schedule/resume',0,{scheduleId:saved.id})).status).toBe(200);
  expect((await a.store.registrationSchedule())?.pausedAt).toBeUndefined();
  await f.api('registration-schedule/cancel',0,{});expect((await a.store.registrationSchedule())?.status).toBe('cancelled');
},20000);
it('rejects another owner, unassigned HSK, invalid URLs and denied Live before arming',async()=>{
  const f=await httpFixture();cleanups.push(f.close);const a=await f.pair(),b=await f.pair(users[1]);
  const input={ids:[b.sessionId],postUrl:post,startsAt:new Date(Date.now()+600000).toISOString(),mode:'test'};
  expect((await f.api('registration-schedule',0,input)).status).toBe(400);
  expect((await f.api('registration-schedule',0,{...input,ids:[a.sessionId]})).status).toBe(400);
  await f.api('hsk-levels',0,{ids:[a.sessionId],level:'4'});
  expect((await f.api('registration-schedule',0,{...input,ids:[a.sessionId],links:{'4':'https://evil.test/'}})).status).toBe(400);
  await f.pool.query('UPDATE hanu.accounts SET live_enabled=false WHERE user_id=$1',[users[0]]);
  expect((await f.api('registration-schedule',0,{...input,ids:[a.sessionId],mode:'live'})).status).toBe(403);
  expect(await a.store.registrationSchedule()).toBeUndefined();
  await f.db.exec('SET ROLE authenticated');try{await expect(f.db.query('SELECT * FROM hanu.registration_schedules')).rejects.toThrow();}finally{await f.db.exec('RESET ROLE');}
},20000);
it('stops only profiles in the authenticated account and reports disconnected members truthfully',async()=>{
 const f=await httpFixture();cleanups.push(f.close);const a=await f.pair(),b=await f.pair(users[1]);
 for(const fixture of [a,b]){
  const s=await fixture.store.session(fixture.sessionId),id='run-'+fixture.sessionId;
  await fixture.store.beginGroup({id,mode:'test',url:'https://docs.google.com/forms/d/e/fixture/viewform',members:[s.id],paused:false,createdAt:new Date().toISOString()},[]);
  s.run={runId:id,sessionId:s.id,managed:true,tabId:1,formId:'fixture',mode:'test',status:'running',filled:[],skipped:[],logs:[],submitAttempted:false,updatedAt:new Date().toISOString()};await fixture.store.saveSession(s);
 }
 const response=await f.api('stop-all',0,{});expect(response.status).toBe(200);
 const result=await response.json();expect(result.map((r:any)=>r.id)).toEqual([a.sessionId]);expect(result[0].ok).toBe(false);
 expect((await b.store.session(b.sessionId)).run?.status).toBe('running');
 expect((await b.store.group('run-'+b.sessionId)).paused).toBe(false);
},20000);
