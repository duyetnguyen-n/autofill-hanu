import { afterEach, expect, it, vi } from 'vitest';
import { WebSocket } from 'ws';
import { CloudRepository, CloudError } from '../../manager/cloud/postgres-store';
import { serveCloud } from '../../manager/cloud/main';
import { httpFixture, extension, users } from './fixture';

const cleanups: (() => Promise<void>)[] = [];
afterEach(async () => { for (const close of cleanups.splice(0).reverse()) await close(); vi.restoreAllMocks(); });
async function setup() { const f = await httpFixture(); cleanups.push(f.close); return f; }
async function replacement(f: Awaited<ReturnType<typeof setup>>) {
  const config = { ...f.config, rollingDeploy: true };
  const repository = new CloudRepository(f.pool, f.objects, crypto.randomUUID());
  const app = await serveCloud({ config, repository, auth: f.auth, port: 0 });
  config.origin = `http://127.0.0.1:${(app.server.address() as { port: number }).port}`;
  cleanups.push(app.close);
  const get = (path: string) => fetch(config.origin + path, { headers: { Cookie: 'test-account=account-a' } });
  return { app, config, repository, get };
}
async function rejectedUpgrade(origin: string) {
  const ws = new WebSocket(origin.replace('http:', 'ws:') + '/extensions');
  return new Promise<Error>(resolve => ws.once('error', resolve));
}

it('keeps the old coordinator exclusive, then accepts the same profile token after it stops', async () => {
  const f = await setup(), paired = await f.pair();
  const before = (await f.pool.query('SELECT data FROM hanu.sessions')).rows;
  const next = await replacement(f);
  expect(await (await next.get('/healthz')).json()).toEqual({ ok: true, coordinator: 'waiting' });
  expect((await next.get('/readyz')).status).toBe(503);
  const state = await next.get('/api/state');
  expect(state.status).toBe(503); expect(state.headers.get('retry-after')).toBe('2');
  expect((await state.json()).error).toContain('không cần liên kết lại');
  expect((await rejectedUpgrade(next.config.origin)).message).toContain('503');
  // Another retry must neither recover the old sessions nor renew its lease.
  const recover = vi.spyOn(next.repository, 'recover'), renew = vi.spyOn(next.repository, 'renewLease');
  await new Promise(resolve => setTimeout(resolve, 2200));
  expect(recover).not.toHaveBeenCalled(); expect(renew).not.toHaveBeenCalled();
  expect((await f.pool.query('SELECT data FROM hanu.sessions')).rows).toEqual(before);
  expect((await f.pool.query('SELECT instance FROM hanu.server_lease')).rows[0].instance).toBe(f.repository.instance);
  expect((await f.api('state')).status).toBe(200);

  await f.app.close();
  await expect.poll(async () => (await next.get('/readyz')).status, { timeout: 5000 }).toBe(200);
  expect(recover).toHaveBeenCalledTimes(1);
  expect(await (await next.get('/healthz')).json()).toEqual({ ok: true });
  await expect(f.repository.renewLease()).rejects.toThrow('mất quyền');
  expect((await next.repository.store(users[0]).session(paired.sessionId)).connected).toBe(false);
  const ws = new WebSocket(next.config.origin.replace('http:', 'ws:') + '/extensions', { headers: { Origin: `chrome-extension://${extension}` } });
  cleanups.push(async () => { ws.terminate(); });
  const messages: any[] = [];
  ws.on('message', raw => {
    const m = JSON.parse(raw.toString()); messages.push(m);
    if (m.type === 'COMMAND') ws.send(JSON.stringify({ protocol: 1, sessionId: paired.sessionId, type: 'RESULT', commandId: m.commandId, ok: true,
      result: { profile: { values: {}, mappings: {}, customFields: [], attachments: {} }, revision: 0 } }));
  });
  await new Promise<void>((resolve, reject) => { ws.once('open', resolve); ws.once('error', reject); });
  ws.send(JSON.stringify({ type: 'HELLO', protocol: 1, transport: 'cloud', extensionId: extension, sessionId: paired.sessionId, token: paired.token }));
  await expect.poll(() => messages.some(m => m.type === 'WELCOME' && m.sessionId === paired.sessionId)).toBe(true);
}, 20000);

it('closing a waiting replacement leaves the active lease and profiles untouched', async () => {
  const f = await setup(); await f.pair();
  const before = (await f.pool.query('SELECT data FROM hanu.sessions')).rows;
  const next = await replacement(f);
  const claim = vi.spyOn(next.repository, 'claimLease');
  await next.app.close();
  await new Promise(resolve => setTimeout(resolve, 2100));
  expect(claim).not.toHaveBeenCalled();
  await f.repository.renewLease();
  expect((await f.pool.query('SELECT data FROM hanu.sessions')).rows).toEqual(before);
}, 15000);

it('does not hide database errors as a rolling deploy or wait outside Render', async () => {
  const f = await setup(), repository = new CloudRepository(f.pool, f.objects, crypto.randomUUID());
  await expect(serveCloud({ config: f.config, repository, auth: f.auth, port: 0 })).rejects.toThrow('server quản lý khác');
  vi.spyOn(repository, 'claimLease').mockRejectedValue(new CloudError('Database unavailable', 503));
  await expect(serveCloud({ config: { ...f.config, rollingDeploy: true }, repository, auth: f.auth, port: 0 })).rejects.toThrow('Database unavailable');
}, 15000);

it('releases a claim that finishes during shutdown and never reactivates the closing instance', async () => {
  const f = await setup(), next = await replacement(f);
  await f.app.close();
  const claim = next.repository.claimLease.bind(next.repository);
  let finish!: () => void, entered!: () => void;
  const gate = new Promise<void>(resolve => { finish = resolve; });
  const started = new Promise<void>(resolve => { entered = resolve; });
  vi.spyOn(next.repository, 'claimLease').mockImplementation(async () => { entered(); await gate; await claim(); });
  await started;
  const closing = next.app.close();
  finish(); await closing;
  expect((await f.pool.query('SELECT instance FROM hanu.server_lease')).rows).toEqual([]);
}, 15000);

it('fails closed on a database failure during retry instead of becoming coordinator-ready', async () => {
  const f = await setup(), next = await replacement(f);
  vi.spyOn(next.repository, 'claimLease').mockRejectedValue(new Error('private database details'));
  await expect.poll(async () => (await next.get('/healthz')).status, { timeout: 5000 }).toBe(503);
  expect((await next.get('/readyz')).status).toBe(503);
  expect((await rejectedUpgrade(next.config.origin)).message).toContain('503');
  expect((await f.pool.query('SELECT instance FROM hanu.server_lease')).rows[0].instance).toBe(f.repository.instance);
}, 15000);
