export type Provider = "hcmue" | "chinesetest";
export const runnerScheme = (provider: Provider) => `hanu-${provider}`;

export function websiteOrigin(value: string, fixture = false): string {
  const url = new URL(value);
  if (url.username || url.password || url.pathname !== "/" || url.search || url.hash ||
      (url.protocol !== "https:" && !(fixture && url.protocol === "http:" && url.hostname === "127.0.0.1")))
    throw new Error("Địa chỉ website cần là HTTPS, không kèm đường dẫn hay thông tin đăng nhập.");
  return url.origin;
}

export function runnerLaunchUrl(provider: Provider, origin: string): string {
  // Local HTTP is allowed only for fixture UI; native launches still require HTTPS.
  return `${runnerScheme(provider)}://open?origin=${encodeURIComponent(origin)}`;
}

export function parseRunnerLaunch(provider: Provider, value: string): string {
  if (value.length > 2048) throw new Error("Link mở runner quá dài.");
  const url = new URL(value);
  if (url.protocol !== `${runnerScheme(provider)}:` || url.hostname !== "open" || url.port ||
      url.username || url.password || (url.pathname !== "" && url.pathname !== "/") || url.hash ||
      [...url.searchParams.keys()].some(key => key !== "origin") || url.searchParams.getAll("origin").length !== 1)
    throw new Error("Link không đúng chức năng runner.");
  return websiteOrigin(url.searchParams.get("origin")!);
}
