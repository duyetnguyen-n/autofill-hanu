import { readFileSync } from 'node:fs';
import { Pool } from 'pg';
import type { SqlPool } from './postgres-store';

export interface CloudConfig {
  origin: string; host: string; port: number; development: boolean;
  supabaseUrl: string; publishableKey: string; secretKey: string;
  databaseUrl: string; databaseCa?: string;
  trustProxy?: boolean;
  // Render starts a replacement before terminating the existing instance.
  rollingDeploy?: boolean;
  hcmueEnabled?: boolean;
  bootstrapAdminEmail?: string;
}
export function cloudConfig(env: NodeJS.ProcessEnv = process.env): CloudConfig {
  const required = (key: string, value = env[key]?.trim()) => {
    if (!value || /YOUR_|REPLACE_|<|>/.test(value)) throw new Error(`Chưa cấu hình ${key}. Xem .env.cloud.example và docs/CLOUD.md.`);
    return value;
  };
  // Render assigns the service URL before starting the container. Use only
  // this trusted platform environment value; never derive origin from a request.
  const platformOrigin = env.RENDER === 'true' ? env.RENDER_EXTERNAL_URL?.trim() : undefined;
  const url = new URL(required('PUBLIC_ORIGIN', env.PUBLIC_ORIGIN?.trim() || platformOrigin));
  const development = env.HANU_CLOUD_DEV === '1';
  if (url.pathname !== '/' || url.search || url.hash || url.username || url.password || url.protocol !== 'https:' && !(development && url.protocol === 'http:' && ['localhost', '127.0.0.1'].includes(url.hostname))) throw new Error('PUBLIC_ORIGIN phải là HTTPS origin; HTTP chỉ dùng cho localhost trong chế độ dev.');
  const supabaseUrl = new URL(required('SUPABASE_URL'));
  if (supabaseUrl.protocol !== 'https:' && !(development && ['localhost', '127.0.0.1'].includes(supabaseUrl.hostname) && supabaseUrl.protocol === 'http:')) throw new Error('SUPABASE_URL phải dùng HTTPS.');
  const port = Number(env.PORT ?? 3000);
  const bootstrapAdminEmail = env.HANU_BOOTSTRAP_ADMIN_EMAIL?.trim().toLowerCase() || undefined;
  if (bootstrapAdminEmail && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(bootstrapAdminEmail)) throw new Error('HANU_BOOTSTRAP_ADMIN_EMAIL phải là email Google của chủ sản phẩm.');
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('PORT không hợp lệ.');
  return { origin: url.origin, host: env.HOST ?? '127.0.0.1', port, development,
    supabaseUrl: supabaseUrl.origin, publishableKey: required('SUPABASE_PUBLISHABLE_KEY'),
    secretKey: required('SUPABASE_SECRET_KEY'), databaseUrl: required('DATABASE_URL'),
    databaseCa: env.PGSSLROOTCERT ? readFileSync(env.PGSSLROOTCERT, 'utf8') : undefined,trustProxy:env.TRUST_PROXY==='1',
    rollingDeploy: env.RENDER === 'true', hcmueEnabled:env.HANU_HCMUE_ENABLED==='1', bootstrapAdminEmail };
}
export function databasePool(config: CloudConfig) {
  const url = new URL(config.databaseUrl);
  if (!['postgres:', 'postgresql:'].includes(url.protocol)) throw new Error('DATABASE_URL không phải URL PostgreSQL.');
  const local = ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);
  // Remove pg URL options that could override our certificate verification.
  for (const key of ['sslmode', 'sslcert', 'sslkey', 'sslrootcert']) url.searchParams.delete(key);
  const pool = new Pool({ connectionString: url.toString(), max: 10, connectionTimeoutMillis: 10000,
    statement_timeout: 15000, idle_in_transaction_session_timeout: 15000,
    ssl: config.development && local ? false : { rejectUnauthorized: true, ca: config.databaseCa } });
  return pool as SqlPool & Pool;
}
