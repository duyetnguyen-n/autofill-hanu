import { afterEach, expect, it, vi } from 'vitest';
import { StoredPickerUploads } from '../src/stored-picker-upload';

const stores: StoredPickerUploads[] = [];
afterEach(() => { for (const store of stores.splice(0)) for (const tab of [1, 2]) store.cancel(tab); vi.unstubAllGlobals(); vi.useRealTimers(); });
function setup() {
  const store = new StoredPickerUploads(); stores.push(store);
  const executeScript = vi.fn(async (request: any): Promise<any[]> => [{
    documentId: 'document-a', frameId: 4,
    result: { state: request.args[0].dataUrl ? 'assigned' : 'waiting' }
  }]);
  vi.stubGlobal('chrome', { scripting: { executeScript } });
  const scope = {
    tabId: 1, key: 'run-a/epoch-a/request-a/image-a', runId: 'run-a', epoch: 'epoch-a',
    pickerUrl: 'https://docs.google.com/picker?hostId=file-upload&rpcService=rpc-a&rpctoken=token-a',
    requestId: 'request-a', name: 'correct.png', type: 'image/png',
    assertActive: vi.fn(async () => {}),
    prepare: vi.fn(async () => ({ dataUrl: 'data:image/png;base64,AQID', readMs: 1, encodeMs: 2 }))
  };
  const ready = () => executeScript.mockImplementation(async (request: any) => [{
    documentId: 'document-a', frameId: 4, result: { state: request.args[0].dataUrl || request.args[0].checkOnly ? 'assigned' : 'ready' }
  }]);
  return { store, scope, executeScript, ready };
}

it('starts one preparation while Picker waits and never fans image bytes out', async () => {
  const f = setup();
  expect(await f.store.upload(f.scope)).toEqual({ state: 'waiting' });
  expect(f.scope.prepare).toHaveBeenCalledTimes(1);
  expect(await f.store.upload(f.scope)).toEqual({ state: 'waiting' });
  expect(f.scope.prepare).toHaveBeenCalledTimes(1);
  expect(f.executeScript.mock.calls.every(([r]) => !r.args[0].dataUrl)).toBe(true);
  f.ready();
  expect(await f.store.upload(f.scope)).toMatchObject({ state: 'assigned', timing: { readMs: 1, encodeMs: 2 } });
  const handoffs = f.executeScript.mock.calls.filter(([r]) => r.args[0].dataUrl);
  expect(handoffs).toHaveLength(1);
  expect(handoffs[0][0].target).toEqual({ tabId: 1, documentIds: ['document-a'] });
  expect(f.executeScript.mock.calls[0][0].target).toEqual({ tabId: 1, allFrames: true });
});

it('keeps startup polling responsive while the file read is stalled', async () => {
  const f = setup();
  let finish!: (v: any) => void;
  f.scope.prepare.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
  expect(await f.store.upload(f.scope)).toEqual({ state: 'waiting' });
  expect(await f.store.upload(f.scope)).toEqual({ state: 'waiting' });
  f.ready();
  let returned = false;
  const assignment = f.store.upload(f.scope).then(result => { returned = true; return result; });
  await Promise.resolve(); await Promise.resolve();
  expect(returned).toBe(false);
  finish({ dataUrl: 'data:image/png;base64,AQID', readMs: 1000, encodeMs: 1 });
  expect(await assignment).toMatchObject({ state: 'assigned' });
  expect(f.scope.prepare).toHaveBeenCalledTimes(1);
});

it('Stop discards a delayed preparation without handing bytes over', async () => {
  const f = setup();
  let finish!: (v: any) => void;
  f.scope.prepare.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
  await f.store.upload(f.scope); f.ready();
  const assignment = f.store.upload(f.scope);
  await Promise.resolve(); await Promise.resolve();
  f.store.cancel(1);
  finish({ dataUrl: 'data:image/png;base64,AQID', readMs: 1000, encodeMs: 1 });
  await expect(assignment).rejects.toThrow('hủy');
  expect(f.executeScript.mock.calls.some(([r]) => r.args[0].dataUrl)).toBe(false);
});

it.each(['paused', 'idle', 'waiting_manual', 'completed'])('drops preparation on %s', async status => {
  const f = setup(); await f.store.upload(f.scope);
  f.store.reconcile(1, { runId: 'run-a', contentEpoch: 'epoch-a', status });
  f.ready(); await f.store.upload({ ...f.scope, key: 'run-b/epoch-b/request-b/image-b', runId: 'run-b', epoch: 'epoch-b' });
  expect(f.scope.prepare).toHaveBeenCalledTimes(2);
});

it('a new epoch never inherits prepared bytes from the previous document', async () => {
  const f = setup(); await f.store.upload(f.scope);
  f.store.reconcile(1, { runId: 'run-a', contentEpoch: 'epoch-b', status: 'running' });
  f.ready(); await f.store.upload({ ...f.scope, key: 'run-a/epoch-b/request-b/image-a', epoch: 'epoch-b' });
  expect(f.scope.prepare).toHaveBeenCalledTimes(2);
});

it('rejects multiple matching Picker documents before reading the photo', async () => {
  const f = setup();
  f.executeScript.mockResolvedValue(['a','b'].map(documentId => ({ documentId, frameId: 2, result: { state: 'ready' } })));
  expect(await f.store.upload(f.scope)).toMatchObject({ state: 'error' });
  expect(f.scope.prepare).not.toHaveBeenCalled();
});

it('does not fall back to a frameId when document identity is unavailable', async () => {
  const f = setup(); f.executeScript.mockResolvedValue([{ frameId: 4, result: { state: 'ready' } }]);
  expect(await f.store.upload(f.scope)).toMatchObject({ state: 'error' });
  expect(f.scope.prepare).not.toHaveBeenCalled();
});

it('rediscovers a provisional document before handoff without reading the photo twice', async () => {
  const f = setup(); await f.store.upload(f.scope);
  f.executeScript.mockRejectedValueOnce(new Error('Document removed'));
  f.executeScript.mockImplementation(async (r: any) => [{ frameId: 4, documentId: 'document-b', result: { state: r.args[0].dataUrl ? 'assigned' : 'ready' } }]);
  expect(await f.store.upload(f.scope)).toMatchObject({ state: 'assigned' });
  expect(f.scope.prepare).toHaveBeenCalledTimes(1);
  expect(f.executeScript.mock.calls.find(([r]) => r.args[0].dataUrl)?.[0].target).toEqual({ tabId: 1, documentIds: ['document-b'] });
});

it('does not rediscover or hand off twice if the assigned document disappears', async () => {
  const f = setup(); f.ready(); await f.store.upload(f.scope);
  const calls = f.executeScript.mock.calls.length;
  f.executeScript.mockRejectedValueOnce(new Error('Document removed'));
  expect(await f.store.upload({ ...f.scope, checkOnly: true })).toEqual({ state: 'waiting' });
  expect(f.executeScript.mock.calls).toHaveLength(calls + 1);
  expect(f.executeScript.mock.calls.filter(([r]) => r.args[0].dataUrl)).toHaveLength(1);
});

it('a lost handoff reply is terminal and cannot automatically dispatch a second file', async () => {
  const f = setup(); f.ready();
  f.executeScript.mockImplementation(async (r: any) => {
    if (r.args[0].dataUrl) throw new Error('Reply lost after dispatch');
    return [{ frameId: 4, documentId: 'document-a', result: { state: 'ready' } }];
  });
  expect(await f.store.upload(f.scope)).toMatchObject({ state: 'error' });
  expect(await f.store.upload(f.scope)).toMatchObject({ state: 'error' });
  expect(await f.store.upload({ ...f.scope, checkOnly: true })).toMatchObject({ state: 'error' });
  expect(f.executeScript.mock.calls.filter(([r]) => r.args[0].dataUrl)).toHaveLength(1);
});

it('can wait for a replacement input in the same document only when helper proves no assignment', async () => {
  const f = setup(); f.ready(); let handoffs = 0;
  f.executeScript.mockImplementation(async (r: any) => [{ frameId: 4, documentId: 'document-a', result: {
    state: r.args[0].dataUrl ? (++handoffs === 1 ? 'waiting' : 'assigned') : 'ready'
  } }]);
  expect(await f.store.upload(f.scope)).toEqual({ state: 'waiting' });
  expect(await f.store.upload(f.scope)).toMatchObject({ state: 'assigned' });
  expect(f.scope.prepare).toHaveBeenCalledTimes(1);
});

it('status-only polls and already assigned requests never read files', async () => {
  const f = setup(); f.ready();
  expect(await f.store.upload({ ...f.scope, checkOnly: true })).toEqual({ state: 'assigned' });
  f.executeScript.mockResolvedValue([{ frameId: 4, documentId: 'document-a', result: { state: 'assigned' } }]);
  expect(await f.store.upload(f.scope)).toEqual({ state: 'assigned' });
  expect(f.scope.prepare).not.toHaveBeenCalled();
});

it('retains a preparation error without unhandled rejection or rereading on each poll', async () => {
  const f = setup(); f.scope.prepare.mockRejectedValueOnce(new Error('missing photo'));
  await f.store.upload(f.scope); f.ready();
  expect(await f.store.upload(f.scope)).toMatchObject({ state: 'error', error: 'missing photo' });
  expect(await f.store.upload(f.scope)).toMatchObject({ state: 'error' });
  expect(f.scope.prepare).toHaveBeenCalledTimes(1);
});

it('bounds a stalled file preparation while waiting for Google', async () => {
  vi.useFakeTimers(); const f = setup(); f.scope.prepare.mockImplementationOnce(() => new Promise(() => {})); await f.store.upload(f.scope);
  await vi.advanceTimersByTimeAsync(20001); f.ready();
  expect(await f.store.upload(f.scope)).toMatchObject({ state: 'error' });
  expect(f.executeScript.mock.calls.some(([r]) => r.args[0].dataUrl)).toBe(false);
});

it('keeps different tabs and their exact bytes isolated', async () => {
  const f = setup(); f.ready();
  f.executeScript.mockImplementation(async (r: any) => [{ frameId: 4, documentId: `doc-${r.target.tabId}`, result: { state: r.args[0].dataUrl ? 'assigned' : 'ready' } }]);
  const other = { ...f.scope, tabId: 2, key: 'run-b/epoch-b/image-b', prepare: vi.fn(async () => ({ dataUrl: 'data:image/png;base64,BAUG', readMs: 0, encodeMs: 0 })) };
  await Promise.all([f.store.upload(f.scope), f.store.upload(other)]);
  const sent = f.executeScript.mock.calls.filter(([r]) => r.args[0].dataUrl).map(([r]) => [r.target.tabId, r.target.documentIds[0], r.args[0].dataUrl]);
  expect(sent).toEqual(expect.arrayContaining([[1,'doc-1','data:image/png;base64,AQID'],[2,'doc-2','data:image/png;base64,BAUG']]));
});

it('probes loading frames immediately instead of waiting for unrelated document_idle', async () => {
  const f=setup();await f.store.upload(f.scope);
  expect(f.executeScript.mock.calls[0][0].injectImmediately).toBe(true);
});
it('a prepared photo survives slow Picker initialization and remains single-use', async () => {
  vi.useFakeTimers();const f=setup();await f.store.upload(f.scope);
  await vi.advanceTimersByTimeAsync(21000);f.ready();
  expect(await f.store.upload(f.scope)).toMatchObject({state:'assigned'});
  expect(f.scope.prepare).toHaveBeenCalledTimes(1);
});
