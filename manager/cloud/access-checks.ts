import type { Account } from '../../src/account';
import { assertAccess } from './access-policy';

interface Entry { account?: Account; checked: number; pending?: Promise<Account|undefined> }

// Only application permissions are cached, never login cookies or Auth tokens.
// Keep the original 2-second TTL and fresh checks on commands/heartbeats.
export class AccessChecks {
  private entries=new Map<string,Entry>();
  constructor(private load:(owner:string)=>Promise<Account|undefined>){}
  invalidate(owner:string){this.entries.delete(owner);}
  prune(){for(const [owner,entry] of this.entries)if(!entry.pending&&Date.now()-entry.checked>300000)this.entries.delete(owner);}
  async allowed(owner:string,fresh=false):Promise<Account>{
    let entry=this.entries.get(owner);
    if(!entry){entry={checked:-Infinity};this.entries.set(owner,entry);}
    if(fresh||Date.now()-entry.checked>=2000){
      const current=entry;
      if(!current.pending){
        const pending=this.load(owner).then(account=>{current.account=account;current.checked=Date.now();return account;});
        current.pending=pending;
        void pending.finally(()=>{if(current.pending===pending)current.pending=undefined;}).catch(()=>{});
      }
      try{await current.pending;}catch(error){if(this.entries.get(owner)===current)throw error;}
      // An admin edit invalidates even an in-flight read. It must not refill
      // the cache with the permissions it read before the edit committed.
      if(this.entries.get(owner)!==current)return this.allowed(owner,true);
    }
    let account=entry.account;
    if(account?.expiresAt&&Date.parse(account.expiresAt)<=Date.now())account={...account,status:'expired'};
    assertAccess(account);return account;
  }
}
