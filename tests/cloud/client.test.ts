import { afterEach, expect, it, vi } from 'vitest';
import { createNativeClient } from '../../src/native-client';
import type { CoordinatorPort } from '../../src/coordinator-transport';
import { websocketConnector } from '../../src/coordinator-transport';

const disposers: (() => void)[] = [];
afterEach(() => { for (const dispose of disposers.splice(0)) dispose(); vi.unstubAllGlobals(); });
function fixture() {
  const storage: Record<string, any> = { coordinatorIdentity: { sessionId: 'local-profile', token: 'local-token' } }, ports: any[] = [];
  vi.stubGlobal('chrome', { runtime: { id: 'a'.repeat(32), connectNative: vi.fn() }, storage: { local: { get: async (key: string) => ({ [key]: structuredClone(storage[key]) }), set: async (data: any) => Object.assign(storage, structuredClone(data)) } } });
  const connector = () => {
    const messages: any[] = [], closes: any[] = [], sent: any[] = [];
    const port: CoordinatorPort = { onMessage: { addListener: fn => messages.push(fn) }, onDisconnect: { addListener: fn => closes.push(fn) }, postMessage: m => sent.push(m), disconnect: () => {} };
    const p = { port, messages, closes, sent, receive: (m: any) => messages.forEach(fn => fn(m)) };
    ports.push(p); return port;
  };
  const adapter = { start: vi.fn(async () => ({})), control: vi.fn(async () => ({})), focus: vi.fn(), disconnected: vi.fn(async () => {}), reconcile: vi.fn(async () => ({})) };
  const client = createNativeClient(adapter, { origin: 'https://fixture.example', connector });
  disposers.push(client.dispose);
  return { storage, ports, adapter, client };
}

it('uses isolated cloud identity and the server profile ID without changing the local identity', async () => {
  const f = fixture(), paired = f.client.pair('ABCDEF123456');
  await vi.waitFor(() => expect(f.ports).toHaveLength(1));
  expect(f.ports[0].sent[0]).toMatchObject({ type: 'PAIR', transport: 'cloud', extensionId: 'a'.repeat(32) });
  f.ports[0].receive({ type: 'PAIRED', token: 'cloud-token', sessionId: 'preserved-profile-aaaaaaaaaa' });
  expect(await paired).toMatchObject({ cloud: true, connected: true, sessionId: 'preserved-profile-aaaaaaaaaa' });
  expect(f.storage.coordinatorIdentity).toEqual({ sessionId: 'local-profile', token: 'local-token' });
  expect(f.storage['cloudCoordinatorIdentity:https://fixture.example'].token).toBe('cloud-token');
});

it('revocation halts the page, forgets the token and allows a new pairing', async () => {
  const f = fixture(), pairing = f.client.pair('ABCDEF123456');
  await vi.waitFor(() => expect(f.ports).toHaveLength(1)); f.ports[0].receive({ type: 'PAIRED', token: 'token' }); await pairing;
  f.ports[0].receive({ type: 'REVOKED' });
  expect((await f.client.status())).toMatchObject({ paired: false, connected: false }); expect(f.adapter.disconnected).toHaveBeenCalled();
  const again = f.client.pair('ABCDEF123457'); await vi.waitFor(() => expect(f.ports).toHaveLength(2));
  f.ports[1].receive({ type: 'PAIRED', token: 'new-token' }); expect((await again).connected).toBe(true);
});

it('drops commands queued on a disconnected transport instead of replaying a Start', async () => {
  const f = fixture(), pairing = f.client.pair('ABCDEF123456'); await vi.waitFor(() => expect(f.ports).toHaveLength(1));
  const p = f.ports[0]; p.receive({ type: 'PAIRED', token: 'token' }); await pairing;
  let release!: () => void; f.adapter.control.mockImplementationOnce(() => new Promise(resolve => { release = () => resolve({}); }));
  const sessionId = (await f.client.status()).sessionId;
  p.receive({ type: 'COMMAND', protocol: 1, sessionId, commandId: 'blocking', kind: 'PAUSE', payload: {} });
  await vi.waitFor(() => expect(release).toBeTypeOf('function'));
  p.receive({ type: 'COMMAND', protocol: 1, sessionId, commandId: 'must-not-start', kind: 'START', payload: {} });
  p.closes.forEach((fn: any) => fn()); release();
  await new Promise(resolve => setTimeout(resolve, 30));
  expect(f.adapter.start).not.toHaveBeenCalled(); expect(f.client.isConnected()).toBe(false);
  expect(p.sent.some((m: any) => m.commandId === 'must-not-start')).toBe(false);
});

it('refuses insecure remote coordinator endpoints', () => {
  expect(() => websocketConnector('http://remote.example')).toThrow('không hợp lệ');
  expect(() => websocketConnector('https://remote.example/path')).toThrow('không hợp lệ');
  expect(() => websocketConnector('https://user:pass@remote.example')).toThrow('không hợp lệ');
});

it('schedules a Chrome alarm to recover a suspended worker after network failure',async()=>{
  const f=fixture(),listeners:any[]=[];
  const alarms={create:vi.fn(async(_name:string,_info:{when:number})=>{}),clear:vi.fn(async(_name:string)=>true),onAlarm:{addListener:(fn:any)=>listeners.push(fn)}};
  (chrome as any).alarms=alarms;
  const pairing=f.client.pair('ABCDEF123456');await vi.waitFor(()=>expect(f.ports).toHaveLength(1));
  f.ports[0].receive({type:'PAIRED',token:'token'});await pairing;f.ports[0].closes.forEach((fn:any)=>fn());
  await vi.waitFor(()=>expect(alarms.create).toHaveBeenCalled());
  expect(alarms.create.mock.calls[0][0]).toBe('hanu-cloud-reconnect');
  expect((alarms.create.mock.calls[0] as any)[1].when).toBeGreaterThan(Date.now()+58000);
});
