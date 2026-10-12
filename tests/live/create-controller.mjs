import { readFile, writeFile } from 'node:fs/promises';
const dataUrl = `data:image/png;base64,${(await readFile('tests/upload-fixture.png')).toString('base64')}`;
await writeFile('dist/test-controller.html', `<!doctype html><html lang="vi"><meta charset="utf-8"><title>Kiểm thử HSK</title><body><h1>Kiểm thử HSK bằng hồ sơ giả</h1><p>Chỉ dùng Test, không gửi form. Sao lưu hồ sơ gốc trong extension trước khi thay bằng dữ liệu giả.</p><button id="fake">Sao lưu và dùng hồ sơ giả</button><button id="restore">Khôi phục hồ sơ gốc</button><button id="inspect">Đọc dropdown trên form</button><button id="scan">Đọc câu hỏi và trạng thái</button><button id="report">Báo cáo lượt chạy</button><pre id="status"></pre><textarea id="output" rows="24" cols="120"></textarea><script src="test-controller.js"></script></body></html>`);
await writeFile('dist/test-controller.js', `
const backupKey='live-test-profile-backup';
const canonical=value=>Array.isArray(value)?value.map(canonical):value && typeof value==='object'?Object.fromEntries(Object.keys(value).sort().map(key=>[key,canonical(value[key])])):value;
const send=message=>chrome.runtime.sendMessage(message);
const status=document.querySelector('#status');
const output=document.querySelector('#output');
const formTab=async()=> (await chrome.tabs.query({})).find(t=>t.url?.startsWith('https://docs.google.com/forms/d/e/1FAIpQLSdwGr_cZjiXs_AapAIHmP1cdHp5q4_tLWI3fNytLWHtUJW5JQ/'));
document.querySelector('#fake').onclick=async()=>{
 const original=await send({type:'GET_PROFILE'});
 const saved=await chrome.storage.local.get(backupKey);
 if(!saved[backupKey]) await chrome.storage.local.set({[backupKey]:original});
 const profile={...original,values:{recordGoogleEmail:'true',fullName:'NGUYEN TEST AUTOFILL',chineseName:'',identityType:'CCCD',identityNumber:'000000000000',passportNumber:'A0000000',gender:'Nam',birthDate:'2000-01-02',nationality:'Việt Nam',motherTongue:'Tiếng Việt',email:'hanu.test@gmail.com',phone:'0900000000',chineseStudyDuration:'1 năm',paymentMethod:'CHUYỂN KHOẢN TẠI NGÂN HÀNG',bankAccountNumber:'0000000000',bankAccountHolder:'NGUYEN TEST AUTOFILL',bankName:'MB Bank',firstCommitment:'true',termsCommitment:'true'},customFields:[],attachments:{},mappings:{}};
 await send({type:'SAVE_PROFILE',profile});
 await send({type:'SAVE_ATTACHMENT',attachmentKey:'identityDocument',name:'upload-fixture.png',mimeType:'image/png',dataUrl:${JSON.stringify(dataUrl)}});
 status.textContent='Đã sao lưu hồ sơ gốc và lưu hồ sơ giả cùng ảnh thử. Mở lại Side Panel để dùng.';
};
document.querySelector('#restore').onclick=async()=>{
 try{
 const saved=(await chrome.storage.local.get(backupKey))[backupKey];
 if(!saved){status.textContent='Không có bản sao lưu';return;}
 await send({type:'SAVE_PROFILE',profile:saved});
 const restored=await send({type:'GET_PROFILE'});
 if(JSON.stringify(canonical(restored))!==JSON.stringify(canonical(saved)))throw new Error('Hồ sơ khôi phục không khớp bản sao lưu');
 const reference=saved.attachments.identityDocument;
 if(reference && !(await send({type:'GET_ATTACHMENT',attachmentId:reference.id})).dataUrl)throw new Error('Không đọc được ảnh gốc');
 status.textContent='Đã đối chiếu hồ sơ khôi phục khớp bản sao và đọc được ảnh gốc. Bản sao lưu được giữ cục bộ.';
 }catch(error){status.textContent='Lỗi khôi phục: '+error.message;}
};
document.querySelector('#inspect').onclick=async()=>{
 const tab=await formTab();
 const result=await chrome.scripting.executeScript({target:{tabId:tab.id},func:()=>Array.from(document.querySelectorAll('[role="listbox"]')).map(e=>e.outerHTML)});
 output.value=JSON.stringify(result.map(r=>r.result),null,2);
 status.textContent='DOM dropdown hiện tại';
};
document.querySelector('#report').onclick=async()=>{
 const tab=await formTab(); const {run}=await send({type:'GET_PANEL_STATE',tabId:tab.id});
 const start=run.logs.findLastIndex(log=>log.message==='Bắt đầu ở chế độ Test.');
 output.value=JSON.stringify({...run,filled:run.filled.length,skipped:run.skipped.length,logs:run.logs.slice(start).map(log=>({...log,message:log.message.replace(/[^\\s]+@[^\\s]+/g,'[account]')}))},null,2);
 status.textContent='Báo cáo lượt Test hiện tại';
};
document.querySelector('#scan').onclick=async()=>{
 const tab=await formTab();
 output.value=JSON.stringify(await send({type:'SCAN_FORM',tabId:tab.id}),null,2);
 status.textContent='Câu hỏi và trạng thái hiện tại';
};
`);
