import {facebookMessage} from './facebook-document';

void (async()=>{
  const config=await chrome.runtime.sendMessage({type:'FACEBOOK_WATCH_CONFIG'}).catch(()=>undefined);
  if(!config?.token)return;
  let timer:ReturnType<typeof setTimeout>|undefined,last='',sending=false,dirty=false;
  async function publish(){
    clearTimeout(timer);timer=undefined;if(sending){dirty=true;return;}
    const text=facebookMessage(document),error=text===undefined?'Chưa đọc được riêng nội dung bài Facebook; đang thử lại.':undefined;
    const fingerprint=error??text!;if(fingerprint===last)return;
    sending=true;
    try{const result=await chrome.runtime.sendMessage({type:'FACEBOOK_WATCH_REPORT',...config,text:text??'',error});if(result?.ok!==false)last=fingerprint;}
    catch{}finally{sending=false;if(dirty){dirty=false;timer=setTimeout(()=>void publish(),25);}}
  }
  const observer=new MutationObserver(()=>{if(!timer)timer=setTimeout(()=>void publish(),25);});
  observer.observe(document,{subtree:true,childList:true,characterData:true,attributes:true,attributeFilter:['href']});
  void publish();window.addEventListener('pagehide',()=>{observer.disconnect();clearTimeout(timer);},{once:true});
})();
