// Research-only parser for Google's responder-page metadata. This is not a
// documented Google API; fail closed when its shape changes. Never eval it.
export const DIRECT_LAB_FORM_ID = '1FAIpQLScRrul5GFZkLQD21oVlarFeb1AbomeKoqOJGVsnW3k3XbMtIA';
export const DIRECT_LAB_URL = `https://docs.google.com/forms/d/e/${DIRECT_LAB_FORM_ID}/viewform`;

export type DirectKind = 'text' | 'textarea' | 'radio' | 'dropdown' | 'checkbox' | 'file' | 'unsupported';
export interface DirectOption { value: string; other: boolean; goTo?: number }
export interface DirectQuestion {
  id: string;
  entryId?: string;
  label: string;
  kind: DirectKind;
  required: boolean;
  options: DirectOption[];
  validations: unknown[];
}
export interface DirectSection { id: number; index: number; title: string; goTo?: number; questions: DirectQuestion[] }
export interface DirectSchema { title: string; sections: DirectSection[]; emailCollection: 'none' | 'input' | 'verified' | 'unknown' }

export function parseDirectSchema(script: string): DirectSchema {
  const match = /^\s*(?:var\s+)?FB_PUBLIC_LOAD_DATA_\s*=\s*([\s\S]*?)\s*;?\s*$/.exec(script);
  if (!match) throw new Error('Không tìm thấy metadata Google Forms hợp lệ.');
  let data: any;
  try { data = JSON.parse(match[1]); } catch { throw new Error('Metadata không phải JSON; đã dừng, không thực thi script.'); }
  const form = data?.[1];
  if (!Array.isArray(form) || !Array.isArray(form[1]) || typeof form[8] !== 'string') throw new Error('Cấu trúc metadata Google Forms đã thay đổi.');
  const sections: DirectSection[] = [{id: -1, index: 0, title: 'Trang đầu', questions: []}];
  const ids = new Set<string>(), entries = new Set<string>();
  const kindFor: Record<number, DirectKind> = {0:'text', 1:'textarea', 2:'radio', 3:'dropdown', 4:'checkbox', 13:'file'};
  for (const item of form[1]) {
    if (!Array.isArray(item) || !Number.isSafeInteger(item[0]) || !Number.isSafeInteger(item[3])) throw new Error('Câu hỏi có cấu trúc không hợp lệ.');
    if (ids.has(String(item[0]))) throw new Error('Metadata có mã câu hỏi trùng.');
    ids.add(String(item[0]));
    if (item[3] === 8) {
      // On a page-break item, slot 5 describes the PREVIOUS section's exit.
      if (item[5] != null) {
        if (!Number.isSafeInteger(item[5])) throw new Error('Nhánh chuyển trang không hợp lệ.');
        sections.at(-1)!.goTo = item[5];
      }
      sections.push({id:item[0], index:sections.length, title:item[1] ?? 'Trang tiếp', questions:[]});
      continue;
    }
    if ([6,11,12].includes(item[3])) continue; // headings, images, videos
    const entryList = item[4], entry = entryList?.[0];
    const supported = kindFor[item[3]] && Array.isArray(entryList) && entryList.length === 1;
    const entryId = Number.isSafeInteger(entry?.[0]) ? String(entry[0]) : undefined;
    if (entryId && entries.has(entryId)) throw new Error('Metadata có entry trùng.');
    if (entryId) entries.add(entryId);
    if (typeof item[1] !== 'string') throw new Error('Câu hỏi thiếu tiêu đề.');
    const options: DirectOption[] = [];
    for (const option of entry?.[1] ?? []) {
      if (!Array.isArray(option) || typeof option[0] !== 'string' || option[2] != null && !Number.isSafeInteger(option[2])) throw new Error('Lựa chọn có cấu trúc không hợp lệ.');
      options.push({value:option[0], other:option[4] === 1, goTo:option[2] ?? undefined});
    }
    sections.at(-1)!.questions.push({
      id:String(item[0]), entryId, label:item[1], kind:supported ? kindFor[item[3]] : 'unsupported',
      // Unknown/multi-entry controls are always reported, including optional ones.
      required:entry?.[2] === 1, options, validations:entry?.[4] ?? []
    });
  }
  const email = form[10]?.[6];
  return {title:form[8], sections, emailCollection:email === 2 ? 'verified' : email === 1 ? 'input' : email == null || email === 0 ? 'none' : 'unknown'};
}
