import { createHash } from "node:crypto";
import { Engine, freshData } from "../../integrations/chinesetest/runner/engine";
import { DONG_A, personalFrom, type Row } from "../../integrations/chinesetest/protocol";
import type { ChineseTestClient, Session } from "../../integrations/chinesetest/runner/client";
export const limits = { maxAccounts:20,maxConcurrent:20,liveEnabled:true,expiresAt:Date.now()+86400000 };
export const personal = personalFrom({ ksEName:"Lê Minh Khuê",birthday:"1999-04-17",ksSex:"女",gjId:180,ksCountry:"VIET NAM",idType:"护照",idNo:"FIXTURE-KHUE",phone:"fixture-phone",photo:"/fixture/portrait.jpg",fid:73,firstLanguage:"Vietnamese",isExamHsk:"0",studyYear:"1",pfId:"1" });
export const center={kdId:DONG_A.center,kdEName:DONG_A.centerName,kdName:"越南东亚大学（网考）",gjId:180,tyFlag:"face_yes,build_yes",mTypeCode:"USD",fee:35};
export const server = () => ({ sites:[center] as Row[], directory:[center,{...center,kdId:"44797750",kdEName:"CONFUCIUS INSTITUTE AT HANOI UNIVERSITY",kdName:"越南河内大学孔子学院（网考）"}] as Row[], full:true as any, linked:{jiLian:true,jiList:[{jlKmId:"60202044",jlKmEName:"HSK (Level 4) Speaking"}]}, fee:60 as any, records:[] as Row[], recordsError:undefined as Error|undefined, recordsGate:undefined as Promise<void>|undefined, result:{code:200,orderNo:"FIXTURE-ORDER",messageKey:"FIXTURE-KEY",onlinePay:1,jfEndDate:"2026-12-01 12:00:00"} as any, order:{code:200,data:{bmid:"FIXTURE-BMID"}} as any, submits:[] as {key:string;payload:Row}[], siteCalls:0, directoryCalls:[] as string[], identityCalls:0, calls:[] as string[], identityError:undefined as Error|undefined, identityGate:undefined as Promise<void>|undefined, submitGate:undefined as Promise<void>|undefined, siteGate:undefined as Promise<void>|undefined });
export type Server=ReturnType<typeof server>;
export class FakeClient {
  constructor(public shared:Server,public session?:Session){}
  async identity(){this.shared.identityCalls++;if(this.shared.identityGate)await this.shared.identityGate;if(this.shared.identityError)throw this.shared.identityError;return {email:this.session?.email || "fixture@example.test",key:this.session?.key || "public"};}
  async profile(){return {code:200,data:personal};}
  async options(){return {code:200,data:{projectList:[{KMID:"13",KMENAME:"HSK"},{KMID:"16",KMENAME:"HSK Speaking"}]}};}
  async subjects(_id:string){return {code:200,data:[{KMID:DONG_A.kmId,KMENAME:"HSK Level 4"}]};}
  async dates(){return {code:200,data:[{KTTIME:DONG_A.ksDate}]};}
  async sites(){this.shared.siteCalls++;if(this.shared.siteGate)await this.shared.siteGate;return {code:200,data:this.shared.sites};}
  async directory(ksType:string){this.shared.directoryCalls.push(ksType);return this.shared.directory;}
  async records(){if(this.shared.recordsGate)await this.shared.recordsGate;if(this.shared.recordsError)throw this.shared.recordsError;return {code:200,rows:this.shared.records,total:this.shared.records.length};}
  async submit(payload:Row){this.shared.submits.push({key:this.session!.key,payload});if(this.shared.submitGate)await this.shared.submitGate;if(this.shared.result instanceof Error)throw this.shared.result;return this.shared.result;}
  async order(){return this.shared.order;}
  async upload(){return "/fixture/new-portrait.jpg";}
  async call(path:string){this.shared.calls.push(path);if(path.includes("juadgeFullBm"))return {code:200,data:this.shared.full};if(path.includes("getOzKd"))return {code:200,data:null};if(path.includes("getJiLianList"))return {code:200,data:this.shared.linked};if(path.includes("getKsFees"))return {code:200,data:this.shared.fee};if(path.includes("countryList"))return {code:200,data:[{gjid:180,gjename:"VIET NAM"}]};if(path.includes("firstLanguageList"))return {code:200,data:[{idksFirstlanguage:73,ename:"Vietnamese"}]};if(path.includes("/common/config"))return {code:200,studyYearList:{1:"Less than 6 months"}};if(path.includes("getProfessionList"))return {code:200,data:[]};return {code:200,data:0};}
  close(){}
}
export async function fixtureEngine(count=1,write=async(_data:any)=>{}){
  const data=await freshData("Máy ChineseTest thử nghiệm"),shared=server();
  for(let i=0;i<count;i++){const email=`khue.${i}@example.test`,key=createHash("sha256").update(email).digest("hex");data.accounts.push({view:{id:`account-${i}`,email,name:i?`Thí sinh thử ${i+1}`:personal.ksEName,maskedId:"•••• TEST",hasPhoto:true,loggedIn:true},session:{token:"fixture-token",cookies:"{}",email,key},personal:{...personal,idNo:`FIXTURE-${i}`}});}
  const login={pending:false,async open(){this.pending=true;},async finish(){return data.accounts[0].session;},async close(){this.pending=false;}};
  const engine=new Engine(data,{write},s=>new FakeClient(shared,s) as unknown as ChineseTestClient,()=>{},login);
  const prepare=async(test=true,accountId="account-0",targetAt=Date.now()+7000)=>engine.execute("prepare",{accountId,target:{...DONG_A,targetAt,waitMs:10000},test,agreeRules:true,agreePrivacy:true},{...limits,expiresAt:Date.now()+86400000});
  const arm=async(result:any)=>engine.execute("arm",{id:result.schedule.id,claimKey:result.claimKey},{...limits,expiresAt:Date.now()+86400000});
  return {data,engine,shared,prepare,arm,login};
}

