import {expect,it,vi} from "vitest";
import {DONG_A,feeKey} from "../../integrations/chinesetest/protocol";
import {inspectTarget,linkedSubject,readFeeQuote} from "../../integrations/chinesetest/runner/checks";
import type {ChineseTestClient} from "../../integrations/chinesetest/runner/client";
import {FakeClient,server,personal,center} from "./support";

it("uses the official first subject from the actual two-row ChineseTest response, without adding its fee twice",async()=>{
 const shared=server(),fake=new FakeClient(shared),call=vi.spyOn(fake,"call"),client=fake as unknown as ChineseTestClient;
 const quote=await readFeeQuote(client,DONG_A,center);
 expect(quote).toMatchObject({amount:60,currency:"USD",linkedId:"60202044",linked:["HSK (Level 4) Speaking"]});
 const result=await inspectTarget(client,{...DONG_A,feeQuote:quote},personal,[center]);
 expect(result).toMatchObject({ready:true,fee:60,payload:{jlKmId:"60202044"}});
 expect(call).toHaveBeenCalledWith("/examinee/enroll/validJiLian",expect.objectContaining({jlKmId:"60202044",ksDate:DONG_A.ksDate}));
 expect(shared.submits).toEqual([]);
});
it.each([null,{}, {jiLian:1}, {jiLian:true,jiList:[]}, {jiLian:true,jiList:[{}, {jlKmId:"984459"}]}, {jiLian:true,jiList:[{jlKmId:{}}]}])("rejects malformed first rows rather than guessing a later linked subject: %j",value=>{
 expect(()=>linkedSubject(value)).toThrow();
});
it("blocks changed linked subjects even when the total fee has stayed the same",async()=>{
 const client=new FakeClient(server()) as unknown as ChineseTestClient;
 await expect(inspectTarget(client,{...DONG_A,feeQuote:{key:feeKey(DONG_A),amount:60,currency:"USD",linked:["previous subject"],linkedId:"984459"}},personal,[center])).rejects.toThrow("Môn đi kèm đã thay đổi");
});
it("keeps consent, validation errors and Speaking history mandatory with multiple API rows",async()=>{
 const fake=new FakeClient(server()),client=fake as unknown as ChineseTestClient;
 await expect(inspectTarget(client,{...DONG_A,acceptLinked:false},personal,[center])).rejects.toThrow("chấp nhận");
 const original=fake.call.bind(fake);vi.spyOn(fake,"call").mockImplementation(async path=>{if(path.includes("validJiLian"))throw Error("ChineseTest validation rejected");return original(path);});
 await expect(inspectTarget(client,DONG_A,personal,[center])).rejects.toThrow("validation rejected");
 vi.restoreAllMocks();await expect(inspectTarget(client,DONG_A,{...personal,isExamHsk:""},[center])).rejects.toThrow("khai báo");
});
