import { afterEach, expect, it, vi } from 'vitest';
import type { ExtensionMessage, RunState } from '../src/shared';

afterEach(() => { vi.unstubAllGlobals(); vi.resetModules(); });
const formUrl = 'https://docs.google.com/forms/d/e/test-form/viewform';
async function setup(sidePanel?: object) {
  let clicked: (tab: { id: number; url: string }) => void;
  let message: (msg: ExtensionMessage, sender: object, respond: (value: unknown) => void) => void;
  const data: Record<string, unknown> = {};
  const create = vi.fn(async () => ({}));
  const sendMessage = vi.fn(async () => ({ ok: true }));
  vi.stubGlobal('chrome', {
    sidePanel,
    action: { onClicked: { addListener: (fn: typeof clicked) => { clicked = fn; } } },
    windows: { create },
    tabs: {
      get: vi.fn(async (id: number) => ({ id, url: formUrl })),
      query: vi.fn(async () => [{ id: 99 }]), sendMessage,
      onUpdated: { addListener: vi.fn() }, onRemoved: { addListener: vi.fn() }
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
  return { click: () => clicked({ id: 7, url: formUrl }), create, ask, data, run, sendMessage };
}

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

it('persists running before resuming after manual completion', async () => {
  const fixture = await setup();
  await fixture.ask({ type: 'FORM_EVENT', event: { type: 'progress', message: 'Manual completion' } }, { tab: { id: 7, url:formUrl } });
  expect(fixture.data['run:7']).toEqual(expect.objectContaining({ status: 'running' }));
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
