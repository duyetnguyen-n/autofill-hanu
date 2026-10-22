import { afterEach, expect, it, vi } from 'vitest';
import { AccessChecks } from '../../manager/cloud/access-checks';
import type { Account } from '../../src/account';
const active={id:'owner-a',status:'active',emailVerified:true,expiresAt:null} as Account;
afterEach(()=>vi.useRealTimers());

it('coalesces simultaneous profile checks per owner without extending the 2-second TTL or bypassing a forced check',async()=>{
 vi.useFakeTimers();let release!:(a:Account)=>void;
 const load=vi.fn(()=>new Promise<Account>(resolve=>release=resolve)),checks=new AccessChecks(load);
 const requests=Array.from({length:75},()=>checks.allowed(active.id,true));
 expect(load).toHaveBeenCalledTimes(1);release(active);expect(await Promise.all(requests)).toHaveLength(75);
 await checks.allowed(active.id);expect(load).toHaveBeenCalledTimes(1);
 const forced=checks.allowed(active.id,true);expect(load).toHaveBeenCalledTimes(2);release(active);await forced;
 await vi.advanceTimersByTimeAsync(2000);const expired=checks.allowed(active.id);expect(load).toHaveBeenCalledTimes(3);release(active);await expired;
});
it('cannot refill stale permission after an administrator invalidates an in-flight check',async()=>{
 let release!:(a:Account)=>void;
 const load=vi.fn().mockImplementationOnce(()=>new Promise<Account>(resolve=>release=resolve)).mockResolvedValue({...active,status:'blocked'});
 const checks=new AccessChecks(load),request=checks.allowed(active.id);
 checks.invalidate(active.id);release(active);
 await expect(request).rejects.toMatchObject({status:403});
 await expect(checks.allowed(active.id)).rejects.toMatchObject({status:403});expect(load).toHaveBeenCalledTimes(2);
});
it('does not reuse permissions across owners or accept expired cached accounts',async()=>{
 vi.useFakeTimers();const load=vi.fn(async(owner:string)=>({...active,id:owner,expiresAt:new Date(Date.now()+1000).toISOString()}));
 const checks=new AccessChecks(load);
 await Promise.all([checks.allowed('owner-a'),checks.allowed('owner-b')]);expect(load).toHaveBeenCalledTimes(2);
 await vi.advanceTimersByTimeAsync(1000);await expect(checks.allowed('owner-a')).rejects.toMatchObject({status:403});expect(load).toHaveBeenCalledTimes(2);
});
it('propagates read failures to every waiting profile and retries without using a stale result',async()=>{
 let fail!:(e:Error)=>void;const load=vi.fn().mockImplementationOnce(()=>new Promise((_,reject)=>fail=reject)).mockResolvedValue(active);
 const checks=new AccessChecks(load),requests=[checks.allowed('owner-a'),checks.allowed('owner-a')];
 const result=Promise.allSettled(requests);fail(new Error('DB unavailable'));expect((await result).every(r=>r.status==='rejected')).toBe(true);
 expect(await checks.allowed('owner-a')).toEqual(active);expect(load).toHaveBeenCalledTimes(2);
});
