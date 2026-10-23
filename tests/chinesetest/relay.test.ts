import { it, expect } from "vitest";
import { httpFixture } from "../cloud/fixture";
import { connectRunner } from "./relay-fixture";
import type { Device } from "../../integrations/chinesetest/protocol";
import { DONG_A } from "../../integrations/chinesetest/protocol";
it("pairs the provider independently, hides secrets from cloud and isolates owners",async()=>{
 const app=await httpFixture(undefined,true,true),runner=await connectRunner(app);
 try{
  const pair=await app.api("chinesetest/pair",0,{code:runner.code});expect(pair.status).toBe(200);const device=await pair.json() as Device;
  expect((await app.api("chinesetest/pair",1,{code:runner.code})).status).toBe(400);
  expect(await(await app.api("chinesetest/devices",1)).json()).toEqual([]);
  expect((await runner.command(device,"state",{},1)).status).toBe(404);
  const state=await runner.command(device,"state");expect(state.result).toMatchObject({ok:true,data:{protocolVersion:1,accounts:[{name:"Lê Minh Khuê"}]}});
  expect(JSON.stringify(state.result)).not.toContain("fixture-token");
  expect((await app.pool.query("SELECT has_schema_privilege('authenticated','chinesetest','USAGE') AS allowed")).rows[0].allowed).toBe(false);
  expect(await(await app.api("hcmue/devices")).json()).toEqual([]);
  const inspection=await runner.command(device,"inspect",{accountId:"account-0",target:{...DONG_A,targetAt:Date.now()+60000}});expect(inspection.result).toMatchObject({ok:true,data:{ready:true,fee:60}});expect(runner.shared.submits).toHaveLength(0);
 }finally{await runner.close();await app.close();}
},15000);
it("persists a send claim and rejects a second runner for the same candidate/exam",async()=>{
 const app=await httpFixture(undefined,false,true),a=await connectRunner(app),b=await connectRunner(app);
 try{
  const da=await(await app.api("chinesetest/pair",0,{code:a.code})).json() as Device,db=await(await app.api("chinesetest/pair",0,{code:b.code})).json() as Device;
  const target={...DONG_A,targetAt:Date.now()+60000};
  const pa=await a.command(da,"prepare",{accountId:"account-0",target,test:false,agreeRules:true,agreePrivacy:true});
  const pb=await b.command(db,"prepare",{accountId:"account-0",target,test:false,agreeRules:true,agreePrivacy:true});
  expect(pa.result.ok).toBe(true);expect(pb.result.ok).toBe(true);
  expect((await a.command(da,"arm",{id:pa.result.data.schedule.id,claimKey:pa.result.data.claimKey})).result.ok).toBe(true);
  const blocked=await b.command(db,"arm",{id:pb.result.data.schedule.id,claimKey:pb.result.data.claimKey});expect(blocked.status).toBe(409);
  expect(a.shared.submits).toHaveLength(0);expect(b.shared.submits).toHaveLength(0);
 }finally{await a.close();await b.close();await app.close();}
},15000);
it("is disabled unless explicitly configured",async()=>{
 const app=await httpFixture();try{expect((await app.api("chinesetest/devices")).status).toBe(404);expect(await(await fetch(app.config.origin+"/api/auth/config")).json()).not.toHaveProperty("chinesetestEnabled");}finally{await app.close();}
},15000);
it("releases both local and cloud claims after verifying cancellation before granting a new run",async()=>{
 const app=await httpFixture(undefined,false,true),a=await connectRunner(app),b=await connectRunner(app);
 try{
  const da=await(await app.api("chinesetest/pair",0,{code:a.code})).json() as Device,db=await(await app.api("chinesetest/pair",0,{code:b.code})).json() as Device;
  const target={...DONG_A,targetAt:Date.now()+60000},args={accountId:"account-0",target,test:false,agreeRules:true,agreePrivacy:true};
  const pa=(await a.command(da,"prepare",args)).result.data,pb=(await b.command(db,"prepare",args)).result.data;
  expect((await a.command(da,"arm",{id:pa.schedule.id,claimKey:pa.claimKey})).result.ok).toBe(true);
  Object.assign(a.data.schedules[0],{status:"confirmed",attempt:{count:1,bmid:"old"}});
  expect((await b.command(db,"arm",{id:pb.schedule.id,claimKey:pb.claimKey})).status).toBe(409);
  expect((await a.command(da,"verify-absent",{id:pa.schedule.id,confirm:true})).result.ok).toBe(true);
  expect((await app.pool.query("SELECT * FROM chinesetest.claims")).rows).toHaveLength(0);
  expect((await b.command(db,"arm",{id:pb.schedule.id,claimKey:pb.claimKey})).result.ok).toBe(true);
  expect(a.shared.submits).toHaveLength(0);expect(b.shared.submits).toHaveLength(0);
 }finally{await a.close();await b.close();await app.close();}
},15000);
