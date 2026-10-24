import {afterEach,beforeEach,expect,it,vi} from "vitest";
import {performance} from "node:perf_hooks";
import {DONG_A} from "../../integrations/chinesetest/protocol";
import {ApiError} from "../../integrations/chinesetest/runner/client";
import type {Engine} from "../../integrations/chinesetest/runner/engine";
import {fixtureEngine,limits} from "./support";
const engines:Engine[]=[];
beforeEach(()=>{vi.useFakeTimers();const start=Date.now();vi.spyOn(performance,"now").mockImplementation(()=>Date.now()-start);});
afterEach(async()=>{for(const e of engines.splice(0))await e.close();vi.restoreAllMocks();vi.useRealTimers();});
async function setup(ahead=3600000,hidden=false){const f=await fixtureEngine();engines.push(f.engine);if(hidden)f.shared.sites=[];const p=await f.engine.execute("prepare",{accountId:"account-0",test:true,target:{...DONG_A,targetAt:Date.now()+ahead,waitMs:7200000,intervalMs:60000}}, {...limits,expiresAt:Date.now()+86400000});await f.arm(p);return {...f,id:p.schedule.id};}
it("checks only active schedules every five minutes and stops polling after stop",async()=>{
 const f=await setup(),before=f.shared.identityCalls;await vi.advanceTimersByTimeAsync(299999);expect(f.shared.identityCalls).toBe(before);
 await vi.advanceTimersByTimeAsync(1);expect(f.shared.identityCalls).toBe(before+1);await vi.advanceTimersByTimeAsync(300000);expect(f.shared.identityCalls).toBe(before+2);
 await f.engine.execute("stop",{id:f.id},limits);await vi.advanceTimersByTimeAsync(600000);expect(f.shared.identityCalls).toBe(before+2);expect(f.shared.submits).toEqual([]);
});
it("waits for a slow response before scheduling another check and coalesces the preflight",async()=>{
 const f=await setup(330000);f.shared.sites=[];let release!:()=>void;f.shared.identityGate=new Promise(r=>release=r);const before=f.shared.identityCalls;
 await vi.advanceTimersByTimeAsync(900000);expect(f.shared.identityCalls).toBe(before+1);expect(f.engine.snapshot().schedules[0].status).toBe("waiting_center");
 release();f.shared.identityGate=undefined;await vi.advanceTimersByTimeAsync(1);await vi.advanceTimersByTimeAsync(299998);expect(f.shared.identityCalls).toBe(before+1);
 await vi.advanceTimersByTimeAsync(2);expect(f.shared.identityCalls).toBe(before+2);
});
it("continues maintaining the session when the selected center has not appeared after dispatch",async()=>{
 const f=await setup(7000,true);await vi.advanceTimersByTimeAsync(8000);const before=f.shared.identityCalls;
 await vi.advanceTimersByTimeAsync(592000);expect(f.engine.snapshot().schedules[0].status).toBe("waiting_center");expect(f.shared.identityCalls).toBe(before+2);expect(f.shared.submits).toEqual([]);
});
it("backs off transient failures without clearing login or stopping the armed schedule",async()=>{
 const f=await setup(),before=f.shared.identityCalls;f.shared.identityError=new ApiError("Retry later",429,600000);
 await vi.advanceTimersByTimeAsync(300000);expect(f.engine.snapshot().accounts[0].loggedIn).toBe(true);expect(f.engine.snapshot().schedules[0]).toMatchObject({status:"armed"});
 await vi.advanceTimersByTimeAsync(599999);expect(f.shared.identityCalls).toBe(before+1);f.shared.identityError=undefined;await vi.advanceTimersByTimeAsync(1);expect(f.shared.identityCalls).toBe(before+2);
});
it("a stopped schedule cannot be changed by a delayed maintenance result",async()=>{
 const f=await setup();let release!:()=>void;f.shared.identityGate=new Promise(r=>release=r);await vi.advanceTimersByTimeAsync(300000);
 await f.engine.execute("stop",{id:f.id},limits);const before=f.shared.identityCalls;f.shared.identityError=new Error("Late protocol error");release();f.shared.identityGate=undefined;
 await vi.advanceTimersByTimeAsync(600000);expect(f.engine.snapshot().schedules[0]).toMatchObject({status:"stopped",message:"Đã dừng theo yêu cầu."});expect(f.shared.identityCalls).toBe(before);
});
it("cancels future checks on runner close and after a completed Test",async()=>{
 const f=await setup(7000);await vi.advanceTimersByTimeAsync(8000);expect(f.engine.snapshot().schedules[0].status).toBe("test_passed");const before=f.shared.identityCalls;
 await vi.advanceTimersByTimeAsync(600000);expect(f.shared.identityCalls).toBe(before);
 const other=await setup();const calls=other.shared.identityCalls;await other.engine.close();await vi.advanceTimersByTimeAsync(600000);expect(other.shared.identityCalls).toBe(calls);
});
