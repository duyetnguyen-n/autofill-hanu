// Only accepts the unsaved-draft dialog caused by OUR in-flight native POST.
// It never accepts alerts, prompts, CAPTCHA, security warnings or other tabs.
export class DirectPageDialogs {
  private attached=false;
  private pending=false;
  private source:{tabId:number};
  private listener:(source:chrome.debugger.Debuggee,method:string,params?:object)=>void;
  constructor(tabId:number,private signal:AbortSignal){
    this.source={tabId};
    this.listener=(source,method,params)=>{
      if(source.tabId!==this.source.tabId||method!=='Page.javascriptDialogOpening'||(params as {type?:string})?.type!=='beforeunload'||!this.pending)return;
      void chrome.debugger.sendCommand(this.source,'Page.handleJavaScriptDialog',{accept:!this.signal.aborted}).catch(()=>{});
    };
  }
  async connect(){
    if(!chrome.debugger?.attach)return;
    await chrome.debugger.attach(this.source,'1.3');this.attached=true;
    chrome.debugger.onEvent.addListener(this.listener);
    await chrome.debugger.sendCommand(this.source,'Page.enable');
    await chrome.debugger.sendCommand(this.source,'Emulation.setFocusEmulationEnabled',{enabled:true});
  }
  async click(x:number,y:number){
    for(const type of ['mousePressed','mouseReleased']){if(this.signal.aborted)throw new Error('Đã dừng.');await chrome.debugger.sendCommand(this.source,'Input.dispatchMouseEvent',{type,x,y,button:'left',clickCount:1});}
  }
  posting(value:boolean){this.pending=value;}
  async close(){
    this.pending=false;
    if(!this.attached)return;
    chrome.debugger.onEvent.removeListener(this.listener);
    this.attached=false;
    await chrome.debugger.detach(this.source).catch(()=>{});
  }
}
