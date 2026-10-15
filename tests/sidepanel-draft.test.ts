// @vitest-environment jsdom
import {readFileSync} from 'node:fs';
import {afterEach,expect,it,vi} from 'vitest';
import {emptyProfile} from '../src/rules';

afterEach(()=>{vi.useRealTimers();vi.unstubAllGlobals();vi.resetModules();document.body.replaceChildren();});
it('keeps unsaved values, custom fields and mappings when uploading, then saves them with the new image',async()=>{
  vi.useFakeTimers();
  document.body.innerHTML=readFileSync('sidepanel.html','utf8');
  const stored=emptyProfile();stored.values.fullName='Old saved name';stored.mappings={'form:q':'fullName'};
  stored.customFields=[{id:'custom',label:'Old label',aliases:['Question'],value:'Old value'}];
  const attachment={id:'new-image',name:'fixture.png',type:'image/png',size:3,updatedAt:''};
  const sent:any[]=[];
  vi.stubGlobal('chrome',{runtime:{getManifest:()=>({version:'test'}),onMessage:{addListener:vi.fn()},sendMessage:async(message:any)=>{
    sent.push(structuredClone(message));
    if(message.type==='GET_PANEL_STATE')return {profile:structuredClone(stored),tabId:1};
    if(message.type==='NATIVE_STATUS')return {extensionId:'a'.repeat(32),connected:false};
    if(message.type==='SAVE_ATTACHMENT')return {profile:{...structuredClone(stored),attachments:{identityDocument:attachment}}};
    return {ok:true};
  }}});
  await import('../src/sidepanel');
  await vi.waitFor(()=>expect(document.querySelector<HTMLInputElement>('#field-fullName')?.value).toBe('Old saved name'));
  document.querySelector<HTMLInputElement>('#field-fullName')!.value='New draft name';
  document.querySelector<HTMLInputElement>('[data-custom-property="value"]')!.value='New draft value';
  const input=document.querySelector<HTMLInputElement>('#identityFile')!;
  Object.defineProperty(input,'files',{value:[new File(['abc'],'fixture.png',{type:'image/png'})]});
  input.dispatchEvent(new Event('change',{bubbles:true}));
  await vi.waitFor(()=>expect(document.querySelector('#identityFileStatus')!.textContent).toContain('fixture.png'));
  document.querySelector<HTMLButtonElement>('#saveProfile')!.click();
  await vi.waitFor(()=>expect(sent.find(m=>m.type==='SAVE_PROFILE')).toMatchObject({profile:{values:{fullName:'New draft name'},customFields:[{value:'New draft value'}],mappings:{'form:q':'fullName'},attachments:{identityDocument:attachment}}}));
});

it('follows a managed Start into its new tab and ignores an older acknowledgement or old-run event', async () => {
  vi.useFakeTimers();
  vi.stubGlobal('__HANU_CLOUD_ORIGIN__','https://fixture.example');
  document.body.innerHTML=readFileSync('sidepanel.html','utf8');
  const stored=emptyProfile(),sent:any[]=[];let listener:any;
  const old={runId:'old',managed:true,tabId:1,mode:'test',status:'idle',eventSeq:9,startedAt:'2026-10-15T00:00:00Z',logs:[]};
  const next={...old,runId:'new',tabId:2,status:'waiting_manual',eventSeq:2,startedAt:'2026-10-16T00:00:00Z'};
  vi.stubGlobal('chrome',{runtime:{getManifest:()=>({version:'test'}),onMessage:{addListener:(fn:any)=>{listener=fn;}},sendMessage:async(m:any)=>{
    sent.push(m);
    if(m.type==='GET_PANEL_STATE')return {profile:structuredClone(stored),run:old,tabId:1};
    if(m.type==='NATIVE_STATUS')return {extensionId:'a'.repeat(32),connected:true};
    if(m.type==='START_RUN'){
      listener({type:'RUN_STATE_UPDATED',run:next});
      return {...next,tabId:-1,eventSeq:0,status:'running'};
    }
    if(m.type==='PAUSE_RUN')return {...next,eventSeq:3,status:'paused'};
    return {ok:true};
  }}});
  await import('../src/sidepanel');
  await vi.waitFor(()=>expect(document.querySelector('#stateBadge')!.textContent).toBe('Sẵn sàng'));
  expect(document.querySelector<HTMLButtonElement>('#startRun')!.hidden).toBe(false);
  document.querySelector<HTMLButtonElement>('#startRun')!.click();
  await vi.waitFor(()=>expect(document.querySelector('#stateBadge')!.textContent).toBe('Cần bạn xử lý'));
  listener({type:'RUN_STATE_UPDATED',run:{...next,eventSeq:1,status:'running'}});
  listener({type:'RUN_STATE_UPDATED',run:{...old,status:'running'}});
  expect(document.querySelector('#stateBadge')!.textContent).toBe('Cần bạn xử lý');
  document.querySelector<HTMLButtonElement>('#pauseRun')!.click();
  await vi.waitFor(()=>expect(sent.find(m=>m.type==='PAUSE_RUN')).toMatchObject({tabId:2}));
  await vi.waitFor(()=>expect(document.querySelector('#stateBadge')!.textContent).toBe('Đã tạm dừng'));
});
