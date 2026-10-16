import {chromium,expect} from '@playwright/test';
import {resolve} from 'node:path';
import {mkdir,writeFile} from 'node:fs/promises';
import {httpFixture,users} from '../tests/cloud/fixture';

const fixture=await httpFixture(resolve('build/cloud-ui'));
const browser=await chromium.launch({channel:'chromium',headless:true});
try{
  const members=await Promise.all([fixture.pair(users[0]),fixture.pair(users[0])]);
  await fixture.api('state');const c=fixture.app.runtimes.get(users[0])!.coordinator,store=c.store;
  const starts:string[]=[];
  for(const [i,m]of members.entries()){const s=await store.session(m.sessionId);s.name=`Profile ${i+1}`;await store.saveSession(s);c.peers.set(s.id,{readyState:1,terminate(){}} as any);}
  c.command=async(id,kind)=>{
    if(kind==='START')starts.push(id);
    if(kind==='STOP_PROFILE'){const s=await store.session(id);return {run:{...s.run,status:'idle',eventSeq:(s.run?.eventSeq??0)+1},execution:null};}
    return {ok:true};
  };
  const group=await c.start(members.map(m=>m.sessionId),'https://docs.google.com/forms/d/e/ui-isolation/viewform','test');
  const context=await browser.newContext({viewport:{width:1440,height:1000}});
  await context.addCookies([{name:'test-account',value:'account-a',url:fixture.config.origin}]);
  const page=await context.newPage(),errors:string[]=[];page.on('pageerror',error=>errors.push(error.message));
  let release!:()=>void,entered!:()=>void;const blocked=new Promise<void>(r=>entered=r),gate=new Promise<void>(r=>release=r);
  await page.route(`**/api/sessions/${members[0].sessionId}/focus`,async route=>{entered();await gate;await route.fulfill({json:{ok:true}});});
  await page.goto(fixture.config.origin);
  const row=(name:string)=>page.getByRole('row').filter({has:page.getByRole('button',{name,exact:true})});
  await row('Profile 1').getByRole('button',{name:'Xem form',exact:true}).click();await blocked;
  await expect(row('Profile 1').getByRole('button',{name:'Xem form',exact:true})).toBeDisabled();
  await expect(row('Profile 2').getByRole('button',{name:'Xem form',exact:true})).toBeEnabled();
  await row('Profile 2').getByRole('button',{name:'Chạy lại',exact:true}).click();
  await expect.poll(async()=>(await store.session(members[1].sessionId)).run?.runId).not.toBe(group.id);
  expect(starts.filter(id=>id===members[1].sessionId)).toHaveLength(2);
  await row('Profile 1').getByRole('button',{name:'Dừng',exact:true}).click();
  await expect.poll(async()=>(await store.session(members[0].sessionId)).run?.status).toBe('idle');
  await mkdir('test-results',{recursive:true});await page.screenshot({path:'test-results/v150-profile-isolation-ui.png',fullPage:true});
  release();await expect(row('Profile 1').getByRole('button',{name:'Xem form',exact:true})).toBeEnabled();
  expect(errors).toEqual([]);
  await writeFile('test-results/v150-profile-isolation-ui.json',JSON.stringify({passed:true,blockedFocusProfile:1,restartedProfile:2,stopWhileFocusPending:true,errors},null,2));
  console.log('PASS: blocked profile 1 does not disable profile 2; Restart 2 and priority Stop 1 both finish while Focus 1 is unresolved.');
}finally{await browser.close();await fixture.close();}
