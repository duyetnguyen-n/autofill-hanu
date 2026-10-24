import {expect,it,vi} from "vitest";
import {fixtureEngine,FakeClient,limits} from "./support";
import {ApiError, type ChineseTestClient} from "../../integrations/chinesetest/runner/client";
import {Engine} from "../../integrations/chinesetest/runner/engine";
const waitJob=async(engine:Engine,id:string)=>{await expect.poll(async()=>(await engine.execute("profile-sync-status",{accountId:"account-0",id},limits)).phase).toMatch(/done|failed/);return engine.execute("profile-sync-status",{accountId:"account-0",id},limits);};

it("uploads immediately without requiring a completed form, waits for read-back, and never reuploads on save",async()=>{
 const f=await fixtureEngine(),old=f.data.accounts[0].personal.photo,version=crypto.randomUUID();let release!:()=>void;
 const gate=new Promise<void>(r=>release=r),original=FakeClient.prototype.photo;
 const spy=vi.spyOn(FakeClient.prototype,"photo").mockImplementation(async function(this:FakeClient,path){await gate;return original.call(this,path);});
 try{
  const args={accountId:"account-0",photoVersion:version,base64:"fixture",mimeType:"image/png"};
  const job=await f.engine.execute("start-photo-upload",args,limits);
  await expect.poll(async()=>(await f.engine.execute("profile-sync-status",{accountId:"account-0",id:job.id},limits)).phase).toBe("reading-photo");
  expect(f.data.accounts[0].personal.photo).toBe(old);expect(f.data.accounts[0].pendingPortrait?.version).toBe(version);
  expect((await f.engine.execute("start-photo-upload",args,limits)).id).toBe(job.id);
  expect((await f.engine.execute("start-photo-read",{accountId:"account-0"},limits)).id).toBe(job.id);
  release();const done=await waitJob(f.engine,job.id);
  expect(done.result.image.path).toBe("/fixture/new-portrait.jpg");expect(done.result.photoVersion).toBe(version);
  await f.engine.execute("save-profile",{accountId:"account-0",personal:f.data.accounts[0].personal,photoVersion:version,photoFlowVersion:2},limits);
  await waitJob(f.engine,(await f.engine.execute("start-photo-upload",args,limits)).id);
  expect(f.shared.uploadCalls).toBe(1);expect(f.shared.submits).toHaveLength(0);
 }finally{release();spy.mockRestore();await f.engine.close();}
});

it("returns a read job before slow identity/image calls finish and exposes progress without a long relay request",async()=>{
 const f=await fixtureEngine();let releaseIdentity!:()=>void,releaseImage!:()=>void;
 f.shared.identityGate=new Promise<void>(r=>releaseIdentity=r);f.shared.photoGate=new Promise<void>(r=>releaseImage=r);
 try{
  const job=await f.engine.execute("start-photo-read",{accountId:"account-0"},limits);
  await expect.poll(async()=>(await f.engine.execute("profile-sync-status",{accountId:"account-0",id:job.id},limits)).phase).toBe("checking-session");
  releaseIdentity();
  await expect.poll(async()=>(await f.engine.execute("profile-sync-status",{accountId:"account-0",id:job.id},limits)).phase).toBe("reading-photo");
  releaseImage();const done=await waitJob(f.engine,job.id);
  expect(done.result.image.path).toBe(f.data.accounts[0].personal.photo);expect(f.shared.uploadCalls).toBe(0);expect(f.shared.submits).toHaveLength(0);
 }finally{releaseIdentity();releaseImage();await f.engine.close();}
});

it("keeps a returned path after read failure and recovers after runner restart with GETs only",async()=>{
 const f=await fixtureEngine(),old=f.data.accounts[0].personal.photo,version=crypto.randomUUID();
 const spy=vi.spyOn(FakeClient.prototype,"photo").mockRejectedValue(new ApiError("image timeout",undefined,undefined,"transient","read"));
 try{
  const job=await f.engine.execute("start-photo-upload",{accountId:"account-0",photoVersion:version,base64:"fixture",mimeType:"image/png"},limits);
  expect((await waitJob(f.engine,job.id)).phase).toBe("failed");
  expect(f.data.accounts[0].personal.photo).toBe(old);expect(f.data.accounts[0].pendingPortrait?.path).toBeTruthy();
  await expect(f.prepare()).rejects.toThrow("chưa được đọc lại");
  spy.mockRestore();
  const restored=new Engine(structuredClone(f.data),{async write(){}},s=>new FakeClient(f.shared,s) as unknown as ChineseTestClient);
  try{
   const read=await restored.execute("read-photo",{accountId:"account-0"},limits);
   expect(read.image.path).toBe("/fixture/new-portrait.jpg");expect(read.photoVersion).toBe(version);
   expect(restored.data.accounts[0].pendingPortrait).toBeUndefined();expect(f.shared.uploadCalls).toBe(1);
  }finally{await restored.close();}
 }finally{spy.mockRestore();await f.engine.close();}
});

it("distinguishes unreadable image permission from an expired login and preserves the old path",async()=>{
 const f=await fixtureEngine(),old=f.data.accounts[0].personal.photo;
 const spy=vi.spyOn(FakeClient.prototype,"photo").mockRejectedValue(new ApiError("image forbidden",403,undefined,"api","read"));
 try{
  await expect(f.engine.execute("read-photo",{accountId:"account-0"},limits)).rejects.toMatchObject({kind:"api",code:403});
  expect(f.data.accounts[0].view.loggedIn).toBe(true);
  f.shared.identityError=new ApiError("Đăng nhập lại",401,undefined,"auth","identity");
  await expect(f.engine.execute("read-photo",{accountId:"account-0"},limits)).rejects.toMatchObject({kind:"auth",code:401});
  expect(f.data.accounts[0].view.loggedIn).toBe(false);expect(f.data.accounts[0].personal.photo).toBe(old);
 }finally{spy.mockRestore();await f.engine.close();}
});
