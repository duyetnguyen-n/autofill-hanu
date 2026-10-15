import { afterEach, expect, it } from 'vitest';
import { WebSocket } from 'ws';
import { Accounts } from '../../manager/cloud/accounts';
import { requireAccount } from '../../manager/cloud/access-policy';
import { Coordinator } from '../../manager/server/coordinator';
import { databaseFixture, httpFixture, users, extension } from './fixture';
import type { WebUser } from '../../manager/cloud/auth';

const cleanup: (() => Promise<void>)[] = [];
afterEach(async () => { for (const close of cleanup.splice(0).reverse()) await close(); });
async function database() { const f = await databaseFixture(); cleanup.push(f.close); return f; }
async function http() { const f = await httpFixture(); cleanup.push(f.close); await f.pool.query("UPDATE hanu.accounts SET role='admin' WHERE user_id=$1", [users[0]]); return f; }
function identity(index = 0, verified = true): WebUser { return { id: users[index], email: index ? 'binh@example.test' : 'an@example.test', name: index ? 'Bình' : 'An', emailVerified: verified, sessionKey: `new-session-${index}`, expiresAt: Date.now() + 3600000 }; }
const profile = { contactName: 'Bình Nguyễn', phone: '0902345678', purpose: 'Chuẩn bị hồ sơ HSK cho học viên', consent: true };
const permissions = { status: 'active', maxProfiles: 5, maxConcurrent: 2, liveEnabled: true, expiresAt: null, adminNote: 'Đã xác nhận người dùng' };
async function update(f: Awaited<ReturnType<typeof http>>, changes: object = {}) {
  const detail = await (await f.api(`admin/accounts/${users[1]}`)).json();
  return f.api(`admin/accounts/${users[1]}`, 0, { ...permissions, version: detail.account.version, ...changes }, 'PATCH');
}
async function connect(origin: string, path: string, hello: object) {
  const ws = new WebSocket(origin.replace('http:', 'ws:') + path, { headers: { Origin: path === '/events' ? origin : `chrome-extension://${extension}` } });
  const messages: any[] = []; ws.on('message', raw => {
    const m = JSON.parse(raw.toString()); messages.push(m);
    if (m.type === 'COMMAND') ws.send(JSON.stringify({ type: 'RESULT', protocol: 1, sessionId: m.sessionId, commandId: m.commandId, ok: true, result: { profile: { values: {}, mappings: {}, customFields: [], attachments: {} }, revision: 0 } }));
  });
  cleanup.push(async () => { if (ws.readyState !== WebSocket.CLOSED) { const done = new Promise<void>(resolve => ws.once('close', () => resolve())); ws.terminate(); await done; } });
  await new Promise<void>((resolve, reject) => { ws.once('open', resolve); ws.once('error', reject); });
  ws.send(JSON.stringify(hello));
  return { ws, messages };
}

it('creates pending users, keeps approval server-owned, and requires a verified, complete profile', async () => {
  const f = await http();
  await f.pool.query('DELETE FROM hanu.accounts WHERE user_id=$1', [users[1]]);
  const me = await (await f.api('auth/me', 1)).json();
  expect(me).toMatchObject({ status: 'pending', role: 'member', profileComplete: false, emailVerified: true });
  expect(me).not.toHaveProperty('sessionKey'); expect(me).not.toHaveProperty('adminNote');
  expect((await f.api('state', 1)).status).toBe(403);
  expect((await f.api('pair', 1, {})).status).toBe(403);
  expect((await f.api('admin/accounts', 1)).status).toBe(403);
  expect((await f.api('account', 1, { ...profile, role: 'admin', status: 'active' }, 'PATCH')).status).toBe(400);
  expect((await f.api('account', 1, { ...profile, consent: false }, 'PATCH')).status).toBe(400);
  expect((await f.api('account', 1, profile, 'PATCH')).status).toBe(200);
  expect((await f.api('state', 1)).status).toBe(403);
  expect((await update(f)).status).toBe(200);
  expect((await f.api('state', 1)).status).toBe(200);
  const events = await (await f.api('admin/events')).json();
  expect(events).toContainEqual(expect.objectContaining({ action: 'update_access', targetEmail: 'binh@example.test', actorEmail: 'an@example.test' }));
}, 20000);

it('bootstraps only the configured verified Google email; later logins preserve admin edits', async () => {
  const f = await database(); await f.pool.query('DELETE FROM hanu.accounts');
  const accounts = new Accounts(f.pool, 'an@example.test');
  expect(await accounts.identify(identity(1))).toMatchObject({ role: 'member', status: 'pending' });
  expect(await accounts.identify(identity(0, false))).toMatchObject({ role: 'member', emailVerified: false });
  expect(await accounts.identify(identity(0))).toMatchObject({ role: 'admin', status: 'active' });
  await f.pool.query("UPDATE hanu.accounts SET status='blocked' WHERE user_id=$1", [users[0]]);
  expect(await accounts.identify({ ...identity(0), sessionKey: 'later-session' })).toMatchObject({ role: 'admin', status: 'blocked' });
  const anotherBootstrap = new Accounts(f.pool, 'binh@example.test');
  expect(await anotherBootstrap.identify({ ...identity(1), sessionKey: 'later-session' })).toMatchObject({ role: 'member' });
}, 20000);

it('consumes pre-approvals only on a verified first login and never reactivates a blocked member', async () => {
  const f = await http(); await f.pool.query('DELETE FROM hanu.accounts WHERE user_id=$1', [users[1]]);
  const grant = { email: 'BINH@example.test', maxProfiles: 8, maxConcurrent: 4, liveEnabled: false, expiresAt: null };
  expect((await f.api('admin/grants', 0, grant)).status).toBe(201);
  const accounts = new Accounts(f.pool);
  expect(await accounts.identify(identity(1))).toMatchObject({ status: 'active', maxProfiles: 8, maxConcurrent: 4, profileComplete: false });
  expect(await accounts.grants()).toEqual([]);
  await expect(requireAccount(f.pool, users[1])).rejects.toMatchObject({ status: 403 });
  await accounts.profile(users[1], profile);
  expect(await requireAccount(f.pool, users[1])).toMatchObject({ status: 'active' });
  await f.pool.query("UPDATE hanu.accounts SET status='blocked' WHERE user_id=$1", [users[1]]);
  expect((await f.api('admin/grants', 0, grant)).status).toBe(409);
  expect(await accounts.identify({ ...identity(1), sessionKey: 'returning' })).toMatchObject({ status: 'blocked' });
});

it('preserves a pre-approval when an unverified first login occurs', async () => {
  const f = await http(); await f.pool.query('DELETE FROM hanu.accounts WHERE user_id=$1', [users[1]]);
  expect((await f.api('admin/grants', 0, { email: 'binh@example.test', maxProfiles: 5, maxConcurrent: 2, liveEnabled: false, expiresAt: null })).status).toBe(201);
  const accounts = new Accounts(f.pool);
  expect(await accounts.identify(identity(1, false))).toMatchObject({ status: 'pending' });
  expect(await accounts.grants()).toHaveLength(1);
  expect(await accounts.identify(identity(1))).toMatchObject({ status: 'active' });
  expect(await accounts.grants()).toHaveLength(0);
  // Verification alone must not bypass an explicit rejection/lock.
  await f.pool.query("UPDATE hanu.accounts SET status='blocked' WHERE user_id=$1", [users[1]]);
  expect(await accounts.identify(identity(1))).toMatchObject({ status: 'blocked' });
});

it('protects admins, rejects stale updates and validates limits without leaking internal notes', async () => {
  const f = await http(), original = await (await f.api(`admin/accounts/${users[1]}`)).json();
  expect((await update(f, { maxProfiles: 1, maxConcurrent: 3 })).status).toBe(400);
  expect((await update(f)).status).toBe(200);
  expect((await f.api(`admin/accounts/${users[1]}`, 0, { ...permissions, version: original.account.version }, 'PATCH')).status).toBe(409);
  const admin = await (await f.api(`admin/accounts/${users[0]}`)).json();
  expect((await f.api(`admin/accounts/${users[0]}`, 0, { ...permissions, version: admin.account.version }, 'PATCH')).status).toBe(403);
  const me = await (await f.api('auth/me', 1)).json(); expect(me).not.toHaveProperty('adminNote');
  const list = await (await f.api('admin/accounts?q=0902345678&status=active')).json();
  expect(list.accounts).toHaveLength(1); expect(list.accounts[0].id).toBe(users[1]);
  const wrongOrigin = await fetch(`${f.config.origin}/api/admin/grants`, { method: 'POST', headers: { Cookie: 'test-account=account-a', Origin: 'https://foreign.example', 'Content-Type': 'application/json' }, body: '{}' });
  expect(wrongOrigin.status).toBe(403);
});

it('serializes profile limits, simultaneous starts and resumes, and denies Live at the durable submit gate', async () => {
  const f = await database();
  await f.pool.query('UPDATE hanu.accounts SET max_profiles=1,max_concurrent=1 WHERE user_id=$1', [users[0]]);
  const codes = await Promise.all([f.repository.pairCode(users[0]), f.repository.pairCode(users[0])]);
  const pairs = await Promise.allSettled(codes.map(code => f.repository.pair(crypto.randomUUID(), extension, code)));
  expect(pairs.filter(p => p.status === 'fulfilled')).toHaveLength(1);
  const first = (pairs.find(p => p.status === 'fulfilled') as PromiseFulfilledResult<any>).value;
  const store = f.repository.store(users[0]); await store.connected(first.sessionId, true);
  await f.pool.query('UPDATE hanu.accounts SET max_profiles=3 WHERE user_id=$1', [users[0]]);
  const a = await f.pair(), b = await f.pair();
  const c = new Coordinator(store, undefined, true);
  c.peers.set(a.sessionId, {} as any); c.peers.set(b.sessionId, {} as any); c.command = async () => ({});
  const form = 'https://docs.google.com/forms/d/e/access-fixture/viewform';
  const started = await Promise.allSettled([c.start([a.sessionId], form, 'live'), c.start([b.sessionId], form, 'live')]);
  expect(started.filter(p => p.status === 'fulfilled')).toHaveLength(1);
  const running = (await store.sessions()).find(s => s.run?.status === 'running')!;
  const paused = await store.session(running.id); paused.run!.status = 'paused'; await store.saveSession(paused);
  const other = running.id === a.sessionId ? b.sessionId : a.sessionId;
  await c.start([other], form, 'live');
  await expect(store.authorizeResume(running.id)).rejects.toMatchObject({ status: 409 });
  const otherRun = await store.session(other); otherRun.run!.status = 'paused'; await store.saveSession(otherRun);
  const resumed = await Promise.allSettled([store.authorizeResume(running.id), store.authorizeResume(other)]);
  expect(resumed.filter(result => result.status === 'fulfilled')).toHaveLength(1);
  for (const id of [running.id, other]) { const s = await store.session(id); await store.cancelResume(id, s.run!.runId!); }
  await f.pool.query('UPDATE hanu.accounts SET live_enabled=false WHERE user_id=$1', [users[0]]);
  await expect(store.authorizeResume(running.id)).rejects.toMatchObject({ status: 403 });
  await expect(store.acquireSubmit(running.id, running.run!.runId!, 'access-fixture')).rejects.toMatchObject({ status: 403 });
  expect(await store.blocked(running.id, 'access-fixture')).toBe(false);
});

it('blocks HTTP, RLS, stale event tickets and linked extensions immediately after an admin lock', async () => {
  const f = await http(), paired = await f.pair(users[1]);
  const peer = await connect(f.config.origin, '/extensions', { type: 'HELLO', protocol: 1, transport: 'cloud', accessPolicy: 1, sessionId: paired.sessionId, extensionId: extension, token: paired.token });
  await expect.poll(() => peer.messages.some(m => m.type === 'WELCOME')).toBe(true);
  const ticket = await (await f.api('events-ticket', 1, {})).json();
  const browser = await connect(f.config.origin, '/events', { type: 'AUTH', ticket: ticket.ticket });
  await expect.poll(() => browser.messages.some(m => m.type === 'STATE')).toBe(true);
  const unused = await (await f.api('events-ticket', 1, {})).json();
  expect((await update(f, { status: 'blocked' })).status).toBe(200);
  await expect.poll(() => peer.ws.readyState).toBe(WebSocket.CLOSED);
  expect(peer.messages.some(m => m.type === 'EMERGENCY_STOP')).toBe(true);
  expect(browser.messages.some(m => m.type === 'ACCESS_CHANGED')).toBe(true);
  expect((await f.api('state', 1)).status).toBe(403);
  expect((await f.api('auth/me', 1)).status).toBe(200);
  await expect(f.repository.authenticate(paired.sessionId, extension, paired.token)).rejects.toMatchObject({ status: 403 });
  const replay = await connect(f.config.origin, '/events', { type: 'AUTH', ticket: unused.ticket });
  await expect.poll(() => replay.ws.readyState).toBe(WebSocket.CLOSED);
  await f.db.exec(`SET ROLE authenticated; SET request.jwt.claim.sub='${users[1]}'`);
  try {
    expect((await f.db.query('SELECT id FROM hanu.sessions')).rows).toEqual([]);
    await expect(f.db.query('SELECT * FROM hanu.accounts')).rejects.toThrow('permission denied');
    await expect(f.db.query('SELECT * FROM hanu.admin_events')).rejects.toThrow('permission denied');
  } finally { await f.db.exec('RESET ROLE; RESET request.jwt.claim.sub'); }
});

it('enforces expiry for existing tokens and revokes an individual extension with an audit entry', async () => {
  const f = await http(), paired = await f.pair(users[1]);
  expect((await update(f, { expiresAt: new Date(Date.now() - 1000).toISOString() })).status).toBe(200);
  expect(await (await f.api('auth/me', 1)).json()).toMatchObject({ status: 'expired' });
  expect((await f.api('pair', 1, {})).status).toBe(403);
  expect((await update(f)).status).toBe(200);
  expect((await f.api(`admin/accounts/${users[1]}/sessions/${paired.sessionId}/revoke`, 0, {})).status).toBe(200);
  expect(await f.repository.authenticate(paired.sessionId, extension, paired.token)).toBeUndefined();
  const detail = await (await f.api(`admin/accounts/${users[1]}`)).json();
  expect(detail.sessions[0]).toMatchObject({ revoked: true, connected: false });
  expect(detail.events.some((event: any) => event.action === 'revoke_extension')).toBe(true);
});

it('refuses older extension clients that still permit independent cloud runs', async () => {
  const f = await http(), paired = await f.pair();
  const peer = await connect(f.config.origin, '/extensions', { type: 'HELLO', protocol: 1, transport: 'cloud', sessionId: paired.sessionId, extensionId: extension, token: paired.token });
  await expect.poll(() => peer.ws.readyState).toBe(WebSocket.CLOSED);
  expect(peer.messages).toContainEqual(expect.objectContaining({ type: 'ERROR', error: expect.stringContaining('Cập nhật') }));
});

it('keeps a durable submit lock through a block and reapproval, with no second grant', async () => {
  const f = await http(), paired = await f.pair(users[1]);
  const coordinator = new Coordinator(paired.store, undefined, true);
  coordinator.peers.set(paired.sessionId, {} as any); coordinator.command = async () => ({});
  const group = await coordinator.start([paired.sessionId], 'https://docs.google.com/forms/d/e/submission-access/viewform', 'live');
  const session = await paired.store.session(paired.sessionId); session.run!.formId = 'submission-access'; await paired.store.saveSession(session);
  await paired.store.acquireSubmit(paired.sessionId, group.id, 'submission-access');
  const before = (await f.pool.query('SELECT * FROM hanu.locks')).rows;
  expect((await update(f, { status: 'blocked' })).status).toBe(200);
  await expect(paired.store.acquireSubmit(paired.sessionId, group.id, 'submission-access')).rejects.toMatchObject({ status: 403 });
  expect((await f.pool.query('SELECT * FROM hanu.locks')).rows).toEqual(before);
  expect((await update(f)).status).toBe(200);
  await expect(paired.store.acquireSubmit(paired.sessionId, group.id, 'submission-access')).rejects.toMatchObject({ status: 409 });
  expect((await paired.store.session(paired.sessionId)).run?.submitAttempted).toBe(true);
  expect(await paired.store.blocked(paired.sessionId, 'submission-access')).toBe(true);
});

it('does not disconnect an extension when only internal notes or a longer expiry change', async () => {
  const f = await http(), paired = await f.pair(users[1]);
  const peer = await connect(f.config.origin, '/extensions', { type: 'HELLO', protocol: 1, transport: 'cloud', accessPolicy: 1, sessionId: paired.sessionId, extensionId: extension, token: paired.token });
  await expect.poll(() => peer.messages.some(m => m.type === 'WELCOME')).toBe(true);
  const response = await update(f, { maxProfiles: 100, maxConcurrent: 100, adminNote: 'Cập nhật thông tin hỗ trợ', expiresAt: new Date(Date.now() + 86400000).toISOString() });
  expect(response.status).toBe(200); expect(await response.json()).toMatchObject({ interrupted: false });
  expect(peer.ws.readyState).toBe(WebSocket.OPEN);
  expect(peer.messages.some(m => m.type === 'EMERGENCY_STOP')).toBe(false);
});

it('stops an already connected extension when its account expires without another website visit', async () => {
  const f = await http(), paired = await f.pair(users[1]);
  const peer = await connect(f.config.origin, '/extensions', { type: 'HELLO', protocol: 1, transport: 'cloud', accessPolicy: 1, sessionId: paired.sessionId, extensionId: extension, token: paired.token });
  await expect.poll(() => peer.messages.some(m => m.type === 'WELCOME')).toBe(true);
  await f.pool.query("UPDATE hanu.accounts SET expires_at=now()-interval '1 second' WHERE user_id=$1", [users[1]]);
  await expect.poll(() => { if (peer.ws.readyState === WebSocket.OPEN) peer.ws.send(JSON.stringify({ protocol: 1, sessionId: paired.sessionId, type: 'HEARTBEAT' })); return peer.ws.readyState; }, { timeout: 8000 }).toBe(WebSocket.CLOSED);
  expect(peer.messages).toContainEqual(expect.objectContaining({ type: 'EMERGENCY_STOP' }));
  expect((await paired.store.session(paired.sessionId)).connected).toBe(false);
}, 15000);
