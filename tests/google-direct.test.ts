import {readFileSync} from 'node:fs';
import {describe,expect,it} from 'vitest';
import {emptyProfile} from '../src/rules';
import {DIRECT_LAB_FORM_ID,directSchemaFingerprint,parseDirectSchema} from '../src/google-direct/schema';
import {buildDirectPlan,previewDirectRequest} from '../src/google-direct/plan';

// Sanitized DOM metadata observed on the supplied lab form, 2026-10-27.
// Descriptions, session tokens and account details were removed.
const fixture = JSON.parse(readFileSync(new URL('./fixtures/google-direct-lab.json',import.meta.url),'utf8'));
const registration = JSON.parse(readFileSync(new URL('./fixtures/google-direct-registration.json',import.meta.url),'utf8'));
const parse = (data: unknown = fixture) => parseDirectSchema(`var FB_PUBLIC_LOAD_DATA_ = ${JSON.stringify(data)};`);
it('maps the supplied non-LAB registration schema with independent question and entry IDs',()=>{
  const plan=buildDirectPlan(parse(registration),profile(),'1FAIpQLSdwGr_cZjiXs_AapAIHmP1cdHp5q4_tLWI3fNytLWHtUJW5JQ',{'2042476168':'2026'});
  expect(plan.entries).toContainEqual(['entry.152376345','NGHIEN CUU LAB']);
  expect(plan.entries).toContainEqual(['entry.153625766','000000000000']);
  expect(plan.entries).toContainEqual(['entry.1703858814','2026']);
  expect(plan.answers.some(a=>a.entryId==='1801749512')).toBe(false);
  expect(plan.answers.filter(a=>a.issue&&a.entryId!=='717838050')).toEqual([]);
  expect(plan.pageHistory).toEqual([0,1,2,3,5,6,7,8]);
});
function profile() {
  const p = emptyProfile();
  p.values = {...p.values,fullName:'NGHIEN CUU LAB',identityType:'CCCD',identityNumber:'000000000000',passportNumber:'AB0000000',gender:'Nam',birthDate:'2000-01-01',nationality:'Việt Nam',motherTongue:'Tiếng Việt',email:'hanu.direct.lab@gmail.com',phone:'0000000000',chineseStudyDuration:'1 năm',paymentMethod:'E-BANKING',bankAccountNumber:'0',bankAccountHolder:'NGHIEN CUU LAB',bankName:'BIDV',firstCommitment:'true',termsCommitment:'true'};
  return p;
}
describe('Google Forms Direct isolated research planner',() => {
  it('reads all 20 questions on 9 pages from the lab schema without evaluating code',() => {
    const schema = parse();
    expect(schema.sections).toHaveLength(9);
    expect(schema.sections.flatMap(s => s.questions)).toHaveLength(20);
    expect(schema.emailCollection).toBe('verified');
    expect(schema.sections[3].goTo).toBe(1228677214);
    expect(() => parseDirectSchema('var FB_PUBLIC_LOAD_DATA_ = (globalThis.pwned=true);')).toThrow('JSON');
  });
  it('follows CCCD and skips the passport page, preserving exact Google option text',() => {
    const plan = buildDirectPlan(parse(),profile(),DIRECT_LAB_FORM_ID,{'982814777':'2026'});
    expect(plan.pageHistory).toEqual([0,1,2,3,5,6,7,8]);
    expect(plan.entries).toContainEqual(['entry.78959346','000000000000']);
    expect(plan.entries).not.toContainEqual(['entry.1511537540','AB0000000']);
    expect(plan.entries).toContainEqual(['entry.816025126','CCCD   |   身份证']);
    expect(plan.entries).toContainEqual(['entry.894532920','本人保证未雇用他人代替报名本次考试。']);
    expect(plan.entries).toContainEqual(['entry.212161877','本人已详细阅读并同意接受以上条款限制。']);
    expect(plan.blockers).toHaveLength(2); // Google upload + verified account email
    expect(plan.canSubmit).toBe(false);
  });
  it('follows passport without requiring/sending the skipped CCCD answer',() => {
    const p = profile(); p.values.identityType = 'HỘ CHIẾU'; p.values.identityNumber = '';
    const plan = buildDirectPlan(parse(),p,DIRECT_LAB_FORM_ID,{'982814777':'2026'});
    expect(plan.pageHistory).toEqual([0,1,2,4,5,6,7,8]);
    expect(plan.entries).toContainEqual(['entry.1511537540','AB0000000']);
    expect(plan.answers.some(a => a.entryId === '78959346')).toBe(false);
    expect(plan.blockers).toHaveLength(2);
  });
  it('stops planning at an unresolved branch instead of assuming a default',() => {
    const p = profile();p.values.identityType = 'UNKNOWN';
    const plan = buildDirectPlan(parse(),p,DIRECT_LAB_FORM_ID);
    expect(plan.pageHistory).toEqual([0,1,2]);
    expect(plan.answers.some(a => a.entryId === '78959346' || a.entryId === '1511537540')).toBe(false);
    expect(plan.blockers.some(b => b.includes('Chưa xác định nhánh'))).toBe(true);
  });
  it('never substitutes saved attachment IDs or filenames for a Google upload',() => {
    const p = profile();p.attachments.identityDocument = {id:'private-local-id',name:'lab.png',size:68,type:'image/png',updatedAt:'2026-10-27'};
    const original = structuredClone(p);
    const plan = buildDirectPlan(parse(),p,DIRECT_LAB_FORM_ID);
    expect(plan.answers.find(a => a.entryId === '1365092776')).toMatchObject({attachmentName:'lab.png',values:[],issue:expect.stringContaining('chưa có mã upload Google')});
    expect(previewDirectRequest(plan)).not.toContain('private-local-id');
    expect(p).toEqual(original);
  });
  it('checks text validation, requires an explicit verification answer and respects refusal',() => {
    const p = profile();p.values.identityNumber = 'invalid';p.values.firstCommitment = 'false';
    const plan = buildDirectPlan(parse(),p,DIRECT_LAB_FORM_ID);
    expect(plan.answers.find(a => a.entryId === '78959346')?.issue).toContain('không khớp');
    expect(plan.answers.find(a => a.entryId === '894532920')?.issue).toContain('Không khớp');
    expect(plan.answers.find(a => a.entryId === '1045827748')?.issue).toContain('Thiếu');
    const overridden = buildDirectPlan(parse(),p,DIRECT_LAB_FORM_ID,{'982814777':'2025'});
    expect(overridden.answers.find(a => a.entryId === '1045827748')?.issue).toContain('không khớp');
  });
  it('rejects ambiguous schema IDs, malformed metadata and unsupported controls',() => {
    const duplicate = structuredClone(fixture);duplicate[1][1].push(duplicate[1][1][1]);
    expect(() => parse(duplicate)).toThrow('trùng');
    const changed = structuredClone(fixture);changed[1][1][3][3] = 9;
    const plan = buildDirectPlan(parse(changed),profile(),DIRECT_LAB_FORM_ID);
    expect(plan.answers.find(a => a.entryId === '2075638650')?.issue).toContain('chưa hỗ trợ');
    expect(() => parse({})).toThrow('thay đổi');
  });
  it('blocks cyclic and missing section targets',() => {
    for (const target of [1483960807,999]) {
      const schema = parse();schema.sections[3].goTo = target;
      const plan = buildDirectPlan(schema,profile(),DIRECT_LAB_FORM_ID);
      expect(plan.blockers.some(b => /vòng lặp|không tồn tại/.test(b))).toBe(true);
    }
  });
});

it('accepts Google-shuffled choices but rejects changed values, validation and destinations',()=>{
  const original=parse(),shuffled=structuredClone(original);shuffled.sections.forEach(s=>s.questions.forEach(q=>q.options.reverse()));
  expect(directSchemaFingerprint(shuffled)).toBe(directSchemaFingerprint(original));
  for(const change of [(s:any)=>s.sections[1].questions[0].options[0].value='OTHER ANSWER',(s:any)=>s.sections[2].questions[2].options[0].goTo=123,(s:any)=>s.sections[8].questions[0].validations=[]]){
    const changed=structuredClone(original);change(changed);expect(directSchemaFingerprint(changed)).not.toBe(directSchemaFingerprint(original));
  }
});
