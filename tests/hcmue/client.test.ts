import { it, expect } from "vitest";
import { createServer } from "node:https";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { execFileSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  HcmueClient,
  ApiFailure,
  transportMessage,
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
        if (cccd === "000000000003") {
          res.writeHead(400);
          res.end(
            JSON.stringify({
              status: "error",
              message: "Số CCCD không tồn tại",
            }),
          );
          return;
        }
        if (cccd === "000000000004") {
          res.writeHead(403);
          res.end(
            JSON.stringify({
              status: "email_not_verified",
              requiresEmailVerification: true,
              message: "Verify email",
            }),
          );
          return;
        }
        if (cccd === "000000000005") {
          res.end(
            JSON.stringify({ status: "error", message: "Mật khẩu không đúng" }),
          );
          return;
        }
        if (cccd === "000000000007") {
          res.writeHead(400);
          res.end(
            JSON.stringify({
              status: "error",
              message: "Account 031202001234 password eyJfixture-token-unsafe",
            }),
          );
          return;
        }
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
              cccd:
                id === "000000000006"
                  ? null
                  : { ho_ten: "Fixture " + id, anh_the: "photo" },
            },
          }),
        );
        return;
      }
      if (path.startsWith("/v1/api/ky-thi-mo/comming-exam?")) {
        res.end(
          JSON.stringify({
            success: true,
            message: "Lấy danh sách kỳ thi chưa diễn ra thành công",
            data: [{ ...exam, phi: "1550000" }],
            pagination: { page: 1, limit: 1000, total: 1, totalPages: 1 },
          }),
        );
        return;
      }
      if (path.endsWith("/cau-hoi-va-tra-loi")) {
        res.end(
          JSON.stringify({
            success: true,
            message: "OK",
            open_exam: {
              ma_cap_thi: exam.ma_cap_thi,
              ngay_mo_dang_ky: exam.ngay_mo_dang_ky,
              hasRegisterCode: 0,
            },
            questions: [],
          }),
        );
        return;
      }
      if (path.startsWith("/v1/api/dang-ky-thi/check-registration?")) {
        res.end(
          JSON.stringify({
            status: "success",
            data: { isRegistered: false, registration: null },
          }),
        );
        return;
      }
      if (path.startsWith("/v1/api/dang-ky-thi/check-schedule-conflict?")) {
        res.end(
          JSON.stringify({
            status: "success",
            data: { hasConflict: false, conflictType: null, conflict: null },
          }),
        );
        return;
      }
      if (path.endsWith("/dang-ky-thi/jobs/fixture-job")) {
        res.end(
          JSON.stringify({
            status: "success",
            data: { jobStatus: "completed", ma_dang_ky: "FIXTURE-TLS" },
          }),
        );
        return;
      }
      if (path.endsWith("/dang-ky-thi/jobs/malformed-job")) {
        res.end("{}");
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
    const untrusted = new HcmueClient(undefined, origin);
    try {
      await expect(untrusted.call("/me/profile")).rejects.toThrow(
        "chứng chỉ HTTPS",
      );
    } finally {
      untrusted.close();
    }
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
    expect(await a.exams()).toEqual([{ ...exam, phi: "1550000" }]);
    expect(await a.questions(exam)).toMatchObject({
      success: true,
      open_exam: { hasRegisterCode: 0 },
      questions: [],
    });
    expect(await a.registration(exam)).toEqual({
      isRegistered: false,
      registration: null,
    });
    expect(await a.conflict(exam)).toEqual({
      hasConflict: false,
      conflictType: null,
      conflict: null,
    });
    expect(await a.job("fixture-job")).toMatchObject({
      data: { jobStatus: "completed", ma_dang_ky: "FIXTURE-TLS" },
    });
    await expect(a.job("malformed-job")).rejects.toThrow("data.jobStatus");
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
    for (const [id, message] of [
      ["000000000003", "Số CCCD không tồn tại"],
      ["000000000004", "chưa xác thực email"],
      ["000000000005", "Mật khẩu không đúng"],
    ]) {
      const failed = new HcmueClient(undefined, origin, ca);
      try {
        await expect(failed.login(id, "fixture")).rejects.toThrow(message);
      } finally {
        failed.close();
      }
    }
    const incomplete = new HcmueClient(undefined, origin, ca);
    try {
      const session = await incomplete.login("000000000006", "fixture");
      expect(session.identity.hasPhoto).toBe(false);
      expect(session.identity.name).toBe("Thí sinh 0006");
    } finally {
      incomplete.close();
    }
    const unsafe = new HcmueClient(undefined, origin, ca);
    try {
      await expect(unsafe.login("000000000007", "fixture")).rejects.toThrow(
        "HTTP 400",
      );
    } finally {
      unsafe.close();
    }

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

it("identifies certificate and network failures without weakening TLS", () => {
  expect(transportMessage("UNABLE_TO_VERIFY_LEAF_SIGNATURE", false)).toContain(
    "chứng chỉ HTTPS",
  );
  expect(transportMessage("ENOTFOUND", false)).toContain("DNS");
  expect(transportMessage("ECONNREFUSED", false)).toContain("Chưa kết nối");
  expect(transportMessage("ECONNRESET", true)).toContain("kiểm tra kết quả");
});
