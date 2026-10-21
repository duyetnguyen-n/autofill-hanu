import { afterEach, expect, it } from 'vitest';
import { WebSocket } from 'ws';
import { StateStreamEncoder, StateStreamReceiver } from '../../manager/state-stream';
import { httpFixture, users } from './fixture';

it('reconstructs additions, removals, reordered arrays, appended logs and cleared optional fields without mutating previous UI state', () => {
  const encoder = new StateStreamEncoder(), receiver = new StateStreamReceiver<any>();
  const states = [
    { sessions: [{ id: 'a', profile: { name: 'An', padding: 'x'.repeat(4000) }, run: { logs: ['one'], error: 'old' } }], groups: ['old'] },
    { sessions: [{ id: 'a', profile: { name: 'An', padding: 'x'.repeat(4000) }, run: { logs: ['one', 'two'], error: undefined } }], groups: ['old'] },
    { sessions: [{ id: 'a', profile: { name: 'Bình', padding: 'x'.repeat(4000) }, run: null }, { id: 'b' }], groups: ['new', 'old'] },
    { sessions: [{ id: 'b' }, { id: 'a', profile: { name: 'Bình' } }], groups: ['new'] },
    { sessions: [], groups: [] }
  ];
  let previous: any, previousJson: string | undefined;
  for (const state of states) {
    const frame = encoder.encode(state), message = JSON.parse(frame.update!);
    const result = receiver.receive(message);
    expect(result).toEqual(JSON.parse(JSON.stringify(state)));
    if (previous) expect(JSON.stringify(previous)).toBe(previousJson);
    previous = result; previousJson = JSON.stringify(result);
    expect(encoder.encode(state).update).toBeNull();
  }
});

it('rejects missing, duplicate, out-of-order or invalid patches and recovers from a full snapshot', () => {
  const encoder = new StateStreamEncoder(), receiver = new StateStreamReceiver<any>();
  const first = encoder.encode({ sessions: [], padding: 'x'.repeat(4000) });
  const second = encoder.encode({ sessions: [{ id: 'a' }], padding: 'x'.repeat(4000) });
  const patch = JSON.parse(second.update!);
  expect(patch.type).toBe('STATE_PATCH');
  expect(() => receiver.receive(patch)).toThrow();
  receiver.receive(JSON.parse(first.full));
  expect(() => receiver.receive({ ...patch, baseRevision: 50 })).toThrow();
  expect(() => receiver.receive({ ...patch, changes: [{ path: ['__proto__', 'polluted'], value: true }] })).toThrow();
  expect(receiver.receive(patch).sessions).toEqual([{ id: 'a' }]);
  expect(() => receiver.receive(patch)).toThrow();
  expect(new StateStreamReceiver<any>().receive(JSON.parse(second.full)).sessions).toEqual([{ id: 'a' }]);
  // A cached UI talking to an older server continues accepting full snapshots.
  expect(receiver.receive({ type: 'STATE', sessions: [] })).toEqual({ sessions: [] });
});

it('keeps small updates compact and uses a snapshot when replacing most data is cheaper', () => {
  const encoder = new StateStreamEncoder(), receiver = new StateStreamReceiver<any>();
  const initial = { sessions: Array.from({ length: 20 }, (_, i) => ({ id: String(i), profile: { name: 'Fixture', fields: 'x'.repeat(2000) }, run: { eventSeq: 0, logs: Array(50).fill('fixture log entry') } })), groups: Array.from({ length: 100 }, (_, i) => ({ id: String(i), members: ['0', '1', '2'] })) };
  receiver.receive(JSON.parse(encoder.encode(initial).full));
  let fullBytes = 0, deltaBytes = 0;
  for (let seq = 1; seq <= 100; seq++) {
    initial.sessions[seq % 20].run.eventSeq++;
    initial.sessions[seq % 20].run.logs.push(`progress ${seq}`);
    const frame = encoder.encode(initial);
    fullBytes += Buffer.byteLength(frame.full); deltaBytes += Buffer.byteLength(frame.update!);
    expect(receiver.receive(JSON.parse(frame.update!))).toEqual(initial);
  }
  expect(deltaBytes / fullBytes).toBeLessThan(0.05);
  const replace = encoder.encode({ sessions: [], groups: [] });
  expect(JSON.parse(replace.update!).type).toBe('STATE');
  expect(receiver.receive(JSON.parse(replace.update!))).toEqual({ sessions: [], groups: [] });
});

const cleanups: (() => Promise<void>)[] = [];
afterEach(async () => { for (const close of cleanups.splice(0).reverse()) await close(); });

it('streams per-account deltas over real WebSockets, preserves legacy clients and resyncs a newly connected tab', async () => {
  const f = await httpFixture(); cleanups.push(f.close);
  const a = await f.pair(), b = await f.pair(users[1]);
  // Make the snapshot representative enough for a small edit to use a delta.
  const s = await a.store.session(a.sessionId); s.profile!.values.fullName = 'x'.repeat(2000); await a.store.saveSession(s);
  async function browser(owner = 0, delta = true) {
    const ticket = (await (await f.api('events-ticket', owner, {})).json()).ticket;
    const ws = new WebSocket(f.config.origin.replace('http:', 'ws:') + '/events', { headers: { Origin: f.config.origin } });
    cleanups.push(async () => { ws.terminate(); });
    const messages: any[] = [], receiver = new StateStreamReceiver<any>(); let state: any;
    ws.on('message', raw => { const message = JSON.parse(raw.toString()); messages.push(message); if (['STATE', 'STATE_PATCH'].includes(message.type)) state = receiver.receive(message); });
    await new Promise<void>((resolve, reject) => { ws.once('open', resolve); ws.once('error', reject); });
    ws.send(JSON.stringify({ type: 'AUTH', ticket, ...(delta ? { stateStream: 1 } : {}) }));
    await expect.poll(() => state).toBeTruthy();
    return { ws, messages, state: () => state };
  }
  const modern = await browser(), legacy = await browser(0, false), other = await browser(1);
  expect(modern.messages[0].type).toBe('STATE');
  expect(other.state().sessions.map((s: any) => s.id)).toEqual([b.sessionId]);
  const runtime = f.app.runtimes.get(users[0])!;
  const count = modern.messages.length, otherCount = other.messages.length;
  await runtime.coordinator.edit(a.sessionId, { name: 'Renamed fixture' });
  await expect.poll(() => modern.state().sessions[0].name).toBe('Renamed fixture');
  await expect.poll(() => legacy.state().sessions[0].name).toBe('Renamed fixture');
  expect(modern.messages.slice(count).some(m => m.type === 'STATE_PATCH')).toBe(true);
  expect(legacy.messages.every(m => m.type === 'STATE')).toBe(true);
  expect(other.messages.length).toBe(otherCount);
  const after = modern.messages.length;
  runtime.coordinator.progressChanged();
  await new Promise(resolve => setTimeout(resolve, 150));
  expect(modern.messages.length).toBe(after);
  modern.ws.terminate();
  await runtime.coordinator.edit(a.sessionId, { name: 'Changed while offline' });
  const reconnected = await browser();
  expect(reconnected.messages[0].type).toBe('STATE');
  expect(reconnected.state().sessions[0].name).toBe('Changed while offline');
  // Joining tabs do not retransmit an unchanged snapshot to existing tabs.
  const legacyCount = legacy.messages.length;
  await browser();
  expect(legacy.messages.length).toBe(legacyCount);
}, 20000);
