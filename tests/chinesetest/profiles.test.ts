import { expect, it } from "vitest";
import { httpFixture } from "../cloud/fixture";
import { connectRunner } from "./relay-fixture";
import { personal } from "./support";
import type { CloudProfile, Device } from "../../integrations/chinesetest/protocol";
const png=Buffer.concat([Buffer.from("89504e470d0a1a0a","hex"),Buffer.alloc(20*1024)]).toString("base64");
it("stores the portrait and draft before ChineseTest upload, serves a private preview, and rejects stale saves",async()=>{
 const app=await httpFixture(undefined,false,true),runner=await connectRunner(app);
 try{
  const device=await(await app.api("chinesetest/pair",0,{code:runner.code})).json() as Device;
  const path=`chinesetest/profiles/${device.id}/account-0`;
  expect(await(await app.api(path)).json()).toBeNull();
  const uploaded=await app.api(path+"/photo",0,{revision:0,personal,base64:png,mimeType:"image/png"});
  expect(uploaded.status).toBe(200);const draft=await uploaded.json() as CloudProfile;
  expect(draft).toMatchObject({revision:1,status:"draft",photoMime:"image/png",personal:{ksEName:personal.ksEName,photo:""}});
  expect(draft.photoVersion).toBeTruthy();expect(draft.syncedPhotoVersion).toBeNull();expect(app.blobs.size).toBe(1);
  expect(runner.data.accounts[0].personal.photo).toBe(personal.photo);expect(runner.shared.submits).toHaveLength(0);
  expect(await(await app.api(path)).json()).toEqual(draft);
  const preview=await app.api(path+"/photo");expect(preview.status).toBe(200);expect(preview.headers.get("content-type")).toBe("image/png");expect(preview.headers.get("cache-control")).toContain("no-store");expect(Buffer.from(await preview.arrayBuffer()).toString("base64")).toBe(png);
  expect((await app.api(path,1)).status).toBe(404);expect((await app.api(path+"/photo",1)).status).toBe(404);
  expect((await fetch(app.config.origin+"/api/"+path+"/photo")).status).toBe(401);
  expect((await app.api(path,0,{revision:0,personal:{...personal,phone:"stale"}})).status).toBe(409);
  const saved=await(await app.api(path,0,{revision:draft.revision,personal:{...personal,phone:"edited",photo:"https://invalid.test/portrait"}})).json() as CloudProfile;
  expect(saved.personal.photo).toBe("");expect(saved.personal.phone).toBe("edited");
  const synced=await(await app.api(path+"/synced",0,{revision:saved.revision,photoVersion:saved.photoVersion,chineseTestPhoto:"/uploaded/portrait.png"})).json() as CloudProfile;
  expect(synced).toMatchObject({status:"synced",syncedPhotoVersion:saved.photoVersion,personal:{photo:"/uploaded/portrait.png"}});
  const newer=await(await app.api(path+"/photo",0,{revision:synced.revision,personal:synced.personal,base64:png,mimeType:"image/png"})).json() as CloudProfile;
  expect((await app.api(path+"/photo/"+synced.photoVersion)).status).toBe(409);expect((await app.api(path+"/photo/"+newer.photoVersion)).status).toBe(200);expect(newer.photoVersion).not.toBe(synced.photoVersion);expect(newer.status).toBe("draft");expect(app.blobs.size).toBe(1);
  expect((await app.api(path+"/synced",0,{revision:newer.revision,photoVersion:synced.photoVersion,chineseTestPhoto:"/uploaded/old.png"})).status).toBe(409);
  expect((await app.pool.query("SELECT relrowsecurity FROM pg_class WHERE oid='chinesetest.profiles'::regclass")).rows[0].relrowsecurity).toBe(true);
 }finally{await runner.close();await app.close();}
},15000);
it("validates image bytes, preserves the stored photo after Storage failure, and resolves concurrent uploads by revision",async()=>{
 const app=await httpFixture(undefined,false,true),runner=await connectRunner(app);
 try{
  const device=await(await app.api("chinesetest/pair",0,{code:runner.code})).json() as Device,path=`chinesetest/profiles/${device.id}/account-0`;
  expect((await app.api(path+"/photo",0,{revision:0,personal,base64:png,mimeType:"image/jpeg"})).status).toBe(400);expect(app.blobs.size).toBe(0);
  const results=await Promise.all([1,2].map(()=>app.api(path+"/photo",0,{revision:0,personal,base64:png,mimeType:"image/png"})));
  expect(results.map(r=>r.status).sort()).toEqual([200,409]);expect(app.blobs.size).toBe(1);
  const draft=await(await app.api(path)).json() as CloudProfile;
  const put=app.objects.put;app.objects.put=async()=>{throw new Error("synthetic storage failure");};
  expect((await app.api(path+"/photo",0,{revision:draft.revision,personal,base64:png,mimeType:"image/png"})).status).toBe(503);app.objects.put=put;
  expect(await(await app.api(path)).json()).toEqual(draft);expect((await app.api(path+"/photo")).status).toBe(200);
 }finally{await runner.close();await app.close();}
},15000);
