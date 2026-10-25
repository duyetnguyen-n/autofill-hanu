import {chromium,expect} from '@playwright/test';
import {mkdtempSync,rmSync,mkdirSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {serve} from '../build/server/main.mjs';
const dir=mkdtempSync(join(tmpdir(),'hanu-facebook-status-'));let app,browser;
try{
 app=await serve({dir,uiDir:resolve('build/manager-ui')});
 const ids=['fixture-missing-11111111','fixture-reader-22222222'];
 for(const [i,id]of ids.entries()){
  app.store.pair(id,app.store.pairCode());const s=app.store.session(id);
  Object.assign(s,{name:i?'Bộ đọc đã cấp quyền':'Profile chưa cấp quyền',hskLevel:'4',expectedEmail:'fixture@example.test',connected:true,synced:true,profile:{values:{fullName:'Dữ liệu giả'},customFields:[],mappings:{},attachments:{}}});app.store.saveSession(s);
  app.coordinator.peers.set(id,{readyState:1,terminate(){}});
  await app.coordinator.receive(id,{type:'FACEBOOK_STATUS',status:{permission:i?'granted':'missing',reader:i?'ready':'missing'}});
 }
 app.coordinator.command=async()=>({capabilities:['preparedFormTab','scheduledHskLinks'],tabId:100});
 const schedule=await app.coordinator.scheduler.arm({ids:[ids[0]],postUrl:'https://www.facebook.com/story.php?story_fbid=123&id=456',startsAt:new Date(Date.now()+600000).toISOString(),mode:'test'});
 await expect.poll(()=>app.coordinator.scheduler.value?.watcher?.ready).toBe(true);
 expect(app.coordinator.scheduler.value.watcher.id).toBe(ids[1]);
 browser=await chromium.launch({channel:'chromium',headless:true});const page=await browser.newPage({viewport:{width:1440,height:1100}}),errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.goto(app.url);await page.getByRole('switch',{name:'Đăng ký theo cấp độ HSK',exact:true}).check();
 await expect(page.locator('.schedule-reader-identity')).toContainText('22222222');
 await expect(page.locator('.schedule-monitor')).toHaveClass(/warning/);
 const source=page.getByLabel('Profile đọc Facebook',{exact:true});await expect(source).toBeEnabled();await source.selectOption(ids[0]);
 await expect(page.locator('.schedule-monitor')).toContainText('chưa được cấp quyền');await expect(page.locator('.schedule-monitor')).toHaveClass(/warning/);
 await source.selectOption(ids[1]);await expect.poll(()=>app.coordinator.scheduler.value.watcher?.ready).toBe(true);
 const observe=async(extra)=>{const s=app.coordinator.scheduler.value;return app.coordinator.scheduler.observe(s.watcher.id,{scheduleId:s.id,token:s.watcher.token,postKey:'456:123',text:'',...extra});};
 await observe({error:'Không xác định duy nhất bài viết vì có nhiều vùng nội dung.'});
 await expect(page.locator('.schedule-monitor')).toHaveClass(/error/);await expect(page.locator('.schedule-monitor')).toHaveAttribute('role','alert');
 mkdirSync('test-results/extension-193',{recursive:true});await page.screenshot({path:'test-results/extension-193/manager-reader-error.png',fullPage:true});
 await observe({error:'Chưa mở hết nội dung bài. Đã thử mở tự động; bấm Xem Facebook để mở Xem thêm thủ công.'});
 await expect(page.locator('.schedule-monitor')).toHaveClass(/warning/);await expect(page.locator('.schedule-monitor')).toContainText('Chưa mở hết nội dung bài');
 await observe({text:'Thông báo chưa đăng link.'});await expect(page.locator('.schedule-monitor')).toHaveClass(/warning/);
 await page.screenshot({path:'test-results/extension-193/manager-reader-waiting.png',fullPage:true});
 await observe({text:'HSK 4: https://forms.gle/FixtureFour'});await expect(page.locator('.schedule-monitor')).toHaveClass(/success/);
 await page.screenshot({path:'test-results/extension-193/manager-reader-success.png',fullPage:true});
 await page.setViewportSize({width:390,height:844});expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
 expect(errors).toEqual([]);console.log('PASS: ready reader chosen, active source switch, missing grant yellow, parse error red/alert, waiting yellow, captured links green, desktop/mobile layout. Synthetic profiles only.');
}finally{await browser?.close();await app?.close();rmSync(dir,{recursive:true,force:true});}
