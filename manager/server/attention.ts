import {randomUUID} from 'node:crypto';
export interface DesktopFocus {capture():Promise<string|undefined>;restore(previous:string,expected:string):Promise<void>;close?():void}
const noFocus:DesktopFocus={capture:async()=>undefined,restore:async()=>{}};
export type AttentionMode='foreground'|'background';
interface Lease {session:string;run:string;token:string;previous?:string;focused?:string;releasing?:boolean;started:number;timer:ReturnType<typeof setTimeout>}
interface Waiter {session:string;run:string;version:number;valid:()=>boolean;resolve:(v:{token:string;mode:AttentionMode})=>void;reject:(e:Error)=>void;timer:ReturnType<typeof setTimeout>}
// Renderer leases are independent per profile. Only physical foreground needs
// a global queue; abandoned documents expire in either mode.
export class AttentionQueue {
  private owner?:Lease;
  private background=new Map<string,Lease>();
  private pending:Waiter[]=[];
  private pumping=false;
  private capturing?:string;
  private closed=false;
  private versions=new Map<string,number>();
  constructor(private desktop:DesktopFocus=noFocus,private leaseMs=12000,private maxHoldMs=90000){}
  acquire(session:string,run:string,valid:()=>boolean,mode:AttentionMode='foreground'):Promise<{token:string;mode:AttentionMode}>{
    if(this.closed)return Promise.reject(new Error('App đã đóng.'));
    if(mode==='background'){
      if(!valid())return Promise.reject(new Error('Lượt đã dừng; bỏ thao tác form.'));
      if(this.background.has(session)||this.owner?.session===session||this.capturing===session||this.pending.some(p=>p.session===session))return Promise.reject(new Error('Profile đang xử lý một bước khác.'));
      const token=randomUUID(),timer=setTimeout(()=>void this.release(session,token),this.leaseMs);
      this.background.set(session,{session,run,token,timer,started:Date.now()});
      return Promise.resolve({token,mode});
    }
    if(this.background.has(session))return Promise.reject(new Error('Profile đang xử lý một bước khác.'));
    return new Promise((resolve,reject)=>{const waiter:Waiter={session,run,version:this.versions.get(session)??0,valid,resolve,reject,timer:setTimeout(()=>{this.pending=this.pending.filter(p=>p!==waiter);reject(new Error('Quá thời gian chờ cửa sổ.'));},175000)};this.pending.push(waiter);void this.pump();});
  }
  private async pump(){
    if(this.pumping||this.owner||this.closed)return;this.pumping=true;
    try{while(!this.owner&&this.pending.length){const p=this.pending.shift()!;clearTimeout(p.timer);const valid=()=>p.version===(this.versions.get(p.session)??0)&&p.valid();if(!valid()){p.reject(new Error('Lượt đã dừng; bỏ thao tác cửa sổ.'));continue;}this.capturing=p.session;const previous=await this.desktop.capture().catch(()=>undefined);this.capturing=undefined;if(this.closed||!valid()){p.reject(new Error('Lượt đã dừng; bỏ thao tác cửa sổ.'));continue;}const token=randomUUID(),timer=setTimeout(()=>void this.release(p.session,token),this.leaseMs);this.owner={session:p.session,run:p.run,token,previous,started:Date.now(),timer};p.resolve({token,mode:'foreground'});}}finally{this.pumping=false;}
  }
  renew(session:string,token:string):boolean{const p=this.background.get(session)??this.owner;if(!p||p.releasing||p.session!==session||p.token!==token||Date.now()-p.started>=this.maxHoldMs)return false;clearTimeout(p.timer);p.timer=setTimeout(()=>void this.release(session,token),Math.min(this.leaseMs,this.maxHoldMs-(Date.now()-p.started)));return true;}
  async focused(session:string,token:string){const p=this.owner;if(!p||p.releasing||p.session!==session||p.token!==token)return false;const handle=await this.desktop.capture().catch(()=>undefined);if(this.owner!==p||p.releasing)return false;p.focused=handle;return true;}
  async release(session:string,token:string){const background=this.background.get(session);if(background?.token===token){clearTimeout(background.timer);this.background.delete(session);return;}const p=this.owner;if(!p||p.releasing||p.session!==session||p.token!==token)return;p.releasing=true;clearTimeout(p.timer);if(p.previous&&p.focused)await this.desktop.restore(p.previous,p.focused).catch(()=>{});if(this.owner===p)this.owner=undefined;void this.pump();}
  async cancel(session:string){this.versions.set(session,(this.versions.get(session)??0)+1);for(const p of this.pending.filter(p=>p.session===session)){clearTimeout(p.timer);p.reject(new Error('Profile đã dừng hoặc mất kết nối.'));}this.pending=this.pending.filter(p=>p.session!==session);const background=this.background.get(session);if(background)await this.release(session,background.token);if(this.owner?.session===session)await this.release(session,this.owner.token);}
  close(){this.closed=true;for(const p of this.pending){clearTimeout(p.timer);p.reject(new Error('App đã đóng.'));}this.pending=[];for(const p of this.background.values())clearTimeout(p.timer);this.background.clear();if(this.owner){clearTimeout(this.owner.timer);this.owner=undefined;}this.desktop.close?.();}
}

