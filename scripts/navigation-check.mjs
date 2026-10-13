import {chromium,expect} from '@playwright/test';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
const dir=mkdtempSync(join(tmpdir(),'hanu-navigation-'));
let context;
try{
 const extension=resolve('dist');
 context=await chromium.launchPersistentContext(dir,{channel:process.env.HANU_TEST_BROWSER??(process.platform==='win32'?'msedge':'chromium'),headless:true,args:[`--disable-extensions-except=${extension}`,`--load-extension=${extension}`]});
 const worker=context.serviceWorkers()[0]??await context.waitForEvent('serviceworker');
 await worker.evaluate(async()=>{await chrome.storage.local.set({profile:{values:{fullName:'SYNTHETIC NAVIGATION TEST',phone:'0900000000'},customFields:[],attachments:{},mappings:{}},profileRevision:1});});
 let step=0,submissions=0;const answers=[];
 const url='https://docs.google.com/forms/d/e/navigation-fixture/viewform';
 await context.route('https://docs.google.com/**',route=>{
   if(route.request().method()==='POST'){if(step<2)answers.push(new URLSearchParams(route.request().postData()).get('answer'));else submissions++;step++;}
   if(step===3){route.fulfill({contentType:'text/html; charset=utf-8',body:'<!doctype html><html><body>Your response has been recorded</body></html>'});return;}
   const labels=['Họ và tên','Số điện thoại'];
   route.fulfill({contentType:'text/html; charset=utf-8',body:`<!doctype html><html><head><meta charset="UTF-8"></head><body><form method="POST" action="/forms/u/0/d/e/navigation-fixture/formResponse"><div role="listitem"><div role="heading">${labels[step]??'Trang cuối'}${step<2?' *':''}</div>${step<2?'<input type="text" name="answer">':''}</div><button>${step<2?'Next':'Submit'}</button></form></body></html>`});
 });
 const page=await context.newPage();await page.goto(url);
 const panel=await context.newPage();await panel.goto(`chrome-extension://${new URL(worker.url()).host}/sidepanel.html?tabId=${await worker.evaluate(async()=>{const tabs=await chrome.tabs.query({});return tabs.find(t=>t.url?.includes('navigation-fixture')).id;})}`);
 await panel.locator('#startRun').click();
 await expect.poll(()=>worker.evaluate(async()=>{const s=await chrome.storage.local.get(null);return Object.entries(s).find(([k])=>k.startsWith('run:'))?.[1]?.status;}),{timeout:15000}).toBe('ready_to_submit');
 expect(step).toBe(2);
 expect(submissions).toBe(0);expect(answers).toEqual(['SYNTHETIC NAVIGATION TEST','0900000000']);
 step=0;answers.length=0;await page.goto(url);await panel.locator('#runMode').selectOption('live');await panel.locator('#startRun').click();
 await expect.poll(()=>worker.evaluate(async()=>{const s=await chrome.storage.local.get(null);return Object.entries(s).find(([k])=>k.startsWith('run:'))?.[1]?.status;}),{timeout:15000}).toBe('completed');
 expect(submissions).toBe(1);expect(answers).toEqual(['SYNTHETIC NAVIGATION TEST','0900000000']);
 await panel.locator('#resumeRun').click();await expect(panel.locator('#runLog')).toContainText('Lượt đã khóa gửi');expect(submissions).toBe(1);
 console.log('PASS: /forms/u/0/ document navigation, correct answers, Test stops before submit, Live confirmed once, Resume cannot submit twice.');
}catch(error){if(context){const worker=context.serviceWorkers()[0];if(worker)console.log(await worker.evaluate(async()=>{const s=await chrome.storage.local.get(null);return Object.fromEntries(Object.entries(s).filter(([k])=>k.startsWith('run:')));}));}throw error;}finally{await context?.close();rmSync(dir,{recursive:true,force:true});}
