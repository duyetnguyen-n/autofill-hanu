// @vitest-environment jsdom
import {readFileSync} from 'node:fs';
import {afterEach,expect,it,vi} from 'vitest';
import {DIRECT_LAB_URL} from '../src/google-direct/schema';
import {inspectDirectForm} from '../src/google-direct/inspect';

const metadata = readFileSync('tests/fixtures/google-direct-lab.json','utf8');
const inspection = {url:DIRECT_LAB_URL,action:DIRECT_LAB_URL.replace('viewform','formResponse'),script:`var FB_PUBLIC_LOAD_DATA_ = ${metadata};`,sessionFields:['fbzx','token','pageHistory'],hasUpload:true};
afterEach(() => {vi.unstubAllGlobals();vi.restoreAllMocks();vi.resetModules();document.body.replaceChildren();});
async function page(executeScript = vi.fn(async () => [{result:inspection}])) {
  document.body.innerHTML = '<main id="directLab"></main>';
  const write = vi.fn(), send = vi.fn(), network = vi.fn();
  vi.stubGlobal('fetch',network);
  vi.stubGlobal('chrome',{tabs:{query:async () => [{id:42,title:'Lab form',url:DIRECT_LAB_URL}],create:vi.fn()},scripting:{executeScript},storage:{local:{set:write,get:async () => ({})}},runtime:{sendMessage:send}});
  await import('../src/google-direct/page');
  await vi.waitFor(() => expect(document.querySelectorAll('#formTab option')).toHaveLength(2));
  const tabs = document.querySelector<HTMLSelectElement>('#formTab')!;tabs.value = '42';tabs.dispatchEvent(new Event('change'));
  return {write,send,network,executeScript};
}
it('reads a selected form, previews a synthetic request, and never sends/writes/starts the legacy engine',async () => {
  const f = await page();
  document.querySelector<HTMLButtonElement>('#inspect')!.click();
  await vi.waitFor(() => expect(document.querySelector<HTMLElement>('#results')!.hidden).toBe(false));
  expect(document.querySelector('#formTitle')!.textContent).toContain('LAB —');
  expect(document.querySelectorAll('#answers tr')).toHaveLength(19); // one identity branch skipped
  expect(document.querySelector('#blockers')!.textContent).toContain('mã upload Google');
  expect(document.querySelector('#payload')!.textContent).not.toContain('NGHIEN');
  const reveal = document.querySelector<HTMLInputElement>('#showValues')!;reveal.checked = true;reveal.dispatchEvent(new Event('change'));
  expect(document.querySelector('#payload')!.textContent).toContain('NGHIEN+CUU+LAB');
  expect(f.executeScript).toHaveBeenCalledWith({target:{tabId:42},func:inspectDirectForm});
  expect(f.write).not.toHaveBeenCalled();expect(f.send).not.toHaveBeenCalled();expect(f.network).not.toHaveBeenCalled();
  const source = document.querySelector<HTMLSelectElement>('#source')!;source.value = 'saved';source.dispatchEvent(new Event('change'));
  expect(document.querySelector<HTMLElement>('#results')!.hidden).toBe(true);
  expect(document.querySelector('#payload')!.textContent).toBe('');
  expect(reveal.checked).toBe(false);
});
it('discards an in-flight inspection when the selected source changes',async () => {
  let finish!: (value: any) => void;
  await page(vi.fn(() => new Promise(resolve => {finish = resolve;})));
  document.querySelector<HTMLButtonElement>('#inspect')!.click();
  const source = document.querySelector<HTMLSelectElement>('#source')!;source.value = 'saved';source.dispatchEvent(new Event('change'));
  finish([{result:inspection}]);
  await vi.waitFor(() => expect(document.querySelector<HTMLButtonElement>('#inspect')!.disabled).toBe(false));
  expect(document.querySelector<HTMLElement>('#results')!.hidden).toBe(true);
});
it('reads only session field names and checks the same-form submission action',() => {
  vi.stubGlobal('location',new URL(DIRECT_LAB_URL));
  document.body.innerHTML = `<form action="${inspection.action}"><input type="hidden" name="token" value="secret-not-exported"><input type="hidden" name="pageHistory" value="0,1"></form>`;
  const script = document.createElement('script');script.textContent = inspection.script;document.body.append(script);
  const result = inspectDirectForm();
  expect(result.sessionFields).toEqual(['token','pageHistory']);
  expect(result.currentPageHistory).toBe('0,1');
  expect(JSON.stringify(result)).not.toContain('secret-not-exported');
  document.querySelector('form')!.action=inspection.action.replace('/forms/','/forms/u/0/');
  expect(inspectDirectForm().action).toContain('/forms/u/0/');
  document.querySelector('form')!.action = 'https://example.com/formResponse';
  expect(() => inspectDirectForm()).toThrow('không khớp');
});
