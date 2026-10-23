import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { parseRunnerLaunch, websiteOrigin, type Provider } from "./launch";
import { createWebsiteSetup } from "./setup";
import { openRunnerWindow } from "./open";

export { openRunnerWindow } from "./open";

export async function startupOrigin(provider: Provider, dir: string, fixture: boolean) {
  const launch = process.argv.find(arg => arg.startsWith("--launch-url="));
  const config = join(dir, "website.json");
  if (launch) {
    const origin = parseRunnerLaunch(provider, launch.slice(13));
    const saved = await readFile(config, "utf8").then(JSON.parse).catch(() => null);
    if (saved?.origin !== origin)
      throw new Error("Mở file Start trong gói runner và nhập đúng website một lần trước khi dùng nút mở trên web. Runner không tự đổi website đã lưu.");
    return origin;
  }
  let value = process.argv.find(arg => arg.startsWith("--origin="))?.slice(9) ??
    process.env[`${provider.toUpperCase()}_CLOUD_ORIGIN`];
  if (!value) {
    const saved = await readFile(config, "utf8").then(JSON.parse).catch(() => null);
    if (saved?.origin) value = saved.origin;
  }
  if (!value && !process.argv.includes("--no-open") && ["win32", "darwin"].includes(process.platform)) {
    const setup = await createWebsiteSetup(provider, fixture);
    console.log("Dán địa chỉ website trong trang trình duyệt vừa mở, rồi bấm Kết nối runner.");
    console.log("Nếu trình duyệt chưa mở, mở link này:", setup.url);
    openRunnerWindow(setup.url);
    try { value = await setup.result; }
    finally { setup.close(); }
  } else if (!value && process.stdin.isTTY) {
    const { createInterface } = await import("node:readline/promises");
    const prompt = createInterface({ input: process.stdin, output: process.stdout });
    try { value = (await prompt.question("Website điều khiển (https://...): ")).trim(); }
    finally { prompt.close(); }
  }
  if (!value) throw new Error("Chạy với --origin=https://website-cua-ban");
  const origin = websiteOrigin(value, fixture);
  return origin;
}

// The descriptor stays local (0600). It never exposes its local access token to the cloud.
export async function reuseRunner(provider: Provider, dir: string, origin: string, pid: number) {
  for (let attempt = 0; attempt < 50; attempt++) {
    const saved = await readFile(join(dir, "runner-open.json"), "utf8").then(JSON.parse).catch(() => null);
    if (saved?.pid === pid && saved.provider === provider) {
      if (saved.origin !== origin) throw new Error("Runner đang chạy với website khác. Mở đúng website của runner đang chạy.");
      const url = new URL(saved.url);
      if (url.protocol !== "http:" || url.hostname !== "127.0.0.1" || !url.port || url.pathname !== "/" || url.username || url.password)
        throw new Error("Thông tin cửa sổ runner không hợp lệ.");
      if (!process.argv.includes("--no-open")) openRunnerWindow(url.href);
      return;
    }
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  throw new Error("Runner đang khởi động. Chờ vài giây rồi bấm Mở runner lần nữa.");
}

export async function saveRunnerWindow(provider: Provider, dir: string, origin: string, url: string) {
  await writeFile(join(dir, "runner-open.json"), JSON.stringify({ provider, pid: process.pid, origin, url }), { mode: 0o600 });
}

export async function rememberWebsite(dir: string, origin: string) {
  await mkdir(dir, { recursive: true, mode: 0o700 });
  await writeFile(join(dir, "website.json"), JSON.stringify({ origin }), { mode: 0o600 });
}
