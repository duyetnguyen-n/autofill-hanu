import { chromium, expect } from '@playwright/test';
import { resolve } from 'node:path';
import { httpFixture, users } from '../tests/cloud/fixture';

const fixture=await httpFixture(resolve('build/cloud-ui'));
await fixture.pair();
await fixture.pool.query("UPDATE hanu.accounts SET role='admin' WHERE user_id=$1",[users[1]]);
const browser=await chromium.launch({channel:'chromium',headless:true});
try{
  const page=await browser.newPage(),errors:string[]=[];let checks=0;
  page.on('pageerror',error=>errors.push(error.message));
  page.on('request',request=>{if(new URL(request.url()).pathname==='/api/auth/me')checks++;});
  await page.clock.install();
  await page.goto(fixture.config.origin);
  await page.getByRole('button',{name:'Tiếp tục với Google',exact:true}).click();
  await expect(page.locator('table')).toContainText('Chrome thử An');
  await expect.poll(()=>fixture.app.runtimes.get(users[0])?.browsers.size).toBe(1);
  const baseline=checks;
  await page.clock.runFor(31000);
  expect(checks).toBe(baseline);
  // Move near the fallback deadline without waiting five wall-clock minutes.
  await page.clock.fastForward(270000);
  await expect.poll(()=>checks).toBe(baseline+1);
  await expect(page.locator('table')).toContainText('Chrome thử An');
  // An admin change still rechecks immediately via the existing WS channel.
  const detail=await(await fixture.api(`admin/accounts/${users[0]}`,1)).json();
  const response=await fixture.api(`admin/accounts/${users[0]}`,1,{
    version:detail.account.version,status:'blocked',maxProfiles:100,maxConcurrent:100,liveEnabled:true,expiresAt:null,adminNote:'Fixture revocation'
  },'PATCH');
  expect(response.status).toBe(200);
  await expect(page.getByRole('heading',{name:'Tài khoản đang bị khóa.',exact:true})).toBeVisible();
  expect(checks).toBe(baseline+2);
  expect(errors).toEqual([]);
  console.log('PASS: built UI skips 30-second polling, checks at five minutes, receives immediate admin revocation through WebSocket. Local auth/database fixture, no browser errors.');
}finally{await browser.close();await fixture.close();}
