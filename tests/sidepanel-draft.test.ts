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
