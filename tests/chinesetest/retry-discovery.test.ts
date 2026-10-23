import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { performance } from "node:perf_hooks";
import type { Engine } from "../../integrations/chinesetest/runner/engine";
import { DONG_A } from "../../integrations/chinesetest/protocol";
import { fixtureEngine, center, limits } from "./support";

const engines: Engine[] = [];
beforeEach(() => { vi.useFakeTimers(); const base = Date.now(); vi.spyOn(performance, "now").mockImplementation(() => Date.now() - base); });
afterEach(async () => { for (const e of engines.splice(0)) await e.close(); vi.restoreAllMocks(); vi.useRealTimers(); });
async function setup(count = 1, write?: (_: any) => Promise<void>) { const f = await fixtureEngine(count, write); engines.push(f.engine); return f; }

it.each(["accepted", "confirmed"] as const)("releases a cancelled %s registration while preserving its order history", async status => {
  const f = await setup(); const p = await f.prepare(false); const run = f.data.schedules[0];
  Object.assign(run, { status, attempt: { count: 1, orderNo: "old-order", orderKey: "old,key", bmid: "old-registration" } });
  await expect(f.prepare(false)).rejects.toThrow("khóa gửi");
  await f.engine.execute("reconcile", { id: run.id }, limits); expect(run.message).toContain("đã hủy");
  await f.engine.execute("verify-absent", { id: run.id, confirm: true }, limits);
  expect(run).toMatchObject({ status: "released", verifiedAbsent: true, attempt: { count: 1, orderNo: "old-order", bmid: "old-registration" } });
  expect(run.verifiedAbsentAt).toBeTypeOf("number");
  await f.engine.execute("reconcile", { id: run.id }, limits); expect(run.status).toBe("released");
  const next = await f.prepare(false); expect(next.schedule.id).not.toBe(p.schedule.id); expect(next.schedule.attempt.count).toBe(0); expect(f.shared.submits).toHaveLength(0);
});
it("keeps a completed registration locked when records still contain it or the read fails", async () => {
  const f = await setup(); await f.prepare(false); const run = f.data.schedules[0]; run.status = "confirmed"; run.attempt.count = 1;
  f.shared.records = [{ KSXM_kmid: DONG_A.kmId, KDZX_kaoshitime: DONG_A.ksDate, KSBM_bmid: "active" }];
  await expect(f.engine.execute("verify-absent", { id: run.id, confirm: true }, limits)).rejects.toThrow("vẫn có đăng ký");
  f.shared.records = []; f.shared.recordsError = new Error("read timeout");
  await expect(f.engine.execute("verify-absent", { id: run.id, confirm: true }, limits)).rejects.toThrow("read timeout");
  expect(run.verifiedAbsent).not.toBe(true);
});
it("does not release a stopped send until its late response has settled", async () => {
  const f = await setup(); const p = await f.prepare(false); let release!: () => void;
  f.shared.submitGate = new Promise(r => release = r); await f.arm(p); await vi.advanceTimersByTimeAsync(7100);
  await f.engine.execute("stop", { id: p.schedule.id }, limits);
  await expect(f.engine.execute("verify-absent", { id: p.schedule.id, confirm: true }, limits)).rejects.toThrow("vẫn đang gửi");
  release(); await vi.advanceTimersByTimeAsync(100); expect(f.data.schedules[0].verifiedAbsent).not.toBe(true);
});
it("rolls back an absence release if durable storage fails", async () => {
  let fail = false; const f = await setup(1, async d => { if (fail && d.schedules.some((s: any) => s.verifiedAbsent)) throw new Error("disk full"); });
  await f.prepare(false); const run = f.data.schedules[0]; run.status = "confirmed"; run.attempt.count = 1; fail = true;
  await expect(f.engine.execute("verify-absent", { id: run.id, confirm: true }, limits)).rejects.toThrow("disk full");
  expect(run.status).toBe("confirmed"); expect(run.verifiedAbsent).not.toBe(true); await expect(f.prepare(false)).rejects.toThrow("khóa gửi");
});
it("loads the Vietnam directory without requiring an exam date or a published session", async () => {
  const f = await setup(); f.shared.sites = [];
  const r = await f.engine.execute("catalog", { kind: "directory", ksType: "2" }, limits);
  expect(r.data).toHaveLength(2); expect(f.shared.directoryCalls).toEqual(["2"]); expect(f.shared.siteCalls).toBe(0); expect(f.shared.submits).toHaveLength(0);
});
it("with zero delay awaits slow discovery, coalesces accounts, then stops without submitting", async () => {
  const f = await setup(2), at = Date.now() + 15000;
  for (let i = 0; i < 2; i++) { const p = await f.engine.execute("prepare", { accountId: `account-${i}`, target: { ...DONG_A, targetAt: at, intervalMs: 0 }, test: true }, limits); await f.arm(p); }
  let release!: () => void; f.shared.siteGate = new Promise(r => release = r); f.shared.sites = []; const before = f.shared.siteCalls;
  await vi.advanceTimersByTimeAsync(19000); expect(f.shared.siteCalls - before).toBe(1);
  await f.engine.execute("stop-all", {}, limits); release(); await vi.advanceTimersByTimeAsync(100);
  expect(f.shared.siteCalls - before).toBe(1); expect(f.shared.submits).toHaveLength(0);
});
it("with zero delay fetches again after an empty response and sends exactly once when the center appears", async () => {
  const f = await setup(); f.shared.sites = [];
  const p = await f.engine.execute("prepare", { accountId: "account-0", target: { ...DONG_A, targetAt: Date.now() + 7000, intervalMs: 0 }, test: false, agreeRules: true, agreePrivacy: true }, limits);
  await f.arm(p); const before = f.shared.siteCalls; await vi.advanceTimersByTimeAsync(7002); expect(f.shared.siteCalls - before).toBeGreaterThan(1);
  f.shared.sites = [center]; await vi.advanceTimersByTimeAsync(2100); expect(f.shared.submits).toHaveLength(1); expect(f.engine.snapshot().schedules[0].status).toBe("confirmed");
});
