import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { performance } from "node:perf_hooks";
import { Engine } from "../../integrations/chinesetest/runner/engine";
import { DONG_A } from "../../integrations/chinesetest/protocol";
import { fixtureEngine, FakeClient, limits } from "./support";
import type { ChineseTestClient } from "../../integrations/chinesetest/runner/client";
import { ApiError } from "../../integrations/chinesetest/runner/client";
const engines:Engine[]=[];
beforeEach(()=>{vi.useFakeTimers();const base=Date.now();vi.spyOn(performance,"now").mockImplementation(()=>Date.now()-base);});
afterEach(async()=>{for(const e of engines.splice(0))await e.close();vi.restoreAllMocks();vi.useRealTimers();});
async function setup(count=1,write?:(_:any)=>Promise<void>){const f=await fixtureEngine(count,write);engines.push(f.engine);return f;}
it("prepares a hidden center, waits for publication, and Test never invokes registration POST",async()=>{
 const f=await setup();f.shared.sites=[];const p=await f.prepare();expect(p.schedule.message).toContain("chưa xuất hiện");await f.arm(p);await vi.advanceTimersByTimeAsync(7100);expect(f.engine.snapshot().schedules[0].status).toBe("waiting_center");f.shared.sites=[(await import('./support')).center];await vi.advanceTimersByTimeAsync(1100);expect(f.engine.snapshot().schedules[0].status).toBe("test_passed");expect(f.shared.submits).toHaveLength(0);
});
it("handles actual boolean capacity and final fee 60, rather than the catalog fee 35",async()=>{
 const f=await setup();const p=await f.prepare(false);await f.arm(p);await vi.advanceTimersByTimeAsync(9500);expect(f.shared.submits).toHaveLength(1);expect(f.shared.submits[0].payload).toMatchObject({kmId:DONG_A.kmId,kdId:DONG_A.center,jlKmId:"60202044",mailInfo:{mid:"",mailSum:1},isExamHsk:"0",willing:0});expect(f.engine.snapshot().schedules[0]).toMatchObject({status:"confirmed",attempt:{count:1,fee:60,bmid:"FIXTURE-BMID"}});
});
it("keeps an ambiguous POST locked and never resends after timeout or re-login",async()=>{
 const f=await setup();f.shared.result=new Error("fixture timeout");const p=await f.prepare(false);await f.arm(p);await vi.advanceTimersByTimeAsync(60000);expect(f.shared.submits).toHaveLength(1);expect(f.engine.snapshot().schedules[0].status).toBe("uncertain");await expect(f.prepare(false)).rejects.toThrow("khóa gửi");
});
it("refuses to send if durable reservation cannot be written",async()=>{
 let reject=false;const f=await setup(1,async d=>{if(reject&&d.schedules.some((s:any)=>s.status==="reserved"))throw new Error("disk full");});const p=await f.prepare(false);await f.arm(p);reject=true;await vi.advanceTimersByTimeAsync(9000);expect(f.shared.submits).toHaveLength(0);expect(f.engine.snapshot().schedules[0].status).toBe("uncertain");
});
it("requires consent and Live access, and keeps editing from arming an old profile",async()=>{
 const f=await setup();await expect(f.engine.execute("prepare",{accountId:"account-0",target:{...DONG_A,targetAt:Date.now()+7000},test:false},limits)).rejects.toThrow("đồng ý");const p=await f.prepare(false);await expect(f.engine.execute("arm",{id:p.schedule.id,claimKey:p.claimKey},{...limits,liveEnabled:false})).rejects.toThrow("Live");const a=f.data.accounts[0];await f.engine.execute("save-profile",{accountId:a.view.id,personal:{...a.personal,phone:"changed"}},limits);await expect(f.arm(p)).rejects.toThrow("Hồ sơ đã đổi");
});
it("blocks existing registration, extra fee, changed currency and missing Speaking history",async()=>{
 const f=await setup();f.shared.records=[{KSXM_kmid:DONG_A.kmId,KDZX_kaoshitime:DONG_A.ksDate,KSBM_bmid:"old"}];await expect(f.prepare()).rejects.toThrow("Test Records");f.shared.records=[];f.shared.fee=61;await expect(f.prepare()).rejects.toThrow("vượt mức");f.shared.fee=60;f.data.accounts[0].personal.isExamHsk="";await expect(f.prepare()).rejects.toThrow("khai báo");f.data.accounts[0].personal.isExamHsk="0";await expect(f.engine.execute("prepare",{accountId:"account-0",target:{...DONG_A,targetAt:Date.now()+7000,currency:"VND"},test:true},limits)).rejects.toThrow("Đơn vị");
});
it("stop invalidates an in-flight read before any POST",async()=>{
 const f=await setup();const p=await f.prepare(false);await f.arm(p);let release!:()=>void;f.shared.siteGate=new Promise(r=>release=r);await vi.advanceTimersByTimeAsync(7100);await f.engine.execute("stop",{id:p.schedule.id},limits);release();await vi.advanceTimersByTimeAsync(2000);expect(f.shared.submits).toHaveLength(0);expect(f.engine.snapshot().schedules[0].status).toBe("stopped");
});
it.each(["stop", "stop-all"] as const)("%s during the arm identity check cannot reactivate a prepared schedule",async(command)=>{
 const f=await setup();const p=await f.prepare(false);let release!:()=>void;f.shared.identityGate=new Promise(r=>release=r);const arming=f.arm(p);await Promise.resolve();await Promise.resolve();await f.engine.execute(command,{id:p.schedule.id},limits);release();await expect(arming).rejects.toThrow("đã dừng");await vi.advanceTimersByTimeAsync(15000);expect(f.shared.submits).toHaveLength(0);expect(f.engine.snapshot().schedules[0].status).toBe("stopped");
});
it("preserves a single send and accepts a late confirmed response after stop",async()=>{
 const f=await setup();const p=await f.prepare(false);let release!:()=>void;f.shared.submitGate=new Promise(r=>release=r);f.shared.result.onlinePay=2;await f.arm(p);await vi.advanceTimersByTimeAsync(7100);expect(f.shared.submits).toHaveLength(1);await f.engine.execute("stop",{id:p.schedule.id},limits);expect(f.engine.snapshot().schedules[0].status).toBe("uncertain");release();await vi.advanceTimersByTimeAsync(15000);expect(f.engine.snapshot().schedules[0].status).toBe("accepted");expect(f.shared.submits).toHaveLength(1);
});
it("requires manual absence verification and never treats unknown records as absent",async()=>{
 const f=await setup();f.shared.result=new Error("timeout");const p=await f.prepare(false);await f.arm(p);await vi.advanceTimersByTimeAsync(7100);await expect(f.engine.execute("verify-absent",{id:p.schedule.id},limits)).rejects.toThrow("Chỉ xác minh");f.shared.records=[{unrecognized:"schema"}];await expect(f.engine.execute("verify-absent",{id:p.schedule.id,confirm:true},limits)).rejects.toThrow("Cấu trúc");f.shared.records=[];await f.engine.execute("verify-absent",{id:p.schedule.id,confirm:true},limits);expect((await f.prepare(false)).schedule.status).toBe("prepared");expect(f.shared.submits).toHaveLength(1);
});
it("restart never replays a reserved request",async()=>{
 const f=await setup();const p=await f.prepare(false);f.data.schedules[0].status="reserved";const restored=new Engine(structuredClone(f.data),{async write(){}},s=>new FakeClient(f.shared,s) as unknown as ChineseTestClient);engines.push(restored);await vi.advanceTimersByTimeAsync(20000);expect(restored.snapshot().schedules[0].status).toBe("uncertain");expect(f.shared.submits).toHaveLength(0);await expect(restored.execute("arm",{id:p.schedule.id,claimKey:p.claimKey},limits)).rejects.toThrow("chưa sẵn sàng");
});
it("runs 20 independent accounts and shares center discovery",async()=>{
 const f=await setup(20);const at=Date.now()+15000;for(let i=0;i<20;i++){const p=await f.prepare(true,`account-${i}`,at);await f.arm(p);}const before=f.shared.siteCalls;await vi.advanceTimersByTimeAsync(16000);expect(f.engine.snapshot().schedules.filter(s=>s.status==="test_passed")).toHaveLength(20);expect(f.shared.submits).toHaveLength(0);expect(f.shared.siteCalls-before).toBe(1);
});
it("does not expose sessions, full identity or order polling key in state",async()=>{
 const f=await setup();const p=await f.prepare(false);await f.arm(p);f.shared.order={code:200,data:null};await vi.advanceTimersByTimeAsync(7100);const state=JSON.stringify(f.engine.snapshot());expect(state).not.toContain("fixture-token");expect(state).not.toContain("FIXTURE-0");expect(state).not.toContain("FIXTURE-KEY");expect(state).not.toContain("idNo");
});
it.each([
 new ApiError("Mất kết nối",undefined,undefined,"transient"),
 new ApiError("ChineseTest HTTP 503.",503),
 new ApiError("ChineseTest HTTP 429.",429,2000),
])("keeps a schedule armed on a transient precheck failure and verifies again before sending: $message",async(error)=>{
 const f=await setup();const p=await f.prepare(true,"account-0",Date.now()+45000);await f.arm(p);f.shared.identityError=error;
 await vi.advanceTimersByTimeAsync(16000);expect(f.engine.snapshot().schedules[0]).toMatchObject({status:"armed",attempt:{count:0}});expect(f.engine.snapshot().schedules[0].message).toContain("lỗi tạm thời");expect(f.engine.snapshot().accounts[0].loggedIn).toBe(true);
 f.shared.identityError=undefined;await vi.advanceTimersByTimeAsync(30000);expect(f.engine.snapshot().schedules[0].status).toBe("test_passed");expect(f.shared.submits).toHaveLength(0);
});
it("reports a confirmed auth rejection with its code and stops before sending",async()=>{
 const f=await setup();const p=await f.prepare(false,"account-0",Date.now()+45000);await f.arm(p);f.shared.identityError=new ApiError("ChineseTest từ chối phiên đăng nhập (mã 401).",401);
 await vi.advanceTimersByTimeAsync(46000);expect(f.engine.snapshot().schedules[0].status).toBe("stopped");expect(f.engine.snapshot().schedules[0].message).toContain("401");expect(f.engine.snapshot().accounts[0].loggedIn).toBe(false);expect(f.shared.submits).toHaveLength(0);
});
it.each([new ApiError("ChineseTest không trả JSON hợp lệ.",undefined,undefined,"protocol"),new ApiError("ChineseTest HTTP 403.",403)])("preserves the actual non-auth failure rather than claiming expiry: $message",async(error)=>{
 const f=await setup();const p=await f.prepare(true,"account-0",Date.now()+45000);await f.arm(p);f.shared.identityError=error;await vi.advanceTimersByTimeAsync(16000);
 expect(f.engine.snapshot().schedules[0].status).toBe("stopped");expect(f.engine.snapshot().schedules[0].message).toContain(error.message);expect(f.engine.snapshot().schedules[0].message).not.toContain("hết hạn");expect(f.engine.snapshot().accounts[0].loggedIn).toBe(true);expect(f.shared.submits).toHaveLength(0);
});
it("retries only the final identity read once after a transient failure",async()=>{
 const f=await setup();const p=await f.prepare(false);await f.arm(p);await vi.advanceTimersByTimeAsync(6500);const before=f.shared.identityCalls;f.shared.identityError=new ApiError("Lỗi mạng",undefined,undefined,"transient");
 await vi.advanceTimersByTimeAsync(600);expect(f.engine.snapshot().schedules[0].status).toBe("checking");expect(f.shared.submits).toHaveLength(0);f.shared.identityError=undefined;
 await vi.advanceTimersByTimeAsync(3500);expect(f.shared.identityCalls-before).toBe(3);expect(f.engine.snapshot().schedules[0].status).toBe("confirmed");expect(f.shared.submits).toHaveLength(1);
});
it("stops after two failed final identity reads without calling registration or claiming expiry",async()=>{
 const f=await setup();const p=await f.prepare(false);await f.arm(p);await vi.advanceTimersByTimeAsync(6500);const before=f.shared.identityCalls;f.shared.identityError=new ApiError("ChineseTest HTTP 503.",503);
 await vi.advanceTimersByTimeAsync(20000);expect(f.shared.identityCalls-before).toBe(2);expect(f.engine.snapshot().schedules[0].status).toBe("failed");expect(f.engine.snapshot().schedules[0].message).toContain("503");expect(f.shared.submits).toHaveLength(0);
});
it("coalesces overlapping prechecks and the final identity read for one account",async()=>{
 const f=await setup();const p=await f.prepare(true,"account-0",Date.now()+45000);await f.arm(p);const before=f.shared.identityCalls;let release!:()=>void;f.shared.identityGate=new Promise(r=>release=r);
 await vi.advanceTimersByTimeAsync(45100);expect(f.shared.identityCalls-before).toBe(1);release();await vi.advanceTimersByTimeAsync(100);expect(f.engine.snapshot().schedules[0].status).toBe("test_passed");expect(f.shared.submits).toHaveLength(0);
});
it("stop cancels the final identity retry before any registration POST",async()=>{
 const f=await setup();const p=await f.prepare(false);await f.arm(p);await vi.advanceTimersByTimeAsync(6500);f.shared.identityError=new ApiError("Mất kết nối",undefined,undefined,"transient");await vi.advanceTimersByTimeAsync(600);await f.engine.execute("stop",{id:p.schedule.id},limits);f.shared.identityError=undefined;await vi.advanceTimersByTimeAsync(5000);expect(f.engine.snapshot().schedules[0].status).toBe("stopped");expect(f.shared.submits).toHaveLength(0);
});
it("a late rejection of the old session cannot invalidate a newly imported login",async()=>{
 const f=await setup();const p=await f.prepare(true,"account-0",Date.now()+45000);await f.arm(p);let release!:()=>void;f.shared.identityGate=new Promise(r=>release=r);await vi.advanceTimersByTimeAsync(16000);await f.engine.execute("stop",{id:p.schedule.id},limits);
 const fresh={...f.data.accounts[0].session,token:"fresh-fixture-token"};f.login.finish=async()=>fresh;await f.engine.execute("finish-login",{},limits);f.shared.identityError=new ApiError("Old session rejected",401);release();await vi.advanceTimersByTimeAsync(100);
 expect(f.engine.snapshot().accounts[0].loggedIn).toBe(true);f.shared.identityError=undefined;f.shared.identityGate=undefined;expect((await f.prepare()).schedule.status).toBe("prepared");expect(f.shared.submits).toHaveLength(0);
});

it("reads saved profiles without identity HTTP requests and never lets a stale form erase the uploaded path",async()=>{
 const f=await setup();const before=f.shared.identityCalls;
 await f.engine.execute("read-profile",{accountId:"account-0"},limits);expect(f.shared.identityCalls).toBe(before);
 const stale={...f.data.accounts[0].personal,photo:""};
 await f.engine.execute("upload-photo",{accountId:"account-0",base64:"fixture",mimeType:"image/png"},limits);
 await f.engine.execute("save-profile",{accountId:"account-0",personal:stale},limits);
 expect(f.data.accounts[0].personal.photo).toBe("/fixture/new-portrait.jpg");
 await f.engine.execute("inspect",{accountId:"account-0",refreshProfile:true},limits);expect(f.data.accounts[0].personal.photo).toBe("/fixture/new-portrait.jpg");
});
it("persists an unsynced image, blocks old prepared schedules, retries failed uploads and skips duplicate uploads",async()=>{
 const f=await setup(),p=await f.prepare(),version=crypto.randomUUID(),a=f.data.accounts[0];
 const upload=vi.spyOn(FakeClient.prototype,"upload").mockRejectedValueOnce(new Error("synthetic upload failure"));
 await f.engine.execute("stage-profile",{accountId:a.view.id,photoVersion:version},limits);
 expect(upload).not.toHaveBeenCalled();expect(f.engine.snapshot().accounts[0].hasPhoto).toBe(false);
 await expect(f.arm(p)).rejects.toThrow("chưa đồng bộ");await expect(f.prepare()).rejects.toThrow("chưa đồng bộ");
 const args={accountId:a.view.id,personal:a.personal,photoVersion:version,base64:"fixture",mimeType:"image/png"};
 await expect(f.engine.execute("save-profile",args,limits)).rejects.toThrow("synthetic upload failure");expect(a.syncedPhotoVersion).not.toBe(version);
 await f.engine.execute("save-profile",args,limits);expect(a.syncedPhotoVersion).toBe(version);expect(f.engine.snapshot().accounts[0].hasPhoto).toBe(true);
 await f.engine.execute("save-profile",{...args,personal:{...a.personal,phone:"updated"}},limits);expect(upload).toHaveBeenCalledTimes(2);
 const restored=new Engine(structuredClone(f.data),{async write(){}},s=>new FakeClient(f.shared,s) as unknown as ChineseTestClient);engines.push(restored);
 expect((await restored.execute("read-profile",{accountId:a.view.id},limits)).personal.photo).toBe("/fixture/new-portrait.jpg");
 const next=crypto.randomUUID();await f.engine.execute("stage-profile",{accountId:a.view.id,photoVersion:next},limits);
 await expect(f.engine.execute("save-profile",args,limits)).rejects.toThrow("Ảnh đã thay đổi");
});
it("quotes the actual read-only fee without requiring a portrait and stops if the confirmed fee changes",async()=>{
 const f=await setup(),target={...DONG_A,maxFee:undefined,currency:undefined,targetAt:Date.now()+7000};
 f.data.accounts[0].personal.photo="";f.shared.sites=[];
 const feeQuote=await f.engine.execute("quote-fee",{accountId:"account-0",target},limits);expect(feeQuote).toMatchObject({amount:60,currency:"USD",linked:["HSK (Level 4) Speaking"]});expect(f.shared.submits).toHaveLength(0);
 f.data.accounts[0].personal.photo="/fixture/portrait.jpg";f.shared.sites=[(await import('./support')).center];
 const result=await f.engine.execute("prepare",{accountId:"account-0",target:{...target,feeQuote},test:false,agreeRules:true,agreePrivacy:true},limits);await f.arm(result);
 f.shared.fee=55;await vi.advanceTimersByTimeAsync(9000);expect(f.engine.snapshot().schedules[0]).toMatchObject({status:"failed"});expect(f.engine.snapshot().schedules[0].message).toContain("Lệ phí đã thay đổi");expect(f.shared.submits).toHaveLength(0);
});
it("never marks the new portrait ready if the vault cannot persist the synchronized profile",async()=>{
 let fail=false;const f=await setup(1,async()=>{if(fail)throw new Error("synthetic vault full");});const version=crypto.randomUUID(),a=f.data.accounts[0],before=a.personal.photo;
 await f.engine.execute("stage-profile",{accountId:a.view.id,photoVersion:version},limits);fail=true;
 await expect(f.engine.execute("save-profile",{accountId:a.view.id,personal:a.personal,photoVersion:version,base64:"fixture",mimeType:"image/png"},limits)).rejects.toThrow("vault full");
 expect(a.personal.photo).toBe(before);expect(a.syncedPhotoVersion).not.toBe(version);expect(f.engine.snapshot().accounts[0].hasPhoto).toBe(false);
 fail=false;await expect(f.prepare()).rejects.toThrow("chưa đồng bộ");
});
