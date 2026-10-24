import { DONG_A, type Plan, type Run, type Target, type Personal, type Row } from "../protocol";
import type { Profile } from "../../../src/shared";
export const vnInput = (ms: number) => Number.isFinite(ms) ? new Date(ms + 7 * 3600000).toISOString().slice(0, 19) : "";
export const vnTime = (value: string) => Date.parse(value + "+07:00");
export const newPlan = (): Plan => ({ target: { ...DONG_A, maxFee: undefined, currency: undefined, targetAt: Math.ceil((Date.now() + 600000) / 60000) * 60000 }, test: true });
export function matchesPlan(s: Pick<Run,"target"|"test">, p: Plan) { return s.test === p.test && JSON.stringify(s.target) === JSON.stringify(p.target); }
export const centerLabel = (row: Row) => `${row.kdEName || row.kdName} · ${row.kdId}`;
export function centerChoices(directory: Row[], available: Row[]) {
  const merged = new Map(directory.map(row => [String(row.kdId), row]));
  for (const row of available) merged.set(String(row.kdId), { ...merged.get(String(row.kdId)), ...row });
  return [...merged.values()].sort((a, b) => centerLabel(a).localeCompare(centerLabel(b)));
}
export function selectedCenter(value: string, choices: Row[]) {
  const normal = (v: unknown) => String(v ?? "").normalize("NFKC").trim().replace(/\s+/g, " ").toLowerCase();
  const exactId = choices.find(row => String(row.kdId) === value.trim());
  if (exactId) return exactId;
  const matches = choices.filter(row => [centerLabel(row), row.kdName, row.kdEName].some(name => name && normal(name) === normal(value)));
  return matches.length === 1 ? matches[0] : undefined;
}
export function profileFromWebsite(p: Profile, previous: Personal, countries: any[], languages: any[]): Personal {
  const v = p.values, out = { ...previous };
  const direct: Record<string,keyof Personal> = { fullName: "ksEName", chineseName: "ksName", phone: "phone", address: "address" };
  for (const [key,field] of Object.entries(direct)) if (v[key]?.trim()) (out as any)[field] = v[key].trim();
  if (v.birthDate && /^\d{4}-\d{2}-\d{2}$/.test(v.birthDate)) out.birthday = v.birthDate;
  else if (/^\d{2}\/\d{2}\/\d{4}$/.test(v.birthDate || "")) { const [day,month,year] = v.birthDate.split("/"); out.birthday = `${year}-${month}-${day}`; }
  if (/^(Nam|Male|男)$/i.test(v.gender || "")) out.ksSex = "男";
  if (/^(Nữ|Female|女)$/i.test(v.gender || "")) out.ksSex = "女";
  if (/passport|hộ chiếu|护照/i.test(v.identityType || "")) { out.idType = "护照"; out.idNo = v.passportNumber || v.identityNumber || out.idNo; }
  else if (/cccd|căn cước|身份证/i.test(v.identityType || "")) { out.idType = "身份证"; out.idNo = v.identityNumber || out.idNo; }
  const country = /^(việt nam|vietnam|viet nam)$/i.test(v.nationality || "") ? countries.find(c => String(c.gjid) === "180") : countries.find(c => [c.gjname,c.gjename].some(n => String(n).toLowerCase() === v.nationality?.toLowerCase()));
  if (country) { out.gjId = String(country.gjid); out.ksCountry = country.gjename || country.gjname; }
  const language = /^(tiếng việt|vietnamese|越南语)$/i.test(v.motherTongue || "") ? languages.find(l => l.ename === "Vietnamese") : languages.find(l => [l.ename,l.flname].some(n => String(n).toLowerCase() === v.motherTongue?.toLowerCase()));
  if (language) { out.fid = String(language.idksFirstlanguage); out.firstLanguage = language.ename || language.flname; }
  // Existing Google Forms attachments can be ID scans, not portraits. Never upload them implicitly.
  return out;
}
