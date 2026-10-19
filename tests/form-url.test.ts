import {expect,it} from 'vitest';
import {allowedFormUrl,canonicalFormId,canStartSeparateTest} from '../src/protocol';
import type {RunState} from '../src/shared';

it.each(['','u/0/','u/2/'])("recognizes the same signed-in form across GET and POST routes: %s",account=>{
  for(const published of ['e/',''])for(const page of ['viewform','formResponse']){
    const url=`https://docs.google.com/forms/${account}d/${published}same-form/${page}?pli=1`;
    expect(canonicalFormId(url)).toBe('same-form');expect(allowedFormUrl(url)).toBe(true);
  }
});
it.each(['https://evil.example/forms/u/0/d/e/same-form/viewform','https://docs.google.com/forms/u/name/d/e/same-form/viewform','https://docs.google.com/forms/d/e/same-form/viewform-fake','https://docs.google.com/forms/u/0/d/e/same-form/edit'])('rejects a foreign or unsupported form URL: %s',url=>{
  expect(canonicalFormId(url)).toBeUndefined();expect(allowedFormUrl(url)).toBe(false);
});
it('keeps a closed form associated with its run without allowing it as a new Start URL',()=>{
  for(const account of ['','u/0/']){
    const url=`https://docs.google.com/forms/${account}d/e/same-form/closedform`;
    expect(canonicalFormId(url)).toBe('same-form');expect(allowedFormUrl(url)).toBe(false);
  }
});
it('does not let an uncertain submission become a new Live or same-form Test',()=>{
  const run={status:'submit_uncertain',submitAttempted:true,autoContinue:false,formId:'old-form'} as RunState;
  const other='https://docs.google.com/forms/d/e/other-form/viewform';
  expect(canStartSeparateTest(run,other,'test')).toBe(true);
  expect(canStartSeparateTest(run,other,'live')).toBe(false);
  expect(canStartSeparateTest(run,'https://docs.google.com/forms/u/0/d/e/old-form/formResponse','test')).toBe(false);
  for(const url of ['https://forms.gle/unresolved','https://evil.example/forms/d/e/other-form/viewform',other.replace('viewform','closedform')])expect(canStartSeparateTest(run,url,'test')).toBe(false);
  for(const autoContinue of [undefined,true])expect(canStartSeparateTest({...run,autoContinue},other,'test')).toBe(false);
  expect(canStartSeparateTest({...run,formId:'',url:undefined},other,'test')).toBe(false);
});
