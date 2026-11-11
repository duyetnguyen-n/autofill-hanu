import { formsWalkthroughs } from "./walkthrough-forms";
import { runnerWalkthroughs } from "./walkthrough-runners";
import { systemWalkthroughs } from "./walkthrough-system";
import type { WalkArea, WalkId } from "./walkthrough-types";

export const walkthroughs = [...systemWalkthroughs, ...formsWalkthroughs, ...runnerWalkthroughs];
const byId = new Map(walkthroughs.map(flow => [flow.id, flow]));
export const walkthroughFor = (id?: string) => id ? byId.get(id as WalkId) : undefined;
export const walkPath: Partial<Record<WalkArea, string>> = {
  forms: "/", direct: "/google-direct", hcmue: "/hcmue", chinesetest: "/chinesetest", admin: "/admin", knowledge: "/knowledge", account: "/account",
};
export const legacyWalkthroughs = [
  { id: "CH-02", area: "account", title: "Kiểm tra quyền, hạn dùng và quyền Live", question: "Kiểm tra quyền sử dụng của tôi" },
  { id: "GF-02", area: "forms", title: "Liên kết thêm Chrome profile", question: "Cách liên kết Chrome profile?" },
  { id: "GF-04", area: "forms", title: "Chuẩn bị hồ sơ và ảnh", question: "Cách chuẩn bị hồ sơ?" },
  { id: "QT-01", area: "admin", title: "Vào Quản trị", question: "Làm sao vào trang Quản trị?" },
] as const;
export const walkAreaLabels: Record<WalkArea, string> = {
  common: "Dùng chung", forms: "Google Forms", direct: "Google Forms Direct", hcmue: "HSK HCMUE",
  chinesetest: "ChineseTest", admin: "Quản trị", knowledge: "Kho tri thức", account: "Tài khoản",
};
export function normalizeWalkText(value: string) {
  return value.toLowerCase().normalize("NFD").replace(/\p{M}/gu, "").replace(/đ/g, "d").replace(/[^a-z0-9]+/g, " ").trim();
}
export function walkArea(path: string): WalkArea | undefined {
  if (path === "/hcmue/knowledge") return "knowledge";
  return (Object.keys(walkPath) as WalkArea[]).find(area => walkPath[area] === path);
}
export function onWalkPage(area: WalkArea, path: string) {
  return area === "common" || area === walkArea(path) || area === "forms" && path === "/google-direct";
}
const aliases = walkthroughs.flatMap(flow => flow.aliases.map(alias => ({ flow, alias: normalizeWalkText(alias) })));
const contextual = new Set(["kiem tra api", "kiem tra ket noi runner", "bat dien tap", "bat lich dang ky that", "cai runner", "lien ket may", "tai ky thi"]);
export function matchWalkthrough(question: string, path: string) {
  const code = question.trim().match(/^(?:hướng dẫn\s+)?([a-z]{2}-\d{2})[?.!]?$/i)?.[1]?.toUpperCase();
  if (code) return walkthroughFor(code);
  const text = normalizeWalkText(question);
  if (/\b(?:khong muon|dung bam|khong can|dang bao loi|loi gi)\b/.test(text)) return;
  if (/\btai sao\b/.test(text) && !/\btai sao nut bi khoa\b/.test(text)) return;
  const area = walkArea(path);
  const explicit = /\bhcmue\b/.test(text) ? "hcmue" : /\bchinese ?test\b/.test(text) ? "chinesetest" : undefined;
  const candidates = aliases.filter(({ flow, alias }) => (!contextual.has(alias) || flow.area === area || flow.area === explicit) &&
    (!explicit || flow.area === explicit || flow.area === "common") && ` ${text} `.includes(` ${alias} `));
  return candidates.sort((left, right) => right.alias.length - left.alias.length ||
    Number(right.flow.area === area) - Number(left.flow.area === area))[0]?.flow;
}
