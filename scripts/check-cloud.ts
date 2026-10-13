import { createClient } from '@supabase/supabase-js';
import { cloudConfig, databasePool } from '../manager/cloud/config';
import { checkCloudDatabase, CloudReadinessError } from '../manager/cloud/readiness';

async function main() {
  const config = cloudConfig();
  const pool = databasePool(config);
  pool.on('error', () => {}); // Raw connection errors can contain credentials.
  try {
    try { await checkCloudDatabase(pool); }
    catch (error) {
      // Only our diagnostic errors may be printed, never pg/network messages.
      if (error instanceof CloudReadinessError) throw error;
      throw new CloudReadinessError('Chưa kiểm tra được PostgreSQL. Kiểm tra DATABASE_URL, mật khẩu, Session pooler 5432, TLS/PGSSLROOTCERT và migration.');
    }
    console.log('OK: PostgreSQL, các bảng HANU, RLS và cấu hình bucket private.');
    const settings = await fetch(`${config.supabaseUrl}/auth/v1/settings`, {
      headers: { apikey: config.publishableKey }, signal: AbortSignal.timeout(15000)
    });
    if (!settings.ok) throw new CloudReadinessError('Supabase Auth từ chối publishable/anon key. Kiểm tra URL và key cùng project.');
    const auth = await settings.json();
    if (auth.external?.google !== true) throw new CloudReadinessError('Google provider chưa bật trong Supabase Authentication.');
    console.log('OK: Supabase Auth nhận public key và Google provider đã bật.');
    const client = createClient(config.supabaseUrl, config.secretKey, {
      auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
      global: { fetch: (input, init) => fetch(input, { ...init, signal: AbortSignal.timeout(15000) }) }
    });
    const { data, error } = await client.storage.getBucket('hanu-private');
    if (error || !data) throw new CloudReadinessError('Storage chưa nhận secret/service_role key hoặc chưa có bucket hanu-private trong project này.');
    if (data.public) throw new CloudReadinessError('Storage API báo bucket hanu-private đang public.');
    console.log('OK: Storage nhận backend key và bucket private. Không đọc ảnh/hồ sơ hoặc ghi dữ liệu.');
    console.log('Vẫn cần thử đăng nhập Google, callback, upload ảnh giả và liên kết extension trên website thật.');
  } finally { await pool.end(); }
}

main().catch(error => {
  // Do not print SDK/network errors, stack traces, URLs or key values.
  const message = error instanceof CloudReadinessError || error instanceof Error
    && /^Chưa cấu hình [A-Z_]+\. Xem \.env\.cloud\.example và docs\/CLOUD\.md\.$/.test(error.message)
    ? error.message : 'Kiểm tra cloud chưa hoàn tất. Kiểm tra cấu hình và kết nối mạng; không chia sẻ secrets.';
  console.error(`FAIL: ${message}`);
  process.exitCode = 1;
});
