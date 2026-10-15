import { readFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { Pool } from 'pg';
import { databaseFixture } from '../tests/cloud/fixture';
import { CloudRepository, type SqlPool, type PrivateObjects } from '../manager/cloud/postgres-store';

// A separate test database is mandatory. Never reuse DATABASE_URL/.env.cloud.
// The optional real PostgreSQL path refuses any existing application tables.
export async function loadFixture(databaseUrl?: string) {
  if (!databaseUrl) {
    const fixture = await databaseFixture();
    return { ...fixture, database: 'PGlite', connections: 1, embeddedDatabase: true };
  }
  const url = new URL(databaseUrl);
  if (!['postgres:', 'postgresql:'].includes(url.protocol)) throw new Error('Invalid load-test database URL.');
  const local = ['127.0.0.1', 'localhost', '[::1]', 'load-db'].includes(url.hostname);
  for (const key of ['sslmode', 'sslcert', 'sslkey', 'sslrootcert']) url.searchParams.delete(key);
  const ca = process.env.HANU_LOAD_DB_CA ? await readFile(process.env.HANU_LOAD_DB_CA, 'utf8') : undefined;
  const pg = new Pool({ connectionString: url.toString(), max: 10, connectionTimeoutMillis: 10000,
    statement_timeout: 15000, ssl: local ? false : { rejectUnauthorized: true, ca } });
  try {
    const name = (await pg.query('SELECT current_database() AS name')).rows[0].name;
    if (name !== 'hanu_load_test') throw new Error('Load test requires a separate database named hanu_load_test.');
    const tables = await pg.query("SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname IN ('public','auth','storage','hanu') AND c.relkind IN ('r','p','v','m') LIMIT 1");
    if (tables.rowCount) throw new Error('Load-test database is not empty. No data was changed. Use a fresh test database.');
    await pg.query(`DO $$ BEGIN
      IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='anon') THEN CREATE ROLE anon; END IF;
      IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='authenticated') THEN CREATE ROLE authenticated; END IF;
    END $$;
    CREATE SCHEMA auth; CREATE TABLE auth.users(id uuid PRIMARY KEY,email text,raw_user_meta_data jsonb DEFAULT '{}',created_at timestamptz NOT NULL DEFAULT now(),last_sign_in_at timestamptz);
    CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$ SELECT nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
    GRANT USAGE ON SCHEMA auth TO authenticated;
    CREATE SCHEMA storage; CREATE TABLE storage.buckets(id text PRIMARY KEY,name text,public boolean,file_size_limit bigint,allowed_mime_types text[]);`);
    await pg.query(await readFile('supabase/migrations/202610130001_cloud.sql', 'utf8'));
    await pg.query(await readFile('supabase/migrations/202610150001_user_access.sql', 'utf8'));
    await pg.query(await readFile('supabase/migrations/202610150002_google_approval_only.sql', 'utf8'));
    const blobs = new Map<string, Buffer>();
    const objects: PrivateObjects = {
      async put(path, bytes) { blobs.set(path, Buffer.from(bytes)); },
      async get(path) { const bytes = blobs.get(path); if (!bytes) throw new Error('Missing synthetic object.'); return Buffer.from(bytes); }
    };
    const pool = pg as SqlPool;
    return { pool, objects, repository: new CloudRepository(pool, objects, randomUUID()),
      database: 'PostgreSQL', connections: 10, embeddedDatabase: false, async close() { await pg.end(); } };
  } catch (error) { await pg.end(); throw error; }
}
