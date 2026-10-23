import { randomBytes } from "node:crypto";
import { createServer } from "node:http";
import { websiteOrigin, type Provider } from "./launch";

// Manual setup accepts a copied management-page URL; deep links stay origin-only.
export function setupWebsiteOrigin(value: string, provider: Provider, fixture = false) {
  const url = new URL(value.trim());
  if (url.username || url.password || url.search || !["/", `/${provider}`, `/${provider}/`].includes(url.pathname))
    throw new Error(`Dán địa chỉ trang ${provider === "hcmue" ? "HCMUE" : "ChineseTest"} hoặc địa chỉ gốc của website HANU.`);
  return websiteOrigin(url.origin, fixture);
}

const escape = (value: string) => value.replace(/[&<>"']/g, char => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char]!);

function setupPage(provider: Provider, value = "", error = "") {
  const label = provider === "hcmue" ? "HCMUE" : "ChineseTest";
  return `<!doctype html><html lang="vi"><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>Kết nối ${label} Runner</title>
<style>body{font:16px system-ui;line-height:1.6;background:#f4f6f5;color:#19312a;max-width:620px;margin:64px auto;padding:24px}main{padding:28px;background:white;border:1px solid #dce5df;border-radius:12px}h1{font-size:28px;line-height:1.25}label{display:block;font-weight:600;margin-top:24px}input,button{box-sizing:border-box;width:100%;font:inherit;padding:12px;border:1px solid #80988c;border-radius:8px}input{margin:8px 0 16px}button{background:#216951;color:white;cursor:pointer}small{display:block;margin-top:16px;color:#52665b}.error{color:#a22f28;overflow-wrap:anywhere}</style>
<main><h1>Kết nối ${label} Runner</h1><p>Dán địa chỉ website HANU bạn đang sử dụng vào ô bên dưới. Có thể dùng <strong>Ctrl+V</strong> hoặc chuột phải → Dán ngay tại đây.</p>
${error ? `<p class="error" role="alert">${escape(error)}</p>` : ""}
<form method="post" action="/website"><label for="website">Địa chỉ website HANU</label><input id="website" name="website" type="url" maxlength="2048" placeholder="https://website-hanu-cua-ban" value="${escape(value)}" required autofocus autocomplete="url" spellcheck="false"><button type="submit">Kết nối runner</button></form>
<small>Dùng địa chỉ website quản lý HANU, không phải chinesetest.cn hoặc website của trường. Chỉ nhập lần đầu; runner sẽ nhớ địa chỉ trên máy này.</small></main></html>`;
}

export async function createWebsiteSetup(provider: Provider, fixture = false) {
  const token = randomBytes(32).toString("hex");
  const cookie = `hanu_setup_${randomBytes(8).toString("hex")}=${token}`;
  let localOrigin = "", settled = false;
  let resolveResult!: (origin: string) => void, rejectResult!: (error: Error) => void;
  const result = new Promise<string>((resolve, reject) => { resolveResult = resolve; rejectResult = reject; });
  // A close/listen error can happen before the caller receives the session.
  void result.catch(() => {});
  let timer: ReturnType<typeof setTimeout> | undefined;
  const finish = (origin?: string, error?: Error) => {
    if (settled) return;
    settled = true;
    clearTimeout(timer);
    server.close();
    server.closeIdleConnections();
    if (origin) resolveResult(origin);
    else rejectResult(error ?? new Error("Đã đóng bước nhập website. Mở Start để thử lại."));
  };
  const server = createServer(async (req, res) => {
    res.setHeader("Cache-Control", "no-store");
    // Native form POSTs need a non-opaque Origin; never send referrers off-machine.
    res.setHeader("Referrer-Policy", "same-origin");
    res.setHeader("Content-Security-Policy", "default-src 'none'; style-src 'unsafe-inline'; form-action 'self'; frame-ancestors 'none'; base-uri 'none'");
    res.setHeader("X-Content-Type-Options", "nosniff");
    const text = (status: number, message: string) => { res.writeHead(status, { "Content-Type": "text/plain; charset=utf-8" }); res.end(message); };
    const html = (status: number, page: string) => { res.writeHead(status, { "Content-Type": "text/html; charset=utf-8" }); res.end(page); };
    if (req.headers.host !== new URL(localOrigin).host) return text(403, "Host không hợp lệ.");
    let url: URL;
    try { url = new URL(req.url ?? "/", localOrigin); }
    catch { return text(400, "Địa chỉ yêu cầu không hợp lệ."); }
    if (req.method === "GET" && url.pathname === "/" && url.searchParams.has("token")) {
      if (url.searchParams.get("token") !== token) return text(403, "Mở lại trang nhập website từ Start.");
      res.writeHead(303, { Location: "/", "Set-Cookie": `${cookie}; HttpOnly; SameSite=Strict; Path=/; Max-Age=900` });
      res.end();
      return;
    }
    if (!req.headers.cookie?.split(";").some(item => item.trim() === cookie)) return text(401, "Mở lại trang nhập website từ Start.");
    if (req.method === "GET" && req.url === "/") return html(200, setupPage(provider));
    if (req.method !== "POST" || req.url !== "/website") return text(404, "Không tìm thấy trang.");
    if (req.headers.origin !== localOrigin) return text(403, "Origin không hợp lệ.");
    if (req.headers["content-type"]?.split(";")[0] !== "application/x-www-form-urlencoded") return text(415, "Định dạng không hợp lệ.");
    let body = "", size = 0;
    try {
      for await (const chunk of req) {
        size += chunk.length;
        if (size > 8192) return text(413, "Địa chỉ quá dài.");
        body += chunk.toString();
      }
    } catch { if (!res.destroyed) text(400, "Không đọc được địa chỉ. Thử lại."); return; }
    const values = new URLSearchParams(body).getAll("website");
    const value = values[0] ?? "";
    let origin: string;
    try {
      if (values.length !== 1 || value.length > 2048) throw new Error("Nhập một địa chỉ website HTTPS hợp lệ.");
      origin = setupWebsiteOrigin(value, provider, fixture);
    } catch {
      return html(400, setupPage(provider, value.slice(0, 2048), "Địa chỉ chưa đúng. Dán link HTTPS của website HANU hoặc trang quản lý đang dùng, rồi thử lại."));
    }
    html(200, `<!doctype html><html lang="vi"><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>Đang mở runner</title><main style="font:18px system-ui;max-width:620px;margin:64px auto;padding:24px"><h1>Đang mở runner</h1><p>Website đã chọn: <strong>${escape(origin)}</strong>.</p><p>Trang điều khiển runner sẽ mở trong tab mới. Giữ cửa sổ chạy runner mở trong khi sử dụng.</p></main></html>`);
    finish(origin);
  });
  server.requestTimeout = 15000;
  server.on("error", error => finish(undefined, error));
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => { server.removeListener("error", reject); resolve(); });
  });
  localOrigin = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
  timer = setTimeout(() => finish(undefined, new Error("Hết thời gian nhập website. Mở Start để thử lại.")), 15 * 60 * 1000);
  return { url: `${localOrigin}/?token=${token}`, result, close: () => finish() };
}
