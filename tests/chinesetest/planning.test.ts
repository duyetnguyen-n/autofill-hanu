import { it,expect } from "vitest";
import { validDate,personalFrom,DONG_A,validateTarget } from "../../integrations/chinesetest/protocol";
import { vnInput,vnTime,profileFromWebsite } from "../../integrations/chinesetest/ui/planning";
import { emptyProfile } from "../../src/rules";
it("keeps the opening timestamp separate from exam day and handles Vietnam time consistently",()=>{
 const ms=Date.parse("2026-11-01T02:00:00Z");expect(vnInput(ms)).toBe("2026-11-01T09:00:00");expect(vnTime(vnInput(ms))).toBe(ms);expect(validDate("2026-02-30")).toBe(false);expect(()=>validateTarget({...DONG_A,targetAt:ms,intervalMs:100})).toThrow("khoảng chờ");
});
it("imports known website fields without turning a document scan into a portrait",()=>{
 const p=emptyProfile();Object.assign(p.values,{fullName:"Lê Minh Khuê",identityType:"HỘ CHIẾU",passportNumber:"FIXTURE-PASSPORT",gender:"Nữ",birthDate:"17/04/1999",nationality:"Việt Nam",motherTongue:"Tiếng Việt"});p.attachments.identityDocument={id:"document-scan",name:"ID.jpg",type:"image/jpeg",size:40000,updatedAt:""};
 const out=profileFromWebsite(p,personalFrom({}),[{gjid:180,gjename:"VIET NAM"}],[{idksFirstlanguage:73,ename:"Vietnamese"}]);expect(out).toMatchObject({birthday:"1999-04-17",ksSex:"女",gjId:"180",fid:"73",idType:"护照",idNo:"FIXTURE-PASSPORT",photo:""});
});
