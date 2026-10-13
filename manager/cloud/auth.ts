import type { IncomingMessage, ServerResponse } from 'node:http';
import { createServerClient, parseCookieHeader, serializeCookieHeader } from '@supabase/ssr';
import { CloudError } from './postgres-store';
import type { CloudConfig } from './config';

export interface WebUser { id: string; email: string; name: string; sessionKey: string; expiresAt: number }
export interface AuthRequest {
  login(): Promise<string>;
  callback(code: string): Promise<void>;
  user(): Promise<WebUser | undefined>;
  logout(): Promise<void>;
}
export interface WebAuth { request(req: IncomingMessage, res: ServerResponse): AuthRequest }

// A fresh SSR client per request. Tokens stay in HttpOnly cookies; all identity
// decisions use getUser(), which verifies with Supabase Auth, never a decoded JWT.
export function supabaseAuth(config: CloudConfig): WebAuth {
  return { request(req, res) {
    const jar = new Map(parseCookieHeader(req.headers.cookie ?? '').map(c => [c.name, c.value]));
    const client = createServerClient(config.supabaseUrl, config.publishableKey, {
      cookieOptions: { httpOnly: true, secure: !config.development, sameSite: 'lax', path: '/' },
      cookies: {
        getAll: () => [...jar].map(([name, value]) => ({ name, value })),
        setAll(cookies, headers) {
          const previous = res.getHeader('Set-Cookie');
          const values = previous ? Array.isArray(previous) ? previous.map(String) : [String(previous)] : [];
          for (const cookie of cookies) {
            jar.set(cookie.name, cookie.value);
            values.push(serializeCookieHeader(cookie.name, cookie.value, { ...cookie.options, httpOnly: true, secure: !config.development, sameSite: 'lax', path: '/' }));
          }
          res.setHeader('Set-Cookie', values);
          for (const [name, value] of Object.entries(headers)) res.setHeader(name, value);
        }
      }
    });
    let verified: WebUser | undefined;
    let checked = false;
    return {
      async login() {
        const { data, error } = await client.auth.signInWithOAuth({ provider: 'google', options: { redirectTo: `${config.origin}/auth/callback`, skipBrowserRedirect: true } });
        if (error || !data.url) throw new CloudError('Chưa mở được đăng nhập Google. Kiểm tra cấu hình provider và redirect URL.', 503);
        return data.url;
      },
      async callback(code) {
        const { error } = await client.auth.exchangeCodeForSession(code);
        if (error) throw new CloudError('Phiên đăng nhập đã hết hạn hoặc mã đã dùng. Đăng nhập lại bằng Google.', 401);
      },
      async user() {
        if (checked) return verified;
        checked = true;
        const { data, error } = await client.auth.getUser();
        if (error || !data.user || !data.user.identities?.some(i => i.provider === 'google')) return;
        const { data: session } = await client.auth.getSession();
        // The token was verified above. These claims only schedule channel
        // expiry and select which browser channels to close on local logout.
        const claims = JSON.parse(Buffer.from(session.session!.access_token.split('.')[1], 'base64url').toString());
        if (typeof claims.session_id !== 'string' || !Number.isFinite(claims.exp)) return;
        verified = { id: data.user.id, email: data.user.email ?? '', name: String(data.user.user_metadata?.full_name ?? data.user.email ?? ''), sessionKey: claims.session_id, expiresAt: claims.exp * 1000 };
        return verified;
      },
      async logout() {
        const { error } = await client.auth.signOut({ scope: 'local' });
        if (error) throw new CloudError('Chưa đăng xuất được. Kiểm tra kết nối và thử lại.', 503);
      }
    };
  } };
}
