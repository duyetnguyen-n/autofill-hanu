import { it, expect } from "vitest";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { request } from "node:http";
import { httpFixture } from "./fixture";

it("restricts script sources and frames and keeps static requests inside public build files", async () => {
  const root = await mkdtemp(join(tmpdir(), "hanu-public-security-"));
  const publicDir = join(root, "public");
  await mkdir(publicDir);
  await writeFile(join(root, "private.txt"), "fixture-private-data");
  await writeFile(join(publicDir, "index.html"), "<!doctype html><title>Fixture</title>");
  const app = await httpFixture(resolve(publicDir));
  const get = (path: string, host?: string) => new Promise<{ status: number; body: string }>((resolve, reject) => {
    const req = request(app.config.origin + "/", { path, headers: host ? { Host: host } : {} }, response => {
      let body = "";
      response.on("data", chunk => { body += chunk; });
      response.on("end", () => resolve({ status: response.statusCode!, body }));
    });
    req.on("error", reject);
    req.end();
  });
  try {
    const response = await fetch(app.config.origin);
    expect(response.status).toBe(200);
    const csp = response.headers.get("content-security-policy")!;
    expect(csp).toContain("script-src 'self'");
    expect(csp).not.toMatch(/script-src[^;]*(unsafe-inline|unsafe-eval|https?:|\*)/);
    expect(csp).toContain("frame-ancestors 'none'");
    expect(csp).toContain("form-action 'self'");
    expect(response.headers.get("x-content-type-options")).toBe("nosniff");
    for (const path of ["/..%2fprivate.txt", "/%2e%2e%2fprivate.txt", "/..%5cprivate.txt"]) {
      const result = await get(path);
      expect(result.status).toBe(404);
      expect(result.body).not.toContain("fixture-private-data");
    }
    expect((await get("/", "foreign.example")).status).toBe(403);
    expect((await fetch(app.config.origin + "/api/state")).status).toBe(401);
  } finally { await app.close(); await rm(root, { recursive: true, force: true }); }
}, 20000);
