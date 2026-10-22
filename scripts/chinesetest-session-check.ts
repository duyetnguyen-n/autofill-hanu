// Read-only diagnostics: never creates an Engine or modifies a running schedule/vault.
import { access, stat } from "node:fs/promises";
import { join } from "node:path";
import { ChineseTestClient, ApiError } from "../integrations/chinesetest/runner/client";
import type { RunnerData } from "../integrations/chinesetest/runner/engine";
import { Vault, systemKey, runnerDirectory } from "../integrations/chinesetest/runner/vault";
import { fingerprint } from "../integrations/chinesetest/crypto";
const dir=runnerDirectory();
await access(join(dir,"state.enc"));
if(process.platform==="win32")await access(join(dir,"key.dpapi"));
const data=await new Vault<RunnerData>(join(dir,"state.enc"),await systemKey(dir)).load(()=>{throw new Error("Không có kho phiên để kiểm tra.");});
if(process.argv.includes("--metadata")){
 console.log(JSON.stringify({directory:dir,runnerName:data.name,fingerprint:await fingerprint(data.keys.publicKey),vaultSavedAt:(await stat(join(dir,"state.enc"))).mtime.toISOString(),accounts:data.accounts.map((a,i)=>({account:i+1,hasCandidate:!!a.personal.ksEName,hasPhoto:!!a.personal.photo})),schedules:data.schedules.map(s=>({status:s.status,test:s.test,sends:s.attempt.count,message:s.message}))}));
 process.exit(0);
}
const accounts=[];
for(const [index,account] of data.accounts.entries()){
 const client=new ChineseTestClient(account.session);
 try{const identity=await client.identity();accounts.push({account:index+1,authenticated:identity.key===account.session.key});}
 catch(e){accounts.push({account:index+1,authenticated:false,code:e instanceof ApiError?e.code:undefined,kind:e instanceof ApiError?e.kind:undefined,stage:e instanceof ApiError?e.stage:undefined,error:(e as Error).message});}
 finally{client.close();}
}
console.log(JSON.stringify({source:"local-stored-session",vaultSavedAt:(await stat(join(dir,"state.enc"))).mtime.toISOString(),checkedAt:new Date().toISOString(),accounts,registrationPosts:0,vaultModified:false}));
