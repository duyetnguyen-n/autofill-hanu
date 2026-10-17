import { afterEach, expect, it, vi } from 'vitest';
import type { ExtensionMessage, RunState } from '../src/shared';

afterEach(() => { vi.useRealTimers();vi.unstubAllGlobals(); vi.resetModules(); });
const formUrl = 'https://docs.google.com/forms/d/e/test-form/viewform';
async function setup(sidePanel?: object) {
  let clicked: (tab: { id: number; url: string }) => void;
  let message: (msg: ExtensionMessage, sender: object, respond: (value: unknown) => void) => void;
  let updated:(id:number,change:object,tab:object)=>void;
  let alarm:(alarm:{name:string})=>void;
  const data: Record<string, unknown> = {};
  const create = vi.fn(async () => ({}));
  const sendMessage = vi.fn(async (_id?:number,_message?:any) => ({ ok: true }));
  vi.stubGlobal('chrome', {
    alarms: {create:vi.fn(),clear:vi.fn(async()=>true),onAlarm:{addListener:(fn:typeof alarm)=>alarm=fn}},
    sidePanel,
    action: { onClicked: { addListener: (fn: typeof clicked) => { clicked = fn; } } },
    windows: { create },
    tabs: {
      get: vi.fn(async (id: number) => ({ id, url: formUrl })),
      query: vi.fn(async () => [{ id: 99 }]), sendMessage,
      onUpdated: { addListener: (fn:typeof updated)=>updated=fn }, onRemoved: { addListener: vi.fn() }
    },
    runtime: {
      getURL: (path: string) => `chrome-extension://test/${path}`,
      sendMessage: vi.fn(async () => ({})),
      onMessage: { addListener: (fn: typeof message) => { message = fn; } }
    },
    storage: { local: {
      get: vi.fn(async (key: string) => ({ [key]: data[key] })),
      set: vi.fn(async (value: object) => { Object.assign(data, value); }),
      remove: vi.fn(async () => {})
    } }
  });
  await import('../src/background');
  const ask = (msg: ExtensionMessage, sender = {}) => new Promise<unknown>(resolve => message(msg, sender, resolve));
  const run: RunState = { tabId: 7, formId: 'test-form', mode: 'test', status: 'waiting_manual', filled: [], skipped: [], logs: [], submitAttempted: false, updatedAt: '' };
  data['run:7'] = run;
  return { click: () => clicked({ id: 7, url: formUrl }), alarm:(name:string)=>alarm({name}),updated:(change:object)=>updated(7,change,{url:formUrl}),create, ask, data, run, sendMessage };
}

it('detects a document that stays loading after the original content script disappears',async()=>{
  vi.useFakeTimers();const f=await setup();Object.assign(f.run,{runId:'loading',contentEpoch:'old',status:'running'});
  vi.mocked(chrome.tabs.get).mockResolvedValue({id:7,url:formUrl,status:'loading'} as any);
  f.updated({status:'loading'});await vi.advanceTimersByTimeAsync(5000);
  expect(f.data['run:7']).toMatchObject({status:'running',activity:{phase:'navigating'}});
  await vi.advanceTimersByTimeAsync(20000);
  expect(f.data['run:7']).toMatchObject({status:'waiting_manual',blockingIssue:{reason:'navigation'},recovery:{attempt:1,automatic:true}});
  expect(chrome.tabs.reload).toBeUndefined();await f.ask({type:'STOP_RUN',tabId:7});
});
it.each(['stop','new-document'] as const)('cancels the predecessor watchdog after %s',async action=>{
  vi.useFakeTimers();const f=await setup();Object.assign(f.run,{runId:'loading',contentEpoch:'old',status:'running'});
  vi.mocked(chrome.tabs.get).mockResolvedValue({id:7,url:formUrl,status:'loading'} as any);
  f.updated({status:'loading'});await vi.advanceTimersByTimeAsync(5000);
  if(action==='stop')await f.ask({type:'STOP_RUN',tabId:7});
  else await f.ask({type:'CLAIM_DOCUMENT',epoch:'new'}, {tab:{id:7,url:formUrl},url:formUrl});
  await vi.advanceTimersByTimeAsync(30000);
  expect(f.data['run:7']).toMatchObject({status:action==='stop'?'idle':'running'});expect((f.data['run:7'] as RunState).recovery).toBeUndefined();
});
it('keeps an uncertain submit locked when the response document hangs',async()=>{
  vi.useFakeTimers();const f=await setup();Object.assign(f.run,{runId:'sending',contentEpoch:'old',status:'submitting',submitAttempted:true});
  vi.mocked(chrome.tabs.get).mockResolvedValue({id:7,url:formUrl,status:'loading'} as any);
  f.updated({status:'loading'});await vi.advanceTimersByTimeAsync(25000);
  expect(f.data['run:7']).toMatchObject({status:'submit_uncertain',submitAttempted:true,blockingIssue:{reason:'submit_uncertain'}});
  expect((f.data['run:7'] as RunState).recovery?.automatic).not.toBe(true);
});
it('acknowledges a durable Stop even if the renderer never answers HALT, and rejects its late navigation event',async()=>{
  vi.useFakeTimers();const f=await setup();Object.assign(f.run,{runId:'frozen',contentEpoch:'old',status:'running'});
  f.sendMessage.mockImplementation(async(_id,m:any)=>m.type==='HALT_RUN'?new Promise<{ok:boolean}>(()=>{}):{ok:true});
  const stopped=f.ask({type:'STOP_RUN',tabId:7});await vi.advanceTimersByTimeAsync(500);
  await expect(stopped).resolves.toMatchObject({status:'idle'});
  await expect(f.ask({type:'FORM_EVENT',runId:'frozen',epoch:'old',event:{type:'activity',phase:'navigating',message:'late Next'}},{tab:{id:7,url:formUrl},url:formUrl})).resolves.toMatchObject({ok:false});
});
it('rechecks the current upload on Resume instead of skipping an old blocked file card',async()=>{
  const f=await setup();Object.assign(f.run,{runId:'reload-upload',contentEpoch:'new',blockingIssue:{reason:'file_upload',questionId:'photo',message:'Upload failed'}});
  await expect(f.ask({type:'RESUME_RUN',tabId:7})).resolves.toMatchObject({status:'running'});
  expect(f.sendMessage).toHaveBeenCalledWith(7,expect.objectContaining({type:'RUN_CURRENT_PAGE',skipQuestionId:undefined}));
});

it('uses action behavior on Chrome 114/115 without calling missing sidePanel.open', async () => {
  const setPanelBehavior = vi.fn(async () => {});
  const fixture = await setup({ setPanelBehavior });
  fixture.click();
  expect(setPanelBehavior).toHaveBeenCalledWith({ openPanelOnActionClick: true });
  expect(fixture.create).not.toHaveBeenCalled();
});

it('opens a controller bound to the original form tab when Side Panel is unavailable', async () => {
  const fixture = await setup();
  fixture.click();
  await vi.waitFor(()=>expect(fixture.create).toHaveBeenCalledWith(expect.objectContaining({ url: 'chrome-extension://test/sidepanel.html?tabId=7', type: 'popup' })));
  expect(await fixture.ask({ type: 'GET_PANEL_STATE', tabId: 7 })).toEqual(expect.objectContaining({ tabId: 7 }));
});

it('does not resurrect a correction wait from a late progress event', async () => {
  const fixture = await setup();
  await fixture.ask({ type: 'FORM_EVENT', event: { type: 'progress', message: 'Manual completion' } }, { tab: { id: 7, url:formUrl } });
  expect(fixture.data['run:7']).toEqual(expect.objectContaining({ status: 'waiting_manual' }));
});

it('does not resume a paused run from a late progress event', async () => {
  const fixture = await setup();
  fixture.run.status = 'paused';
  await fixture.ask({ type: 'FORM_EVENT', event: { type: 'progress', message: 'Late message' } }, { tab: { id: 7, url:formUrl } });
  expect(fixture.data['run:7']).toEqual(expect.objectContaining({ status: 'paused' }));
});

it('keeps navigation claims and progress responsive when a panel notification never replies', async () => {
  const fixture = await setup();
  fixture.run.status = 'running';
  vi.mocked(chrome.runtime.sendMessage).mockImplementation(() => new Promise(() => {}) as any);
  const sender = { tab: { id: 7, url: formUrl }, url: formUrl, frameId: 0 };
  await expect(fixture.ask({ type: 'CLAIM_DOCUMENT', epoch: 'next-page' }, sender)).resolves.toMatchObject({ ok: true,run:{status:'running',contentEpoch:'next-page'} });
  await expect(fixture.ask({ type: 'GET_RUN_FOR_TAB' }, sender)).resolves.toMatchObject({ status: 'running', contentEpoch: 'next-page' });
  await expect(fixture.ask({ type: 'FORM_EVENT', event: { type: 'progress', message: 'Next page filled' } }, sender)).resolves.toEqual({ ok: true });
  expect(fixture.data['run:7']).toMatchObject({ logs: [expect.objectContaining({ message: 'Next page filled' })] });
});

it('clears a stopped pre-submit error so a fresh run is available',async()=>{
  const fixture=await setup();
  fixture.run.blockingIssue={reason:'unsupported',message:'Old validation error'};
  await fixture.ask({type:'STOP_RUN',tabId:7});
  expect(fixture.data['run:7']).toMatchObject({status:'idle',blockingIssue:undefined});
});

it('does not reuse a running session on a different form in the same tab', async () => {
  const fixture = await setup();
  fixture.run.status = 'running';
  expect(await fixture.ask({ type: 'GET_RUN_FOR_TAB' }, { tab: { id: 7, url: formUrl.replace('test-form', 'other-form') } })).toBeUndefined();
  expect(await fixture.ask({ type: 'GET_RUN_FOR_TAB' }, { tab: { id: 7, url: formUrl } })).toEqual(fixture.run);
});

it('keeps a transient retry scoped and lets Stop cancel it immediately',async()=>{
  const f=await setup();f.run.status='running';f.run.runId='retry';f.run.contentEpoch='page';
  const sender={tab:{id:7,url:formUrl},url:formUrl};
  await f.ask({type:'FORM_EVENT',runId:'retry',epoch:'page',event:{type:'transient_error',reason:'server_error',message:'503 Service Unavailable'}},sender);
  expect(f.data['run:7']).toMatchObject({status:'waiting_manual',recovery:{attempt:1,automatic:true},activity:{phase:'retrying'}});
  await f.ask({type:'STOP_RUN',tabId:7});
  expect(f.data['run:7']).toMatchObject({status:'idle',recovery:{automatic:false}});
  await f.ask({type:'FORM_EVENT',runId:'retry',epoch:'page',event:{type:'progress',message:'late callback'}},sender);
  expect(f.data['run:7']).toMatchObject({status:'idle'});
});
it('never schedules a reload after a send reservation has been persisted',async()=>{
  const f=await setup();Object.assign(f.run,{status:'submitting',submitAttempted:true});
  await f.ask({type:'FORM_EVENT',event:{type:'transient_error',reason:'server_error',message:'500'}},{tab:{id:7,url:formUrl},url:formUrl});
  expect(f.data['run:7']).toMatchObject({status:'submit_uncertain',submitAttempted:true,blockingIssue:{reason:'submit_uncertain'}});
  expect((f.data['run:7'] as RunState).recovery).toBeUndefined();
});

it('rearms an early recovery alarm instead of losing the last allowed retry',async()=>{
  vi.useFakeTimers();const f=await setup();
  Object.assign(f.run,{runId:'early-retry',contentEpoch:'error-page',url:formUrl,
    blockingIssue:{reason:'server_error',message:'429'},
    recovery:{reason:'server_error',attempt:3,automatic:true,retryAt:new Date(Date.now()+10).toISOString()}});
  f.data.managedRun=f.run;
  f.alarm('hanu-recovery:early-retry');await vi.advanceTimersByTimeAsync(0);
  expect(chrome.alarms.create).toHaveBeenCalledWith('hanu-recovery:early-retry',expect.any(Object));
  expect(f.sendMessage.mock.calls.some(([,m])=>m?.type==='RUN_CURRENT_PAGE')).toBe(false);
  await vi.advanceTimersByTimeAsync(20);
  expect(f.data['run:7']).toMatchObject({status:'running'});
});

it('a Stop still cancels a retry that was rearmed after an early wake',async()=>{
  vi.useFakeTimers();const f=await setup();
  Object.assign(f.run,{runId:'early-stop',contentEpoch:'error-page',url:formUrl,
    blockingIssue:{reason:'server_error',message:'429'},
    recovery:{reason:'server_error',attempt:3,automatic:true,retryAt:new Date(Date.now()+10).toISOString()}});
  f.data.managedRun=f.run;
  f.alarm('hanu-recovery:early-stop');await vi.advanceTimersByTimeAsync(0);
  await f.ask({type:'STOP_RUN',tabId:7});await vi.advanceTimersByTimeAsync(100);
  expect(f.data['run:7']).toMatchObject({status:'idle',recovery:{automatic:false}});
  expect(f.sendMessage.mock.calls.some(([,m])=>m?.type==='RUN_CURRENT_PAGE')).toBe(false);
});
it('checkpoints a valid manual answer in its run while rejecting stale document events',async()=>{
  const f=await setup();f.run.runId='manual';f.run.contentEpoch='new-page';
  const event={type:'corrections' as const,answers:{phone:{label:'Phone',kind:'text' as const,values:['0911111111']}}},sender={tab:{id:7,url:formUrl},url:formUrl};
  expect(await f.ask({type:'FORM_EVENT',runId:'manual',epoch:'old-page',event},sender)).toMatchObject({ok:false});
  await f.ask({type:'FORM_EVENT',runId:'manual',epoch:'new-page',event},sender);
  expect(f.data['run:7']).toMatchObject({status:'waiting_manual',corrections:event.answers});
  expect(f.data.profile).toBeUndefined();
});
