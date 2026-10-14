import {chromium,expect} from '@playwright/test';
import {resolve} from 'node:path';

const browser=await chromium.launch({channel:process.platform==='win32'?'msedge':'chromium',headless:true});
try{
  for(const mode of ['test','live','halt']){
    const page=await browser.newPage();
    page.setDefaultTimeout(5000);
    const url='https://docs.google.com/forms/d/e/validation-browser-fixture/viewform';
    await page.route(url,route=>route.fulfill({contentType:'text/html; charset=utf-8',body:`<!doctype html><html><head><meta charset="utf-8"></head><body>
      <div role="listitem" data-item-id="phone"><div role="heading">Số điện thoại *</div>
        <input aria-label="Điện thoại" type="text" name="entry.phone" pattern="[0-9]{10}" required></div>
      <div role="listitem" data-item-id="email"><div role="heading">Email liên hệ</div>
        <input aria-label="Email" type="email" value="bad"></div><button id="next">Next</button>
    </body></html>`}));
    await page.goto(url);
    await page.evaluate(mode=>{
      window.fixture={events:[],requests:[],next:0,submitted:0,mode:mode==='live'?'live':'test'};
      const f=window.fixture;
      const profile={values:{phone:'wrong'},customFields:[],attachments:{},mappings:{}};
      Object.assign(window.chrome,{runtime:{onMessage:{addListener:fn=>f.listener=fn},sendMessage:async message=>{
        f.requests.push(message.type);
        if(message.type==='GET_PROFILE')return structuredClone(profile);
        if(message.type==='FORM_EVENT')f.events.push(message.event);
        if(message.type==='AUTO_RESUME'){f.listener({type:'RUN_CURRENT_PAGE',runId:'run',mode:f.mode},{},()=>{});return {ok:true,resumed:true};}
        if(message.type==='REQUEST_SUBMIT')return {granted:true};
        return {ok:true};
      }}});
      document.querySelector('#next').onclick=()=>{
        f.next++;f.correctedPhone=document.querySelector('[name="entry.phone"]').value;
        document.body.innerHTML='<button id="submit">Submit</button>';
        document.querySelector('#submit').onclick=()=>{f.submitted++;document.body.textContent='Your response has been recorded';};
      };
    },mode);
    await page.addScriptTag({path:resolve('dist/content.js')});
    await page.evaluate(()=>window.fixture.listener({type:'RUN_CURRENT_PAGE',runId:'run',mode:window.fixture.mode},{},()=>{}));
    await expect.poll(()=>page.evaluate(()=>window.fixture.events.at(-1)?.type)).toBe('block');
    if(mode==='halt')await page.evaluate(()=>window.fixture.listener({type:'HALT_RUN'},{},()=>{}));
    await page.getByRole('textbox',{name:'Điện thoại',exact:true}).fill('0900000000');
    await page.getByRole('textbox',{name:'Điện thoại',exact:true}).press('Tab');
    await page.waitForTimeout(250);
    expect(await page.evaluate(()=>window.fixture.next)).toBe(0);
    await page.getByRole('textbox',{name:'Email',exact:true}).fill('correct@example.test');
    await page.getByRole('textbox',{name:'Email',exact:true}).press('Tab');
    if(mode==='halt'){
      await page.waitForTimeout(300);expect(await page.evaluate(()=>window.fixture.next)).toBe(0);
      expect(await page.evaluate(()=>window.fixture.requests.includes('AUTO_RESUME'))).toBe(false);
    }else{
      await expect.poll(()=>page.evaluate(()=>window.fixture.events.at(-1)?.type)).toBe(mode==='live'?'completed':'ready_to_submit');
      expect(await page.evaluate(()=>window.fixture.next)).toBe(1);
      expect(await page.evaluate(()=>window.fixture.correctedPhone)).toBe('0900000000');
      expect(await page.evaluate(()=>window.fixture.submitted)).toBe(mode==='live'?1:0);
      expect(await page.evaluate(()=>window.fixture.requests.filter(type=>type==='AUTO_RESUME').length)).toBe(1);
    }
    await page.close();
  }
  console.log('PASS: real Chromium validity and input/change events; all errors must clear; corrected answer preserved; Test never submits; Live submits once; Halt prevents auto Resume. Google Forms is intercepted and no real form is submitted.');
}finally{await browser.close();}
