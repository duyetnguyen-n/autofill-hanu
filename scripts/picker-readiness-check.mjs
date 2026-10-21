// Research-only comparison. Isolated browser, routed synthetic pages; no Google
// traffic, user profiles, saved photos or production extension modifications.
import {chromium} from '@playwright/test';
import {transform} from 'esbuild';
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import assert from 'node:assert/strict';

const {code}=await transform(await readFile('src/picker-upload.ts','utf8'),{loader:'ts',format:'esm',target:'es2022'});
const {assignPickerFile}=await import('data:text/javascript;base64,'+Buffer.from(code).toString('base64'));
const bytes=await readFile('tests/upload-fixture.png');
const expectedHash=createHash('sha256').update(bytes).digest('hex');
const url='https://docs.google.com/picker?hostId=file-upload&rpcService=fixture&rpctoken=fixture&maxSizeBytesPerItem=1000000';
function html(readyMs,earlyButtonMs){return `<!doctype html><meta charset="utf-8"><button id="browse" disabled>Choose file</button><input id="file" type="file" hidden><div role="status"></div><div id="chip"></div><script>
window.trace={readyAt:null,chosenAt:null,assigned:0,committed:0,orphaned:0,hash:null};
const handle=(input,generation)=>input.onchange=async()=>{
 const f=input.files[0];if(!f)return;trace.assigned++;trace.chosenAt=performance.now();
 const hash=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',await f.arrayBuffer()))).map(x=>x.toString(16).padStart(2,'0')).join('');
 setTimeout(()=>{if(generation!==1||!input.isConnected){trace.orphaned++;return;}trace.committed++;trace.hash=hash;document.querySelector('#chip').textContent=f.name;},300);
};handle(document.querySelector('#file'),0);
if(${Number.isFinite(earlyButtonMs)})setTimeout(()=>{const initial=document.querySelector('#file');const b=document.querySelector('#browse');b.onclick=()=>initial.click();b.disabled=false;},${earlyButtonMs??0});
setTimeout(()=>document.querySelector('[role=status]').textContent='Đã mở bộ chọn Chèn tệp.',150);
setTimeout(()=>{const old=document.querySelector('#file');const fresh=old.cloneNode();old.replaceWith(fresh);handle(fresh,1);
const b=document.querySelector('#browse');b.onclick=()=>fresh.click();b.disabled=false;trace.readyAt=performance.now();},${readyMs});
</script>`;}
const browser=await chromium.launch({channel:'chromium',headless:true});
async function trial(readyMs,mode,earlyButtonMs){
 const context=await browser.newContext();
 try{
  await context.route('**/*',route=>route.request().url().startsWith('https://docs.google.com/picker?')?route.fulfill({contentType:'text/html',body:html(readyMs,earlyButtonMs)}):route.abort());
  const page=await context.newPage();await page.goto(url,{waitUntil:'load'});
  let helperResult;
  if(mode==='fixed-guard'){
   for(let i=0;i<40;i++){
    helperResult=await page.evaluate(({source,payload})=>(new Function('return ('+source+')'))()(payload),{source:assignPickerFile.toString(),payload:{pickerUrl:url,requestId:'research-upload',name:'fixture.png',type:'image/png',dataUrl:'data:image/png;base64,'+bytes.toString('base64')}});
    if(helperResult.state==='assigned'||helperResult.state==='error')break;
    await page.waitForTimeout(250);
   }
  }else{
   const choosing=page.waitForEvent('filechooser',{timeout:10000});
   // Browser auto-waits for the actual upload button to be enabled. The event
   // identifies the specific input requested by the current controller.
   await page.getByRole('button',{name:'Choose file',exact:true}).click({timeout:10000});
   const chooser=await choosing;
   await chooser.setFiles({name:'fixture.png',mimeType:'image/png',buffer:bytes});
  }
  // A terminal outcome must include receiver-side acknowledgement and a hash;
  // handing a File to an input is not a success result.
  await page.waitForFunction(()=>window.trace.committed>0||window.trace.orphaned>0,{},{timeout:10000});
  const trace=await page.evaluate(()=>({...window.trace,confirmedAt:window.trace.committed?performance.now():null}));
  const result={mode,controllerReadyMs:readyMs,earlyButtonMs:earlyButtonMs??null,...trace,helperResult};
  assert.equal(trace.assigned,1,'one selection, no speculative second upload');
  if((mode==='chooser-event'&&!Number.isFinite(earlyButtonMs))||readyMs<5000){assert.equal(trace.committed,1);assert.equal(trace.hash,expectedHash);assert.equal(trace.orphaned,0);}
  else {assert.equal(trace.committed,0);assert.equal(trace.orphaned,1);}
  return result;
 }finally{await context.close();}
}
try{
 const results=await Promise.all([...([600,1800,6500].flatMap(delay=>['fixed-guard','chooser-event'].map(mode=>trial(delay,mode)))),...['fixed-guard','chooser-event'].map(mode=>trial(6500,mode,400))]);
 await mkdir('test-results',{recursive:true});
 const report={at:new Date().toISOString(),scope:'Concept experiment only. Eight isolated contexts, all HTTPS requests fulfilled by synthetic local fixtures. No Google requests or user profiles. The fixture models a controller replacing its file input, an early opened announcement, and a button enabled when that controller is ready. The additional adversarial case enables the button before its final controller: chooser-event also fails there. The event alone is not an upload-controller readiness guarantee. This does not establish when Google enables its button or whether Google RPC is ready at that instant. Playwright chooser supports bytes; extension integration remains unimplemented.',productionModified:false,results};
 await writeFile('test-results/picker-readiness-comparison.json',JSON.stringify(report,null,2)+'\n');
 console.log(JSON.stringify(results.map(({mode,controllerReadyMs,earlyButtonMs,chosenAt,committed,orphaned})=>({mode,controllerReadyMs,earlyButtonMs,assignedMs:Math.round(chosenAt),committed,orphaned})),null,2));
}finally{await browser.close();}
