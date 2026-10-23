import { execFile } from "node:child_process";

export function openRunnerWindow(url: string) {
  if (process.platform === "darwin") execFile("open", [url]);
  else if (process.platform === "win32") execFile("rundll32", ["url.dll,FileProtocolHandler", url]);
}
