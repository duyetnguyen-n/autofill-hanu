import { appendFile, open, rename, stat } from "node:fs/promises";
import { join } from "node:path";
import type { RunSummary } from "../assistant";

export type DiagnosticEvent = Record<string, string | number | boolean | undefined>;
export type ReportDiagnostic = (event: DiagnosticEvent) => void;

const summarizedEvents = new Set([
  "schedule_prepared", "schedule_armed", "preflight_start", "preflight_ready", "preflight_failed",
  "preflight_retry", "deadline_rejected", "opening_wait", "opening_check", "opening_error",
  "schedule_dispatch", "schedule_status", "schedule_stopped",
]);

export async function scheduleEvents(dir: string, id: string): Promise<NonNullable<RunSummary["events"]>> {
  const latest = new Map<string, NonNullable<RunSummary["events"]>[number]>();
  for (const name of ["diagnostics.jsonl.1", "diagnostics.jsonl"]) {
    const file = await open(join(dir, name), "r").catch(() => undefined);
    if (!file) continue;
    try {
      const size = Math.min((await file.stat()).size, 1024 * 1024 + 4096);
      const { buffer, bytesRead } = await file.read(Buffer.alloc(size), 0, size, 0);
      for (const line of buffer.toString("utf8", 0, bytesRead).split("\n")) {
        if (!line.includes(id)) continue;
        try {
          const event = JSON.parse(line);
          if (event.scheduleId !== id || !summarizedEvents.has(event.event) || typeof event.at !== "string") continue;
          const key = event.event === "schedule_status" ? `${event.event}:${event.status}` : event.event;
          latest.set(key, { kind: event.event, at: event.at, reason: event.reason, httpStatus: event.httpStatus, catalogStatus: event.catalogStatus, open: event.open, full: event.full, schoolTime: event.schoolTime });
        } catch { /* An in-progress append may leave a partial line. */ }
      }
    } finally {
      await file.close();
    }
  }
  return [...latest.values()].sort((a, b) => a.at.localeCompare(b.at)).slice(-8);
}

export function diagnosticFile(dir: string) {
  const file = join(dir, "diagnostics.jsonl");
  const limit = 1024 * 1024;
  let size: number | undefined;
  let pending = Promise.resolve();
  const record: ReportDiagnostic = event => {
    const line = JSON.stringify({ ...event, at: new Date().toISOString() }) + "\n";
    pending = pending.then(async () => {
      size ??= await stat(file).then(value => value.size, () => 0);
      if (size >= limit) {
        await rename(file, file + ".1");
        size = 0;
      }
      await appendFile(file, line, { encoding: "utf8", mode: 0o600 });
      size += Buffer.byteLength(line);
    }).catch(() => {
      size = undefined;
    });
  };
  return { record, flush: () => pending };
}

export function schoolErrorKind(value: unknown) {
  if (typeof value !== "string") return undefined;
  if (/ECONNREFUSED[^\r\n]{0,80}:3306/i.test(value)) return "school_database_unreachable";
  if (/phiên đăng nhập đã hết hạn|đăng nhập trên thiết bị khác|token kh[oô]ng hợp lệ/i.test(value)) return "session_invalid";
  if (/chưa (?:đến giờ|mở)|chưa bắt đầu/i.test(value)) return "not_open";
  if (/đã đóng|hết hạn đăng ký/i.test(value)) return "closed";
  if (/hết chỗ|đã đủ số lượng/i.test(value)) return "full";
  if (/mật khẩu|CCCD/i.test(value)) return "credential_or_identity_rejected";
  if (/xung đột|trùng lịch/i.test(value)) return "schedule_conflict";
  if (/xác thực email|ảnh thẻ/i.test(value)) return "profile_incomplete";
  if (/câu hỏi|câu trả lời/i.test(value)) return "answers_rejected";
  return undefined;
}
