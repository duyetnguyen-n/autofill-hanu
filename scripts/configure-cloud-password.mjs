// Local setup helper. The password is entered by the user, saved to the ignored
// .env.cloud file, and never printed or sent to an external website by this form.
import { createServer } from 'node:http';
import { readFile, writeFile, rename } from 'node:fs/promises';
import { parseEnv } from 'node:util';
import { randomBytes } from 'node:crypto';
import { resolve } from 'node:path';

const envPath = resolve('.env.cloud');
const config = parseEnv(await readFile(envPath, 'utf8'));
const database = new URL(config.DATABASE_URL);
const projectRef = new URL(config.SUPABASE_URL).hostname.split('.')[0];
if (!/^[a-z0-9]+$/.test(projectRef) || database.username !== 'postgres.' + projectRef) throw new Error('DATABASE_URL and SUPABASE_URL must use the same Supabase session-pooler project.');
const route = '/' + randomBytes(24).toString('hex');
const csrf = randomBytes(32).toString('hex');
let origin, saving = false, saved = false;
const successPage = '<meta charset="utf-8"><h1>Đã lưu mật khẩu database</h1><p>Bạn có thể quay lại chat. Mình sẽ kiểm tra kết nối Supabase tiếp.</p>';
const page = `<!doctype html><html lang="vi"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Kết nối database HANU</title><style>body{font:17px system-ui;background:#f3f5f7;color:#17202a;max-width:600px;margin:10vh auto;padding:24px}main{background:white;padding:32px;border-radius:16px}input,button{font:inherit;padding:12px;box-sizing:border-box;width:100%;margin-top:12px}button{background:#087c61;color:white;border:0;border-radius:8px}small{display:block;margin-top:20px;color:#52606d}</style><main><h1>Kết nối database HANU</h1><p>Nhập mật khẩu database bạn đã đặt khi tạo project Supabase <strong>${projectRef}</strong>.</p><form method="post"><input type="hidden" name="csrf" value="${csrf}"><label for="password">Mật khẩu database</label><input id="password" name="password" type="password" required autocomplete="off" autofocus><button>Lưu mật khẩu vào cấu hình</button></form><small>Trang này chỉ chạy trên máy bạn (127.0.0.1). Mật khẩu được lưu trong .env.cloud riêng tư để backend kết nối Supabase; không hiển thị trong chat hoặc lưu vào trình quản lý mật khẩu.</small></main></html>`;
const server = createServer(async (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.setHeader('Content-Security-Policy', "default-src 'none'; style-src 'unsafe-inline'; form-action 'self'; frame-ancestors 'none'; base-uri 'none'");
  res.setHeader('Referrer-Policy', 'no-referrer');
  if (req.headers.host !== new URL(origin).host || req.url !== route) { res.writeHead(404); return res.end(); }
  if (req.method === 'GET') return res.end(saved ? successPage : page);
  // Embedded browsers can submit an opaque ("null") Origin. The unpredictable
  // route plus a separate hidden CSRF token still prove access to this form;
  // cross-site requests with an explicit foreign Origin remain rejected.
  const requestOrigin = req.headers.origin;
  if (req.method !== 'POST' || requestOrigin && requestOrigin !== origin && requestOrigin !== 'null' || saving || !/^application\/x-www-form-urlencoded(?:;|$)/i.test(req.headers['content-type'] ?? '')) { res.writeHead(403); return res.end(); }
  saving = true;
  try {
    let body = '';
    for await (const chunk of req) { body += chunk; if (body.length > 8192) throw new Error(); }
    const fields = new URLSearchParams(body);
    if (fields.get('csrf') !== csrf) throw new Error();
    if (saved) return res.end(successPage);
    const password = fields.get('password');
    if (!password || /[\r\n\0]/.test(password)) throw new Error();
    const current = await readFile(envPath, 'utf8');
    database.password = encodeURIComponent(password);
    const updated = current.replace(/^DATABASE_URL=.*$/m, 'DATABASE_URL=' + database.toString());
    const tempPath = envPath + '.setup-temp';
    await writeFile(tempPath, updated, { mode: 0o600 });
    await rename(tempPath, envPath);
    saved = true;
    res.end(successPage);
    console.log('Password configuration saved.');
    // Keep the confirmation available until expiry so a reload is harmless.
  } catch {
    saving = false;
    res.writeHead(400); res.end('<meta charset="utf-8"><p>Chưa lưu được. Quay lại trang trước và thử lại.</p>');
  }
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
origin = `http://127.0.0.1:${server.address().port}`;
console.log(origin + route);
const expiry = setTimeout(() => server.close(), 15 * 60000);
for (const signal of ['SIGINT', 'SIGTERM']) process.once(signal, () => { clearTimeout(expiry); server.close(); });
