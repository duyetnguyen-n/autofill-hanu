import { afterEach, expect, it, vi } from 'vitest';
import { WebSocket } from 'ws';
import { httpFixture, users, extension } from './fixture';

const cleanups: (() => Promise<void>)[] = [];
afterEach(async () => { for (const close of cleanups.splice(0).reverse()) await close(); });
async function setup() { const f = await httpFixture(); cleanups.push(f.close); return f; }
function socket(origin: string, path: string, browser = false) {
  const ws = new WebSocket(origin.replace('http:', 'ws:') + path, { headers: { Origin: browser ? origin : `chrome-extension://${extension}` } });
  const messages: any[] = [];
  ws.on('message', raw => messages.push(JSON.parse(raw.toString())));
  cleanups.push(async () => { if (ws.readyState !== WebSocket.CLOSED) { const closed = new Promise<void>(r => ws.once('close', () => r())); ws.terminate(); await closed; } });
  return { ws, messages, opened: new Promise<void>((resolve, reject) => { ws.once('open', resolve); ws.once('error', reject); }) };
}
async function connectExtension(f: Awaited<ReturnType<typeof setup>>, owner = 0) {
  const code = (await (await f.api('pair', owner, {})).json()).code;
  const peer = socket(f.config.origin, '/extensions'); await peer.opened;
  const sessionId = crypto.randomUUID();
  peer.ws.send(JSON.stringify({ type: 'PAIR', protocol: 1, transport: 'cloud', accessPolicy: 1, sessionId, extensionId: extension, code }));
  await expect.poll(() => peer.messages.find(m => m.type === 'PAIRED')).toBeTruthy();
  const paired = peer.messages.find(m => m.type === 'PAIRED');
  // Real protocol acknowledgement through WSS endpoint (local ws in fixture).
  peer.ws.on('message', raw => {
    const command = JSON.parse(raw.toString());
    if (command.type !== 'COMMAND') return;
    const result = command.kind === 'READ_PROFILE' ? { profile: { values: {}, mappings: {}, customFields: [], attachments: {} }, revision: 0 } : {};
    peer.ws.send(JSON.stringify({ type: 'RESULT', protocol: 1, sessionId, commandId: command.commandId, ok: true, result }));
  });
  for (const command of peer.messages.filter(m => m.type === 'COMMAND')) peer.ws.send(JSON.stringify({ type: 'RESULT', protocol: 1, sessionId, commandId: command.commandId, ok: true, result: { profile: { values: {}, mappings: {}, customFields: [], attachments: {} }, revision: 0 } }));
  await expect.poll(async () => (await f.repository.store(users[owner]).session(sessionId)).synced).toBe(true);
  return { ...peer, sessionId, token: paired.token };
}

it('uses the freshly identified HTTP account without querying permissions twice',async()=>{
  const f=await setup();await f.api('auth/me');
  const query=vi.spyOn(f.pool,'query');
  try{
    expect((await f.api('events-ticket',0,{})).status).toBe(200);
    expect(query.mock.calls.filter(([sql])=>sql==='SELECT * FROM hanu.accounts WHERE user_id=$1')).toHaveLength(1);
  }finally{query.mockRestore();}
},20000);

it('requires authentication and same-origin mutations; login exposes no auth tokens', async () => {
  const f = await setup();
  expect((await fetch(`${f.config.origin}/api/state`)).status).toBe(401);
  expect((await fetch(`${f.config.origin}/api/pair`, { method: 'POST', headers: { Cookie: 'test-account=account-a', Origin: 'https://wrong.example', 'Content-Type': 'application/json' }, body: '{}' })).status).toBe(403);
  const me = await (await f.api('auth/me')).json();
  expect(me).toMatchObject({ id: users[0], email: 'an@example.test', name: 'An thử nghiệm' });
  const login = await f.api('auth/login', 0, {});
  expect(login.status).toBe(200); expect((await login.json()).url).toContain('/auth/callback');
}, 20000);

it('pairs an unpacked extension without native registration and isolates API and browser events', async () => {
  const f = await setup(), a = await connectExtension(f, 0), b = await connectExtension(f, 1);
  expect((await f.api(`sessions/${a.sessionId}/ping`, 1, {})).status).toBe(404);
  expect((await f.api(`sessions/${a.sessionId}`, 1, { name: 'intrusion' }, 'PATCH')).status).toBe(404);
  expect((await f.api(`sessions/${a.sessionId}/history`, 1)).status).toBe(404);
  expect((await f.api(`sessions/${a.sessionId}/unlink`, 1, {})).status).toBe(404);
  const ticket = (await (await f.api('events-ticket', 1, {})).json()).ticket;
  const browser = socket(f.config.origin, '/events', true); await browser.opened;
  browser.ws.send(JSON.stringify({ type: 'AUTH', ticket }));
  await expect.poll(() => browser.messages.find(m => m.type === 'STATE')).toBeTruthy();
  const state = browser.messages.find(m => m.type === 'STATE');
  expect(state.owner).toBe(users[1]); expect(state.sessions.map((s: any) => s.id)).toEqual([b.sessionId]);
  const replay = socket(f.config.origin, '/events', true); await replay.opened;
  const closed = new Promise<number>(r => replay.ws.once('close', r));
  replay.ws.send(JSON.stringify({ type: 'AUTH', ticket })); expect(await closed).toBe(1008);
  const personal = await (await f.api('state', 0)).json();
  expect(personal.sessions.map((s: any) => s.id)).toEqual([a.sessionId]);
});

it('keeps image drafts, isolates downloads and revokes tokens when a profile is unlinked', async () => {
  const f = await setup(), a = await connectExtension(f);
  const profile = (await f.repository.store(users[0]).session(a.sessionId)).profile!;
  profile.values.fullName = 'Tên đã lưu';
  expect((await f.api(`sessions/${a.sessionId}`, 0, { profile }, 'PATCH')).status).toBe(200);
  const bytes = Buffer.from('fixture image');
  const response = await f.api(`sessions/${a.sessionId}/attachment`, 0, { key: 'identityDocument', name: 'fixture.png', mimeType: 'image/png', base64: bytes.toString('base64') });
  expect(response.status).toBe(200); const session = await response.json();
  expect(session.profile.values.fullName).toBe('Tên đã lưu');
  const path = `sessions/${a.sessionId}/attachments/${session.profile.attachments.identityDocument.id}`;
  expect((await f.api(path, 1)).status).toBe(404);
  expect(Buffer.from(await (await f.api(path, 0)).arrayBuffer())).toEqual(bytes);
  const closed = new Promise<number>(r => a.ws.once('close', r));
  expect((await f.api(`sessions/${a.sessionId}/unlink`, 0, {})).status).toBe(200);
  expect(await closed).toBe(1008);
  expect(await f.repository.authenticate(a.sessionId, extension, a.token)).toBeUndefined();
  expect((await f.repository.store(users[0]).session(a.sessionId)).profile!.values.fullName).toBe('Tên đã lưu');
});

it('rejects page-origin extension connections and spoofed profile tokens', async () => {
  const f = await setup(), a = await connectExtension(f);
  const page = new WebSocket(f.config.origin.replace('http:', 'ws:') + '/extensions', { headers: { Origin: f.config.origin } });
  const error = await new Promise<Error>(r => page.once('error', r)); expect(error.message).toContain('403');
  const rogue = socket(f.config.origin, '/extensions'); await rogue.opened;
  rogue.ws.send(JSON.stringify({ type: 'HELLO', protocol: 1, transport: 'cloud', accessPolicy: 1, sessionId: a.sessionId, extensionId: extension, token: 'b'.repeat(64) }));
  await expect.poll(() => rogue.messages.some(m => m.type === 'UNPAIRED')).toBe(true);
});

it('logout closes the browser session and invalidates unused tickets while linked extensions stay connected', async () => {
  const f = await setup(), a = await connectExtension(f), ticket = (await (await f.api('events-ticket', 0, {})).json()).ticket;
  const browser = socket(f.config.origin, '/events', true); await browser.opened; browser.ws.send(JSON.stringify({ type: 'AUTH', ticket }));
  await expect.poll(() => browser.messages.some(m => m.type === 'STATE')).toBe(true);
  const closed = new Promise<number>(r => browser.ws.once('close', r));
  expect((await f.api('auth/logout', 0, {})).status).toBe(200); expect(await closed).toBe(1008);
  expect((await f.api('state', 0)).status).toBe(401); expect(a.ws.readyState).toBe(WebSocket.OPEN);
});


it('unlinks offline profiles, invalidates pending relink codes and preserves data through a new link', async () => {
  const f = await setup(), a = await f.pair();
  await a.store.connected(a.sessionId, false);
  const other = await f.pair();
  const snapshot = await a.store.session(a.sessionId);
  const run = { runId: 'retained-run', sessionId: a.sessionId, status: 'completed' } as any;
  await f.pool.query('INSERT INTO hanu.groups(owner,id,data) VALUES($1,$2,$3)', [users[0], run.runId, JSON.stringify({ id: run.runId, members: [a.sessionId], mode: 'live' })]);
  await a.store.saveRun(a.sessionId, run);
  await f.pool.query("INSERT INTO hanu.locks(owner,session,form,run,resolution) VALUES($1,$2,'retained-form','retained-run','received')", [users[0], a.sessionId]);
  const oldCode = await f.repository.pairCode(users[0], a.sessionId);
  expect(snapshot.linked).toBe(true);
  expect((await f.api(`sessions/${a.sessionId}/unlink`, 0, {})).status).toBe(200);
  expect(await f.repository.authenticate(a.sessionId, extension, a.token)).toBeUndefined();
  await expect(f.repository.pair(crypto.randomUUID(), extension, oldCode)).rejects.toMatchObject({ status: 401 });
  const state = await (await f.api('state')).json();
  expect(state.sessions.find((s: any) => s.id === a.sessionId)).toMatchObject({ linked: false, connected: false, profile: snapshot.profile });
  expect(await a.store.history(a.sessionId)).toEqual([run]);
  expect(await a.store.blocked(a.sessionId, 'retained-form')).toBe(true);
  expect(await f.repository.authenticate(other.sessionId, extension, other.token)).toBe(users[0]);
  const newCode = await f.repository.pairCode(users[0], a.sessionId);
  const relink = await f.repository.pair(crypto.randomUUID(), extension, newCode);
  expect(relink.sessionId).toBe(a.sessionId);
  expect(await a.store.session(a.sessionId)).toMatchObject({ linked: true, profile: snapshot.profile });
  expect(await a.store.history(a.sessionId)).toEqual([run]);
  expect(await a.store.blocked(a.sessionId, 'retained-form')).toBe(true);
});

it('starts from the linked extension through the same quota and Live gates as the manager', async () => {
  const f = await setup(), a = await connectExtension(f);
  const coordinator = f.app.runtimes.get(users[0])!.coordinator;
  await coordinator.edit(a.sessionId, { expectedEmail: 'an@example.test' });
  await f.pool.query('UPDATE hanu.accounts SET live_enabled=false,max_concurrent=1 WHERE user_id=$1', [users[0]]);
  const send = (requestId: string, mode: string, extra = {}) => a.ws.send(JSON.stringify({ protocol: 1, sessionId: a.sessionId, type: 'REQUEST', requestId, kind: 'START', url: 'https://docs.google.com/forms/d/e/extension-start/viewform', mode, ...extra }));
  send('live-denied', 'live');
  await expect.poll(() => a.messages.find(m => m.requestId === 'live-denied')).toMatchObject({ ok: false, error: expect.stringContaining('Live') });
  expect((await f.repository.store(users[0]).session(a.sessionId)).run).toBeUndefined();
  send('bad-url', 'test', { url: 'https://example.test/' });
  await expect.poll(() => a.messages.find(m => m.requestId === 'bad-url')).toMatchObject({ ok: false });
  send('start-test', 'test');
  await expect.poll(() => a.messages.find(m => m.requestId === 'start-test')).toMatchObject({ ok: true, run: { mode: 'test', status: 'running', sessionId: a.sessionId } });
  expect(a.messages.filter(m => m.type === 'COMMAND' && m.kind === 'START')).toHaveLength(1);
  const other = await connectExtension(f);
  await coordinator.edit(other.sessionId, { expectedEmail: 'an@example.test' });
  other.ws.send(JSON.stringify({ protocol: 1, sessionId: other.sessionId, type: 'REQUEST', requestId: 'over-quota', kind: 'START', url: 'https://docs.google.com/forms/d/e/extension-start/viewform', mode: 'test' }));
  await expect.poll(() => other.messages.find(m => m.requestId === 'over-quota')).toMatchObject({ ok: false, error: expect.stringContaining('đồng thời') });
  expect(other.messages.filter(m => m.type === 'COMMAND' && m.kind === 'START')).toHaveLength(0);
  expect((await f.pool.query('SELECT * FROM hanu.locks')).rows).toEqual([]);
});

it.each(['manager','extension'] as const)('allows a separate Test via %s without resolving an old uncertain submission',async entry=>{
  const f=await setup(),a=await connectExtension(f),store=f.repository.store(users[0]);
  const coordinator=f.app.runtimes.get(users[0])!.coordinator;
  await coordinator.edit(a.sessionId,{expectedEmail:'an@example.test'});
  const previous={runId:'uncertain-live',sessionId:a.sessionId,managed:true,formId:'old-live',url:'https://docs.google.com/forms/d/e/old-live/viewform',tabId:1,mode:'live',status:'submit_uncertain',autoContinue:false,submitAttempted:true,eventSeq:1,filled:[],skipped:[],logs:[],updatedAt:new Date().toISOString()} as const;
  await f.pool.query('INSERT INTO hanu.groups(owner,id,data) VALUES($1,$2,$3)',[users[0],previous.runId,JSON.stringify({id:previous.runId,members:[a.sessionId],mode:'live'})]);
  const session=await store.session(a.sessionId);session.run=previous as any;await store.saveSession(session);await store.saveRun(a.sessionId,previous as any);
  await f.pool.query("INSERT INTO hanu.locks(owner,session,form,run,resolution) VALUES($1,$2,'old-live',$3,'uncertain')",[users[0],a.sessionId,previous.runId]);
  const start=async(requestId:string,url:string,mode:string)=>{
    if(entry==='manager'){const response=await f.api('start',0,{requestId,ids:[a.sessionId],url,mode});return {ok:response.ok,...await response.json()};}
    a.ws.send(JSON.stringify({protocol:1,sessionId:a.sessionId,type:'REQUEST',requestId,kind:'START',url,mode}));
    await expect.poll(()=>a.messages.find(m=>m.requestId===requestId)).toBeTruthy();return a.messages.find(m=>m.requestId===requestId);
  };
  expect(await start('same-form-test','https://docs.google.com/forms/d/e/old-live/viewform','test')).toMatchObject({ok:false});
  expect(await start('other-form-live','https://docs.google.com/forms/d/e/new-test/viewform','live')).toMatchObject({ok:false});
  expect(await start('short-link-test','https://forms.gle/unknown-form','test')).toMatchObject({ok:false});
  expect(await start('separate-form-test','https://docs.google.com/forms/d/e/new-test/viewform','test')).toMatchObject({ok:true});
  await expect.poll(async()=>(await store.session(a.sessionId)).run?.mode).toBe('test');
  expect(await store.blocked(a.sessionId,'old-live')).toBe(true);
  expect((await store.history(a.sessionId)).find(r=>r.runId===previous.runId)).toMatchObject({status:'submit_uncertain',autoContinue:false,submitAttempted:true});
  expect(a.messages.filter(m=>m.type==='COMMAND'&&m.kind==='START')).toHaveLength(1);
});
