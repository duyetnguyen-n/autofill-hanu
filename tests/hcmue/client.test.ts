import { it, expect } from "vitest";
import { createServer } from "node:https";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { execFileSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  HcmueClient,
  ApiFailure,
} from "../../integrations/hcmue/runner/client";
import { exam } from "./support";
it("uses strict TLS and isolated bearer/device/cookie sessions without redirects", async () => {
  const dir = await mkdtemp(join(tmpdir(), "hcmue-tls-"));
  let a: HcmueClient | undefined, b: HcmueClient | undefined;
  const prior = process.env.HCMUE_FIXTURE;
  process.env.HCMUE_FIXTURE = "1";
  execFileSync(
    "openssl",
    [
      "req",
      "-x509",
      "-newkey",
      "rsa:2048",
      "-nodes",
      "-keyout",
      join(dir, "key.pem"),
      "-out",
      join(dir, "cert.pem"),
      "-days",
      "1",
      "-subj",
      "/CN=localhost",
      "-addext",
      "subjectAltName=DNS:localhost",
    ],
    { stdio: "ignore" },
  );
  const ca = await readFile(join(dir, "cert.pem"), "utf8"),
    headers: any[] = [];
  const server = createServer(
    { key: await readFile(join(dir, "key.pem")), cert: ca },
    async (req, res) => {
      let raw = "";
      for await (const part of req) raw += part;
      const path = req.url!;
      res.setHeader("Content-Type", "application/json");
      if (path.endsWith("/auth/login")) {
        const { cccd } = JSON.parse(raw);
        res.setHeader("Set-Cookie", `sid=${cccd}; HttpOnly; Path=/`);
        res.end(JSON.stringify({ status: "success", token: "token-" + cccd }));
        return;
      }
      headers.push({
        path,
        authorization: req.headers.authorization,
        device: req.headers["x-device-id"],
        cookie: req.headers.cookie,
      });
      if (path.endsWith("/me/profile")) {
        const id = String(req.headers.authorization).replace(
          "Bearer token-",
          "",
        );
        res.end(
          JSON.stringify({
            success: true,
            data: {
              user: {
                cccd: id,
                email: "fixture@example.test",
                isVerified: true,
              },
              cccd: { ho_ten: "Fixture " + id, anh_the: "photo" },
            },
          }),
        );
        return;
      }
      if (path.endsWith("/redirect")) {
        res.writeHead(302, { Location: "https://example.invalid/" });
        res.end("{}");
        return;
      }
      if (path.endsWith("/busy")) {
        res.writeHead(429, { "Retry-After": "3" });
        res.end("{}");
        return;
      }
      if (path.endsWith("/broken")) {
        res.end("<html>not JSON</html>");
        return;
      }
      if (path.endsWith("/dang-ky-thi")) {
        res.end(JSON.stringify({ status: "success", data: "FIXTURE-TLS" }));
        return;
      }
      res.end("{}");
    },
  );
  await new Promise<void>((r) => server.listen(0, "localhost", r));
  try {
    const origin = `https://localhost:${(server.address() as any).port}`;
    a = new HcmueClient(undefined, origin, ca);
    b = new HcmueClient(undefined, origin, ca);
    const [sa, sb] = await Promise.all([
      a.login("000000000001", "fixture-a"),
      b.login("000000000002", "fixture-b"),
    ]);
    expect(sa.identity.key).not.toBe(sb.identity.key);
    expect(sa.deviceId).not.toBe(sb.deviceId);
    expect(sa).not.toHaveProperty("password");
    const ha = headers.find(
        (h) => h.authorization === "Bearer token-000000000001",
      ),
      hb = headers.find((h) => h.authorization === "Bearer token-000000000002");
    expect(ha.cookie).toBe("sid=000000000001");
    expect(hb.cookie).toBe("sid=000000000002");
    expect(ha.device).toBe(sa.deviceId);
    expect(
      await a.submit({ ma_cap_thi: exam.ma_cap_thi, answers: [] }),
    ).toEqual({ status: "success", data: "FIXTURE-TLS" });
    await expect(a.call("/redirect")).rejects.toMatchObject({
      status: 302,
      mayHaveSent: true,
    });
    await expect(a.call("/busy")).rejects.toMatchObject({
      status: 429,
      retryAfterMs: 3000,
    });
    await expect(a.call("/broken")).rejects.toBeInstanceOf(ApiFailure);
    expect(
      () => new HcmueClient(undefined, "https://example.invalid", ca),
    ).toThrow("HCMUE");
    expect(() => new HcmueClient(undefined, undefined, ca)).toThrow("TLS");
  } finally {
    a?.close();
    b?.close();
    await new Promise<void>((r) => server.close(() => r()));
    if (prior === undefined) delete process.env.HCMUE_FIXTURE;
    else process.env.HCMUE_FIXTURE = prior;
    await rm(dir, { recursive: true, force: true });
  }
}, 20000);
