import { afterEach, beforeEach, describe, it, expect, vi } from "vitest";
import { performance } from "node:perf_hooks";
import { Engine } from "../../integrations/hcmue/runner/engine";
import { ApiFailure } from "../../integrations/hcmue/runner/client";
import { fixtureEngine, limits, exam, FakeClient } from "./support";
import { examKey } from "../../integrations/hcmue/protocol";
let cleanup: (() => Promise<void>)[] = [];
beforeEach(() => {
  vi.useFakeTimers();
  const base = Date.now();
  vi.spyOn(performance, "now").mockImplementation(() => Date.now() - base);
});
afterEach(async () => {
  for (const close of cleanup) await close();
  cleanup = [];
  vi.restoreAllMocks();
  vi.useRealTimers();
});
async function setup(write?: (_: any) => Promise<void>) {
  const f = await fixtureEngine(write);
  cleanup.push(() => f.engine.close());
  return f;
}
describe("isolated HCMUE execution", () => {
  it("prepares and dry-runs at the deadline without calling POST", async () => {
    const f = await setup(),
      s = await f.prepare();
    await f.arm(s.id);
    await vi.advanceTimersByTimeAsync(6999);
    expect(f.client.submits).toHaveLength(0);
    await vi.advanceTimersByTimeAsync(3);
    expect(s.status).toBe("stopped");
    expect(s.attempt.latenessMs).toBe(0);
    expect(f.client.submits).toHaveLength(0);
  });
  it("dispatches once, then verifies a code and payment deadline", async () => {
    const f = await setup(),
      s = await f.prepare(false);
    await f.arm(s.id);
    await vi.advanceTimersByTimeAsync(7010);
    expect(f.client.submits).toEqual([
      {
        ma_cap_thi: exam.ma_cap_thi,
        ngay_mo_dang_ky: exam.ngay_mo_dang_ky,
        answers: [],
      },
    ]);
    expect(s.status).toBe("pending_payment");
    expect(s.attempt.registrationCode).toBe("FIXTURE-0001");
    expect(s.attempt.paymentDeadline).toBe("2026-12-06T16:00:00.000Z");
    await expect(f.prepare(false)).rejects.toThrow("khóa gửi");
  });
  it("never resends an ambiguous timeout", async () => {
    const f = await setup();
    f.client.result = new ApiFailure("Timeout", true);
    const s = await f.prepare(false);
    await f.arm(s.id);
    await vi.advanceTimersByTimeAsync(80000);
    expect(f.client.submits).toHaveLength(1);
    expect(s.status).toBe("uncertain");
  });
  it("retries only a known pre-transport failure, at most once", async () => {
    const f = await setup();
    f.client.result = new ApiFailure("Not connected", false);
    const s = await f.prepare(false);
    await f.arm(s.id);
    await vi.advanceTimersByTimeAsync(80000);
    expect(f.client.submits).toHaveLength(2);
    expect(s.status).toBe("uncertain");
  });
  it("stops a pending retry when explicitly stopped", async () => {
    const f = await setup();
    f.client.result = new ApiFailure("Not connected", false);
    const s = await f.prepare(false);
    await f.arm(s.id);
    await vi.advanceTimersByTimeAsync(7001);
    await f.engine.execute("stop", { id: s.id }, limits);
    await vi.advanceTimersByTimeAsync(80000);
    expect(f.client.submits).toHaveLength(1);
  });
  it("polls queued jobs and verifies the final registration", async () => {
    const f = await setup();
    f.client.result = { status: "queued", jobId: "job-1" };
    const s = await f.prepare(false);
    await f.arm(s.id);
    await vi.advanceTimersByTimeAsync(9000);
    expect(f.client.submits).toHaveLength(1);
    expect(s.status).toBe("pending_payment");
    expect(s.attempt.registrationCode).toBe("FIXTURE-0001");
  });
  it("fails closed on changed questions and does not overwrite a stop", async () => {
    const f = await setup(),
      s = await f.prepare(false);
    await f.arm(s.id);
    f.client.q.questions = [
      { ma_cau_hoi: 1, noi_dung: "Mới", cau_tra_loi: [] },
    ];
    await vi.advanceTimersByTimeAsync(10000);
    expect(s.status).toBe("failed");
    expect(f.client.submits).toHaveLength(0);
  });
  it("requires durable reservation before T minus two seconds", async () => {
    let delayOnce = true;
    const f = await setup(async (data) => {
      if (
        delayOnce &&
        data.schedules.some((s: any) => s.status === "reserved")
      ) {
        delayOnce = false;
        await new Promise((r) => setTimeout(r, 3500));
      }
    });
    const s = await f.prepare(false);
    await f.arm(s.id);
    await vi.advanceTimersByTimeAsync(10000);
    expect(f.client.submits).toHaveLength(0);
    expect(s.status).toBe("failed");
  });
  it("blocks live access and allows only one active schedule per account", async () => {
    const f = await setup(),
      s = await f.prepare(false);
    await expect(f.arm(s.id, { liveEnabled: false })).rejects.toThrow("Live");
    s.test = true;
    await f.arm(s.id);
    await expect(
      f.engine.execute(
        "prepare",
        {
          accountId: "account-1",
          examKey: examKey(exam),
          targetAt: Date.now() + 9000,
          answers: {},
          test: true,
        },
        limits,
      ),
    ).rejects.toThrow("lịch hoặc khóa gửi");
  });
  it("halts on wall-clock changes", async () => {
    const f = await setup(),
      s = await f.prepare(false);
    await f.arm(s.id);
    vi.setSystemTime(Date.now() + 5000);
    await vi.advanceTimersByTimeAsync(10000);
    expect(f.client.submits).toHaveLength(0);
    expect(["failed", "stopped"]).toContain(s.status);
  });
  it("never replays armed or reserved schedules on restart", async () => {
    const f = await setup(),
      s = await f.prepare(false);
    await f.arm(s.id);
    const restored = structuredClone(f.data);
    restored.schedules.push({
      ...structuredClone(s),
      id: "reserved-copy",
      status: "reserved",
    });
    const engine = new Engine(
      restored,
      { write: async () => {} },
      () => f.client as any,
    );
    cleanup.push(() => engine.close());
    expect(restored.schedules[0].status).toBe("stopped");
    expect(restored.schedules[1].status).toBe("uncertain");
    await f.engine.execute("stop-all", {}, limits);
    await vi.advanceTimersByTimeAsync(10000);
    expect(f.client.submits).toHaveLength(0);
  });
  it("checks existing registration, photo, and conflicts before preparation", async () => {
    const f = await setup();
    f.client.registered = true;
    await expect(f.prepare(false)).rejects.toThrow("đã đăng ký");
    f.client.registered = false;
    f.client.conflicting = true;
    await expect(f.prepare(false)).rejects.toThrow("xung đột");
  });
  it("inspects an expired full exam and preserves each API's failure independently", async () => {
    const f = await setup();
    const ended = { ...exam, ngay_ket_thuc_dang_ky: "2026-01-02 12:00:00", so_luong: 400 };
    f.client.exams = async () => [ended];
    f.client.questions = async () => { throw new Error("Phiên hết hạn ở API câu hỏi"); };
    f.client.registered = true;
    const report = await f.engine.execute("inspect", { accountId: "account-1", examKey: examKey(ended) }, limits) as any;
    expect(report.exam).toEqual(ended);
    expect(report.checks).toEqual(expect.arrayContaining([
      expect.objectContaining({ label: "Hồ sơ", ok: true }),
      expect.objectContaining({ label: "Câu hỏi", ok: false, message: "Phiên hết hạn ở API câu hỏi" }),
      expect.objectContaining({ label: "Đăng ký cũ", ok: true, message: expect.stringContaining("đã có đăng ký") }),
      expect.objectContaining({ label: "Trùng lịch", ok: true }),
    ]));
    expect(f.data.schedules).toHaveLength(0);
    expect(f.client.submits).toHaveLength(0);
  });
  it("rehearses an ended full exam with an existing registration without ever submitting", async () => {
    const f = await setup();
    f.client.exams = async () => [{ ...exam, ngay_ket_thuc_dang_ky: "2026-01-02 12:00:00", so_luong: 400 }];
    f.client.registered = true;
    f.client.conflicting = true;
    await expect(f.prepare(false)).rejects.toThrow("Đợt này đã đóng");
    const s = await f.prepare(true);
    await f.arm(s.id);
    await vi.advanceTimersByTimeAsync(7010);
    expect(s.status).toBe("stopped");
    expect(s.attempt.message).toContain("Không gọi API");
    expect(f.client.submits).toHaveLength(0);
  });
  it("rehearses before an exam opens without waiting until its real opening", async () => {
    const f = await setup();
    f.client.exams = async () => [{ ...exam, ngay_mo_dang_ky: "2098-01-01 09:00:00" }];
    await f.engine.execute("prepare", { accountId: "account-1", examKey: examKey((await f.client.exams())[0]), targetAt: Date.now() + 7000, answers: {}, test: true }, { ...limits, expiresAt: Date.now() + 86400000 });
    const s = f.data.schedules.at(-1)!;
    await f.arm(s.id);
    await vi.advanceTimersByTimeAsync(7010);
    expect(s.status).toBe("stopped");
    expect(f.client.submits).toHaveLength(0);
  });
  it("replaces an account's old prepared level when preparing a different HSK", async () => {
    const f = await setup(), first = await f.prepare();
    const secondExam = { ...exam, ma_cap_thi: "HSK6_D1", ten_cap_thi: "HSK 6" };
    f.client.exams = async () => [exam, secondExam];
    await f.engine.execute("prepare", { accountId: "account-1", examKey: examKey(secondExam), targetAt: Date.now() + 7000, answers: {}, test: true }, limits);
    expect(first.status).toBe("stopped");
    const ready = f.data.schedules.filter(s => s.status === "prepared");
    expect(ready).toHaveLength(1);
    expect(ready[0].exam.ma_cap_thi).toBe("HSK6_D1");
  });
});

it("dispatches twenty independent accounts without serializing POSTs", async () => {
  const f = await setup();
  await f.engine.close();
  f.data.accounts = Array.from({ length: 20 }, (_, i) => ({
    view: {
      ...f.data.accounts[0].view,
      id: "account-" + i,
      identity: { ...f.data.accounts[0].view.identity, key: "key-" + i },
    },
    session: {
      ...f.data.accounts[0].session,
      identity: { ...f.data.accounts[0].session.identity, key: "key-" + i },
    },
  }));
  const clients = new Map<string, FakeClient>();
  const engine = new Engine(f.data, { write: async () => {} }, (session) => {
    const c = new FakeClient(session!.identity);
    clients.set(session!.identity.key, c);
    return c as any;
  });
  cleanup.push(() => engine.close());
  for (const a of f.data.accounts)
    await engine.execute(
      "prepare",
      {
        accountId: a.view.id,
        examKey: examKey(exam),
        targetAt: Date.now() + 7000,
        answers: {},
        test: false,
      },
      { ...limits, expiresAt: Date.now() + 86400000 },
    );
  await engine.execute(
    "arm",
    { ids: f.data.schedules.map((s) => s.id) },
    { ...limits, expiresAt: Date.now() + 86400000 },
  );
  await vi.advanceTimersByTimeAsync(7010);
  expect(f.data.schedules.every((s) => s.status === "pending_payment")).toBe(
    true,
  );
  expect(clients.size).toBe(20);
  for (const client of clients.values()) expect(client.submits).toHaveLength(1);
});

it("preserves the duplicate lock after logout and login again", async () => {
  const f = await setup(),
    s = await f.prepare(false);
  await f.arm(s.id);
  await vi.advanceTimersByTimeAsync(7010);
  await f.engine.execute("logout", { id: s.accountId }, limits);
  await f.engine.execute(
    "login",
    { cccd: "000000001234", password: "fixture-only" },
    limits,
  );
  expect(f.data.accounts[0].view.id).toBe(s.accountId);
  await expect(f.prepare(false)).rejects.toThrow("khóa gửi");
});

it("drops plaintext login credentials instead of persisting them", async () => {
  const f = await setup(),
    args = { cccd: "000000001234", password: "fixture-password-never-store" };
  await f.engine.execute("login", args, limits);
  expect(args.password).toBe("");
  expect(JSON.stringify(f.data)).not.toContain("fixture-password-never-store");
});
