import {facebookMessage,prepareFacebookPost} from './facebook-document';

type SendMessage=(message:Record<string,unknown>)=>Promise<any>;
/** DOM changes are a fast path, not the only opportunity to deliver a read. */
export function startFacebookReader(document:Document,send:SendMessage){
  let config:any,timer:ReturnType<typeof setTimeout>|undefined,last='',lastSent=0,sending=false,dirty=false,disposed=false;
  const observer=new document.defaultView!.MutationObserver(()=>schedule(25));
  const heartbeat=setInterval(()=>schedule(0),1000);
  function stop(){disposed=true;observer.disconnect();clearInterval(heartbeat);clearTimeout(timer);document.defaultView!.removeEventListener('pagehide',stop);}
  function schedule(delay:number){if(disposed)return;if(sending){dirty=true;return;}if(timer!==undefined)return;timer=setTimeout(()=>{timer=undefined;void publish();},delay);}
  async function publish(){
    if(disposed||sending)return;
    sending=true;let retry=false;
    try{
      if(!config){
        config=await send({type:'FACEBOOK_WATCH_CONFIG'});
        if(disposed)return;
        if(!config?.token){if(config?.active===false)stop();else retry=true;return;}
      }
      prepareFacebookPost(document);
      const text=facebookMessage(document),error=text===undefined||!text.trim()?(document.getElementById('login_popup_cta_form')||document.querySelector('form[action*="/login/"]')?'Facebook chưa cho đọc bài trong profile này. Mở cửa sổ theo dõi để đăng nhập, hoặc chọn profile đã đăng nhập Facebook.':'Đang chờ Facebook dựng xong nội dung bài; chưa tải lại trang.'):undefined;
      const fingerprint=error??text!;
      if(fingerprint===last&&Date.now()-lastSent<10000)return;
      const result=await send({type:'FACEBOOK_WATCH_REPORT',...config,text:text??'',error});
      if(disposed)return;
      if(result?.ok===false){config=undefined;retry=true;}
      else {last=fingerprint;lastSent=Date.now();}
    }catch{retry=true;}
    finally{sending=false;if(!disposed){if(retry)schedule(500);else if(dirty)schedule(25);}dirty=false;}
  }
  observer.observe(document,{subtree:true,childList:true,characterData:true,attributes:true,attributeFilter:['href','aria-hidden']});
  document.defaultView!.addEventListener('pagehide',stop,{once:true});
  void publish();
  return stop;
}
