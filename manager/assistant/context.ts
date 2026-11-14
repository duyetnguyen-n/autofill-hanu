import { redactAssistantText } from "./privacy";

export type CompanionFact = { label: string; value: string };
export type CompanionControl = { id: string; label: string; disabled: boolean; reason?: string; purpose?: "launch-runner" | "navigate" };
export type CompanionEvent = { kind: "navigate" | "click" | "change" | "notice"; label: string; path: string; at: string };
export type CompanionTurn = { role: "user" | "assistant"; text: string };
export interface CompanionPage {
  path: string;
  title: string;
  capturedAt: string;
  facts: CompanionFact[];
  dialogs: string[];
  notices: string[];
  controls: CompanionControl[];
  focusedControl?: string;
  workflow?: { title: string; detail: string; stage?: number; total?: number; done?: boolean };
}
export interface CompanionContext {
  page: CompanionPage;
  goal: string;
  events: CompanionEvent[];
  tracking?: { active: boolean; summary: string; latestUpdate?: string };
}

export const companionPaths = ["/", "/google-direct", "/hcmue", "/chinesetest", "/account", "/admin", "/knowledge", "/hcmue/knowledge"];
export const safeCompanionText = (value: unknown, limit = 180) => typeof value === "string"
  ? redactAssistantText(value.slice(0, 4000)).replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ").trim().slice(0, limit) : "";
const record = (value: unknown): Record<string, unknown> => value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
const list = (value: unknown) => Array.isArray(value) ? value : [];
const timestamp = (value: unknown) => typeof value === "string" && /^\d{4}-\d\d-\d\dT[\d:.]+Z$/.test(value) && Number.isFinite(Date.parse(value)) ? value : undefined;
const controlId = (value: unknown) => typeof value === "string" && /^c-\d{1,6}$/.test(value) ? value : undefined;

/** Accept only the observation schema; DOM text is data, never agent instructions or authorization. */
export function readCompanionContext(value: unknown, now = Date.now()): CompanionContext | undefined {
  const source = record(value), raw = record(source.page);
  const capturedAt = timestamp(raw.capturedAt);
  if (!companionPaths.includes(raw.path as string) || !capturedAt || Math.abs(now - Date.parse(capturedAt)) > 5 * 60_000) return;
  const controls: CompanionControl[] = list(raw.controls).slice(0, 12).flatMap(value => {
    const item = record(value), id = controlId(item.id), label = safeCompanionText(item.label, 100);
    const purpose = item.purpose === "launch-runner" || item.purpose === "navigate" ? item.purpose : undefined;
    return id && label ? [{ id, label, disabled: item.disabled === true, reason: safeCompanionText(item.reason, 240) || undefined, purpose }] : [];
  });
  const workflow = record(raw.workflow), workflowTitle = safeCompanionText(workflow.title);
  const stage = typeof workflow.stage === "number" && Number.isInteger(workflow.stage) && workflow.stage >= 0 && workflow.stage <= 100 ? workflow.stage : undefined;
  const total = typeof workflow.total === "number" && Number.isInteger(workflow.total) && workflow.total > 0 && workflow.total <= 100 ? workflow.total : undefined;
  return {
    page: {
      path: raw.path as string, title: safeCompanionText(raw.title, 100), capturedAt,
      facts: list(raw.facts).slice(0, 12).flatMap(value => {
        const item = record(value), label = safeCompanionText(item.label, 60), text = safeCompanionText(item.value);
        return label && text ? [{ label, value: text }] : [];
      }),
      dialogs: list(raw.dialogs).slice(-3).map(value => safeCompanionText(value, 100)).filter(Boolean),
      notices: list(raw.notices).slice(-4).map(value => safeCompanionText(value, 240)).filter(Boolean),
      controls, focusedControl: controls.some(item => item.id === raw.focusedControl) ? raw.focusedControl as string : undefined,
      workflow: workflowTitle ? { title: workflowTitle, detail: safeCompanionText(workflow.detail, 240), stage, total, done: workflow.done === true } : undefined,
    },
    goal: safeCompanionText(source.goal, 400),
    tracking: typeof record(source.tracking).active === "boolean"
      ? { active: record(source.tracking).active === true, summary: safeCompanionText(record(source.tracking).summary, 300), latestUpdate: safeCompanionText(record(source.tracking).latestUpdate, 600) || undefined } : undefined,
    events: list(source.events).slice(-12).flatMap(value => {
      const item = record(value), at = timestamp(item.at), label = safeCompanionText(item.label, 140);
      return ["navigate", "click", "change", "notice"].includes(item.kind as string) && companionPaths.includes(item.path as string) &&
        at && Date.parse(at) <= now + 60_000 && now - Date.parse(at) < 2 * 60 * 60_000 && label
        ? [{ kind: item.kind as CompanionEvent["kind"], path: item.path as string, at, label }] : [];
    }),
  };
}

export function readCompanionHistory(value: unknown): CompanionTurn[] {
  return list(value).slice(-10).flatMap(value => {
    const item = record(value);
    const text = typeof item.text === "string" ? redactAssistantText(item.text.slice(0, 900)).trim() : "";
    return (item.role === "user" || item.role === "assistant") && text ? [{ role: item.role, text }] : [];
  });
}

export function asksAboutCurrentPage(message: string) {
  const text = message.normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/đ/g, "d").replace(/Đ/g, "D");
  return /(?:dang (?:vuong|o dau|lam gi)|lam (?:gi |the nao )?tiep|buoc tiep|man (?:hinh )?nay|trang nay|nut nay|cai nay|loi nay|thong bao nay|mo.*runner|vua (?:bam|lam|sua|thao tac)|khong (?:bam|an|nhan) duoc|bi (?:mo|khoa)|cho nao|tinh trang hien tai)/i.test(text);
}

export function currentPageAnswer(context: CompanionContext, message = "") {
  const { page } = context;
  if (/mở.*runner|mo.*runner/i.test(message)) {
    const launch = page.controls.find(item => item.purpose === "launch-runner" && !item.disabled);
    return { answer: launch ? `Bạn bấm “${launch.label}” ở phần Máy thực thi nhé. Nếu trình duyệt hỏi, chọn Mở ứng dụng. Khi máy hiện đang kết nối thì mình mới xác nhận được Runner đã sẵn sàng.`
      : "Bạn vào phần Máy thực thi rồi tìm nút ‘Mở runner trên máy này’ nhé. Mình chưa thấy nút mở Runner trong phần đang hiển thị, nên chưa thể chỉ đúng vị trí cho bạn.",
      focus: launch ? { id: launch.id, label: launch.label } : undefined };
  }
  const focused = page.controls.find(item => item.id === page.focusedControl);
  const blocked = focused?.disabled ? focused : page.controls.find(item => item.disabled && item.reason);
  const lines: string[] = [];
  if (blocked) lines.push(`Bạn chưa bấm được “${blocked.label}” vì ${blocked.reason || "mình chưa đọc được điều kiện còn thiếu. Bạn mở phần chi tiết của thao tác này để mình kiểm tra tiếp nhé."}`);
  if (page.notices.length) lines.push(page.notices.at(-1)!);
  if (page.workflow) lines.push(`${page.workflow.done ? "Xong bước này rồi" : "Mình cùng làm bước này nhé"}: ${page.workflow.title}. ${page.workflow.detail}`);
  const nextStep = page.facts.find(fact => fact.label === "Bước tiếp theo");
  if (nextStep && !page.workflow) lines.push(nextStep.value);
  if (!blocked && !page.workflow && !page.notices.length && !nextStep) {
    lines.push("Bạn chọn hồ sơ hoặc mở lịch cần xem nhé. Mình sẽ dựa vào trạng thái của mục đó để chỉ bước tiếp theo.");
  }
  const event = context.events.filter(item => item.kind === "click" || item.kind === "change").at(-1);
  if (event && /lưu|gửi|bật|chuẩn bị|đăng ký|xóa|dừng/i.test(event.label))
    lines.push("Mình thấy bạn vừa thao tác, nhưng chưa có xác nhận hoàn tất. Mình chưa thể kết luận đã lưu hay gửi thành công.");
  return { answer: lines.join("\n\n"), focus: blocked ? { id: blocked.id, label: blocked.label } : undefined };
}
