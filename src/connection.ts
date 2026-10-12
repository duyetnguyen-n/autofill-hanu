import './sidepanel.css';
async function refresh(){const s=await chrome.runtime.sendMessage({type:'NATIVE_STATUS'});document.querySelector('#session')!.textContent=`Mã phiên: ${s.sessionId}`;document.querySelector('#extension')!.textContent=s.extensionId;document.querySelector('#status')!.textContent=s.connected?'Đã kết nối bộ điều phối.':'App đang mất kết nối.';}
void refresh();setInterval(()=>void refresh(),3000);
