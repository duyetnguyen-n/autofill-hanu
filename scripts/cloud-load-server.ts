import { createHash, randomUUID, timingSafeEqual } from 'node:crypto';
import { performance, monitorEventLoopDelay } from 'node:perf_hooks';
import type { IncomingMessage, ServerResponse } from 'node:http';
import type { WebAuth } from '../manager/cloud/auth';
import type { CloudConfig } from '../manager/cloud/config';
import { serveCloud } from '../manager/cloud/main';
import type { SqlPool } from '../manager/cloud/postgres-store';
import { loadFixture } from './cloud-load-fixture';

const key = process.env.HANU_LOAD_TEST_KEY ?? '';
if (!/^[a-f0-9]{64}$/.test(key)) throw new Error('Set HANU_LOAD_TEST_KEY to a random 64-character hex key.');
const count = Number(process.env.HANU_LOAD_USERS ?? 10);
if (!Number.isInteger(count) || count < 1 || count > 20) throw new Error('HANU_LOAD_USERS must be 1..20.');
const dbDelay=Number(process.env.HANU_LOAD_DB_DELAY_MS??0);
if(!Number.isInteger(dbDelay)||dbDelay<0||dbDelay>1000)throw new Error('HANU_LOAD_DB_DELAY_MS must be 0..1000.');
const waitForDb=()=>dbDelay?new Promise<void>(resolve=>setTimeout(resolve,dbDelay)):Promise.resolve();
const fixture = await loadFixture(process.env.HANU_LOAD_DATABASE_URL);
const owners = Array.from({ length: count }, () => randomUUID());
await fixture.pool.query('INSERT INTO auth.users(id) SELECT unnest($1::uuid[])', [owners]);

await fixture.pool.query(`INSERT INTO hanu.accounts(user_id,email,email_verified,name,status,contact_name,phone,purpose,consent_at,max_profiles,max_concurrent,live_enabled)
  SELECT id,'synthetic-'||n||'@example.test',true,'Synthetic user '||n,'active','Synthetic user '||n,'0901234567','Synthetic load test',now(),100,100,true
  FROM unnest($1::uuid[]) WITH ORDINALITY AS t(id,ordinal) CROSS JOIN LATERAL (SELECT ordinal-1 AS n) x`, [owners]);

function authorized(req: IncomingMessage) {
  const supplied = String(req.headers.authorization ?? '').replace(/^Bearer /, '');
  return /^[a-f0-9]{64}$/.test(supplied) && timingSafeEqual(Buffer.from(supplied), Buffer.from(key));
}
function userIndex(req: IncomingMessage) {
  const value = String(req.headers['x-hanu-load-user'] ?? '');
  const index = /^\d+$/.test(value) ? Number(value) : -1;
  return index >= 0 && index < owners.length ? index : -1;
}
const auth: WebAuth = { request(req) {
  return {
    async user() {
      const index = userIndex(req);
      if (!authorized(req) || index < 0) return;
      return { id: owners[index], email: `synthetic-${index}@example.test`, name: `Synthetic user ${index}`,
        emailVerified: true, sessionKey: owners[index], expiresAt: Date.now() + 3600000 };
    },
    async login() { throw new Error('Load fixture has no real login.'); },
    async callback() { throw new Error('Load fixture has no real login.'); },
    async logout() {}
  };
} };
const config: CloudConfig = { origin: process.env.HANU_LOAD_ORIGIN ?? process.env.RENDER_EXTERNAL_URL ?? 'http://127.0.0.1:0',
  host: process.env.HOST ?? '127.0.0.1', port: Number(process.env.PORT ?? 0), development: true, trustProxy: true,
  supabaseUrl: 'http://127.0.0.1:54321', publishableKey: 'load-fixture-only', secretKey: 'load-fixture-only', databaseUrl: 'load-fixture-only' };

let calls = 0, active = 0, peakConnections = 0, queryMs: number[] = [], acquireMs: number[] = [];
const raw = fixture.pool;
const measured: SqlPool = {
  async query(sql, values) { const t = performance.now(); calls++; try { await waitForDb();return await raw.query(sql, values); } finally { queryMs.push(performance.now() - t); } },
  async connect() {
    const t = performance.now(), db = await raw.connect();
    acquireMs.push(performance.now() - t); peakConnections = Math.max(peakConnections, ++active);
    let released = false;
    return {
      release() { if (!released) { released = true; active--; db.release(); } },
      async query(sql, values) { const t = performance.now(); calls++; try { await waitForDb();return await db.query(sql, values); } finally { queryMs.push(performance.now() - t); } }
    };
  }
};
fixture.repository.pool = measured;
const app = await serveCloud({ config, repository: fixture.repository, auth, port: config.port });
if (config.origin === 'http://127.0.0.1:0') config.origin = `http://127.0.0.1:${(app.server.address() as {port:number}).port}`;
const delay = monitorEventLoopDelay({ resolution: 10 }); delay.enable();
let epoch = performance.now(), cpu = process.cpuUsage(), utilization = performance.eventLoopUtilization();
let peakRss = process.memoryUsage().rss, peakHeap = process.memoryUsage().heapUsed;
const sampler = setInterval(() => { const m = process.memoryUsage(); peakRss = Math.max(peakRss, m.rss); peakHeap = Math.max(peakHeap, m.heapUsed); }, 100);
function percentile(values: number[], p: number) { const sorted = [...values].sort((a,b)=>a-b); return sorted.length ? Math.round(sorted[Math.max(0,Math.ceil(sorted.length*p)-1)]*100)/100 : 0; }
function reset() {
  epoch = performance.now(); cpu = process.cpuUsage(); utilization = performance.eventLoopUtilization(); delay.reset();
  calls = 0; queryMs = []; acquireMs = []; peakConnections = active;
  const m = process.memoryUsage(); peakRss = m.rss; peakHeap = m.heapUsed;
}
function metrics() {
  const used = process.cpuUsage(cpu), duration = performance.now() - epoch, m = process.memoryUsage();
  return { durationMs: Math.round(duration), cpuMs: Math.round((used.user+used.system)/1000),
    cpuPercentOfOneCore: Math.round((used.user+used.system)/1000/duration*10000)/100,
    rssMiB: Math.round(m.rss/1048576), peakRssMiB: Math.round(Math.max(peakRss,m.rss)/1048576), peakHeapMiB: Math.round(Math.max(peakHeap,m.heapUsed)/1048576),
    eventLoopP95Ms: Math.round(delay.percentile(95)/1e4)/100, eventLoopMaxMs: Math.round(delay.max/1e4)/100,
    eventLoopUtilization: Math.round(performance.eventLoopUtilization(utilization).utilization*10000)/10000,
    queries: calls, queryP95Ms: percentile(queryMs,0.95), transactionAcquireP95Ms: percentile(acquireMs,0.95), peakTransactionConnections: peakConnections,
    extensionConnections: [...app.runtimes.values()].reduce((sum,r)=>sum+r.coordinator.peers.size,0),
    dashboardConnections: [...app.runtimes.values()].reduce((sum,r)=>sum+r.browsers.size,0) };
}
function json(res: ServerResponse, value: unknown, status = 200) { res.writeHead(status, {'Content-Type':'application/json','Cache-Control':'no-store'});res.end(JSON.stringify(value)); }
// These routes exist ONLY in this isolated harness; production has none.
const handlers = app.server.listeners('request'); app.server.removeAllListeners('request');
app.server.on('request', (req, res) => {
  if (!req.url?.startsWith('/__load/')) { for (const handler of handlers) handler.call(app.server,req,res); return; }
  if (!authorized(req)) { json(res,{error:'Unauthorized load fixture request.'},401);return; }
  if (req.method !== 'GET' && req.headers.origin !== config.origin) { json(res,{error:'Invalid origin.'},403);return; }
  void (async()=>{
    if (req.url==='/__load/info' && req.method==='GET') {
      const sessions = await measured.query('SELECT count(*)::int AS count FROM hanu.sessions');
      return json(res,{scope:'hanu-isolated-load-v1',users:owners.length,owners,database:fixture.database,
        databaseConnections:fixture.connections,embeddedDatabase:fixture.embeddedDatabase,injectedDbDelayMs:dbDelay,profileCount:sessions.rows[0].count,
        realGoogleForms:false,realSupabaseAuth:false,syntheticProxyIPs:true});
    }
    if (req.url==='/__load/metrics' && req.method==='GET') return json(res,metrics());
    if (req.url==='/__load/reset-metrics' && req.method==='POST') {reset();return json(res,{ok:true});}
    if (req.url==='/__load/checkpoint' && req.method==='GET') {
      const sessions = (await measured.query('SELECT owner,id,data FROM hanu.sessions ORDER BY owner,id')).rows;
      const locks = (await measured.query('SELECT owner,session,run,form,resolution FROM hanu.locks')).rows;
      const runs = (await measured.query('SELECT owner,session,id,data FROM hanu.runs')).rows;
      return json(res,{sessions:sessions.map(s=>({owner:s.owner,id:s.id,status:s.data.run?.status,seq:s.data.run?.eventSeq,submitAttempted:s.data.run?.submitAttempted})),
        locks,runs:runs.map(r=>({owner:r.owner,session:r.session,id:r.id,status:r.data.status}))});
    }
    json(res,{error:'Unknown load fixture route.'},404);
  })().catch(()=>json(res,{error:'Load fixture read failed.'},500));
});
// Emulate the user's ten independent networks. Render otherwise sees the
// single load generator's actual IP. Only this authenticated fixture can do it.
const upgrades = app.server.listeners('upgrade'); app.server.removeAllListeners('upgrade');
app.server.on('upgrade',(req,socket,head)=>{
  const index=userIndex(req);
  if(!authorized(req)||index<0){socket.destroy();return;}
  req.headers['x-forwarded-for']=`198.51.100.${index+1}`;
  for(const handler of upgrades)handler.call(app.server,req,socket,head);
});
let closing = false;
async function close() { if(closing)return;closing=true;clearInterval(sampler);delay.disable();await app.close();await fixture.close(); }
for(const signal of ['SIGTERM','SIGINT'] as const)process.on(signal,()=>{void close().then(()=>process.exit(0),()=>process.exit(1));});
// Ready output contains no key, database URL, or credentials.
console.log('HANU_LOAD_READY '+JSON.stringify({origin:config.origin,database:fixture.database,keyFingerprint:createHash('sha256').update(key).digest('hex').slice(0,8)}));
