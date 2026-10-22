import { it,expect } from "vitest";
import { createServer } from "node:https";
import { mkdtemp,readFile,rm } from "node:fs/promises";
import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join,resolve,dirname } from "node:path";
import { CookieJar } from "tough-cookie";
import { ChineseTestClient,requestSignature } from "../../integrations/chinesetest/runner/client";
import { ORIGIN } from "../../integrations/chinesetest/protocol";
it("reproduces headers, verifies TLS, isolates sessions, and never follows redirects or retries writes",async()=>{
 const dir=await mkdtemp(join(tmpdir(),"chinesetest-tls-")),old=process.env.CHINESETEST_FIXTURE;process.env.CHINESETEST_FIXTURE="1";
 let a:ChineseTestClient|undefined,b:ChineseTestClient|undefined;
 const seen:any[]=[];let posts=0;
 const gitOpenSsl=join(process.env.ProgramFiles || "C:/Program Files","Git/usr/bin/openssl.exe");
 execFileSync(process.platform==="win32"&&existsSync(gitOpenSsl)?gitOpenSsl:"openssl",["req","-x509","-newkey","rsa:2048","-nodes","-keyout",join(dir,"key.pem"),"-out",join(dir,"cert.pem"),"-days","1","-subj","/CN=localhost","-addext","subjectAltName=DNS:localhost"],{stdio:"ignore"});
 const ca=await readFile(join(dir,"cert.pem"),"utf8");
 const server=createServer({key:await readFile(join(dir,"key.pem")),cert:ca},async(req,res)=>{
  const stamp=Number(req.headers["access-ch-ref-stamp"]);expect(req.headers["access-ch-ref-site"]).toBe(requestSignature(stamp));expect(req.headers.origin).toBe(ORIGIN);expect(req.headers.referer).toBe(ORIGIN+"/kaoshibaoming");
  res.setHeader("content-type","application/json");
  if(req.url?.endsWith("/common/get_safe_stamp")){res.end(JSON.stringify({code:200,data:Date.now()}));return;}
  seen.push({authorization:req.headers.authorization,cookie:req.headers.cookie});
  if(req.url?.endsWith("/redirect")){res.writeHead(302,{Location:"https://example.invalid/"});res.end();return;}
  if(req.url?.endsWith("/error")){res.end(JSON.stringify({code:500,msg:"Authorization Bearer fixture-secret"}));return;}
  if(req.url?.endsWith("/expired")){res.end(JSON.stringify({code:401,msg:"expired"}));return;}
  if(req.url?.endsWith("/examinee/enroll/submitPersonalInfo")){posts++;for await(const _chunk of req){}req.socket.destroy();return;}
  res.end(JSON.stringify({code:200,data:{ok:true}}));
 });
 await new Promise<void>(r=>server.listen(0,"localhost",r));const origin=`https://localhost:${(server.address() as any).port}`;
 try{
  const jar=new CookieJar();await jar.setCookie("sid=a; Secure; Path=/",origin);
  a=new ChineseTestClient({token:"fixture-a",cookies:JSON.stringify(await jar.serialize()),email:"a@example.test",key:"a"},origin,ca);
  await jar.setCookie("sid=b; Secure; Path=/",origin);b=new ChineseTestClient({token:"fixture-b",cookies:JSON.stringify(await jar.serialize()),email:"b@example.test",key:"b"},origin,ca);
  await Promise.all([a.call("/read"),b.call("/read")]);expect(seen).toEqual(expect.arrayContaining([{authorization:"Bearer fixture-a",cookie:"sid=a"},{authorization:"Bearer fixture-b",cookie:"sid=b"}]));
  await expect(a.call("/expired")).rejects.toMatchObject({code:401});
  await expect(a.call("/redirect")).rejects.toMatchObject({code:302});
  await expect(a.call("/error")).rejects.not.toThrow("fixture-secret");
  await expect(a.identity()).rejects.toThrow("email");
  await expect(a.submit({fixture:true})).rejects.toThrow();expect(posts).toBe(1);
  expect(()=>new ChineseTestClient(undefined,"https://example.com")).toThrow();
  expect(()=>new ChineseTestClient(undefined,ORIGIN,ca)).toThrow("TLS");
  const untrusted=new ChineseTestClient(undefined,origin);try{await expect(untrusted.call("/read")).rejects.toThrow();}finally{untrusted.close();}
 }finally{a?.close();b?.close();await new Promise<void>(r=>{server.closeAllConnections();server.close(()=>r());});if(old===undefined)delete process.env.CHINESETEST_FIXTURE;else process.env.CHINESETEST_FIXTURE=old;if(dirname(resolve(dir))===resolve(tmpdir()))await rm(dir,{recursive:true,force:true});}
},15000);
