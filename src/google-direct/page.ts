import '@fontsource-variable/geist';
import '@fontsource-variable/geist-mono';
import './style.css';
import {getProfile} from '../storage';
import {emptyProfile} from '../rules';
import type {Profile} from '../shared';
import {DIRECT_LAB_FORM_ID,DIRECT_LAB_URL, parseDirectSchema, type DirectSchema} from './schema';
import {inspectDirectForm, type DirectInspection} from './inspect';
import {buildDirectPlan, previewDirectRequest} from './plan';
import {DirectExecutor} from './executor';

const root = document.querySelector<HTMLElement>('#directLab')!;
root.innerHTML = `
  <header><a href="sidepanel.html">HSK Autofill</a><span class="tag">NGHIÊN CỨU</span></header>
  <div class="intro"><p class="eyebrow">GOOGLE FORMS DIRECT · LAB</p><h1>Chuẩn bị dữ liệu.<br>Kiểm tra trước khi gửi.</h1>
  <p>Ghép hồ sơ có sẵn, tự chuẩn bị request, tải ảnh và gửi trên form Lab. Luồng Google Forms cũ chạy riêng.</p></div>
  <section aria-labelledby="setupTitle"><h2 id="setupTitle">01 / Chọn nguồn dữ liệu</h2>
    <div class="setup"><label>Tab Google Form<select id="formTab"><option value="">Chọn tab đang mở</option></select></label>
    <label>Dữ liệu lập request<select id="source"><option value="fixture">Hồ sơ giả để nghiên cứu</option><option value="saved">Hồ sơ đã lưu trên Chrome này</option></select></label></div>
    <div class="toolbar"><button id="openTest">Mở form test</button><button id="refreshTabs">Làm mới danh sách</button><button id="inspect" class="primary">Đọc form và lập dữ liệu</button></div>
    <p id="message" role="status" aria-live="polite">Mở form trong Chrome đã đăng nhập, rồi chọn tab tương ứng.</p>
  </section>
  <div id="results" hidden>
    <section><h2>02 / Kiểm tra dữ liệu</h2><h3 id="formTitle"></h3><p id="summary"></p>
      <div class="table-scroll"><table><thead><tr><th>Câu hỏi / entry</th><th>Nguồn và giá trị</th><th>Đối chiếu</th></tr></thead><tbody id="answers"></tbody></table></div>
      <h3>Trạng thái chuẩn bị</h3><ul id="blockers"></ul>
    </section>
    <section><h2>03 / Bản xem trước request</h2><p>Phần dữ liệu này chưa bao gồm token phiên, trạng thái upload và thông tin xác thực. Không dùng để khẳng định form đã sẵn sàng gửi.</p>
      <p id="endpoint" class="mono"></p><p id="sessionFields"></p>
      <details><summary>Chẩn đoán cấu trúc trạng thái Google (không gồm token/đáp án)</summary><pre id="stateDiagnostics"></pre></details>
      <label class="reveal"><input id="showValues" type="checkbox"> Hiện giá trị hồ sơ trong payload</label><pre id="payload"></pre>
      <p class="note">Lab không ghi lại hồ sơ, cookie, token hoặc payload vào bộ nhớ lưu trữ. Khi cần đổi đáp án, sửa tại đây; hồ sơ gốc được giữ nguyên.</p>
    </section>
    <section><h2>04 / Tự chạy và gửi form Lab</h2><p>Tool tự chạy bằng dữ liệu đang xem. Hồ sơ giả dùng ảnh fixture 1×1; hồ sơ đã lưu dùng đúng ảnh trong Chrome này. Lệnh này sẽ tạo phản hồi thật trên form test.</p>
      <div class="toolbar"><button id="execute" class="primary">Tự chạy và gửi form test</button><button id="stopExecute" hidden>Dừng</button></div>
      <p id="executionStatus" role="status" aria-live="polite">Chưa bắt đầu.</p>
      <button id="resolveNotReceived" hidden>Đã đối chiếu Google: chưa có phản hồi, cho phép thử lại</button>
    </section>
  </div>`;

const element = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
let schema: DirectSchema | undefined, inspection: DirectInspection | undefined, profile: Profile;
let overrides: Record<string,string> = {};
let busy = false;
let generation = 0;
let execution: AbortController | undefined;
let uncertainRunId: string | undefined;
const executor = new DirectExecutor();
function message(text: string, error = false) {element('message').textContent = text;element('message').className = error ? 'error' : '';}
function fixtureProfile(): Profile {
  const result = emptyProfile();
  result.values = {...result.values, fullName:'NGHIEN CUU LAB',identityType:'CCCD',identityNumber:'000000000000',passportNumber:'AB0000000',
    gender:'Nam',birthDate:'2000-01-01',nationality:'Việt Nam',motherTongue:'Tiếng Việt',email:'hanu.direct.lab@gmail.com',phone:'0000000000',
    chineseStudyDuration:'1 năm',paymentMethod:'E-BANKING',bankAccountNumber:'0',bankAccountHolder:'NGHIEN CUU LAB',bankName:'BIDV',firstCommitment:'true',termsCommitment:'true'};
  // A custom field carries a user-supplied test answer; never infer a CAPTCHA.
  result.customFields = [{id:'lab-year',label:'Năm nay là năm bao nhiêu?\n今年是哪一年？',aliases:[],value:'2026'}];
  return result;
}
async function refreshTabs() {
  const select = element<HTMLSelectElement>('formTab'), previous = select.value;
  const tabs = await chrome.tabs.query({url:'https://docs.google.com/forms/*'});
  select.replaceChildren(new Option('Chọn tab đang mở',''));
  for (const tab of tabs) if (tab.id !== undefined && /\/(?:viewform|formResponse)(?:[?#]|$)/.test(tab.url ?? '')) select.add(new Option(tab.title ?? 'Google Form',String(tab.id)));
  if ([...select.options].some(o => o.value === previous)) select.value = previous;
  if(!select.value){const lab=tabs.filter(tab=>tab.id!==undefined&&tab.url?.includes(`/d/e/${DIRECT_LAB_FORM_ID}/`)).at(-1);if(lab)select.value=String(lab.id);}
}
function clearResults() {
  generation++;
  schema = undefined; inspection = undefined; overrides = {};
  element('results').hidden = true; element('answers').replaceChildren(); element('payload').textContent = '';
  element<HTMLInputElement>('showValues').checked = false;
}
function renderPlan() {
  if (!schema || !inspection) return;
  const formId = /\/d\/e\/([^/]+)\//.exec(inspection.url)![1];
  const plan = buildDirectPlan(schema,profile,formId,overrides);
  element('results').hidden = false; element('formTitle').textContent = schema.title;
  element('summary').textContent = `${plan.answers.length} câu trên nhánh đã xác định · ${plan.entries.length} trường dữ liệu · lộ trình trang ${plan.pageHistory.map(n => n+1).join(' → ')}`;
  const tbody = element('answers');
  const focusedId = (document.activeElement as HTMLInputElement)?.dataset.questionId;
  const selectionStart = (document.activeElement as HTMLInputElement)?.selectionStart;
  tbody.replaceChildren();
  for (const answer of plan.answers) {
    const row = document.createElement('tr'), label = document.createElement('td'), valueCell = document.createElement('td'), check = document.createElement('td');
    const title = document.createElement('strong'); title.textContent = answer.label;
    const code = document.createElement('small'); code.className = 'mono'; code.textContent = answer.entryId ? `entry.${answer.entryId}` : 'Loại chưa hỗ trợ'; label.append(title,code);
    const source = document.createElement('small'); source.textContent = answer.source ?? 'Chưa ghép được hồ sơ'; valueCell.append(source);
    const q = schema.sections.flatMap(s => s.questions).find(q => q.id === answer.questionId)!;
    if (q.kind === 'file' || q.kind === 'unsupported') {
      const text = document.createElement('span'); text.textContent = answer.attachmentName ?? (q.kind === 'file' ? 'Chưa có tệp' : 'Chưa hỗ trợ'); valueCell.append(text);
    } else {
      const input = document.createElement('input'); input.type = q.kind === 'text' && /cccd|number|email|phone/i.test(answer.source ?? '') ? 'password' : 'text';
      input.value = Object.hasOwn(overrides,q.id) ? overrides[q.id] : answer.values[0] ?? '';
      input.setAttribute('aria-label',`Đáp án Lab: ${q.label}`); input.dataset.questionId = q.id;
      input.disabled = !!execution;
      input.addEventListener('change',() => {overrides[q.id] = input.value;renderPlan();}); valueCell.append(input);
    }
    check.textContent = answer.issue ?? (answer.values.length ? 'Đã ghép dữ liệu' : 'Không bắt buộc');
    check.className = answer.issue ? 'error' : 'ok'; row.append(label,valueCell,check); tbody.append(row);
  }
  if (focusedId) {
    const input = [...tbody.querySelectorAll<HTMLInputElement>('input')].find(i => i.dataset.questionId === focusedId);
    input?.focus(); if (input && selectionStart != null) input.setSelectionRange(selectionStart,selectionStart);
  }
  const blockers = element('blockers'); blockers.replaceChildren();
  for (const issue of plan.blockers) {const li = document.createElement('li');li.textContent = issue;blockers.append(li);}
  element('endpoint').textContent = `POST ${inspection.action}`;
  element('sessionFields').textContent = `Tên trường phiên quan sát được: ${inspection.sessionFields.join(', ')}. Không lấy giá trị token.`;
  element('stateDiagnostics').textContent=JSON.stringify(inspection.diagnostics??{},null,2);
  const reveal = element<HTMLInputElement>('showValues').checked;
  const safePlan = {...plan,entries:plan.entries.map(([key,value]) => [key,reveal ? value : '[ẩn]'] as [string,string])};
  element('payload').textContent = previewDirectRequest(safePlan);
}
async function inspect() {
  if (busy) return;
  const selected = element<HTMLSelectElement>('formTab').value;
  if (!selected) {message('Chọn một tab Google Form trước.',true);return;}
  clearResults(); busy = true; element<HTMLButtonElement>('inspect').disabled = true; message('Đang đọc metadata và ghép dữ liệu…');
  const version = generation, source = element<HTMLSelectElement>('source').value;
  try {
    const result = await chrome.scripting.executeScript({target:{tabId:Number(selected)},func:inspectDirectForm});
    if (version !== generation) return;
    if (result.length !== 1 || !result[0].result) throw new Error('Không đọc được đúng một trang form.');
    inspection = result[0].result; schema = parseDirectSchema(inspection.script);
    profile = source === 'saved' ? await getProfile() : fixtureProfile();
    if (version !== generation) return;
    renderPlan(); message('Đã lập bản xem trước. Bấm Tự chạy và gửi form test để tool thực hiện toàn bộ lượt.');
  } catch (error) {clearResults();message((error as Error).message,true);}
  finally {busy = false;element<HTMLButtonElement>('inspect').disabled = false;}
}
element('inspect').addEventListener('click',() => void inspect());
element('refreshTabs').addEventListener('click',() => void refreshTabs().catch(e => message(String(e),true)));
element('openTest').addEventListener('click',() => void chrome.tabs.create({url:DIRECT_LAB_URL}).then(() => refreshTabs()).catch(e => message(String(e),true)));
for (const id of ['formTab','source']) element(id).addEventListener('change',clearResults);
element('showValues').addEventListener('change',renderPlan);
element('execute').addEventListener('click',() => void execute());
element('stopExecute').addEventListener('click',() => {execution?.abort();element('executionStatus').textContent='Đã yêu cầu dừng. Nếu request cuối đã phát, vẫn cần đối chiếu kết quả Google.';});
element('resolveNotReceived').addEventListener('click',()=>void (async()=>{
  if(!uncertainRunId||execution)return;
  try{await executor.resolveNotReceived(uncertainRunId);uncertainRunId=undefined;element('resolveNotReceived').hidden=true;element<HTMLButtonElement>('execute').disabled=false;element('executionStatus').textContent='Đã ghi nhận đối chiếu chưa gửi. Có thể bắt đầu một lượt thử mới.';}
  catch(error){element('executionStatus').textContent=(error as Error).message;}
})());
async function execute() {
  if (!schema || !inspection || execution || busy) return;
  const controller = new AbortController(); execution = controller;
  const source = element<HTMLSelectElement>('source').value;
  const selected = Number(element<HTMLSelectElement>('formTab').value);
  for (const input of document.querySelectorAll<HTMLInputElement>('#answers input')) input.disabled=true;
  for (const id of ['source','formTab','inspect','execute','refreshTabs','openTest']) (element(id) as HTMLButtonElement).disabled = true;
  element('stopExecute').hidden=false;
  let uncertain=false;
  try {
    const fixture = source === 'fixture';
    const file = fixture ? {name:'google-direct-lab-fixture.png',type:'image/png',blob:new Blob([Uint8Array.from(atob('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII='),c=>c.charCodeAt(0))],{type:'image/png'})} : undefined;
    const result = await executor.run({tabId:selected,profile:structuredClone(profile),overrides:{...overrides},expectedScript:inspection.script,file,signal:controller.signal,
      onProgress:text=>{element('executionStatus').textContent=text;}});
    uncertain=result.status==='uncertain';
    uncertainRunId=uncertain?result.runId:undefined;
    element('resolveNotReceived').hidden=!uncertain;
    element('executionStatus').textContent=`${result.status==='received'?'Đã gửi thành công':uncertain?'Chưa rõ kết quả':result.status==='stopped'?'Đã dừng':'Chưa gửi thành công'} · ${result.message} · ${result.postCount} request.`;
    element('executionStatus').className=result.status==='received'?'ok':'error';
  } catch(error) {element('executionStatus').textContent=(error as Error).message;element('executionStatus').className='error';}
  finally {
    execution=undefined;element('stopExecute').hidden=true;
    for (const id of ['source','formTab','inspect','execute','refreshTabs','openTest']) (element(id) as HTMLButtonElement).disabled = false;
    for (const input of document.querySelectorAll<HTMLInputElement>('#answers input')) input.disabled=false;
    // A new inspection/run cannot clear an uncertain durable submit lock.
    if(uncertain)element<HTMLButtonElement>('execute').disabled=true;
  }
}
window.addEventListener('pagehide',()=>execution?.abort(),{once:true});
void chrome.storage.local.get(null).then(data=>{
  const pending=Object.entries(data).filter(([key,value])=>key.startsWith(`googleDirectSubmit:${DIRECT_LAB_FORM_ID}:`)&&value?.status==='pending').map(([,value])=>value);
  if(pending.length===1){uncertainRunId=pending[0].runId;element('resolveNotReceived').hidden=false;element<HTMLButtonElement>('execute').disabled=true;element('executionStatus').textContent='Có lượt trước chưa rõ kết quả. Đối chiếu trên trang Câu trả lời của Google trước khi cho phép thử lại.';}
}).catch(error=>message(`Chưa đọc được khóa gửi: ${(error as Error).message}`,true));
void refreshTabs().catch(e => message(`Không đọc được tab Chrome: ${String(e)}`,true));
