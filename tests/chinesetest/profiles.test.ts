import {expect,it,vi} from "vitest";
import {httpFixture} from "../cloud/fixture";
import {connectRunner} from "./relay-fixture";
import {personal} from "./support";
import type {Device,CloudPhoto} from "../../integrations/chinesetest/protocol";

it("stores only ChineseTest metadata, blocks legacy drafts/originals, scopes ownership and serializes revisions",async()=>{
 const app=await httpFixture(undefined,false,true),runner=await connectRunner(app);
 const put=vi.spyOn(app.objects,"put"),get=vi.spyOn(app.objects,"get");
 try{
  const device=await(await app.api("chinesetest/pair",0,{code:runner.code})).json() as Device,path=`chinesetest/profiles/${device.id}/account-0`;
  expect(await(await app.api(path)).json()).toBeNull();
  expect((await app.api(path,0,{revision:0,personal})).status).toBe(410);
  expect((await app.api(path+"/photo",0,{revision:0,personal,base64:"original",mimeType:"image/png"})).status).toBe(410);
  expect((await app.api(path+"/photo")).status).toBe(410);
  const meta={revision:0,photoVersion:crypto.randomUUID(),mimeType:"image/png",chineseTestPhoto:"/portraits/verified.png"};
  expect((await app.api(path+"/photo-metadata",0,{...meta,personal})).status).toBe(400);
  const results=await Promise.all([1,2].map(()=>app.api(path+"/photo-metadata",0,meta)));
  expect(results.map(r=>r.status).sort()).toEqual([200,409]);
  const saved=await(await app.api(path)).json() as CloudPhoto;
  expect(saved).toMatchObject({revision:1,photoVersion:meta.photoVersion,chineseTestPhoto:meta.chineseTestPhoto,photoMime:"image/png",needsMigration:false});
  expect(saved).not.toHaveProperty("personal");expect(saved).not.toHaveProperty("photoKey");
  const row=(await app.pool.query("SELECT personal,photo_key,status FROM chinesetest.profiles WHERE runner_id=$1",[device.id])).rows[0];
  expect(row).toEqual({personal:{},photo_key:null,status:"synced"});
  expect((await app.api(path,1)).status).toBe(404);expect((await app.api(path+"/photo-metadata",1,meta)).status).toBe(404);
  expect((await fetch(app.config.origin+"/api/"+path)).status).toBe(401);
  expect((await app.api(path+"/photo-metadata",0,{...meta,revision:1,chineseTestPhoto:"https://evil.test/p.png"})).status).toBe(400);
  expect(app.blobs.size).toBe(0);expect(put).not.toHaveBeenCalled();expect(get).not.toHaveBeenCalled();expect(runner.shared.submits).toHaveLength(0);
  expect((await app.pool.query("SELECT relrowsecurity FROM pg_class WHERE oid='chinesetest.profiles'::regclass")).rows[0].relrowsecurity).toBe(true);
 }finally{put.mockRestore();get.mockRestore();await runner.close();await app.close();}
},15000);

it("does not expose legacy drafts and removes the old Storage original when verified metadata replaces it",async()=>{
 const app=await httpFixture(undefined,false,true),runner=await connectRunner(app);
 try{
  const device=await(await app.api("chinesetest/pair",0,{code:runner.code})).json() as Device,path=`chinesetest/profiles/${device.id}/account-0`;
  const owner=(await app.pool.query("SELECT owner FROM chinesetest.runners WHERE id=$1",[device.id])).rows[0].owner;
  await app.objects.put("legacy-portrait",Buffer.from("old original"));
  await app.pool.query("INSERT INTO chinesetest.profiles(owner,runner_id,account_id,personal,photo_key,photo_version,photo_mime) VALUES($1,$2,$3,$4,$5,$6,$7)", [owner,device.id,"account-0",JSON.stringify(personal),"legacy-portrait",crypto.randomUUID(),"image/png"]);
  const legacy=await(await app.api(path)).json();expect(legacy).not.toHaveProperty("personal");expect(legacy.needsMigration).toBe(true);
  const remove=vi.spyOn(app.objects,"remove").mockRejectedValueOnce(new Error("offline"));
  const meta={revision:1,photoVersion:crypto.randomUUID(),mimeType:"image/png",chineseTestPhoto:"/verified/portrait.png"};
  expect((await app.api(path+"/photo-metadata",0,meta)).status).toBe(503);
  expect((await app.pool.query("SELECT photo_key FROM chinesetest.profiles WHERE runner_id=$1",[device.id])).rows[0].photo_key).toBe("legacy-portrait");
  expect((await app.api(path+"/photo-metadata",0,meta)).status).toBe(200);
  expect(app.blobs.size).toBe(0);
  expect((await app.pool.query("SELECT personal,photo_key FROM chinesetest.profiles WHERE runner_id=$1",[device.id])).rows[0]).toEqual({personal:{},photo_key:null});
  remove.mockRestore();
 }finally{await runner.close();await app.close();}
},15000);
