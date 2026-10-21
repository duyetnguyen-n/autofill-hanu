import { PGlite } from '@electric-sql/pglite';
import { readFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import type { SqlPool, SqlConnection, PrivateObjects } from '../../manager/cloud/postgres-store';
import { CloudRepository } from '../../manager/cloud/postgres-store';
import type { WebAuth, WebUser } from '../../manager/cloud/auth';
import { serveCloud } from '../../manager/cloud/main';
import { emptyProfile } from '../../src/rules';

export const users = ['11111111-1111-4111-8111-111111111111', '22222222-2222-4222-8222-222222222222'];
export const extension = 'a'.repeat(32);

// PGlite runs PostgreSQL itself in WASM. Its one connection is serialized here;
// tests exercise the real migration, RLS, SQL transactions and row predicates.
export async function databaseFixture() {
  const db = new PGlite();
  await db.exec(`CREATE ROLE anon; CREATE ROLE authenticated;
    CREATE SCHEMA auth; CREATE TABLE auth.users(id uuid PRIMARY KEY,email text,raw_user_meta_data jsonb DEFAULT '{}',created_at timestamptz NOT NULL DEFAULT now(),last_sign_in_at timestamptz);
    CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$ SELECT nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
    GRANT USAGE ON SCHEMA auth TO authenticated;
    CREATE SCHEMA storage; CREATE TABLE storage.buckets(id text PRIMARY KEY,name text,public boolean,file_size_limit bigint,allowed_mime_types text[]);
    INSERT INTO auth.users VALUES('${users[0]}'),('${users[1]}');`);
  await db.exec(await readFile('supabase/migrations/202610130001_cloud.sql', 'utf8'));
  await db.exec(await readFile('supabase/migrations/202610150001_user_access.sql', 'utf8'));
  await db.exec(await readFile('supabase/migrations/202610150002_google_approval_only.sql', 'utf8'));
  await db.exec(await readFile('supabase/migrations/202610200001_registration_schedule.sql', 'utf8'));
  // Existing tests opt into approved synthetic accounts; new access tests remove
  // these grants explicitly to exercise the default pending state.
  await db.exec(`INSERT INTO hanu.accounts(user_id,email,email_verified,name,status,contact_name,phone,purpose,consent_at,max_profiles,max_concurrent,live_enabled)
    VALUES('${users[0]}','an@example.test',true,'An thử nghiệm','active','An thử nghiệm','0901234567','Kiểm thử sản phẩm',now(),100,100,true),
    ('${users[1]}','binh@example.test',true,'Bình thử nghiệm','active','Bình thử nghiệm','0902345678','Kiểm thử sản phẩm',now(),100,100,true) ON CONFLICT(user_id) DO UPDATE SET email=EXCLUDED.email,email_verified=EXCLUDED.email_verified,name=EXCLUDED.name,status=EXCLUDED.status,contact_name=EXCLUDED.contact_name,phone=EXCLUDED.phone,purpose=EXCLUDED.purpose,consent_at=EXCLUDED.consent_at,max_profiles=EXCLUDED.max_profiles,max_concurrent=EXCLUDED.max_concurrent,live_enabled=EXCLUDED.live_enabled;`);
  let tail = Promise.resolve();
  async function lock() {
    const previous = tail; let unlock!: () => void;
    tail = new Promise<void>(resolve => { unlock = resolve; });
    await previous; return unlock;
  }
  const query: SqlConnection['query'] = async (sql, values) => {
    const result = await db.query(sql, values);
    return { rows: result.rows, rowCount: result.rows.length || result.affectedRows || 0 };
  };
  const pool: SqlPool = {
    async query(sql, values) { const unlock = await lock(); try { return await query(sql, values); } finally { unlock(); } },
    async connect() { const unlock = await lock(); return { query, release: unlock }; }
  };
  const blobs = new Map<string, Buffer>();
  const objects: PrivateObjects = {
    async put(path, bytes) { blobs.set(path, Buffer.from(bytes)); },
    async get(path) { const result = blobs.get(path); if (!result) throw new Error('Missing test object'); return Buffer.from(result); }
  };
  const repository = new CloudRepository(pool, objects, randomUUID());
  await repository.claimLease();
  async function pair(owner = users[0], ready = true) {
    const result = await repository.pair(randomUUID(), extension, await repository.pairCode(owner));
    const store = repository.store(owner);
    await store.connected(result.sessionId, true);
    if (ready) {
      const s = await store.session(result.sessionId);
      s.name = owner === users[0] ? 'Chrome thử An' : 'Chrome thử Bình';
      s.expectedEmail = owner === users[0] ? 'an@example.test' : 'binh@example.test';
      s.profile = emptyProfile(); s.profile.values.fullName = s.name; s.synced = true;
      await store.saveSession(s);
    }
    return { ...result, store };
  }
  return { db, pool, objects, blobs, repository, pair, async close() { await db.close(); } };
}

export async function httpFixture(uiDir?: string, hcmueEnabled = false) {
  const fixture = await databaseFixture();
  if (hcmueEnabled) await fixture.db.exec(await readFile('supabase/migrations/202610210001_hcmue_runners.sql','utf8'));
  const authorized = new Set(['account-a', 'account-b']);
  let loginUser = 0;
  const auth: WebAuth = { request(req, res) {
    const cookie = req.headers.cookie?.match(/test-account=(account-[ab])/), key = cookie?.[1];
    return {
      async login() { return `${config.origin}/auth/callback?code=fixture-${loginUser}`; },
      async callback(code) {
        if (!/^fixture-[01]$/.test(code)) throw new Error('Invalid fixture login');
        const key = code.endsWith('0') ? 'account-a' : 'account-b'; authorized.add(key);
        res.setHeader('Set-Cookie', `test-account=${key}; HttpOnly; SameSite=Lax; Path=/`);
      },
      async user(): Promise<WebUser | undefined> {
        if (!key || !authorized.has(key)) return;
        const index = key === 'account-a' ? 0 : 1;
        return { id: users[index], name: ['An thử nghiệm', 'Bình thử nghiệm'][index], email: ['an@example.test', 'binh@example.test'][index], emailVerified: true, googleSub: `fixture-google-${index}`, sessionKey: key, expiresAt: Date.now() + 3600000 };
      },
      async logout() { if (key) authorized.delete(key); res.setHeader('Set-Cookie', 'test-account=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0'); }
    };
  } };
  const config = { origin: 'http://127.0.0.1:0', host: '127.0.0.1', port: 0, development: true,
    supabaseUrl: 'http://127.0.0.1:54321', publishableKey: 'fixture-only', secretKey: 'fixture-only', databaseUrl: 'fixture-only', hcmueEnabled };
  const app = await serveCloud({ config, repository: fixture.repository, auth, port: 0, uiDir });
  config.origin = `http://127.0.0.1:${(app.server.address() as { port: number }).port}`;
  const api = async (path: string, owner = 0, data?: unknown, method = data === undefined ? 'GET' : 'POST') => fetch(`${config.origin}/api/${path}`, {
    method, headers: { Cookie: `test-account=account-${owner ? 'b' : 'a'}`, Origin: config.origin, 'Content-Type': 'application/json' }, body: data === undefined ? undefined : JSON.stringify(data)
  });
  return { ...fixture, app, config, auth, api, authorized, setLoginUser(index: number) { loginUser = index; }, async close() { await app.close(); await fixture.close(); } };
}
