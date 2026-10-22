import { examKey, schoolTime, type Exam, type Schedule } from "../protocol";

export interface AccountPlan {
  examKey: string;
  target: string;
  test: boolean;
}
export const vnInput = (ms: number) =>
  Number.isFinite(ms) ? new Date(ms + 7 * 3600000).toISOString().slice(0, 19) : "";
export const targetTime = (value: string) => Date.parse(value + "+07:00");
export function suggestedTarget(exam: Exam, test: boolean, now = Date.now()) {
  return vnInput(test ? now + 60000 : Math.max(schoolTime(exam.ngay_mo_dang_ky), now + 60000));
}
export function planForSchedule(schedule: Schedule): AccountPlan {
  return { examKey: examKey(schedule.exam), target: vnInput(Date.parse(schedule.targetAt)), test: schedule.test };
}
export function matchesPlan(schedule: Schedule, plan?: AccountPlan) {
  return !plan || (examKey(schedule.exam) === plan.examKey && Date.parse(schedule.targetAt) === targetTime(plan.target) && schedule.test === plan.test);
}
/** A rejected account must not abort independent candidates in the batch. */
export async function eachAccount<T>(items: T[], work: (item: T) => Promise<void>, failed: (item: T, message: string) => void) {
  let completed = 0;
  for (const item of items) {
    try { await work(item); completed++; }
    catch (e) { failed(item, e instanceof Error ? e.message : "Không xử lý được tài khoản này."); }
  }
  return completed;
}
