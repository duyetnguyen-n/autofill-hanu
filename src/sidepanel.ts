import "./sidepanel.css";
import '@fontsource-variable/geist';
import {cloudOrigin} from './coordinator-transport';
import {FACEBOOK_ORIGINS} from './facebook-watch';
import {runStatusLabel} from './run-presentation';
import { HSK_RULES } from "./rules";
import { AttachmentRef, CustomField, FieldRule, FormQuestionSummary, Profile, RunMode, RunState } from "./shared";

const $ = <T extends Element>(_: { new (): T }, selector: string): T => {
  const element = document.querySelector<T>(selector);
  if (!element) throw new Error(`Missing element: ${selector}`);
  return element;
};

let profile: Profile;
let savedProfileJson='';
const pendingButtons=new Set<string>();
let run: RunState | undefined;
let tabId: number | undefined;
let audit: FormQuestionSummary[] = [];
const targetTabParam = new URLSearchParams(location.search).get("tabId");
const targetTabId = targetTabParam && /^\d+$/.test(targetTabParam) ? Number(targetTabParam) : undefined;
let permissionPending=false;
async function refreshFacebookPermission(){
  if(!chrome.permissions?.contains)return;
  try{
    const granted=await chrome.permissions.contains({origins:FACEBOOK_ORIGINS});
    if(permissionPending)return;
    const button=document.getElementById('enableFacebook') as HTMLButtonElement;
    document.getElementById('facebookPermission')!.dataset.granted=String(granted);
    button.disabled=granted;button.textContent=granted?'✓  Đã cho phép theo dõi':'Cho phép theo dõi Facebook';
    document.getElementById('facebookPermissionStatus')!.textContent=granted?'Profile này có thể đọc bài khi bạn bật lịch.':'Chỉ cần cấp quyền trên một profile đọc bài.';
  }catch{document.getElementById('facebookPermissionStatus')!.textContent='Chưa kiểm tra được quyền Facebook. Bấm nút để thử lại.';}
}
document.getElementById('enableFacebook')?.addEventListener('click',()=>{
  // Request directly in the click gesture. Never widen permissions on load.
  const request=chrome.permissions.request({origins:FACEBOOK_ORIGINS});
  const button=document.getElementById('enableFacebook') as HTMLButtonElement;
  permissionPending=true;button.disabled=true;button.textContent='Đang chờ cấp quyền…';
  void request.then(async granted=>{
    if(!granted)throw new Error('Chưa cấp quyền; vẫn có thể dán link HSK trên màn quản lý.');
    const result=await chrome.runtime.sendMessage({type:'FACEBOOK_ENABLE'});if(result?.ok===false)throw new Error(result.error);
    permissionPending=false;await refreshFacebookPermission();
  }).catch(e=>{document.getElementById('facebookPermissionStatus')!.textContent=(e as Error).message;}).finally(()=>{permissionPending=false;if(document.getElementById('facebookPermission')!.dataset.granted!=='true'){button.disabled=false;button.textContent='Cho phép theo dõi Facebook';}});
});
void refreshFacebookPermission();
chrome.permissions?.onAdded?.addListener(refreshFacebookPermission);
chrome.permissions?.onRemoved?.addListener(refreshFacebookPermission);
window.addEventListener('pagehide',()=>{chrome.permissions?.onAdded?.removeListener(refreshFacebookPermission);chrome.permissions?.onRemoved?.removeListener(refreshFacebookPermission);},{once:true});

const stateLabels: Record<string, string> = {
  idle: "Sẵn sàng",
  running: "Đang chạy",
  paused: "Đã tạm dừng",
  waiting_manual: "Cần bạn xử lý",
  ready_to_submit: "Sẵn sàng gửi",
  submitting: "Đang xác nhận",
  completed: "Đã hoàn thành",
  failed: "Có lỗi"
  ,submit_uncertain:'Chưa xác định đã gửi'
};

function makeField(label: string, key: string, value: string, type = "text"): HTMLElement {
  const wrapper = document.createElement("label");
  wrapper.className = "field";
  wrapper.htmlFor = `field-${key}`;
  const title = document.createElement("span");
  title.textContent = label;
  const input = type === "textarea"
    ? document.createElement("textarea")
    : document.createElement("input");
  input.id = `field-${key}`;
  input.dataset.profileKey = key;
  input.value = value;
  if (input instanceof HTMLInputElement) input.type = type;
  if (key.includes("Number") || key === "phone") input.autocomplete = "off";
  wrapper.append(title, input);
  return wrapper;
}

function booleanField(ruleKey: string, label: string, value: string): HTMLElement {
  const wrapper = document.createElement("label");
  wrapper.className = "field";
  const title = document.createElement("span");
  title.textContent = label;
  const select = document.createElement("select");
  select.dataset.profileKey = ruleKey;
  select.innerHTML = '<option value="">Chưa chọn</option><option value="true">Có / đồng ý</option><option value="false">Không</option>';
  if(ruleKey==='recordGoogleEmail')select.options[0].text='Tự ghi khi form bắt buộc';
  select.value = value;
  wrapper.append(title, select);
  return wrapper;
}

function optionField(rule: FieldRule, value: string): HTMLElement {
  const wrapper = document.createElement("label");
  wrapper.className = "field";
  const title = document.createElement("span");
  title.textContent = rule.label;
  const select = document.createElement("select");
  select.dataset.profileKey = rule.key;
  select.append(new Option("Chưa chọn", ""));
  Object.keys(rule.optionAliases ?? {}).forEach((option) => select.append(new Option(option, option)));
  select.value = value;
  wrapper.append(title, select);
  return wrapper;
}

function renderProfile(): void {
  const container = $(HTMLDivElement, "#profileFields");
  container.replaceChildren();
  for (const rule of HSK_RULES.filter((rule) => rule.kind !== "file")) {
    const value = profile.values[rule.key] ?? "";
    const kinds = Array.isArray(rule.kind) ? rule.kind : [rule.kind];
    const field = kinds.includes("checkbox") && !kinds.includes("radio")
      ? booleanField(rule.key, rule.label, value)
      : rule.optionAliases
        ? optionField(rule, value)
      : makeField(rule.label, rule.key, value, rule.key === "birthDate" ? "date" : "text");
    container.append(field);
  }
}

function customFieldRow(field: CustomField): HTMLElement {
  const row = document.createElement("div");
  row.className = "custom-row";
  row.dataset.customId = field.id;
  const label = document.createElement("input");
  label.placeholder = "Tên trường";
  label.value = field.label;
  label.dataset.customProperty = "label";
  const aliases = document.createElement("input");
  aliases.placeholder = "Alias, cách nhau bằng dấu phẩy";
  aliases.value = field.aliases.join(", ");
  aliases.dataset.customProperty = "aliases";
  const value = document.createElement("input");
  value.placeholder = "Giá trị";
  value.value = field.value;
  value.dataset.customProperty = "value";
  const remove = document.createElement("button");
  remove.className = "remove-custom";
  remove.type = "button";
  remove.textContent = "×";
  remove.title = "Xóa trường";
  remove.addEventListener("click", () => {
    profile.customFields = profile.customFields.filter((item) => item.id !== field.id);
    renderCustomFields();
  });
  row.append(label, aliases, value, remove);
  return row;
}

function renderCustomFields(): void {
  const container = $(HTMLDivElement, "#customFields");
  container.replaceChildren(...profile.customFields.map(customFieldRow));
}

function renderAttachment(): void {
  const reference = profile.attachments.identityDocument;
  $(HTMLParagraphElement, "#identityFileStatus").textContent = reference
    ? `${reference.name} — ${(reference.size / 1024).toFixed(1)} KB — đã lưu cục bộ`
    : "Chưa chọn tệp.";
}

function renderAudit(): void {
  const list = $(HTMLOListElement, "#formAudit");
  if (audit.length === 0) {
    list.replaceChildren();
    return;
  }
  list.replaceChildren(...audit.map((question) => {
    const item = document.createElement("li");
    const title = document.createElement("strong");
    title.textContent = question.label;
    const detail = document.createElement("span");
    const parts = [question.required ? "bắt buộc" : "tùy chọn", question.kind, question.filled ? "đã có dữ liệu" : "trống"];
    if (question.dateFormat) parts.push(`ngày: ${question.dateFormat}`);
    detail.textContent = parts.join(" · ");
    item.append(title, detail);
    if (question.options.length > 0) {
      const options = document.createElement("small");
      options.textContent = `Lựa chọn: ${question.options.slice(0, 10).join(" | ")}${question.options.length > 10 ? "…" : ""}`;
      item.append(options);
    }
    return item;
  }));
}

function renderRun(): void {
  const status = run?.status ?? "idle";
  const badge = $(HTMLSpanElement, "#stateBadge");
  badge.textContent = run&&(run.blockingIssue?.reason||run.recovery||run.recoveryRequired||run.activity)?runStatusLabel(run):stateLabels[status];
  const restart=$(HTMLButtonElement,'#restartRun');restart.hidden=!run?.runId;restart.disabled=!!run?.submitAttempted||pendingButtons.has('restartRun');
  const start=$(HTMLButtonElement,'#startRun');start.disabled=pendingButtons.has('startRun')||!!run&&['running','paused','waiting_manual','submitting'].includes(run.status);
  start.title=start.disabled?'Lượt hiện tại còn giữ profile. Dùng Tiếp tục hoặc Chạy lại.':'';
  $(HTMLButtonElement,'#resumeRun').disabled=!run||!!run.submitAttempted||pendingButtons.has('resumeRun');
  badge.className = `badge ${status}`;

  const list = $(HTMLOListElement, "#runLog");
  list.replaceChildren(...(run?.logs ?? []).slice().reverse().map((entry) => {
    const item = document.createElement("li");
    item.className = entry.level;
    item.textContent = `${new Date(entry.at).toLocaleTimeString("vi-VN", { hour: "2-digit", minute: "2-digit", second: "2-digit" })} — ${entry.message}`;
    return item;
  }));

  const card = $(HTMLElement, "#blockingCard");
  const issue = run?.blockingIssue;
  card.classList.toggle("hidden", !issue);
  if (!issue) return;
  $(HTMLParagraphElement, "#blockingMessage").textContent = issue.message;
  const mappingControls = $(HTMLElement, "#mappingControls");
  const canMap = issue.reason === "unknown_required" && Boolean(issue.questionId);
  mappingControls.classList.toggle("hidden", !canMap);
  if (canMap) {
    const select = $(HTMLSelectElement, "#mappingRule");
    select.replaceChildren(...HSK_RULES.map((rule) => {
      const option = document.createElement("option");
      option.value = rule.key;
      option.textContent = rule.label;
      if (issue.candidates?.includes(rule.key)) option.textContent += " (gợi ý)";
      return option;
    }));
  }
}

function readProfileFromForm(): Profile {
  const values = { ...profile.values };
  document.querySelectorAll<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>("[data-profile-key]").forEach((input) => {
    const key = input.dataset.profileKey;
    if (key) values[key] = input.value.trim();
  });
  const customFields = Array.from(document.querySelectorAll<HTMLElement>(".custom-row")).map((row) => {
    const existing = profile.customFields.find((field) => field.id === row.dataset.customId);
    const get = (property: string) => row.querySelector<HTMLInputElement>(`[data-custom-property="${property}"]`)?.value.trim() ?? "";
    return {
      id: existing?.id ?? crypto.randomUUID(),
      label: get("label"),
      aliases: get("aliases").split(",").map((alias) => alias.trim()).filter(Boolean),
      value: get("value")
    };
  });
  return { ...profile, values, customFields };
}

async function send<T>(message: unknown): Promise<T> {
  const response = await chrome.runtime.sendMessage(message);
  if (response?.ok === false) throw new Error(response.error);
  return response as T;
}

async function saveProfile(): Promise<void> {
  const next=readProfileFromForm();
  if(JSON.stringify(next)===savedProfileJson)return;
  profile=next;
  await send({ type: "SAVE_PROFILE", profile });
  savedProfileJson=JSON.stringify(profile);
}

async function refresh(): Promise<void> {
  const state = await send<{ profile: Profile; run?: RunState; tabId?: number }>({ type: "GET_PANEL_STATE", tabId: targetTabId });
  profile = state.profile;
  savedProfileJson=JSON.stringify(profile);
  run = state.run;
  tabId = state.tabId;
  $(HTMLSelectElement, "#runMode").value = run?.mode ?? "test";
  renderProfile();
  renderCustomFields();
  renderAttachment();
  renderAudit();
  renderRun();
}

function renderModeHelp(): void {
  const mode = $(HTMLSelectElement, "#runMode").value as RunMode;
  $(HTMLParagraphElement, "#modeHelp").textContent = mode === "test"
    ? "Chế độ Test luôn dừng trước nút Gửi. Google Forms có thể lưu bản nháp khi bạn đăng nhập."
    : "Live sẽ tự bấm Gửi đúng một lần khi không còn trường bắt buộc hoặc xác thực chưa xử lý.";
}

function updateRun(next: RunState | undefined): void {
  if(next?.managed&&run?.managed){
    if(next.runId===run.runId&&((next.eventSeq??0)<(run.eventSeq??0)||next.tabId<0&&run.tabId>=0))return;
    if(next.runId!==run.runId&&Date.parse(next.startedAt??'')<Date.parse(run.startedAt??''))return;
  }
  run=next;
  if(next&&next.tabId>=0)tabId=next.tabId;
  renderRun();
}

// Chrome can suspend the panel while switching to the new tab created by
// Restart. Reconcile missed broadcasts without replacing unsaved profile edits.
let runRefresh:Promise<void>|undefined;
function refreshRunOnly():Promise<void>{
  if(runRefresh)return runRefresh;
  const pending=send<{run?:RunState}>({type:'GET_PANEL_STATE',tabId:targetTabId}).then(state=>{
    if(state.run)updateRun(state.run);
  });
  runRefresh=pending;void pending.finally(()=>{if(runRefresh===pending)runRefresh=undefined;}).catch(()=>{});
  return pending;
}
const reconcileVisibleRun=()=>{if(document.visibilityState!=='hidden')void refreshRunOnly().catch(()=>{});};
window.addEventListener('focus',reconcileVisibleRun);
document.addEventListener('visibilitychange',reconcileVisibleRun);

$(HTMLButtonElement, "#saveProfile").addEventListener("click", () => void saveProfile());
$(HTMLSelectElement, "#runMode").addEventListener("change", renderModeHelp);
$(HTMLButtonElement, "#scanForm").addEventListener("click", async () => {
  if (tabId === undefined) throw new Error("Không tìm thấy tab đang mở.");
  const result = await send<{ questions: FormQuestionSummary[] }>({ type: "SCAN_FORM", tabId });
  audit = result.questions;
  renderAudit();
});
$(HTMLButtonElement, "#addCustomField").addEventListener("click", () => {
  profile.customFields.push({ id: crypto.randomUUID(), label: "", value: "", aliases: [] });
  renderCustomFields();
});
let panelActionEpoch=0;
function panelControl(id:string,work:()=>Promise<RunState|undefined>){
  const button=$(HTMLButtonElement,`#${id}`);
  button.addEventListener('click',()=>{
    const epoch=++panelActionEpoch,label=button.textContent;
    pendingButtons.add(id);
    button.disabled=true;button.textContent='Đang chờ xác nhận…';
    $(HTMLElement,'#actionStatus').textContent=`Đã gửi lệnh ${label}. Đang chờ bộ điều phối xác nhận.`;
    void work().then(next=>{updateRun(next);if(epoch===panelActionEpoch)$(HTMLElement,'#actionStatus').textContent=`Đã nhận phản hồi ${label}.`;}).catch(error=>{
      if(epoch!==panelActionEpoch)return;
      $(HTMLElement,'#actionStatus').textContent=(error as Error).message;
      const item=document.createElement('li');item.className='error';item.textContent=`${label}: ${(error as Error).message}`;$(HTMLOListElement,'#runLog').prepend(item);
    }).finally(()=>{pendingButtons.delete(id);button.textContent=label;button.disabled=false;renderRun();});
  });
}
panelControl('startRun',async()=>{await saveProfile();if(tabId===undefined)throw new Error('Không tìm thấy tab form.');return send<RunState>({type:'START_RUN',tabId,mode:$(HTMLSelectElement,'#runMode').value as RunMode});});
panelControl('restartRun',async()=>{await saveProfile();if(tabId===undefined||!run?.runId)throw new Error('Chưa có lượt để chạy lại.');return send<RunState>({type:'RESTART_RUN',tabId,runId:run.runId,operationId:crypto.randomUUID()});});
panelControl('pauseRun',async()=>tabId===undefined?undefined:send<RunState>({type:'PAUSE_RUN',tabId}));
panelControl('resumeRun',async()=>tabId===undefined?undefined:send<RunState>({type:'RESUME_RUN',tabId}));
panelControl('stopRun',async()=>tabId===undefined?undefined:send<RunState>({type:'STOP_RUN',tabId}));
$(HTMLButtonElement, "#saveMapping").addEventListener("click", async () => {
  const issue = run?.blockingIssue;
  if (tabId === undefined || !issue?.questionId) return;
  const result = await send<{ profile: Profile }>({ type: "SAVE_MAPPING", tabId, questionId: issue.questionId, ruleKey: $(HTMLSelectElement, "#mappingRule").value });
  profile = result.profile;
  savedProfileJson=JSON.stringify(profile);
  await send({ type: "RESUME_RUN", tabId });
});
$(HTMLInputElement, "#identityFile").addEventListener("change", async (event) => {
  const file = (event.currentTarget as HTMLInputElement).files?.[0];
  if (!file) return;
  const dataUrl = await new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });
  const result = await send<{ profile: Profile }>({ type: "SAVE_ATTACHMENT", attachmentKey: "identityDocument", name: file.name, mimeType: file.type, dataUrl });
  savedProfileJson=JSON.stringify(result.profile);
  profile = { ...readProfileFromForm(), attachments: { ...profile.attachments, identityDocument: result.profile.attachments.identityDocument } };
  renderAttachment();
});
$(HTMLButtonElement, "#clearData").addEventListener("click", async () => {
  if (!window.confirm("Xóa toàn bộ hồ sơ, tệp và trạng thái chạy đã lưu trên máy này?")) return;
  await send({ type: "CLEAR_ALL_DATA" });
  await refresh();
});

chrome.runtime.onMessage.addListener((message: { type?: string; run?: RunState }) => {
  if (message.type === "RUN_STATE_UPDATED" && message.run && (message.run.tabId === tabId || cloudOrigin()&&message.run.managed)) {
    updateRun(message.run);
  }
});

window.addEventListener("unhandledrejection", (event) => {
  const item = document.createElement("li");
  item.className = "error";
  item.textContent = `Lỗi: ${event.reason instanceof Error ? event.reason.message : String(event.reason)}`;
  $(HTMLOListElement, "#runLog").prepend(item);
});

void refresh().then(renderModeHelp);
async function refreshNative(){
  const s=await send<{extensionId:string;sessionId:string;connected:boolean;paired:boolean;error:string}>({type:'NATIVE_STATUS'});
  $(HTMLElement,'#extensionId').textContent=s.extensionId;
  $(HTMLButtonElement,'#openCoordinator').disabled=!s.connected&&!cloudOrigin();
  $(HTMLButtonElement,'#unlinkProfile').hidden=!s.paired;
  const details=$(HTMLDetailsElement,'#pairingDetails'),paired=String(!!s.paired);
  if(details.dataset.paired!==paired){details.open=!s.paired;details.dataset.paired=paired;}
  $(HTMLElement,'#pairingSummary').textContent=s.paired?'Quản lý liên kết':'Liên kết profile';
  const badge=$(HTMLElement,'#connectionBadge');badge.dataset.connected=String(s.connected);badge.textContent=s.connected?'Đã kết nối':s.paired?'Đang nối lại':'Chưa liên kết';
  const session=$(HTMLElement,'#sessionInfo');session.hidden=!s.sessionId;session.textContent=s.sessionId?`Mã phiên: ${s.sessionId}`:'';
  const text=$(HTMLElement,'#nativeStatus');
  text.textContent=s.connected?`Profile này đã kết nối ${cloudOrigin()?'website':'app'} quản lý.`:s.error||(s.paired?(cloudOrigin()?'Liên kết được giữ nguyên. Đang kết nối lại website.':'Đã liên kết. Hãy mở app quản lý.'):(cloudOrigin()?'Liên kết một lần để quản lý profile trên website.':'Sao chép ID extension sang app để tạo mã liên kết.'));
  text.className=s.connected?'native-connected':s.error?'native-error':'muted';
}
if(cloudOrigin()){
  $(HTMLElement,'#openCoordinator span').textContent='Mở website quản lý';
  const notice=document.querySelector<HTMLElement>('.notice');if(notice)notice.textContent='Bắt đầu, tạm dừng và tiếp tục tại đây hoặc trên website. Mọi thao tác dùng cùng quyền của tài khoản đã liên kết.';
  const idRow=document.querySelector<HTMLElement>('.extension-id-row');if(idRow)idRow.hidden=true;
  $(HTMLElement,'#connectionTitle').textContent='Kết nối website';
}
$(HTMLButtonElement,'#unlinkProfile').addEventListener('click',async()=>{try{await send({type:'NATIVE_UNLINK'});await refreshNative();}catch(e){$(HTMLElement,'#nativeStatus').textContent=(e as Error).message;}});
$(HTMLButtonElement,'#pairProfile').addEventListener('click',async()=>{const button=$(HTMLButtonElement,'#pairProfile');button.disabled=true;button.textContent='Đang liên kết...';try{await send({type:'NATIVE_PAIR',code:$(HTMLInputElement,'#pairCode').value});await refreshNative();}catch(e){const status=$(HTMLElement,'#nativeStatus');status.textContent=(e as Error).message;status.className='native-error';}finally{button.disabled=false;button.textContent='Liên kết profile';}});
void refreshNative();const statusTimer=setInterval(()=>{void refreshNative();reconcileVisibleRun();},3000);
window.addEventListener('pagehide',()=>{clearInterval(statusTimer);window.removeEventListener('focus',reconcileVisibleRun);document.removeEventListener('visibilitychange',reconcileVisibleRun);},{once:true});
$(HTMLButtonElement,'#copyExtensionId').addEventListener('click',async()=>{await navigator.clipboard.writeText($(HTMLElement,'#extensionId').textContent??'');$(HTMLButtonElement,'#copyExtensionId').textContent='Đã sao chép';});
$(HTMLButtonElement,'#openCoordinator').addEventListener('click',()=>void send({type:'NATIVE_OPEN_MANAGER'}));
$(HTMLElement, "#buildVersion").textContent = `v${chrome.runtime.getManifest().version}`;
