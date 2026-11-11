import { createContext, useContext } from "react";

export const guideTargets = {
  menu: "account-menu", admin: "open-admin", account: "open-account", access: "access-facts", live: "live-status",
  pairOpen: "pair-open", pairCreate: "pair-create", pairCopy: "pair-copy", pairNext: "pair-next", pairClose: "pair-close", profileClose: "profile-close",
  profiles: "profile-list", profileTab: "profile-tab", profileIdentity: "profile-identity", profileFields: "profile-fields",
  profileFiles: "profile-files", profileSave: "profile-save", profileConflict: "profile-conflict",
} as const;
export const adminPath = "/admin";
export const products = [
  { id: "forms", label: "Google Forms", href: "/", aliases: /\b(google forms?|forms)\b/ },
  { id: "direct", label: "Google Forms Direct", href: "/google-direct", aliases: /\b(?:google forms? )?direct\b/ },
  { id: "hcmue", label: "HSK HCMUE", href: "/hcmue", aliases: /\bhcmue\b/ },
  { id: "chinesetest", label: "ChineseTest", href: "/chinesetest", aliases: /\bchinese ?test\b/ },
] as const;
export type Product = typeof products[number];
export type FormsGuide = "pair-profile" | "prepare-profile";
export type Guide = "admin" | "access" | "live" | Product["id"] | FormsGuide;
export type GuideTarget = keyof typeof guideTargets | Product["id"];
export type GuideIntent = { guide: Guide; open: boolean } | "continue";
export type FormsGuideStep = {
  title: string; detail: string; stage: number; total: number; target?: GuideTarget; done?: boolean;
  action?: { label: string; run(): void }; nextGuide?: FormsGuide;
};
export const isFormsGuide = (guide?: Guide): guide is FormsGuide => guide === "pair-profile" || guide === "prepare-profile";

export function productAtPath(path: string) { return products.find(product => product.href === path); }
export function productForGuide(guide: Guide) { return products.find(product => product.id === guide); }
export function pathForGuide(guide: Guide) {
  if (isFormsGuide(guide)) return "/";
  if (guide === "admin") return adminPath;
  if (guide === "access" || guide === "live") return "/account";
  return productForGuide(guide)!.href;
}
export function onGuidePage(guide: Guide) {
  return isFormsGuide(guide) ? ["/", "/google-direct"].includes(location.pathname) : location.pathname === pathForGuide(guide);
}
export function targetMarker(target: GuideTarget) {
  return Object.hasOwn(guideTargets, target) ? guideTargets[target as keyof typeof guideTargets] : `product-${target}`;
}

export function guideIntent(question: string, guiding = false): GuideIntent | undefined {
  const text = question.toLowerCase().normalize("NFD").replace(/\p{M}/gu, "").replace(/đ/g, "d")
    .replace(/[^a-z0-9]+/g, " ").trim();
  if (/\b(khong|dung|chua) (can |muon )?(mo|vao|bam|an)\b/.test(text)) return;
  if (guiding && /^(mo|bam|an|vao)( menu)? (giup|minh|ho|cho)( toi| minh| em| t| minh voi| toi voi)?$/.test(text)) return "continue";
  const how = /\b(lam sao|the nao|o dau|cach|huong dan|chi (toi|minh|em)|how|where)\b/.test(text);
  const open = !how && /^(hay |ban |vui long |toi muon |minh muon |cho toi )?(mo|vao|den|chuyen den|chuyen sang|open|go to)\b/.test(text);
  const navigation = /\b(vao|truy cap|mo|chuyen (sang|den)|doi sang|tim|open|go to)\b/.test(text);
  if (/\b(lien ket|ket noi|them) (?:ma |them |chrome )*(?:chrome )?profile\b/.test(text) &&
      !/\b(huy|xoa|loi|tai sao|hcmue|chinese ?test)\b/.test(text)) return { guide: "pair-profile", open: false };
  if (/\b(?:chuan bi|dong bo|cap nhat|nhap) (?:va dong bo )?(?:ho so|profile)\b/.test(text) &&
      !/\b(hcmue|chinese ?test|loi|tai sao|da dong bo|chua dong bo)\b/.test(text)) return { guide: "prepare-profile", open: false };
  if (/\b(quyen live|quyen dang ky that)\b/.test(text) && !/\b(cap|doi|bat|tat) quyen\b/.test(text)) return { guide: "live", open: false };
  if (/\b(quyen su dung|han su dung|han tai khoan|han muc (profile|tai khoan))\b/.test(text) &&
      /\b(xem|kiem tra|con|duoc|het|bao lau|o dau|the nao)\b/.test(text)) return { guide: "access", open };
  if (/\b(quan tri|admin)\b/.test(text) && (navigation || how)) return { guide: "admin", open };
  if (!navigation) return;
  const destination = text.match(/\b(?:sang|den|vao|go to) (.+)$/)?.[1] ?? text;
  const matches = products.filter(product => product.aliases.test(destination));
  const distinct = matches.filter(product => product.id !== "forms" || !matches.some(match => match.id === "direct"));
  if (distinct.length === 1) return { guide: distinct[0].id, open };
}

export const GuideContext = createContext<{
  active: boolean; switching: boolean; availableProducts: readonly Product[]; formsGuide?: FormsGuide;
  reportFormsStep(step?: FormsGuideStep): void; startFormsGuide(guide: FormsGuide): void; handoff(question: string): boolean;
}>({
  active: false,
  switching: false,
  availableProducts: [],
  reportFormsStep: () => {},
  startFormsGuide: () => {},
  handoff: (_question: string) => false,
});
export const useGuide = () => useContext(GuideContext);
