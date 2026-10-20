import {facebookPostKey} from './registration-schedule';
export const FACEBOOK_ORIGINS=['https://www.facebook.com/*'];
const SCRIPT_ID='hanu-facebook-message';
interface Watch {scheduleId:string;token:string;postUrl:string;watchAt:string;expiresAt:string;tabId:number;leaseUntil:number}
export async function enableFacebookWatch(){
  if(!await chrome.permissions.contains({origins:FACEBOOK_ORIGINS}))throw new Error('Mở extension ở một profile → Cho phép theo dõi Facebook. Các profile khác không cần quyền này.');
  const scripts=await chrome.scripting.getRegisteredContentScripts({ids:[SCRIPT_ID]});
  if(!scripts.length)await chrome.scripting.registerContentScripts([{id:SCRIPT_ID,matches:FACEBOOK_ORIGINS,js:['facebook-content.js'],runAt:'document_start',persistAcrossSessions:true}]);
}
export class FacebookWatcher {
  private watch?:Watch;private timer?:ReturnType<typeof setInterval>;private nextReload=0;private loadingSince=0;private busy=false;
  private generation=0;private revoked=new Set<string>();
  constructor(private connected:()=>boolean,private report:(payload:Record<string,unknown>)=>Promise<unknown>){
    // HTTP complete precedes Facebook's SPA article rendering. Only a readable
    // post releases this gate, so fast polling cannot starve the article.
    chrome.tabs.onUpdated.addListener((id,change)=>{if(id===this.watch?.tabId&&change.status==='loading'&&!this.loadingSince)this.loadingSince=Date.now();});
    chrome.tabs.onRemoved.addListener(id=>{if(id===this.watch?.tabId)this.stop();});
    chrome.permissions?.onRemoved?.addListener(p=>{if(p.origins?.some(o=>o.includes('facebook.com')))this.stop();});
  }
  stop(){this.generation++;this.watch=undefined;clearInterval(this.timer);this.timer=undefined;void chrome.storage.local.remove('facebookWatch');}
  async command(payload:Record<string,unknown>){
    if(payload.stop){this.revoked.add(String(payload.token));if(this.watch?.token===payload.token||!this.watch)this.stop();return {stopped:true};}
    if(payload.focus){
      const w=this.watch;
      if(!w||w.token!==payload.token||w.scheduleId!==payload.scheduleId||!this.connected()||Date.now()>w.leaseUntil||Date.now()>=Date.parse(w.expiresAt))throw new Error('Cửa sổ theo dõi đã dừng hoặc đổi lịch.');
      const tab=await chrome.tabs.get(w.tabId);
      if(this.watch!==w||facebookPostKey(tab.url??'')!==facebookPostKey(w.postUrl))throw new Error('Cửa sổ không còn ở bài Facebook đã chọn.');
      await chrome.tabs.update(w.tabId,{active:true});
      if(tab.windowId!==undefined)await chrome.windows.update(tab.windowId,{focused:true,state:'normal'});
      return {ready:true,tabId:w.tabId};
    }
    if(typeof payload.postUrl!=='string'||!facebookPostKey(payload.postUrl)||typeof payload.scheduleId!=='string'||typeof payload.token!=='string'||!Number.isFinite(Date.parse(String(payload.watchAt)))||!Number.isFinite(Date.parse(String(payload.expiresAt)))||Date.parse(String(payload.expiresAt))<=Date.now())throw new Error('Lịch theo dõi Facebook không hợp lệ hoặc đã hết giờ.');
    if(this.revoked.has(payload.token))throw new Error('Phiên theo dõi đã dừng.');
    const generation=this.generation;await enableFacebookWatch();if(generation!==this.generation)throw new Error('Lượt theo dõi đã thay đổi.');
    if(this.watch?.token===payload.token&&await chrome.tabs.get(this.watch.tabId).catch(()=>undefined)){this.watch.leaseUntil=Date.now()+25000;return {ready:true};}
    const stored=await chrome.storage.local.get(['facebookWatch','facebookWatchWindow']);
    const saved=(stored.facebookWatch??stored.facebookWatchWindow) as Watch|undefined;
    if(generation!==this.generation)throw new Error('Lượt theo dõi đã thay đổi.');this.stop();const current=this.generation;
    const candidate=saved?await chrome.tabs.get(saved.tabId).catch(()=>undefined):undefined;
    const reusable=candidate&&facebookPostKey(candidate.url??'')===facebookPostKey(payload.postUrl)?candidate:undefined;
    const popup=reusable?undefined:await chrome.windows.create({url:'about:blank',type:'popup',width:520,height:720,focused:false});
    const tab=reusable??popup?.tabs?.[0]??(popup?.id!==undefined?(await chrome.tabs.query({windowId:popup.id}))[0]:undefined);
    if(current!==this.generation){if(popup?.id!==undefined)await chrome.windows.remove(popup.id).catch(()=>{});throw new Error('Lượt theo dõi đã hủy trước khi mở bài.');}
    if(tab?.id===undefined)throw new Error('Không mở được cửa sổ Facebook nhỏ.');
    this.watch={scheduleId:payload.scheduleId,token:payload.token,postUrl:payload.postUrl,watchAt:String(payload.watchAt),expiresAt:String(payload.expiresAt),tabId:tab.id!,leaseUntil:Date.now()+25000};
    await chrome.storage.local.set({facebookWatch:this.watch,facebookWatchWindow:{tabId:tab.id}});
    if(current!==this.generation)throw new Error('Lượt theo dõi đã hủy trước khi mở bài.');
    this.nextReload=Date.now()+10000;this.loadingSince=Date.now();
    await chrome.tabs.update(tab.id!,{url:payload.postUrl});
    this.timer=setInterval(()=>void this.tick().catch(()=>{}),200);
    return {ready:true};
  }
  configuration(sender:chrome.runtime.MessageSender){
    const w=this.watch;if(!w||sender.tab?.id!==w.tabId||(sender.frameId??0)!==0||facebookPostKey(sender.url??'')!==facebookPostKey(w.postUrl))return;
    return {scheduleId:w.scheduleId,token:w.token,postKey:facebookPostKey(w.postUrl)};
  }
  async observation(sender:chrome.runtime.MessageSender,payload:any){
    const config=this.configuration(sender);if(!config||config.scheduleId!==payload.scheduleId||config.token!==payload.token||config.postKey!==payload.postKey||typeof payload.text!=='string'||payload.text.length>120000)throw new Error('Trang không thuộc phiên theo dõi Facebook.');
    if(!payload.error&&payload.text.trim())this.loadingSince=0;
    return this.report({scheduleId:config.scheduleId,token:config.token,postKey:config.postKey,text:payload.text,error:typeof payload.error==='string'?payload.error.slice(0,300):undefined});
  }
  private async tick(){
    const w=this.watch;if(!w)return;const now=Date.now();
    if(!this.connected()||now>w.leaseUntil||now>=Date.parse(w.expiresAt)){this.stop();return;}
    if(this.busy)return;
    const fast=now>=Date.parse(w.watchAt),interval=fast?1500:10000;
    // Entering the fast phase must not wait for the preceding slow deadline.
    this.nextReload=Math.min(this.nextReload,now+interval);
    if(now<this.nextReload||this.loadingSince&&now-this.loadingSince<8000)return;
    this.busy=true;this.nextReload=now+interval;
    try{
      const tab=await chrome.tabs.get(w.tabId);
      if(this.watch!==w)return;
      if(facebookPostKey(tab.url??'')!==facebookPostKey(w.postUrl))throw new Error('Tab theo dõi đã chuyển khỏi bài đã chọn.');
      this.loadingSince=now;await chrome.tabs.reload(w.tabId);
    }catch(e){if(this.watch===w){this.nextReload=Date.now()+5000;await this.report({scheduleId:w.scheduleId,token:w.token,postKey:facebookPostKey(w.postUrl),text:'',error:(e as Error).message}).catch(()=>{});}}
    finally{this.busy=false;}
  }
}
