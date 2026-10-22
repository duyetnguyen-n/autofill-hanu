import { describe, expect, it } from "vitest";
import { examObservation, scheduleProblem } from "../../integrations/hcmue/protocol";
import { eachAccount, matchesPlan, planForSchedule, suggestedTarget, targetTime } from "../../integrations/hcmue/ui/planning";
import { exam } from "./support";
import type { Schedule } from "../../integrations/hcmue/protocol";

const now = Date.parse("2026-10-22T10:00:00+07:00"),
  ended = { ...exam, ngay_mo_dang_ky: "2026-10-19 11:00:00", ngay_ket_thuc_dang_ky: "2026-10-19 12:00:00", so_luong: 400 };
describe("HCMUE per-account planning", () => {
  it("keeps the source status even when local time and capacity contradict it", () => {
    const before = structuredClone(ended);
    expect(examObservation(ended, now)).toContain("Đã quá hạn");
    expect(examObservation(ended, now)).toContain("Số chỗ đã đủ");
    expect(ended).toEqual(before);
    expect(ended.trang_thai).toBe("open");
    expect(scheduleProblem(ended, now + 60000, now, false)).toContain("Đợt này đã đóng");
    expect(scheduleProblem(ended, now + 60000, now, true)).toBeUndefined();
  });
  it("distinguishes lead time, window bounds, capacity and invalid school dates", () => {
    expect(scheduleProblem(exam, now + 1000, now, false)).toContain("dưới 6 giây");
    expect(scheduleProblem(exam, NaN, now, true)).toContain("hợp lệ");
    expect(scheduleProblem(exam, now + 8 * 86400000, now, true)).toContain("7 ngày");
    expect(scheduleProblem({ ...exam, so_luong: 400 }, now + 60000, now, false)).toContain("đã đủ");
    expect(scheduleProblem({ ...exam, ngay_mo_dang_ky: "bad" }, now + 60000, now, false)).toContain("không hợp lệ");
    expect(scheduleProblem({ ...exam, ngay_mo_dang_ky: "2026-10-23 09:00:00" }, now + 60000, now, false)).toContain("khi trường mở");
    expect(scheduleProblem({ ...exam, ngay_ket_thuc_dang_ky: "2026-10-22 10:00:30" }, now + 60000, now, false)).toContain("khi trường đóng");
  });
  it("uses Vietnam time for scheduling and allows rehearsing future/ended exams now", () => {
    expect(targetTime("2026-10-22T10:00:00")).toBe(now);
    expect(suggestedTarget(ended, true, now)).toBe("2026-10-22T10:01:00");
    const future = { ...exam, ngay_mo_dang_ky: "2026-10-23 09:00:00" };
    expect(suggestedTarget(future, false, now)).toBe("2026-10-23T09:00:00");
    expect(suggestedTarget(future, true, now)).toBe("2026-10-22T10:01:00");
  });
  it("continues independent accounts with different exams after one fails", async () => {
    const received: string[] = [], errors: Record<string, string> = {};
    const rows = [{ id: "A", exam: "HSK2" }, { id: "B", exam: "HSK4" }, { id: "C", exam: "HSK6" }];
    const n = await eachAccount(rows, async a => { if (a.id === "B") throw new Error("Thiếu ảnh"); received.push(a.exam); }, (a, message) => { errors[a.id] = message; });
    expect(n).toBe(2);
    expect(received).toEqual(["HSK2", "HSK6"]);
    expect(errors).toEqual({ B: "Thiếu ảnh" });
  });
  it("prevents arming an old prepared plan after changing level, time or mode", () => {
    const s = { exam, targetAt: "2026-10-23T02:00:00.000Z", test: true } as Schedule;
    const p = planForSchedule(s);
    expect(matchesPlan(s, p)).toBe(true);
    expect(matchesPlan(s, { ...p, test: false })).toBe(false);
    expect(matchesPlan(s, { ...p, target: "2026-10-23T09:00:01" })).toBe(false);
    expect(matchesPlan(s, { ...p, examKey: "HSK6" })).toBe(false);
  });
});
