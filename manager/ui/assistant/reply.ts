export type ChatReference = { id: string; title: string; href: string };
export interface SystemReply { answer: string; source: "model" | "guide" | "context"; references: ChatReference[]; focus?: { id: string; label: string } }
export function readReply(value: unknown): SystemReply {
  const data = value as Partial<SystemReply> | null;
  if (!data || typeof data.answer !== "string" || !data.answer.trim()) throw new Error("Trợ lý trả dữ liệu chưa hợp lệ. Gửi lại câu hỏi để thử lại.");
  return {
    answer: data.answer.slice(0, 4000), source: data.source === "model" || data.source === "context" ? data.source : "guide",
    focus: data.focus && typeof data.focus.id === "string" && /^c-\d{1,6}$/.test(data.focus.id) && typeof data.focus.label === "string"
      ? { id: data.focus.id, label: data.focus.label.slice(0, 100) } : undefined,
    references: Array.isArray(data.references) ? data.references.flatMap(ref =>
      ref && typeof ref.id === "string" && typeof ref.title === "string" &&
      typeof ref.href === "string" && /^\/(?![\\/])/.test(ref.href) ? [ref] : []) : [],
  };
}
