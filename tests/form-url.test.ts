import {expect,it} from 'vitest';
import {allowedFormUrl,canonicalFormId} from '../src/protocol';

it.each(['','u/0/','u/2/'])("recognizes the same signed-in form across GET and POST routes: %s",account=>{
  for(const published of ['e/',''])for(const page of ['viewform','formResponse']){
    const url=`https://docs.google.com/forms/${account}d/${published}same-form/${page}?pli=1`;
    expect(canonicalFormId(url)).toBe('same-form');expect(allowedFormUrl(url)).toBe(true);
  }
});
it.each(['https://evil.example/forms/u/0/d/e/same-form/viewform','https://docs.google.com/forms/u/name/d/e/same-form/viewform','https://docs.google.com/forms/d/e/same-form/viewform-fake','https://docs.google.com/forms/u/0/d/e/same-form/edit'])('rejects a foreign or unsupported form URL: %s',url=>{
  expect(canonicalFormId(url)).toBeUndefined();expect(allowedFormUrl(url)).toBe(false);
});
