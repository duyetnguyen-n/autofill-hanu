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
 const seen:any[]=[],directoryQueries:URLSearchParams[]=[];let posts=0;
 const gitOpenSsl=join(process.env.ProgramFiles || "C:/Program Files","Git/usr/bin/openssl.exe");
 execFileSync(process.platform==="win32"&&existsSync(gitOpenSsl)?gitOpenSsl:"openssl",["req","-x509","-newkey","rsa:2048","-nodes","-keyout",join(dir,"key.pem"),"-out",join(dir,"cert.pem"),"-days","1","-subj","/CN=localhost","-addext","subjectAltName=DNS:localhost"],{stdio:"ignore"});
 const ca=await readFile(join(dir,"cert.pem"),"utf8");
 const server=createServer({key:await readFile(join(dir,"key.pem")),cert:ca},async(req,res)=>{
  const stamp=Number(req.headers["access-ch-ref-stamp"]);expect(req.headers["access-ch-ref-site"]).toBe(requestSignature(stamp));expect(req.headers.origin).toBe(ORIGIN);expect(req.headers.referer).toBe(ORIGIN+"/kaoshibaoming");
  res.setHeader("content-type","application/json");
  if(req.url?.endsWith("/common/get_safe_stamp")){res.end(JSON.stringify({code:200,data:Date.now()}));return;}
  seen.push({authorization:req.headers.authorization,cookie:req.headers.cookie});
  const url=new URL(req.url!,"https://localhost");
  if(url.pathname.endsWith("/portal/index/getExamSiteList")){
   directoryQueries.push(url.searchParams);const type=url.searchParams.get("type"),page=url.searchParams.get("pageNum");
   const row=(kdId:string)=>({kdId,siteName:"考点 "+kdId,siteEName:"Center "+kdId});
   res.end(JSON.stringify(type==="1"?{code:200,total:3,rows:page==="1"?[row("1"),row("2")]:[row("3")]}:type==="2"?{code:200,total:2,rows:[row("1"),row("1")]}:{code:200,total:1,rows:[]}));return;
  }
  if(url.pathname.endsWith("/examinee/enroll/getExamSiteList")){expect(url.searchParams.get("gjId")).toBe("180");res.end(JSON.stringify({code:200,data:[]}));return;}
  if(req.url?.endsWith("/redirect")){res.writeHead(302,{Location:"https://example.invalid/"});res.end();return;}
  if(req.url?.endsWith("/error")){res.end(JSON.stringify({code:500,msg:"Authorization Bearer fixture-secret"}));return;}
  if(req.url?.endsWith("/expired")){res.end(JSON.stringify({code:401,msg:"expired"}));return;}
  if(req.url?.endsWith("/forbidden-json")){res.end(JSON.stringify({code:403,msg:"denied"}));return;}
  if(req.url?.endsWith("/forbidden-http")){res.writeHead(403);res.end("access denied");return;}
  if(req.url?.endsWith("/busy")){res.writeHead(503,{"Retry-After":"2"});res.end();return;}
  if(req.url?.endsWith("/examinee/enroll/submitPersonalInfo")){posts++;for await(const _chunk of req){}req.socket.destroy();return;}
  res.end(JSON.stringify({code:200,data:{ok:true}}));
 });
 await new Promise<void>(r=>server.listen(0,"localhost",r));const origin=`https://localhost:${(server.address() as any).port}`;
 try{
  const jar=new CookieJar();await jar.setCookie("sid=a; Secure; Path=/",origin);
  a=new ChineseTestClient({token:"fixture-a",cookies:JSON.stringify(await jar.serialize()),email:"a@example.test",key:"a"},origin,ca);
  await jar.setCookie("sid=b; Secure; Path=/",origin);b=new ChineseTestClient({token:"fixture-b",cookies:JSON.stringify(await jar.serialize()),email:"b@example.test",key:"b"},origin,ca);
  await Promise.all([a.call("/read"),b.call("/read")]);expect(seen).toEqual(expect.arrayContaining([{authorization:"Bearer fixture-a",cookie:"sid=a"},{authorization:"Bearer fixture-b",cookie:"sid=b"}]));
  await expect(a.call("/expired")).rejects.toMatchObject({code:401,kind:"auth",stage:"read"});
  await expect(a.call("/forbidden-json")).rejects.toMatchObject({code:403,kind:"auth"});
  await expect(a.call("/forbidden-http")).rejects.toMatchObject({code:403,kind:"api"});
  await expect(a.call("/busy")).rejects.toMatchObject({code:503,kind:"transient",retryAfterMs:2000});
  await expect(a.call("/redirect")).rejects.toMatchObject({code:302});
  await expect(a.call("/error")).rejects.not.toThrow("fixture-secret");
  await expect(a.identity()).rejects.toThrow("email");
  expect(await a.directory("1")).toMatchObject([{kdId:"1",kdEName:"Center 1"},{kdId:"2"},{kdId:"3"}]);
  expect(directoryQueries.map(q=>q.get("pageNum"))).toEqual(["1","2"]);expect(directoryQueries.every(q=>q.get("countryId")==="180"&&q.get("type")==="1"&&!q.has("ksDate"))).toBe(true);
  await expect(a.directory("2")).rejects.toThrow("Cấu trúc");await expect(a.directory("4")).rejects.toThrow("chưa đầy đủ");await expect(a.directory("0")).rejects.toThrow("Hình thức");
  expect(await a.sites("828636","2","2026-12-13")).toMatchObject({data:[]});
  await expect(a.submit({fixture:true})).rejects.toMatchObject({kind:"transient",stage:"registration"});expect(posts).toBe(1);
  expect(()=>new ChineseTestClient(undefined,"https://example.com")).toThrow();
  expect(()=>new ChineseTestClient(undefined,ORIGIN,ca)).toThrow("TLS");
  const untrusted=new ChineseTestClient(undefined,origin);try{await expect(untrusted.call("/read")).rejects.toThrow();}finally{untrusted.close();}
 }finally{a?.close();b?.close();await new Promise<void>(r=>{server.closeAllConnections();server.close(()=>r());});if(old===undefined)delete process.env.CHINESETEST_FIXTURE;else process.env.CHINESETEST_FIXTURE=old;if(dirname(resolve(dir))===resolve(tmpdir()))await rm(dir,{recursive:true,force:true});}
},15000);
