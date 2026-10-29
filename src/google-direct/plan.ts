import {HSK_RULES} from '../rules';
import {hasExactAlias, mappingKey, normalize, type FieldRule, type Profile} from '../shared';
import type {DirectQuestion, DirectSchema} from './schema';

export interface DirectAnswer {
  questionId: string;
  entryId?: string;
  label: string;
  source?: string;
  values: string[];
  issue?: string;
  attachmentName?: string;
  attachmentId?: string;
}
export interface DirectPlan {
  pageHistory: number[];
  answers: DirectAnswer[];
  entries: [string, string][];
  blockers: string[];
  // This phase does not verify the session/upload protocol or dispatch a POST.
  canSubmit: false;
}
const same = (a: string, b: string) => normalize(a).replace(/\s*\|\s*/g,'|') === normalize(b).replace(/\s*\|\s*/g,'|');

function resolveRule(q: DirectQuestion, profile: Profile, formId: string): FieldRule | undefined {
  const mapped = profile.mappings[mappingKey(formId,q.id)] ?? (q.entryId ? profile.mappings[mappingKey(formId,`entry.${q.entryId}`)] : undefined);
  if (mapped) return HSK_RULES.find(r => r.key === mapped);
  let candidates = HSK_RULES.filter(r => hasExactAlias(q.label,r.aliases));
  if (candidates.length > 1) candidates = candidates.filter(r => Object.values(r.optionAliases ?? {}).flat().some(alias => q.options.some(o => same(o.value,alias))));
  return candidates.length === 1 ? candidates[0] : undefined;
}

function validateText(value: string, validations: unknown[]): string | undefined {
  for (const raw of validations) {
    if (!Array.isArray(raw)) return 'Chưa hỗ trợ cấu trúc kiểm tra dữ liệu này.';
    const [type, operation, args] = raw;
    if (type === 4 && [299,300,301,302].includes(operation) && Array.isArray(args) && typeof args[0] === 'string') {
      // Google uses RE2; incompatible expressions must be checked by Google.
      if (/\(\?[=!<]|\\[1-9]/.test(args[0]) || args[0].length > 2000 || value.length > 10000) return 'Biểu thức kiểm tra cần được đối chiếu với Google.';
      try {
        const regex = new RegExp(operation === 301 || operation === 302 ? `^(?:${args[0]})$` : args[0]);
        const ok = regex.test(value);
        if ([300,302].includes(operation) ? ok : !ok) return 'Giá trị không khớp quy tắc kiểm tra của form.';
      } catch { return 'Không đọc được biểu thức kiểm tra của form.'; }
    } else if (type === 1 && operation === 9) {
      if (!/^[-+]?(?:\d+(?:\.\d*)?|\.\d+)$/.test(value)) return 'Form yêu cầu một số hợp lệ.';
    } else return 'Có quy tắc kiểm tra dữ liệu chưa hỗ trợ.';
  }
}

export function buildDirectPlan(schema: DirectSchema, profile: Profile, formId: string, overrides: Record<string, string> = {}): DirectPlan {
  const plan: DirectPlan = {pageHistory:[], answers:[], entries:[], blockers:[], canSubmit:false};
  const visited = new Set<number>();
  let index = 0;
  while (index < schema.sections.length) {
    const section = schema.sections[index];
    if (visited.has(index)) { plan.blockers.push('Nhánh điều hướng tạo vòng lặp.'); break; }
    visited.add(index); plan.pageHistory.push(index);
    const destinations = new Set<number>();
    let unresolvedBranch = false;
    for (const q of section.questions) {
      const rule = resolveRule(q,profile,formId);
      const customs = profile.customFields.filter(f => hasExactAlias(q.label,[f.label,...f.aliases]));
      const explicit = Object.hasOwn(overrides,q.id);
      const value = explicit ? overrides[q.id] : rule ? profile.values[rule.key] ?? '' : customs.length === 1 ? customs[0].value : '';
      const answer: DirectAnswer = {questionId:q.id, entryId:q.entryId, label:q.label, source:explicit ? 'Nhập riêng cho form' : rule?.label ?? (customs.length === 1 ? customs[0].label : undefined), values:[]};
      plan.answers.push(answer);
      if (!q.entryId || q.kind === 'unsupported') answer.issue = 'Loại câu hỏi chưa hỗ trợ gửi trực tiếp.';
      else if (q.kind === 'file') {
        const ref = rule?.attachmentKey ? profile.attachments[rule.attachmentKey] : undefined;
        answer.attachmentName = ref?.name;
        answer.attachmentId = ref?.id;
        // A local ID/filename is NEVER a Google file ID. Even saved photos need
        // a Google upload handshake tied to this form/account and response.
        if (q.required || ref) answer.issue = ref ? 'Có ảnh đã lưu; chưa có mã upload Google cho phiên/form này.' : 'Thiếu tệp bắt buộc và mã upload Google.';
      } else if (!value.trim()) {
        if (q.required) answer.issue = 'Thiếu đáp án bắt buộc.';
      } else if (q.kind === 'text' || q.kind === 'textarea') {
        answer.values = [value]; answer.issue = validateText(value,q.validations);
      } else {
        const aliases = rule?.optionAliases?.[value] ?? [];
        // Several bilingual alternatives can represent the same saved value
        // (e.g. either language of a commitment). Prefer an exact value, then
        // the rule's declared alias order; still reject duplicate options.
        const matches = [value,...aliases].map(v => q.options.filter(o => !o.other && same(v,o.value))).find(options => options.length) ?? [];
        if (matches.length !== 1) answer.issue = matches.length ? 'Có nhiều lựa chọn khớp; cần chọn rõ đáp án.' : 'Không khớp lựa chọn. Mục Khác/nhiều checkbox chưa hỗ trợ.';
        else {
          answer.values = [matches[0].value];
          if (matches[0].goTo !== undefined) destinations.add(matches[0].goTo);
          if (q.validations.length) answer.issue = 'Quy tắc kiểm tra lựa chọn chưa được hỗ trợ.';
        }
      }
      if (answer.issue) plan.blockers.push(`${q.label}: ${answer.issue}`);
      if (q.options.some(o => o.goTo !== undefined) && (!answer.values.length || answer.issue)) unresolvedBranch = true;
      if (!answer.issue) for (const value of answer.values) plan.entries.push([`entry.${q.entryId}`, value]);
    }
    if (unresolvedBranch) {plan.blockers.push('Chưa xác định nhánh tiếp theo; chưa lập dữ liệu các trang phía sau.');break;}
    if (destinations.size > 1) {plan.blockers.push('Có nhiều nhánh khác nhau trên cùng trang.');break;}
    const destination = [...destinations][0] ?? section.goTo;
    // -2 is Google's explicit "continue to next section" marker, observed
    // against native Next on the independent registration form (2026-10-29).
    if (destination === undefined || destination === -2) index++;
    else {
      if (destination < 0) {plan.blockers.push('Chưa kiểm chứng mã điều hướng đặc biệt của Google.');break;}
      const next = schema.sections.findIndex(s => s.id === destination);
      if (next < 0) {plan.blockers.push('Nhánh trỏ đến một trang không tồn tại.');break;}
      index = next;
    }
  }
  if (schema.emailCollection !== 'none') plan.blockers.push('Cần kiểm chứng cơ chế ghi email và ràng buộc tài khoản Google của phiên gửi.');
  return plan;
}

export function previewDirectRequest(plan: DirectPlan): string {
  const body = new URLSearchParams(plan.entries);
  body.set('pageHistory',plan.pageHistory.join(','));
  return body.toString();
}
