import { createContext, useContext } from "react";

export const guideTargets = { menu: "account-menu", admin: "open-admin" } as const;
export const adminPath = "/admin";

export function adminGuideIntent(question: string, guiding = false): "guide" | "open" | undefined {
  const text = question.toLowerCase().normalize("NFD").replace(/\p{M}/gu, "").replace(/đ/g, "d")
    .replace(/[^a-z0-9]+/g, " ").trim();
  if (/\b(khong|dung|chua) (can |muon )?(mo|vao|bam|an)\b/.test(text)) return;
  if (guiding && /^(mo|bam|an|vao)( menu)? (giup|minh|ho|cho)\b/.test(text)) return "open";
  if (!/\b(quan tri|admin)\b/.test(text)) return;
  if (/\b(lam sao|the nao|o dau|cach|huong dan|chi (toi|minh|em)|how|where)\b/.test(text)) return "guide";
  if (/^(hay |ban |vui long |toi muon |minh muon |cho toi )?(mo|vao|den|chuyen den|chuyen sang|open|go to)\b/.test(text)) return "open";
  if (/\b(vao|truy cap|tim) (trang |man )?(quan tri|admin)\b/.test(text)) return "guide";
}

export const GuideContext = createContext<{ active: boolean; handoff(question: string): boolean }>({
  active: false,
  handoff: (_question: string) => false,
});
export const useGuide = () => useContext(GuideContext);
