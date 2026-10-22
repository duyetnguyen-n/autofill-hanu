import { afterEach, expect, it } from 'vitest';
import { httpFixture, users } from './fixture';

const cleanup: (()=>Promise<void>)[]=[];
afterEach(async()=>{while(cleanup.length)await cleanup.pop()!();});
async function fixture(){const f=await httpFixture();cleanup.push(f.close);await f.pool.query("UPDATE hanu.accounts SET role='admin' WHERE user_id=$1",[users[0]]);return f;}
async function version(f:Awaited<ReturnType<typeof fixture>>){return (await (await f.api(`admin/accounts/${users[1]}`)).json()).account.version;}

it('grants the role only to an active verified account and audits the actor without changing usage limits',async()=>{
 const f=await fixture(); await f.pool.query("UPDATE hanu.accounts SET expires_at=now()+interval '7 days' WHERE user_id=$1",[users[1]]); const before=(await (await f.api(`admin/accounts/${users[1]}`)).json()).account;
 const response=await f.api(`admin/accounts/${users[1]}/promote-admin`,0,{version:before.version});
 expect(response.status).toBe(200);
 expect(await response.json()).toMatchObject({role:'admin',status:before.status,maxProfiles:before.maxProfiles,maxConcurrent:before.maxConcurrent,liveEnabled:before.liveEnabled,expiresAt:null,version:before.version+1});
 expect((await f.api('admin/accounts',1)).status).toBe(200);
 const event=(await (await f.api('admin/events')).json()).find((e:any)=>e.action==='promote_admin');
 expect(event).toMatchObject({actorEmail:'an@example.test',targetEmail:'binh@example.test',details:{before:{role:'member'},after:{role:'admin'}}});
 expect((await f.api(`admin/accounts/${users[1]}/promote-admin`,0,{version:before.version+1})).status).toBe(409);
});

it('rejects members, foreign origins, role injection and stale administrator decisions',async()=>{
 const f=await fixture(), current=await version(f), path=`admin/accounts/${users[1]}/promote-admin`;
 expect((await f.api(path,1,{version:current})).status).toBe(403);
 expect((await f.api(path,0,{version:current,role:'admin'})).status).toBe(400);
 expect((await f.api(path,0,{version:current-1})).status).toBe(409);
 const foreign=await fetch(`${f.config.origin}/api/${path}`,{method:'POST',headers:{Cookie:'test-account=account-a',Origin:'https://foreign.example','Content-Type':'application/json'},body:JSON.stringify({version:current})});
 expect(foreign.status).toBe(403);
 expect((await f.pool.query('SELECT role FROM hanu.accounts WHERE user_id=$1',[users[1]])).rows[0].role).toBe('member');
 expect((await (await f.api('admin/events')).json()).filter((e:any)=>e.action==='promote_admin')).toHaveLength(0);
});

it.each(['pending','blocked','rejected','expired','unverified'])('does not use role assignment to bypass %s account restrictions',async state=>{
 const f=await fixture();
 if(state==='expired')await f.pool.query("UPDATE hanu.accounts SET expires_at=now()-interval '1 day' WHERE user_id=$1",[users[1]]);
 else if(state==='unverified')await f.pool.query('UPDATE hanu.accounts SET email_verified=false WHERE user_id=$1',[users[1]]);
 else await f.pool.query('UPDATE hanu.accounts SET status=$2 WHERE user_id=$1',[users[1],state]);
 expect((await f.api(`admin/accounts/${users[1]}/promote-admin`,0,{version:await version(f)})).status).toBe(403);
 expect((await f.pool.query('SELECT role FROM hanu.accounts WHERE user_id=$1',[users[1]])).rows[0].role).toBe('member');
});
