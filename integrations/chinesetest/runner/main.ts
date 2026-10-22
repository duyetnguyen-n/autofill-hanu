import { Worker } from "node:worker_threads";
import { createServer } from "node:http";
import { randomBytes } from "node:crypto";
import { hostname } from "node:os";
import { execFile, spawn, type ChildProcess } from "node:child_process";
import { fileURLToPath } from "node:url";
import { mkdir, readFile, unlink, open as fsOpen } from "node:fs/promises";
import { join } from "node:path";
import { WebSocket } from "ws";
import { runnerDirectory } from "./vault";
import { activeStatus, type RunnerState } from "../protocol";
let originArg =
  process.argv.find((a) => a.startsWith("--origin="))?.slice(9) ??
  process.env.CHINESETEST_CLOUD_ORIGIN;
if (!originArg && process.stdin.isTTY) {
  const { createInterface } = await import("node:readline/promises");
  const prompt = createInterface({
    input: process.stdin,
    output: process.stdout,
  });
  try {
    originArg = (
      await prompt.question("Website điều khiển (https://...): ")
    ).trim();
  } finally {
    prompt.close();
  }
}
if (!originArg) throw new Error("Chạy với --origin=https://website-cua-ban");
const url = new URL(originArg);
if (
  url.protocol !== "https:" &&
  !(
    process.env.CHINESETEST_FIXTURE &&
    url.hostname === "127.0.0.1" &&
    url.protocol === "http:"
  )
)
  throw new Error("Website cần HTTPS.");
const origin = url.origin,
  dir = runnerDirectory();
await mkdir(dir, { recursive: true, mode: 0o700 });
// One process per vault: two runners must never execute the same local schedule.
const lockFile = join(dir, "runner.pid");
let lock;
try {
  lock = await fsOpen(lockFile, "wx", 0o600);
} catch {
  const pid = Number(await readFile(lockFile, "utf8").catch(() => ""));
  let alive = false;
  try {
    if (pid > 0) {
      process.kill(pid, 0);
      alive = true;
    }
  } catch {}
  if (alive)
    throw new Error("CHINESETEST Runner đã chạy. Mở cửa sổ điều khiển đang có.");
  await unlink(lockFile).catch(() => {});
  lock = await fsOpen(lockFile, "wx", 0o600);
}
await lock.writeFile(String(process.pid));
await lock.close();
const worker = new Worker(new URL("./worker.mjs", import.meta.url), {
  workerData: { name: hostname(), dir },
});
let state: RunnerState | undefined,
  identity: any,
  token: string | undefined,
  pairCode = "",
  connected = false,
  error = "",
  ws: WebSocket | undefined,
  retry: ReturnType<typeof setTimeout> | undefined,
  closing = false,
  revoked = false,
  owner: string | undefined,
  awake: ChildProcess | undefined;
const localToken = randomBytes(32).toString("hex");
const localPending = new Map<string, (value: unknown) => void>();
let localOrigin = "";
const json = (res: any, v: unknown, status = 200) => {
  res.writeHead(status, {
    "Content-Type": "application/json",
    "Cache-Control": "no-store",
  });
  res.end(JSON.stringify(v));
};
const server = createServer((req, res) => {
  if (req.headers.host !== new URL(localOrigin).host)
    return json(res, { error: "Host" }, 403);
  res.setHeader(
    "Content-Security-Policy",
    "default-src 'self'; script-src 'self'; style-src 'unsafe-inline'; frame-ancestors 'none'; base-uri 'none'",
  );
  res.setHeader("Referrer-Policy", "no-referrer");
  if (req.url?.startsWith("/?token=")) {
    if (new URL(req.url, localOrigin).searchParams.get("token") !== localToken)
      return json(res, { error: "Token" }, 403);
    res.setHeader(
      "Set-Cookie",
      `chinesetest=${localToken}; HttpOnly; SameSite=Strict; Path=/`,
    );
    res.writeHead(303, { Location: "/" });
    res.end();
    return;
  }
  if (
    !req.headers.cookie
      ?.split(";")
      .some((c) => c.trim() === `chinesetest=${localToken}`)
  )
    return json(res, { error: "Mở lại Runner từ ứng dụng." }, 401);
  if (req.url === "/state" && req.method === "GET")
    return json(res, { connected, paired:!!owner, pairCode, identity, state, error, origin });
  if (req.url === "/stop" && req.method === "POST") {
    if (req.headers.origin !== localOrigin)
      return json(res, { error: "Origin" }, 403);
    worker.postMessage({ type: "LOCAL_STOP" });
    return json(res, { ok: true });
  }
  if (["/login", "/finish-login", "/cancel-login"].includes(req.url || "") && req.method === "POST") {
    if (req.headers.origin !== localOrigin) return json(res, { error: "Origin" }, 403);
    if (!state) return json(res, { error: "Runner chưa sẵn sàng." }, 409);
    const id = randomBytes(16).toString("hex");
    const timer = setTimeout(() => { localPending.delete(id); if (!res.writableEnded) json(res, { error: "Chưa có xác nhận. Kiểm tra trạng thái trước khi thử lại." }, 504); }, 90000);
    localPending.set(id, value => { clearTimeout(timer); if (!res.writableEnded) json(res, value); });
    worker.postMessage({ type: "LOCAL_COMMAND", id, command: req.url!.slice(1) });
    return;
  }
  if (req.url === "/ui.js") {
    res.writeHead(200, { "Content-Type": "text/javascript" });
    res.end(
      `async function refresh(){try{const r=await fetch('/state');const d=await r.json();document.getElementById('connection').textContent=d.connected?'Đã kết nối website':'Đang nối lại website';document.getElementById('code').textContent=d.pairCode||(d.paired?'Đã liên kết':'Chờ kết nối để lấy mã');document.getElementById('fp').textContent=d.identity?.fingerprint||'';document.getElementById('error').textContent=d.error||'';document.getElementById('site').href=d.origin+'/chinesetest';document.getElementById('summary').textContent=(d.state?.accounts.length||0)+' tài khoản · '+(d.state?.schedules.filter(s=>['armed','waiting_center','checking','reserved','sending','queued'].includes(s.status)).length||0)+' lịch đang hoạt động';document.getElementById('runs').textContent=(d.state?.schedules||[]).map(s=>s.target.ksDate+' · '+s.target.center+' · '+s.status+' · '+new Date(s.target.targetAt).toLocaleString('vi-VN')+(s.attempt.bmid?' · '+s.attempt.bmid:'')).join('\\n');}catch{document.getElementById('connection').textContent='Runner đã dừng';}}document.getElementById('stop').onclick=async()=>{await fetch('/stop',{method:'POST'});await refresh()};for(const id of ['login','finish-login','cancel-login'])document.getElementById(id).onclick=async()=>{const button=document.getElementById(id);button.disabled=true;try{const r=await fetch('/'+id,{method:'POST'});const d=await r.json();if(d.error)document.getElementById('error').textContent=d.error;}catch{document.getElementById('error').textContent='Không nhận được xác nhận. Đọc trạng thái trước khi thử lại.';}finally{button.disabled=false;await refresh()}};refresh();setInterval(refresh,2000);`,
    );
    return;
  }
  if (req.url === "/" && req.method === "GET") {
    res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
    res.end(
      `<!doctype html><html lang="vi"><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>CHINESETEST Runner</title><style>body{font:16px system-ui;background:#f4f6f5;color:#19312a;max-width:760px;margin:50px auto;padding:24px}h1{font-size:32px;letter-spacing:-1px}section{background:white;border:1px solid #dce5df;border-radius:12px;padding:28px;margin:24px 0}code{font-size:24px;letter-spacing:2px;overflow-wrap:anywhere}pre{white-space:pre-wrap;overflow-wrap:anywhere}button,a{display:inline-block;padding:12px 20px;border-radius:8px;border:1px solid #216951;font:inherit;text-decoration:none;color:#216951;background:white;cursor:pointer}button{background:#a22f28;color:white;border:0}small{color:#52665b;overflow-wrap:anywhere}#error{color:#a22f28}</style><h1>CHINESETEST Runner</h1><p id="connection">Đang mở máy chạy…</p><section><p>Mã liên kết một lần</p><code id="code"></code><p>Đối chiếu dấu vân tay với website</p><small id="fp"></small><p><a id="site" target="_blank" rel="noreferrer">Mở website CHINESETEST</a></p></section><section><h2>Đăng nhập ChineseTest</h2><p>Tự đăng nhập và hoàn tất xác minh trong Chrome. Runner chỉ lấy phiên sau khi bạn bấm Hoàn tất; không đọc mật khẩu.</p><button id="login">Mở Chrome đăng nhập</button> <button id="finish-login">Hoàn tất đăng nhập</button> <button id="cancel-login">Hủy đăng nhập</button></section><section><h2>Lịch trên máy</h2><p id="summary"></p><pre id="runs"></pre><button id="stop">Dừng tất cả trên máy</button></section><p id="error" role="alert"></p><p>Giữ ứng dụng chạy và máy có mạng. Lịch đã bật tiếp tục khi website đóng.</p><script src="/ui.js"></script></html>`,
    );
    return;
  }
  json(res, { error: "Not found" }, 404);
});
await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
localOrigin = `http://127.0.0.1:${(server.address() as any).port}`;
const openUrl = localOrigin + "/?token=" + localToken;
if (process.env.CHINESETEST_FIXTURE === "1" && process.send) process.send({ type: "LOCAL_READY", url: openUrl });
if (!process.argv.includes("--no-open")) {
  if (process.platform === "darwin") execFile("open", [openUrl]);
  else if (process.platform === "win32")
    execFile("rundll32", ["url.dll,FileProtocolHandler", openUrl]);
}
console.log("ChineseTest Runner đã mở. Giữ ứng dụng chạy và máy có mạng.");
function keepAwake() {
  const needed = state?.schedules.some((s) => activeStatus(s.status));
  if (needed && !awake) {
    if (process.platform === "darwin")
      awake = spawn("/usr/bin/caffeinate", ["-i", "-s"], { stdio: "ignore" });
    else if (process.platform === "win32")
      awake = spawn(
        "powershell.exe",
        [
          "-NoProfile",
          "-NonInteractive",
          "-Command",
          `Add-Type -Name Power -Namespace Runner -MemberDefinition '[DllImport("kernel32.dll")] public static extern uint SetThreadExecutionState(uint flags);'; [Runner.Power]::SetThreadExecutionState(2147483649); while($true){Start-Sleep -Seconds 30}`,
        ],
        { stdio: "ignore", windowsHide: true },
      );
    awake?.on("error", () => {
      error = "Không bật được giữ máy thức. Kiểm tra cài đặt ngủ máy.";
    });
  }
  if (!needed && awake) {
    awake.kill();
    awake = undefined;
  }
}
function connect() {
  if (closing || revoked || !identity) return;
  const address = new URL("/chinesetest-runner", origin);
  address.protocol = address.protocol === "https:" ? "wss:" : "ws:";
  ws = new WebSocket(address);
  let lastPong = Date.now();
  const ping = setInterval(() => {
    if (ws?.readyState === 1) {
      if (Date.now() - lastPong > 45000) ws.terminate();
      else ws.send(JSON.stringify({ type: "PING" }));
    }
  }, 15000);
  ws.on("open", () =>
    ws!.send(JSON.stringify({ type: "HELLO", ...identity, token })),
  );
  ws.on("message", (raw) => {
    try {
      const m = JSON.parse(raw.toString());
      if (m.type === "REGISTERED") {
        token = m.token;
        worker.postMessage({ type: "CLOUD", cloud: { origin, token } });
      }
      if (m.type === "PAIR_CODE") pairCode = m.code;
      if (m.type === "WELCOME") {
        if (owner && owner !== m.owner) {
          revoked = true;
          error = "Liên kết thiết bị thay đổi. Mở lại Runner để liên kết mới.";
          worker.postMessage({ type: "REVOKED" });
          ws?.close();
          return;
        }
        connected = true;
        error = "";
        owner = m.owner ?? undefined;
        if (owner) {
          pairCode = "";
          worker.postMessage({
            type: "CLOUD",
            cloud: { origin, token, owner },
          });
        }
      }
      if (m.type === "BOUND") {
        pairCode = "";
        owner = m.owner;
        worker.postMessage({ type: "CLOUD", cloud: { origin, token, owner } });
      }
      if (m.type === "PONG") lastPong = Date.now();
      if (m.type === "REVOKED") {
        revoked = true;
        token = undefined;
        pairCode = "";
        error = "Máy đã bị hủy liên kết. Dừng Runner và liên kết lại.";
        worker.postMessage({ type: "REVOKED" });
        ws?.close();
      }
      if (m.type === "COMMAND") worker.postMessage(m);
    } catch {
      ws?.close();
    }
  });
  ws.on("error", () => {
    error = "Chưa kết nối được website. Lịch đã bật vẫn chạy trên máy.";
  });
  ws.on("close", () => {
    connected = false;
    clearInterval(ping);
    if (!closing && !revoked) retry = setTimeout(connect, 3000);
  });
}
worker.on("message", (m) => {
  if (m.type === "LOCAL_RESULT") { localPending.get(m.id)?.({ ok: m.ok, error: m.error }); localPending.delete(m.id); }
  if (m.type === "READY") {
    identity = m.identity;
    state = m.state;
    if (m.cloud?.origin === origin) {
      token = m.cloud.token;
      owner = m.cloud.owner;
    } else if (m.cloud)
      error =
        "Runner đang liên kết với website khác. Dùng đúng URL hoặc thư mục dữ liệu khác.";
    if (!m.cloud || m.cloud.origin === origin) connect();
  }
  if (m.state) {
    state = m.state;
    keepAwake();
  }
  if (m.claims && connected && ws?.readyState === 1) ws.send(JSON.stringify({ type: "CLAIMS", claims: m.claims }));
  if (m.type === "RESULT" && ws?.readyState === 1)
    ws.send(
      JSON.stringify({ type: "RESULT", commandId: m.commandId, box: m.box }),
    );
  if (m.type === "FATAL") {
    error = m.error;
    console.error(error);
  }
  if (m.type === "COMMAND_ERROR" && ws?.readyState === 1)
    ws.send(JSON.stringify({ type: "COMMAND_ERROR", commandId: m.commandId }));
  if (m.type === "COMMAND_ERROR")
    error =
      "Lệnh không hợp lệ hoặc không giải mã được. Đối chiếu dấu vân tay máy.";
});
worker.on("error", () => {
  error =
    "Worker dừng bất thường. Mở lại Runner để đối chiếu, không gửi lại tự động.";
});
async function close() {
  if (closing) return;
  closing = true;
  clearTimeout(retry);
  ws?.terminate();
  worker.postMessage({ type: "CLOSE" });
  await new Promise<void>((r) => {
    const t = setTimeout(r, 3000);
    worker.on("message", (m) => {
      if (m.type === "CLOSED") {
        clearTimeout(t);
        r();
      }
    });
  });
  await worker.terminate();
  awake?.kill();
  server.close();
  await unlink(lockFile).catch(() => {});
  process.exit(0);
}
process.on("SIGINT", () => void close());
process.on("SIGTERM", () => void close());

