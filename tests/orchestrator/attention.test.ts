import {afterEach,it,expect,vi} from 'vitest';
import {AttentionQueue} from '../../manager/server/attention';
const queues:AttentionQueue[]=[];
afterEach(()=>{for(const q of queues)q.close();queues.length=0;vi.useRealTimers();});
function fixture(){const desktop={capture:vi.fn(async()=> 'manager'),restore:vi.fn(async()=>{})};const q=new AttentionQueue(desktop,100,350);queues.push(q);return {q,desktop};}
it('serializes three profiles and restores the prior window before granting the next one',async()=>{const {q,desktop}=fixture();const a=await q.acquire('a','run',()=>true);desktop.capture.mockResolvedValueOnce('chrome-a');await q.focused('a',a.token);let granted=false;const b=q.acquire('b','run',()=>true).then(v=>{granted=true;return v;});const c=q.acquire('c','run',()=>true);expect(granted).toBe(false);await q.release('a',a.token);const lb=await b;expect(desktop.restore).toHaveBeenCalledWith('manager','chrome-a');await q.release('b',lb.token);await expect(c).resolves.toHaveProperty('token');});
it('expires an abandoned page and serves the next profile',async()=>{vi.useFakeTimers();const {q}=fixture();await q.acquire('a','run',()=>true);const next=q.acquire('b','run',()=>true);await vi.advanceTimersByTimeAsync(101);await expect(next).resolves.toHaveProperty('token');});
it('renews only the owning token and has an absolute hold limit',async()=>{vi.useFakeTimers();const {q}=fixture(),a=await q.acquire('a','run',()=>true);expect(q.renew('b',a.token)).toBe(false);for(let i=0;i<4;i++){await vi.advanceTimersByTimeAsync(80);expect(q.renew('a',a.token)).toBe(true);}await vi.advanceTimersByTimeAsync(31);expect(q.renew('a',a.token)).toBe(false);});
it('a stale release cannot unlock a newer profile',async()=>{const {q}=fixture(),a=await q.acquire('a','run',()=>true);await q.release('a',a.token);const b=await q.acquire('b','run',()=>true);await q.release('a',a.token);expect(q.renew('b',b.token)).toBe(true);});
it('Stop cancels a waiting profile without opening its window',async()=>{const {q,desktop}=fixture();await q.acquire('a','run',()=>true);const b=q.acquire('b','run',()=>true);const rejected=expect(b).rejects.toThrow('dừng');await q.cancel('b');await rejected;expect(desktop.capture).toHaveBeenCalledOnce();});
it('Stop during foreground capture cannot grant a late lease',async()=>{const {q,desktop}=fixture();let captured!:(v:string)=>void;desktop.capture.mockImplementationOnce(()=>new Promise(r=>captured=r));const a=q.acquire('a','run',()=>true);const rejected=expect(a).rejects.toThrow('dừng');await q.cancel('a');captured('manager');await rejected;});
it('rechecks a run after waiting so an old document cannot take foreground',async()=>{const {q}=fixture(),a=await q.acquire('a','run',()=>true);let valid=true;const b=q.acquire('b','old-run',()=>valid);const rejected=expect(b).rejects.toThrow('dừng');valid=false;await q.release('a',a.token);await rejected;});
it('rejects a mark for an expired owner',async()=>{const {q}=fixture(),a=await q.acquire('a','run',()=>true);await q.release('a',a.token);expect(await q.focused('a',a.token)).toBe(false);});
it('grants five background profiles immediately without moving or restoring physical focus',async()=>{
 const {q,desktop}=fixture();const leases=await Promise.all(['a','b','c','d','e'].map(s=>q.acquire(s,'run',()=>true,'background')));
 expect(new Set(leases.map(l=>l.token)).size).toBe(5);expect(leases.every(l=>l.mode==='background')).toBe(true);expect(desktop.capture).not.toHaveBeenCalled();
 for(let i=0;i<5;i++)expect(q.renew(['a','b','c','d','e'][i],leases[i].token)).toBe(true);
 await q.release('a',leases[0].token);expect(q.renew('b',leases[1].token)).toBe(true);expect(desktop.restore).not.toHaveBeenCalled();
});
it('Stop and expiry affect only the matching background profile',async()=>{
 vi.useFakeTimers();const {q}=fixture(),a=await q.acquire('a','run',()=>true,'background'),b=await q.acquire('b','run',()=>true,'background');
 await q.cancel('a');expect(q.renew('a',a.token)).toBe(false);expect(q.renew('b',b.token)).toBe(true);
 await vi.advanceTimersByTimeAsync(101);expect(q.renew('b',b.token)).toBe(false);await expect(q.acquire('b','new',()=>true,'background')).resolves.toMatchObject({mode:'background'});
});
it('rejects a stopped background run and duplicate steps within the same profile',async()=>{
 const {q}=fixture();await expect(q.acquire('a','run',()=>false,'background')).rejects.toThrow('dừng');
 await q.acquire('a','run',()=>true,'background');await expect(q.acquire('a','run',()=>true,'background')).rejects.toThrow('bước khác');await expect(q.acquire('a','run',()=>true)).rejects.toThrow('bước khác');
});
it('background work on another profile does not wait for a foreground lease',async()=>{
 const {q}=fixture();await q.acquire('a','run',()=>true);const b=await q.acquire('b','run',()=>true,'background');expect(q.renew('b',b.token)).toBe(true);expect(await q.focused('b',b.token)).toBe(false);
});
it('cannot give a background lease to the profile currently awaiting foreground capture',async()=>{
 const {q,desktop}=fixture();let captured!:(v:string)=>void;desktop.capture.mockImplementationOnce(()=>new Promise(r=>captured=r));const pending=q.acquire('a','run',()=>true);
 await expect(q.acquire('a','run',()=>true,'background')).rejects.toThrow('bước khác');captured('manager');await pending;
});
it('renewal, stale tokens and shutdown preserve independent background ownership',async()=>{
 vi.useFakeTimers();const {q}=fixture(),a=await q.acquire('a','run',()=>true,'background');await q.release('a',a.token);const b=await q.acquire('a','next',()=>true,'background');
 await q.release('a',a.token);expect(q.renew('a',b.token)).toBe(true);expect(q.renew('b',b.token)).toBe(false);
 for(let i=0;i<4;i++){await vi.advanceTimersByTimeAsync(80);expect(q.renew('a',b.token)).toBe(true);}await vi.advanceTimersByTimeAsync(31);expect(q.renew('a',b.token)).toBe(false);
 q.close();await expect(q.acquire('c','run',()=>true,'background')).rejects.toThrow('đóng');
});
