export type ChatReference = { id: string; title: string; href: string };
export interface SystemReply { answer: string; source: "model" | "guide"; references: ChatReference[] }
export function readReply(value: unknown): SystemReply {
  const data = value as Partial<SystemReply> | null;
  if (!data || typeof data.answer !== "string" || !data.answer.trim()) throw new Error("Trợ lý trả dữ liệu chưa hợp lệ. Gửi lại câu hỏi để thử lại.");
  return {
    answer: data.answer.slice(0, 4000), source: data.source === "model" ? "model" : "guide",
    references: Array.isArray(data.references) ? data.references.flatMap(ref =>
      ref && typeof ref.id === "string" && typeof ref.title === "string" &&
      typeof ref.href === "string" && /^\/(?![\\/])/.test(ref.href) ? [ref] : []) : [],
  };
}
