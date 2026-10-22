import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { randomBytes, createCipheriv, createDecipheriv } from "node:crypto";
import { mkdir, readFile, writeFile, rename, open } from "node:fs/promises";
import { join } from "node:path";
import { homedir } from "node:os";
const exec = promisify(execFile);
export const runnerDirectory = () =>
  process.env.HCMUE_DATA_DIR ??
  join(
    homedir(),
    process.platform === "win32"
      ? "AppData/Local/HcmueRunner"
      : "Library/Application Support/HcmueRunner",
  );
export async function atomicWrite(file: string, data: string) {
  const temp = file + ".tmp";
  const handle = await open(temp, "w", 0o600);
  try {
    await handle.writeFile(data);
    await handle.sync();
  } finally {
    await handle.close();
  }
  await rename(temp, file);
}
export async function systemKey(dir: string, service = "vn.hcmue.runner"): Promise<Buffer> {
  await mkdir(dir, { recursive: true, mode: 0o700 });
  if (process.platform === "darwin") {
    try {
      const { stdout } = await exec("/usr/bin/security", [
        "find-generic-password",
        "-s",
        service,
        "-a",
        "vault",
        "-w",
      ]);
      const b = Buffer.from(stdout.trim(), "base64");
      if (b.length !== 32) throw new Error("Key length");
      return b;
    } catch (e) {
      if ((e as { code?: number }).code !== 44) throw e;
      const key = randomBytes(32);
      await exec("/usr/bin/security", [
        "add-generic-password",
        "-s",
        service,
        "-a",
        "vault",
        "-w",
        key.toString("base64"),
      ]);
      return key;
    }
  }
  if (process.platform === "win32") {
    const script = `Add-Type -AssemblyName System.Security; $p=Join-Path $env:HCMUE_VAULT_DIR 'key.dpapi'; if(Test-Path $p){$k=[Security.Cryptography.ProtectedData]::Unprotect([IO.File]::ReadAllBytes($p),$null,[Security.Cryptography.DataProtectionScope]::CurrentUser)}else{$k=New-Object byte[] 32; [Security.Cryptography.RandomNumberGenerator]::Create().GetBytes($k); [IO.File]::WriteAllBytes($p,[Security.Cryptography.ProtectedData]::Protect($k,$null,[Security.Cryptography.DataProtectionScope]::CurrentUser))}; [Convert]::ToBase64String($k)`;
    const { stdout } = await exec(
      "powershell.exe",
      ["-NoProfile", "-NonInteractive", "-Command", script],
      { env: { ...process.env, HCMUE_VAULT_DIR: dir }, windowsHide: true },
    );
    const key = Buffer.from(stdout.trim(), "base64");
    if (key.length !== 32) throw new Error("Không mở được DPAPI.");
    return key;
  }
  throw new Error("Runner bản này hỗ trợ macOS và Windows.");
}
export class Vault<T> {
  constructor(
    private file: string,
    private key: Buffer,
  ) {}
  async write(value: T) {
    const iv = randomBytes(12),
      cipher = createCipheriv("aes-256-gcm", this.key, iv),
      data = Buffer.concat([
        cipher.update(JSON.stringify(value)),
        cipher.final(),
      ]);
    await atomicWrite(
      this.file,
      Buffer.concat([iv, cipher.getAuthTag(), data]).toString("base64"),
    );
  }
  // Store ASCII envelope so writes remain atomic and syncable on both platforms.
  async load(fallback: () => T): Promise<T> {
    let text: string;
    try {
      text = await readFile(this.file, "utf8");
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code === "ENOENT") return fallback();
      throw e;
    }
    const bytes = Buffer.from(text, "base64"),
      d = createDecipheriv("aes-256-gcm", this.key, bytes.subarray(0, 12));
    d.setAuthTag(bytes.subarray(12, 28));
    return JSON.parse(
      Buffer.concat([d.update(bytes.subarray(28)), d.final()]).toString(),
    );
  }
}
