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
    if(this.signal.aborted)throw new Error('Đã dừng.');
    await chrome.debugger.sendCommand(this.source,'Input.dispatchMouseEvent',{type:'mouseMoved',x,y,button:'none',buttons:0,pointerType:'mouse'});
    if(this.signal.aborted)throw new Error('Đã dừng.');
    await chrome.debugger.sendCommand(this.source,'Input.dispatchMouseEvent',{type:'mousePressed',x,y,button:'left',buttons:1,clickCount:1,pointerType:'mouse'});
    // Release a held press even when Stop arrives, outside the target then.
    const active=!this.signal.aborted;
    await chrome.debugger.sendCommand(this.source,'Input.dispatchMouseEvent',{type:'mouseReleased',x:active?x:-1,y:active?y:-1,button:'left',buttons:0,clickCount:1,pointerType:'mouse'});
    if(!active)throw new Error('Đã dừng.');
  }
  posting(value:boolean){this.pending=value;}
  async keys(keys:string[]){
    for(const key of keys){
      if(this.signal.aborted)throw new Error('Đã dừng.');
      const windowsVirtualKeyCode=key==='Home'?36:key==='ArrowUp'?38:key==='ArrowDown'?40:key==='Enter'?13:0;
      if(!windowsVirtualKeyCode)throw new Error('Phím lựa chọn không hợp lệ.');
      // Google's Material menu commits from keypress. CDP needs Enter's
      // character to emit it; keyDown/keyUp alone can leave only a highlight.
      await chrome.debugger.sendCommand(this.source,'Input.dispatchKeyEvent',{type:'keyDown',key,code:key,windowsVirtualKeyCode,...(key==='Enter'?{text:'\r',unmodifiedText:'\r'}:{})});
      await chrome.debugger.sendCommand(this.source,'Input.dispatchKeyEvent',{type:'keyUp',key,code:key,windowsVirtualKeyCode});
      // Google applies each arrow's highlight on an animation frame. Sending
      // the next key in the same frame can reuse the previous index.
      if(!this.signal.aborted)await new Promise(resolve=>setTimeout(resolve,40));
    }
  }
  async close(){
    this.pending=false;
    if(!this.attached)return;
    chrome.debugger.onEvent.removeListener(this.listener);
    this.attached=false;
    await chrome.debugger.detach(this.source).catch(()=>{});
  }
}
