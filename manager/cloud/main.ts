import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import {isIP} from 'node:net';
import { randomBytes, randomUUID } from 'node:crypto';
import { existsSync, readFileSync, statSync } from 'node:fs';
import { extname, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { WebSocket, WebSocketServer } from 'ws';
import { Coordinator } from '../server/coordinator';
import { AttentionQueue } from '../server/attention';
import { RunBuffer } from '../server/run-buffer';
import { PROTOCOL_VERSION } from '../../src/protocol';
import { CloudRepository, CloudError, LeaseBusyError, MAX_ATTACHMENT_BYTES, type PostgresStore } from './postgres-store';
import { checkCloudDatabase } from './readiness';
import { supabaseAuth, type WebAuth, type WebUser } from './auth';
import { cloudConfig, databasePool, type CloudConfig } from './config';
import { supabaseObjects } from './storage';
import { digest } from '../server/store';
import {MAX_ARCHIVE_BYTES} from '../server/archive';
import {importArchive} from './import-archive';
import { Accounts } from './accounts';
import { assertAccess, assertLive } from './access-policy';
import type { Account } from '../../src/account';

interface Runtime {
  store: PostgresStore; coordinator: Coordinator; browsers: Set<WebSocket>;
  dirty: boolean; broadcasting: boolean; touched: number;
  snapshot?: Promise<{ sessions: Awaited<ReturnType<PostgresStore['sessions']>>; groups: Awaited<ReturnType<PostgresStore['groups']>> }>;
  broadcastTimer?: ReturnType<typeof setTimeout>;
}
interface Ticket { user: WebUser; expires: number }
class RateLimit {
  entries = new Map<string, { count: number; expires: number }>();
  check(key: string, limit: number, ms: number) {
    const now = Date.now();
    const old = this.entries.get(key);
    if (old && old.expires > now) { if (++old.count > limit) throw new CloudError('Quá nhiều yêu cầu. Chờ một chút rồi thử lại.', 429); }
    else this.entries.set(key, { count: 1, expires: now + ms });
    if (this.entries.size > 10000) {
      for (const [id, entry] of this.entries) if (entry.expires <= now) this.entries.delete(id);
      if (this.entries.size > 10000) throw new CloudError('Server đang bận. Thử lại sau.', 503);
    }
  }
}
async function body(req: IncomingMessage,limit=Math.ceil(MAX_ATTACHMENT_BYTES * 4 / 3) + 65536) {
  if (!/^application\/json(?:;|$)/i.test(String(req.headers['content-type'] ?? ''))) throw new CloudError('Yêu cầu phải là JSON.', 415);
  let size = 0; const parts: Buffer[] = [];
  for await (const chunk of req) {
    size += chunk.length;
    if (size > limit) throw new CloudError('Yêu cầu quá lớn.', 413);
    parts.push(chunk);
  }
  try {
    const value = parts.length ? JSON.parse(Buffer.concat(parts).toString()) : {};
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error();
    return value;
  } catch { throw new CloudError('Nội dung JSON không hợp lệ.'); }
}

export async function serveCloud(options: {
  config: CloudConfig; repository: CloudRepository; auth?: WebAuth; uiDir?: string;
  port?: number; host?: string;
}) {
  const { config, repository } = options;
  const auth = options.auth ?? supabaseAuth(config);
  const accounts = new Accounts(repository.pool, config.bootstrapAdminEmail);
  const accessCache = new Map<string, { account: Account; checked: number }>();
  const changingAccess = new Set<string>();
  async function allowed(owner: string, fresh = false) {
    const cached = accessCache.get(owner);
    let account = cached?.account;
    if (fresh || !cached || Date.now() - cached.checked >= 2000) {
      account = await accounts.get(owner);
      if (account) accessCache.set(owner, { account, checked: Date.now() });
    }
    if (account?.expiresAt && Date.parse(account.expiresAt) <= Date.now()) account = { ...account, status: 'expired' };
    assertAccess(account);
    return account;
  }
  const uiDir = options.uiDir ?? resolve(fileURLToPath(new URL('.', import.meta.url)), '../cloud-ui');
  const runtimes = new Map<string, Runtime>();
  const tickets = new Map<string, Ticket>();
  const browserUsers = new Map<WebSocket, WebUser>();
  const lastSeen = new Map<WebSocket, number>();
  const rate = new RateLimit();
  const sockets = new WebSocketServer({ noServer: true, maxPayload: 1024 * 1024 });
  let emergencyError = '', closing = false;
  let ready = false, ownsLease = false;
  let activation: Promise<void> | undefined, renewal: Promise<void> | undefined;
  let leaseTimer: ReturnType<typeof setInterval> | undefined, retryTimer: ReturnType<typeof setTimeout> | undefined;
  const updating = 'Website đang cập nhật. Đang chờ server cũ dừng; kết nối sẽ tự thử lại, không cần liên kết lại extension.';
  function clientIp(req:IncomingMessage){
    const forwarded=config.trustProxy?String(req.headers['x-forwarded-for']??'').split(',').at(-1)?.trim():undefined;
    return forwarded&&isIP(forwarded)?forwarded:req.socket.remoteAddress??'unknown';
  }
  function activate() {
    const attempt = (async () => {
      await repository.claimLease();
      ownsLease = true;
      leaseTimer ??= setInterval(() => {
        if (closing || emergencyError || renewal) return;
        renewal = repository.renewLease().catch(failClosed).finally(() => { renewal = undefined; });
      }, 20000);
      // Recovery mutates sessions, so it must never run in the waiting instance.
      await repository.recover();
      if (emergencyError) throw new CloudError(emergencyError, 503);
      ready = !closing;
    })();
    activation = attempt;
    return attempt.finally(() => { activation = undefined; });
  }
  await checkCloudDatabase(repository.pool);
  try { await activate(); }
  catch (error) {
    if (config.rollingDeploy && error instanceof LeaseBusyError) {
      // This is HTTP availability, not coordinator readiness. Render must route
      // traffic before it sends SIGTERM to the old instance. Validate dependencies
      // without touching live sessions, then serve explicit 503s until we own the lease.
      await checkCloudDatabase(repository.pool);
      console.log('HANU Cloud waiting for the previous coordinator; HTTP available, commands disabled.');
    } else {
      clearInterval(leaseTimer); await renewal;
      if (ownsLease) await repository.releaseLease();
      throw error;
    }
  }

  const state = async (runtime: Runtime) => {
    runtime.snapshot ??= Promise.all([runtime.store.sessions(), runtime.store.groups()]).then(([sessions, groups]) => ({sessions,groups}));
    const saved = await runtime.snapshot;
    return {sessions: runtime.coordinator.runBuffer!.overlay(saved.sessions),groups:saved.groups,owner:runtime.store.owner,
      allowedExtensionIds: [], platform: { os: 'cloud', arch: '' }, cloud: true, emergencyError};
  };
  function failClosed(error: unknown) {
    if (closing || emergencyError) return;
    emergencyError = 'Bộ điều phối không lưu hoặc xác nhận được tiến độ. Đã ngừng cấp lệnh; kết nối lại và đối chiếu trước khi tiếp tục.';
    console.error('Cloud coordinator stopped:', error instanceof CloudError ? error.message : 'Database or transport unavailable');
    for (const runtime of runtimes.values()) {
      runtime.coordinator.attention.close();
      for (const ws of runtime.coordinator.peers.values()) {
        if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ type: 'EMERGENCY_STOP', error: emergencyError }));
        ws.close(1011, 'Coordinator unavailable');
      }
      for(const ws of runtime.browsers){if(ws.readyState===WebSocket.OPEN)ws.send(JSON.stringify({type:'SERVER_ERROR',error:emergencyError}));ws.close(1011,'Coordinator unavailable');}
    }
    for(const ws of sockets.clients)ws.close(1011,'Coordinator unavailable');
  }
  async function broadcast(runtime: Runtime) {
    runtime.dirty = true;
    if (runtime.broadcasting) return;
    runtime.broadcasting = true;
    try {
      while (runtime.dirty && !closing) {
        runtime.dirty = false;
        if (!runtime.browsers.size) continue;
        const message = JSON.stringify({ type: 'STATE', ...await state(runtime) });
        for (const ws of runtime.browsers) if (ws.readyState === WebSocket.OPEN) {
          if (ws.bufferedAmount > 2 * 1024 * 1024) ws.close(1013, 'Slow client');
          else ws.send(message);
        }
      }
    } catch (error) { failClosed(error); } finally { runtime.broadcasting = false; }
  }
  function runtime(owner: string) {
    let result = runtimes.get(owner);
    if (!result) {
      const store = repository.store(owner), coordinator = new Coordinator(store, new AttentionQueue(), true, new RunBuffer(store));
      result = { store, coordinator, browsers: new Set(), dirty: false, broadcasting: false, touched: Date.now() };
      coordinator.launchUrl = config.origin;
      coordinator.unavailable=error=>{if(!(error instanceof CloudError)||error.status===503)failClosed(error);};
      coordinator.progressUnavailable=failClosed;
      const sendCommand = coordinator.command.bind(coordinator);
      coordinator.command = async (id, kind, payload = {}, runId, timeout) => {
        if (!['STOP', 'STOP_PROFILE', 'PAUSE'].includes(kind)) {
          const account = await allowed(owner, ['START', 'RESUME'].includes(kind));
          if (kind === 'START') assertLive(account, String(payload.mode));
          if (kind === 'RESUME') assertLive(account, (await store.session(id)).run?.mode ?? 'test');
        }
        return sendCommand(id, kind, payload, runId, timeout);
      };
      const current = result;
      coordinator.changed = () => { current.snapshot=undefined;void broadcast(current); };
      coordinator.progressChanged = () => {
        // Live overlays need no SQL. Bound UI work independently of form speed.
        if(!current.broadcastTimer)current.broadcastTimer=setTimeout(()=>{current.broadcastTimer=undefined;void broadcast(current);},100);
      };
      runtimes.set(owner, result);
    }
    result.touched = Date.now();
    return result;
  }
  async function interruptAccess(owner: string, message = 'Quyền sử dụng đã thay đổi. Tải lại để kiểm tra.') {
    accessCache.delete(owner);
    for (const [key, ticket] of tickets) if (ticket.user.id === owner) tickets.delete(key);
    const current = runtimes.get(owner);
    if (!current) return;
    for (const ws of current.browsers) {
      if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ type: 'ACCESS_CHANGED', error: message }));
      ws.close(1008, 'Access changed');
    }
    const peers = [...current.coordinator.peers];
    for (const [, ws] of peers) {
      if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ type: 'EMERGENCY_STOP', error: message }));
      ws.close(1008, 'Access changed');
    }
    await Promise.all(peers.map(([id, ws]) => current.coordinator.disconnect(id, ws)));
    await current.coordinator.settledConnections();
  }
  function json(res: ServerResponse, value: unknown, status = 200) {
    res.statusCode = status; res.setHeader('Content-Type', 'application/json; charset=utf-8'); res.end(JSON.stringify(value));
  }
  const server = createServer(async (req, res) => {
    res.setHeader('Cache-Control', 'private, no-store');
    res.setHeader('Referrer-Policy', 'no-referrer');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Content-Security-Policy', "default-src 'self'; connect-src 'self'; img-src 'self' blob: data:; style-src 'self' 'unsafe-inline'; script-src 'self'; frame-ancestors 'none'; base-uri 'self'; form-action 'self'");
    try {
      if (req.headers.host !== new URL(config.origin).host) throw new CloudError('Host không hợp lệ.', 403);
      const url = new URL(req.url ?? '/', config.origin), path = url.pathname;
      if (path === '/healthz' && req.method === 'GET') return json(res,
        { ok: !emergencyError && !closing, ...(!ready ? { coordinator: 'waiting' } : {}) }, emergencyError || closing ? 503 : 200);
      if (path === '/readyz' && req.method === 'GET') return json(res,
        ready && !emergencyError && !closing ? { ok: true } : { ok: false, error: emergencyError || updating }, ready && !emergencyError && !closing ? 200 : 503);
      if (path === '/api/auth/config' && req.method === 'GET') return json(res, { cloud: true });
      if (path === '/auth/callback' && req.method === 'GET') {
        const requestAuth = auth.request(req, res);
        const code = url.searchParams.get('code');
        if (!code || code.length > 4096 || url.searchParams.has('error')) { res.writeHead(303, { Location: '/?auth_error=1' }); return res.end(); }
        try { await requestAuth.callback(code); const user = await requestAuth.user(); if (!user) throw new CloudError('Đăng nhập Google không hợp lệ.', 401); await accounts.identify(user); }
        catch { res.writeHead(303, { Location: '/?auth_error=1' }); return res.end(); }
        res.writeHead(303, { Location: '/' }); return res.end();
      }
      if (path.startsWith('/api/')) {
        if (req.method !== 'GET' && req.headers.origin !== config.origin) throw new CloudError('Origin không hợp lệ.', 403);
        const requestAuth = auth.request(req, res);
        if (path === '/api/auth/login' && req.method === 'POST') {
          rate.check(`login:${clientIp(req)}`, 20, 60000);
          await body(req); return json(res, { url: await requestAuth.login() });
        }
        const user = await requestAuth.user();
        if (!user) throw new CloudError('Đăng nhập Google để mở trang quản lý.', 401);
        const account = await accounts.identify(user);
        if (path === '/api/auth/me' && req.method === 'GET') return json(res, account);
        if (path === '/api/auth/logout' && req.method === 'POST') {
          await body(req); await requestAuth.logout();
          for (const [ws, browser] of browserUsers) if (browser.sessionKey === user.sessionKey && browser.id === user.id) ws.close(1008, 'Signed out');
          for (const [ticket, entry] of tickets) if (entry.user.sessionKey === user.sessionKey && entry.user.id === user.id) tickets.delete(ticket);
          return json(res, { ok: true });
        }
        if (emergencyError) throw new CloudError(emergencyError, 503);
        if (!ready || closing) { res.setHeader('Retry-After', '2'); throw new CloudError(updating, 503); }
        rate.check(`api:${user.id}`, 300, 60000);
        if (path === '/api/account' && req.method === 'PATCH') {
          rate.check(`account:${user.id}`, 10, 60000);
          const result = await accounts.profile(user.id, await body(req, 4096));
          accessCache.delete(user.id);
          return json(res, result);
        }
        if (path.startsWith('/api/admin/')) {
          await accounts.requireAdmin(user.id);
          rate.check(`admin:${user.id}`, 120, 60000);
          if (path === '/api/admin/accounts' && req.method === 'GET') return json(res, await accounts.list(url.searchParams));
          if (path === '/api/admin/events' && req.method === 'GET') return json(res, await accounts.events());
          if (path === '/api/admin/grants' && req.method === 'GET') return json(res, await accounts.grants());
          if (path === '/api/admin/grants' && req.method === 'POST') return json(res, await accounts.createGrant(user.id, await body(req, 4096)), 201);
          if (path === '/api/admin/grants' && req.method === 'DELETE') {
            await accounts.deleteGrant(user.id, String((await body(req, 1024)).email ?? ''));
            return json(res, { ok: true });
          }
          const match = path.match(/^\/api\/admin\/accounts\/([0-9a-f-]{36})(?:\/sessions\/([a-zA-Z0-9-]{20,80})\/revoke)?$/);
          if (match) {
            const target = match[1], session = match[2];
            if (!session && req.method === 'GET') return json(res, { ...await accounts.detail(target), events: await accounts.events(target) });
            if (!session && req.method === 'PATCH') {
              if (changingAccess.has(target)) throw new CloudError('Tài khoản đang được cập nhật. Thử lại sau.', 409);
              const value = await body(req, 8192);
              changingAccess.add(target);
              try {
                const updated = await accounts.update(user.id, target, value);
                accessCache.delete(target);
                if (updated.interrupt) await interruptAccess(target);
                else for (const ws of runtimes.get(target)?.browsers ?? []) if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ type: 'ACCOUNT_UPDATED' }));
                return json(res, { ...updated.account, interrupted: updated.interrupt });
              } finally { changingAccess.delete(target); }
            }
            if (session && req.method === 'POST') {
              await body(req, 1024);
              const ws = runtimes.get(target)?.coordinator.peers.get(session);
              await accounts.revokeExtension(user.id, target, session);
              if (ws?.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ type: 'REVOKED' }));
              ws?.close(1008, 'Revoked');
              if (ws) await runtimes.get(target)?.coordinator.disconnect(session, ws);
              else await repository.store(target).connected(session, false);
              runtimes.get(target)?.coordinator.changed();
              return json(res, { ok: true });
            }
          }
          throw new CloudError('Không tìm thấy API quản trị.', 404);
        }
        assertAccess(account);
        await allowed(user.id);
        const current = runtime(user.id), { store, coordinator } = current;
        if(path==='/api/import'&&req.method==='POST'){
          rate.check(`import:${user.id}`,3,3600000);
          const result=await importArchive(repository,user.id,await body(req,MAX_ARCHIVE_BYTES));coordinator.changed();return json(res,result);
        }
        if (path === '/api/events-ticket' && req.method === 'POST') {
          await body(req);
          const ticket = randomBytes(32).toString('hex');
          if(tickets.size>=5000)throw new CloudError('Server đang bận. Thử lại sau.',503);
          tickets.set(digest(ticket), { user, expires: Date.now() + 10000 });
          return json(res, { ticket });
        }
        if (path === '/api/state' && req.method === 'GET') return json(res, await state(current));
        if (path === '/api/pair' && req.method === 'POST') {
          rate.check(`pair:${user.id}`, 20, 60000);
          const value = await body(req);
          if (value.replaceSessionId !== undefined && typeof value.replaceSessionId !== 'string') throw new CloudError('Profile liên kết lại không hợp lệ.');
          return json(res, { code: await repository.pairCode(user.id, value.replaceSessionId), expiresIn: 300 });
        }
        if (path === '/api/start' && req.method === 'POST') { const value = await body(req); await Promise.all((await store.sessions()).map(s => coordinator.runBuffer?.flush(s.id))); return json(res, await coordinator.start(value.ids, value.url, value.mode, value.finalQuestion)); }
        if (path === '/api/final-question' && req.method === 'POST') { const value = await body(req); return json(res, await coordinator.setFinalQuestion(value.ids, value.finalQuestion, value.resume === true)); }
        const group = path.match(/^\/api\/groups\/([^/]+)\/(pause|resume|stop)$/);
        if (group && req.method === 'POST') { await body(req); return json(res, await coordinator.groupControl(group[1], group[2].toUpperCase() as 'PAUSE' | 'RESUME' | 'STOP')); }
        const match = path.match(/^\/api\/sessions\/([^/]+)(?:\/(.*))?$/);
        if (match) {
          const [, id, action] = match;
          // Gate even read-only commands BEFORE contacting an extension.
          const s = await store.session(id);
          if (req.method === 'PATCH' && !action) return json(res, await coordinator.edit(id, await body(req)));
          if (req.method === 'GET' && action === 'history') return json(res, await store.history(id));
          if (req.method === 'GET' && action?.startsWith('attachments/')) {
            const attachmentId = action.slice('attachments/'.length);
            if (!Object.values(s.profile?.attachments ?? {}).some(a => a?.id === attachmentId)) throw new CloudError('Không tìm thấy ảnh.', 404);
            const attachment = await store.attachment(id, attachmentId);
            res.setHeader('Content-Type', 'application/octet-stream');
            res.setHeader('Content-Disposition', 'attachment'); return res.end(attachment.data);
          }
          if (req.method === 'POST') {
            const value = await body(req);
            if (action === 'ping') return json(res, await coordinator.command(id, 'PING', {}, undefined, 5000));
            if (action === 'focus') return json(res, await coordinator.command(id, 'FOCUS'));
            if (action === 'scan') return json(res, await coordinator.command(id, 'SCAN_FORM'));
            if (action === 'pull') return json(res, await coordinator.pull(id));
            if (action === 'push') return json(res, await coordinator.push(id, value.force === true));
            if (action === 'use-extension') { if (!s.conflict) throw new CloudError('Không có xung đột.'); await coordinator.importDocument(id, s.conflict); return json(res, await store.session(id)); }
            if (['pause', 'resume', 'stop'].includes(action)) return json(res, await coordinator.control(id, action.toUpperCase() as 'PAUSE' | 'RESUME' | 'STOP'));
            if (action === 'reconcile') return json(res, await coordinator.command(id, 'RECONCILE', {}, s.run?.runId));
            if (action === 'resolve') { if (!['received', 'not_received'].includes(value.result)) throw new CloudError('Kết quả xác minh không hợp lệ.'); await coordinator.resolve(id, value.result); return json(res, { ok: true }); }
            if (action === 'unlink') {
              // Closing the socket halts the client, revocation prevents HELLO.
              const peer = coordinator.peers.get(id);
              peer?.send(JSON.stringify({ type: 'REVOKED' })); peer?.close(1008, 'Unlinked');
              coordinator.runBuffer?.halt(id);await coordinator.runBuffer?.flush(id);coordinator.runBuffer?.forget(id);
              await repository.revoke(user.id, id); coordinator.changed(); return json(res, { ok: true });
            }
            if (action === 'attachment') {
              if (!s.profile) throw new CloudError('Đọc hồ sơ trước khi thêm ảnh.');
              if (typeof value.base64 !== 'string' || !/^[A-Za-z0-9+/]*={0,2}$/.test(value.base64) || typeof value.name !== 'string' || value.name.length > 255 || !['image/jpeg', 'image/png', 'image/webp', 'application/pdf'].includes(value.mimeType) || !['identityDocument'].includes(String(value.key ?? 'identityDocument'))) throw new CloudError('Chọn ảnh JPG, PNG, WebP hoặc PDF hợp lệ.');
              const bytes = Buffer.from(value.base64, 'base64'), attachmentId = randomUUID();
              if (!bytes.length || bytes.length > MAX_ATTACHMENT_BYTES) throw new CloudError('Ảnh phải có dung lượng từ 1 byte đến 10 MB.', 413);
              await store.saveAttachment(id, attachmentId, bytes, digest(bytes));
              const latest = await store.session(id);
              if (!latest.profile) throw new CloudError('Hồ sơ đã thay đổi. Đọc lại trước khi thêm ảnh.', 409);
              latest.profile.attachments[String(value.key ?? 'identityDocument')] = { id: attachmentId, name: value.name, type: value.mimeType, size: bytes.length, updatedAt: new Date().toISOString() };
              latest.synced = false; await store.saveSession(latest); coordinator.changed(); return json(res, latest);
            }
          }
        }
        throw new CloudError('Không tìm thấy API.', 404);
      }
      if (req.method !== 'GET') throw new CloudError('Method không hợp lệ.', 405);
      const file = resolve(uiDir, '.' + decodeURIComponent(['/', '/admin', '/account'].includes(path) ? '/index.html' : path));
      if (!file.startsWith(resolve(uiDir) + sep) || !existsSync(file) || !statSync(file).isFile()) throw new CloudError('Không tìm thấy trang.', 404);
      const types: Record<string, string> = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.woff2': 'font/woff2' };
      res.setHeader('Content-Type', types[extname(file)] ?? 'application/octet-stream'); res.end(readFileSync(file));
    } catch (error) {
      if (!(error instanceof CloudError) && /^(08|53|57|58)/.test(String((error as { code?: string }).code ?? ''))) failClosed(error);
      // Database messages may include private values. Do not expose them.
      const databaseError = !!(error as { code?: string }).code;
      json(res, { error: error instanceof CloudError || !databaseError ? (error as Error).message : 'Không xử lý được dữ liệu. Kiểm tra cấu hình server.', ...(error instanceof CloudError && error.code ? { code: error.code } : {}) }, error instanceof CloudError ? error.status : databaseError ? 503 : 400);
    }
  });

  server.on('upgrade', (req, socket, head) => {
    try {
      const path = req.url;
      if (!ready || closing || emergencyError || req.headers.host !== new URL(config.origin).host) throw new CloudError('Unavailable', 503);
      if (path === '/events') {
        if (req.headers.origin !== config.origin) throw new CloudError('Origin', 403);
      } else if (path === '/extensions') {
        // Browsers cannot pose as an extension. A missing Origin is permitted
        // for Chrome service workers; the token/code remains the credential.
        if (req.headers.origin && !/^chrome-extension:\/\/[a-p]{32}$/.test(req.headers.origin)) throw new CloudError('Origin', 403);
        rate.check(`upgrade:${clientIp(req)}`, 100, 60000);
      } else throw new CloudError('Not found', 404);
      sockets.handleUpgrade(req, socket, head, ws => {
        lastSeen.set(ws, Date.now());
        let owner: string | undefined, id: string | undefined, current: Runtime | undefined;
        let chain = Promise.resolve(), authenticated = false;
        let expiry: ReturnType<typeof setTimeout> | undefined;
        const handshake = setTimeout(() => ws.close(1008, 'Handshake timeout'), 10000);
        const onMessage = async (raw: string) => {
          if (ws.readyState !== WebSocket.OPEN) return;
          const m = JSON.parse(raw);
          if (!authenticated) {
            if (path === '/events') {
              if (m.type !== 'AUTH' || typeof m.ticket !== 'string') throw new CloudError('Authentication required', 401);
              const key = digest(m.ticket), ticket = tickets.get(key); tickets.delete(key);
              if (!ticket || ticket.expires < Date.now() || ticket.user.expiresAt <= Date.now()) throw new CloudError('Session expired', 401);
              owner = ticket.user.id; await allowed(owner, true); current = runtime(owner); current.browsers.add(ws); browserUsers.set(ws, ticket.user);
              authenticated = true; clearTimeout(handshake);
              expiry = setTimeout(() => ws.close(1008, 'Refresh session'), Math.min(ticket.user.expiresAt - Date.now(), 30 * 60000));
              await broadcast(current); return;
            }
            rate.check(`handshake:${clientIp(req)}`, 30, 60000);
            if (m.accessPolicy !== 1) throw new CloudError('Cập nhật và Reload extension bản mới để sử dụng cơ chế cấp quyền tài khoản.', 403);
            if (m.protocol !== PROTOCOL_VERSION || m.transport !== 'cloud' || !/^[a-zA-Z0-9-]{20,80}$/.test(m.sessionId) || !/^[a-p]{32}$/.test(m.extensionId) || req.headers.origin && req.headers.origin !== `chrome-extension://${m.extensionId}`) throw new CloudError('Extension hoặc giao thức không hợp lệ.', 401);
            if (m.type === 'PAIR') {
              const paired = await repository.pair(m.sessionId, m.extensionId, String(m.code ?? ''));
              owner = paired.owner; id = paired.sessionId; current = runtime(owner);
              await current.coordinator.connect(id, ws);
              if (ws.readyState !== WebSocket.OPEN) { await current.coordinator.disconnect(id, ws); return; }
              ws.send(JSON.stringify({ type: 'PAIRED', sessionId: id, token: paired.token }));
            } else if (m.type === 'HELLO') {
              owner = await repository.authenticate(m.sessionId, m.extensionId, String(m.token ?? ''));
              if (!owner) { ws.send(JSON.stringify({ type: 'UNPAIRED' })); ws.close(1008, 'Unpaired'); return; }
              id = m.sessionId; current = runtime(owner);
              await current.coordinator.connect(id!, ws);
              if (ws.readyState !== WebSocket.OPEN) { await current.coordinator.disconnect(id!, ws); return; }
              ws.send(JSON.stringify({ type: 'WELCOME', sessionId: id }));
            } else throw new CloudError('Handshake không hợp lệ.', 401);
            await allowed(owner!, true);
            authenticated = true; clearTimeout(handshake);
            void current!.coordinator.pull(id!).catch(async error => {
              if (closing) return;
              try { const s = await current!.store.session(id!); s.error = error instanceof CloudError || !(error as any).code ? (error as Error).message : 'Không đồng bộ được hồ sơ.'; await current!.store.saveSession(s); current!.coordinator.changed(); }
              catch (failure) { failClosed(failure); }
            });
            return;
          }
          if (path === '/events') { await allowed(owner!); return; }
          if (m.type !== 'RESULT') await allowed(owner!);
          if (current!.coordinator.peers.get(id!) !== ws) throw new CloudError('Kết nối đã được thu hồi.', 403);
          if (m.protocol !== PROTOCOL_VERSION || m.sessionId !== id) throw new CloudError('Mã phiên không khớp kết nối.', 401);
          if(m.type==='REQUEST'&&m.kind==='UNLINK'){
            await repository.revoke(owner!,id!);
            ws.send(JSON.stringify({type:'REPLY',requestId:m.requestId,ok:true}));ws.close(1008,'Unlinked');current!.coordinator.changed();return;
          }
          if (m.type === 'LOAD_FAILURE') await current!.coordinator.failure(id!, m.runId);
          else await current!.coordinator.receive(id!, m);
        };
        ws.on('message', raw => {
          lastSeen.set(ws, Date.now());
          const handle = async () => { try {if(authenticated&&path==='/extensions')rate.check(`messages:${owner}:${id}`,1800,60000);await onMessage(raw.toString()); } catch (error) {
            if (!(error instanceof CloudError) && (error as any).code) failClosed(error);
            if (ws.readyState === WebSocket.OPEN) {
              ws.send(JSON.stringify({ type: 'ERROR', error: error instanceof CloudError || !(error as any).code ? (error as Error).message : 'Không lưu được trạng thái.' }));
              if (authenticated && error instanceof CloudError && error.status === 403) {
                ws.send(JSON.stringify({ type: path === '/extensions' ? 'EMERGENCY_STOP' : 'ACCESS_CHANGED', error: error.message }));
              }
              if (!authenticated || error instanceof CloudError && [401, 403,429].includes(error.status)) ws.close(1008, 'Authentication failed');
            }
          } };
          // A CONTROL request may await a command RESULT. Let RESULT bypass the
          // profile queue to avoid deadlocking its own acknowledgement.
          let result = false;
          try {
            const message=JSON.parse(raw.toString());
            result=authenticated&&path==='/extensions'&&(message.type==='RESULT'||message.type==='REQUEST'&&String(message.kind).startsWith('ATTENTION_'));
          } catch {}
          if (result) void handle(); else chain = chain.then(handle);
        });
        ws.on('error', () => ws.terminate());
        ws.on('close', () => {
          clearTimeout(handshake); clearTimeout(expiry); lastSeen.delete(ws); browserUsers.delete(ws);
          current?.browsers.delete(ws);
          if (id && current) void current.coordinator.disconnect(id, ws).catch(failClosed);
        });
      });
    } catch (error) {
      socket.write(`HTTP/1.1 ${error instanceof CloudError ? error.status : 403} Forbidden\r\nConnection: close\r\n\r\n`); socket.destroy();
    }
  });
  server.requestTimeout = 30000; server.headersTimeout = 15000;
  try { await new Promise<void>((resolve, reject) => { server.once('error', reject); server.listen(options.port ?? config.port, options.host ?? config.host, resolve); }); }
  catch (error) { clearInterval(leaseTimer); await renewal; if (ownsLease) await repository.releaseLease(); throw error; }
  function retryActivation() {
    retryTimer = setTimeout(() => {
      if (closing || emergencyError || ready) return;
      void activate().then(() => {
        if (ready) console.log('HANU Cloud coordinator ready; extension connections may resume.');
      }).catch(error => {
        // Only contention is retryable. Database/recovery errors must fail closed.
        if (!(error instanceof LeaseBusyError)) failClosed(error);
      }).finally(() => { if (!closing && !emergencyError && !ready) retryActivation(); });
    }, 2000);
  }
  if (!ready) retryActivation();
  let accessCheck: Promise<unknown> | undefined;
  const heartbeat = setInterval(() => {
    if (!accessCheck && !closing && !emergencyError) {
      accessCheck = Promise.all([...runtimes].filter(([, r]) => r.browsers.size || r.coordinator.peers.size).map(async ([owner]) => {
        try { await allowed(owner, true); }
        catch (error) { if (error instanceof CloudError && error.status === 403) await interruptAccess(owner, error.message); else throw error; }
      })).catch(failClosed).finally(() => { accessCheck = undefined; });
    }
    for (const [owner, entry] of accessCache) if (Date.now() - entry.checked > 300000) accessCache.delete(owner);
    for (const [ws, seen] of lastSeen) if (Date.now() - seen > 65000 && !browserUsers.has(ws)) ws.terminate();
    for (const [key, ticket] of tickets) if (ticket.expires < Date.now()) tickets.delete(key);
    for (const [owner, current] of runtimes) if (!current.coordinator.peers.size && !current.browsers.size && !current.coordinator.pending.size && Date.now() - current.touched > 5 * 60000) { current.coordinator.attention.close(); runtimes.delete(owner); }
  }, 5000);
  return { server, repository, runtimes, async close() {
    closing = true; ready = false; clearInterval(heartbeat); clearInterval(leaseTimer); clearTimeout(retryTimer);
    // An in-flight claim/recovery must finish before release, or a closing
    // waiting instance could acquire a lease after its cleanup had completed.
    await activation?.catch(() => {}); clearInterval(leaseTimer); await renewal; await accessCheck;
    for (const current of runtimes.values()) {clearTimeout(current.broadcastTimer);current.coordinator.attention.close();}
    await Promise.all([...sockets.clients].map(ws => new Promise<void>(resolve => { ws.once('close', () => resolve()); ws.terminate(); })));
    // close callbacks schedule persistence; finish it before releasing the lease.
    for (const current of runtimes.values()) for (const [id, ws] of [...current.coordinator.peers]) await current.coordinator.disconnect(id, ws).catch(() => {});
    await Promise.all([...runtimes.values()].map(current=>current.coordinator.settledConnections()));
    await new Promise<void>(resolve => server.close(() => resolve())); sockets.close();
    if (ownsLease) await repository.releaseLease();
  } };
}

if (process.argv.includes('--serve-cloud')) {
  const config = cloudConfig(), pool = databasePool(config), repository = new CloudRepository(pool, supabaseObjects(config.supabaseUrl, config.secretKey), randomUUID());
  pool.on('error', () => console.error('Idle PostgreSQL connection failed.'));
  try {
    const app = await serveCloud({ config, repository });
    console.log(`HANU Cloud listening on ${config.host}:${config.port} (${config.origin})`);
    for (const signal of ['SIGINT', 'SIGTERM'] as const) process.once(signal, () => { void app.close().finally(() => pool.end()).then(() => process.exit()); });
  } catch (error) { await pool.end(); console.error(error instanceof CloudError ? error.message : 'Không khởi động được. Kiểm tra .env.cloud, chứng chỉ PostgreSQL và migration.'); process.exitCode = 1; }
}
