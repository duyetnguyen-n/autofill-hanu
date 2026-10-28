// @vitest-environment jsdom
import React,{act} from 'react';
import {createRoot,type Root} from 'react-dom/client';
import {afterEach,beforeEach,expect,it,vi} from 'vitest';
import type {RegistrationSchedule} from '../src/registration-schedule';
import {RegistrationSchedulePanel} from '../manager/ui/RegistrationSchedule';

vi.mock('@fluentui/react-components',async()=>{
  const R=await import('react');
  return {
    Button:({children,appearance,size,icon,...props}:any)=>R.createElement('button',props,children),
    Field:({children}:any)=>R.createElement('div',null,children),
    Input:({onChange,contentBefore,...props}:any)=>R.createElement('input',{...props,onInput:(e:any)=>onChange?.(e,{value:e.currentTarget.value})}),
    Checkbox:()=>null,Select:({children,...props}:any)=>R.createElement('select',props,children),
    Textarea:({onChange,...props}:any)=>R.createElement('textarea',{...props,onInput:(e:any)=>onChange?.(e,{value:e.currentTarget.value})})
  };
});
vi.mock('@fluentui/react-icons',()=>({CalendarClockRegular:()=>null,StopRegular:()=>null,LinkRegular:()=>null}));
vi.mock('../manager/ui/HskVerification',()=>({HskVerification:()=>null}));
vi.mock('../manager/ui/Notice',()=>({Notice:({children}:any)=><div>{children}</div>}));

let root:Root,host:HTMLDivElement;
beforeEach(()=>{vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT',true);host=document.createElement('div');document.body.append(host);root=createRoot(host);});
afterEach(async()=>{await act(async()=>root.unmount());host.remove();vi.unstubAllGlobals();});

async function fixture(){
  const session={id:'a',name:'ND',hskLevel:'3',connected:true,linked:true} as any;
  let schedule={id:'schedule',engine:'direct',status:'armed',manualOnly:true,mode:'test',postUrl:'',startsAt:new Date().toISOString(),members:[{id:'a',level:'3',status:'waiting',requestId:'request-a'}],links:{}} as RegistrationSchedule;
  const render=()=>root.render(<RegistrationSchedulePanel schedule={schedule} sessions={[session]} selected={[session]} mode="test" busy={false} request={request}/>);
  const request=vi.fn(async(path:string)=>{
    if(path==='registration-schedule/link'){
      // Model the real immediate dispatch arriving before the next click.
      schedule={...schedule,status:'finished',members:[{...schedule.members[0],status:'started',runId:'run-new'}]};
      session.run={runId:'run-new',status:'running'};render();
    }
    return [];
  });
  await act(async()=>render());
  const input=host.querySelector<HTMLInputElement>('[aria-label="Link HSK 3"]')!;
  await act(async()=>{input.focus();input.value='https://docs.google.com/forms/d/e/lab/viewform';input.dispatchEvent(new Event('input',{bubbles:true}));});
  return {input,request};
}
it('submits a link once when moving focus from its input to its action button',async()=>{
  const {request}=await fixture();
  const button=host.querySelector<HTMLButtonElement>('[data-hsk-link-actions] button')!;
  await act(async()=>button.focus());
  await act(async()=>button.click());
  expect(request.mock.calls.map(([path])=>path)).toEqual(['registration-schedule/link']);
});
it('still saves a link when leaving the field for another control',async()=>{
  const {request}=await fixture();
  const other=document.createElement('button');document.body.append(other);
  try{await act(async()=>other.focus());expect(request.mock.calls.map(([path])=>path)).toEqual(['registration-schedule/link']);}
  finally{other.remove();}
});
