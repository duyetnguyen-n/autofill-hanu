import {chromium,expect} from '@playwright/test';
import {mkdtempSync,rmSync,mkdirSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {serve} from '../build/server/main.mjs';
const dir=mkdtempSync(join(tmpdir(),'hanu-final-ui-'));let app,browser;
try{
  app=await serve({dir,uiDir:resolve('build/manager-ui')});
  const ids=['final-fixture-a','final-fixture-b'],payloads=[];
  for(const [i,id] of ids.entries()){app.store.pair(id,app.store.pairCode());const s=app.store.session(id);s.name=`Profile thử ${i+1}`;s.expectedEmail=`fixture${i}@example.test`;s.connected=true;s.synced=true;s.profile={values:{fullName:`Candidate ${i}`},customFields:[],mappings:{},attachments:{}};app.store.saveSession(s);app.coordinator.peers.set(id,{readyState:1,terminate(){}});}
  const form='https://docs.google.com/forms/d/e/final-ui/viewform';
  app.coordinator.command=async(id,kind,payload)=>{
    payloads.push({id,kind,payload});
    if(kind==='PING')return {capabilities:['sharedFinalQuestion']};
    if(kind==='SCAN_FORM')return {formId:'final-ui',url:form,questions:[{id:'unrelated',targetId:'entry.100',label:'Họ và tên *',kind:'text',required:true,filled:true,options:[]},{id:'final',targetId:'entry.9000',label:'Câu hỏi cuối *',kind:'dropdown',required:true,filled:false,options:['Đáp án A','Đáp án B']},{id:'account',label:'Record fixture@example.test as the email to be included with my response',kind:'checkbox',required:false,filled:true,options:[]}]};
    if(kind==='RESUME')return {...app.store.session(id).run,status:'running',eventSeq:1};return {};
  };
  browser=await chromium.launch({channel:process.platform==='win32'?'msedge':'chromium',headless:true});
  const page=await browser.newPage({viewport:{width:1440,height:1100}});await page.goto(app.url);
  await page.getByLabel('Chọn các profile đang hiển thị',{exact:true}).check();await page.getByLabel('Link Google Form',{exact:true}).fill(form);
  await expect(page.getByRole('button',{name:'Bắt đầu Test',exact:true})).toBeEnabled();
  await page.getByRole('textbox',{name:/^Đáp án chung/}).fill('Đáp án B');
  await expect(page.getByRole('button',{name:'Bắt đầu Test',exact:true})).toBeDisabled();
  await page.getByRole('button',{name:'Đọc câu hỏi trên form',exact:true}).click();
  await expect(page.locator('.final-question-preview')).toContainText('Câu hỏi cuối *');
  await expect(page.locator('.final-question-preview')).toContainText('Danh sách chọn');
  await expect(page.getByLabel('Đáp án chung',{exact:true})).toHaveValue('Đáp án B');
  await expect(page.getByText('Chọn câu hỏi cuối đã biết',{exact:true})).toHaveCount(0);
  await expect(page.getByLabel('Chọn câu hỏi khác',{exact:true})).not.toBeVisible();
  await expect(page.getByRole('button',{name:'Bắt đầu Test',exact:true})).toBeEnabled();
  mkdirSync('test-results',{recursive:true});await page.screenshot({path:'test-results/compact-final-question-manager.png',fullPage:true});
  await page.getByRole('button',{name:'Bắt đầu Test',exact:true}).click();await expect(page.locator('table')).toContainText('Đang chạy');
  for(const id of ids){expect(app.store.session(id).run.finalQuestion).toEqual({label:'Câu hỏi cuối *',value:'Đáp án B',kind:'dropdown',formId:'final-ui',questionId:'entry.9000'});expect(app.store.session(id).profile.values.fullName).toContain('Candidate');}
  expect(payloads.filter(p=>p.kind==='START')).toHaveLength(2);
  for(const id of ids){const s=app.store.session(id);s.run.status='waiting_manual';s.run.formId='final-ui';s.run.blockingIssue={reason:'verification',message:'Cần đáp án'};app.store.saveSession(s);}app.coordinator.changed();
  await page.getByLabel('Đáp án chung',{exact:true}).selectOption('Đáp án A');await page.getByRole('button',{name:'Áp dụng và tiếp tục các profile đã chọn',exact:true}).click();
  await expect(page.getByText('Đã áp dụng đáp án chung và tiếp tục các profile đã chọn.',{exact:true})).toBeVisible();
  expect(payloads.filter(p=>p.kind==='SET_FINAL_QUESTION')).toHaveLength(2);expect(payloads.filter(p=>p.kind==='RESUME')).toHaveLength(2);
  for(const id of ids)expect(app.store.session(id).run.finalQuestion.value).toBe('Đáp án A');
  await page.getByLabel('Link Google Form',{exact:true}).fill(form.replace('final-ui','another-form'));await expect(page.getByRole('textbox',{name:'Đáp án chung',exact:true})).toHaveValue('');
  await expect(page.locator('.final-question-preview')).not.toContainText('Câu hỏi cuối *');
  await page.getByText('Chọn câu khác / nhập trước',{exact:true}).click();
  await page.getByLabel('Nội dung chính xác của câu hỏi cuối',{exact:true}).fill('Câu tự nhập');
  await page.getByRole('textbox',{name:'Đáp án chung',exact:true}).fill('2026');
  await expect(page.locator('.final-question-preview')).toContainText('Câu tự nhập');
  await page.getByRole('button',{name:'Không dùng đáp án chung',exact:true}).click();
  await expect(page.getByRole('textbox',{name:'Đáp án chung',exact:true})).toHaveValue('');
  console.log('PASS: one-click scan selects the last question, stable ID/type and answer options; no enable/target-selection click; old email checkbox ignored; one answer reaches both profiles; waiting runs update/resume together; manual input and reset remain available.');
}finally{await browser?.close();await app?.close();rmSync(dir,{recursive:true,force:true});}
