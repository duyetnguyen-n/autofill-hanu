import {expect,it} from "vitest";
import {createServer} from "node:https";
import {mkdtemp,readFile,rm} from "node:fs/promises";
import {execFileSync} from "node:child_process";
import {existsSync} from "node:fs";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {CookieJar} from "tough-cookie";
import {ChineseTestClient} from "../../integrations/chinesetest/runner/client";
import {portraitPng} from "./support";

it("reads actual HTTPS image bytes with the runner session, rejects unsafe paths/redirects/HTML/oversize responses and bounds latency",async()=>{
 const dir=await mkdtemp(join(tmpdir(),"chinesetest-portrait-")),old=process.env.CHINESETEST_FIXTURE;process.env.CHINESETEST_FIXTURE="1";
 const ssl=join(process.env.ProgramFiles || "C:/Program Files","Git/usr/bin/openssl.exe");
 execFileSync(process.platform==="win32"&&existsSync(ssl)?ssl:"openssl",["req","-x509","-newkey","rsa:2048","-nodes","-keyout",join(dir,"key.pem"),"-out",join(dir,"cert.pem"),"-days","1","-subj","/CN=localhost","-addext","subjectAltName=DNS:localhost"],{stdio:"ignore"});
 const ca=await readFile(join(dir,"cert.pem"),"utf8");let mode="ok",reads=0;const problems:string[]=[];
 const server=createServer({key:await readFile(join(dir,"key.pem")),cert:ca},(req,res)=>{
  reads++;
  try{
   expect(req.url).toBe("/portraits/read-back.png");expect(req.method).toBe("GET");
   expect(req.headers.authorization).toBe("Bearer fixture-portrait-token");expect(req.headers.cookie).toContain("token=fixture-cookie");
   if(mode==="redirect"){res.writeHead(302,{Location:"https://evil.invalid/photo.png"});res.end();return;}
   if(mode==="auth"){res.writeHead(403);res.end();return;}
   if(mode==="html"){res.writeHead(200,{"content-type":"text/html"});res.end("<html>login</html>");return;}
   res.writeHead(200,{"content-type":"image/png"});
   if(mode==="invalid"){res.end("not an image");return;}
   if(mode==="huge"){res.end(Buffer.alloc(1024*1024));return;}
   if(mode==="slow")return;
   res.end(portraitPng);
  }catch(e){problems.push((e as Error).message);res.writeHead(500);res.end();}
 });
 await new Promise<void>(r=>server.listen(0,"localhost",r));
 const origin=`https://localhost:${(server.address() as any).port}`,jar=new CookieJar();await jar.setCookie("token=fixture-cookie; Secure; Path=/",origin);
 const client=new ChineseTestClient({token:"fixture-portrait-token",cookies:JSON.stringify(jar.serializeSync()),email:"fixture@example.test",key:"fixture"},origin,ca,{readTimeoutMs:200});
 try{
  const image=await client.photo("portraits/read-back.png");expect(image.mimeType).toBe("image/png");expect(Buffer.from(image.base64,"base64")).toEqual(portraitPng);
  for(const path of ["https://evil.invalid/p.png","//evil.invalid/p.png","/../p.png","/a/%2e%2e/p.png","/a\\p.png","/a/p.png?token=secret","/a/p.svg"]){await expect(client.photo(path)).rejects.toThrow("Đường dẫn");}
  expect(reads).toBe(1);
  mode="redirect";await expect(client.photo("/portraits/read-back.png")).rejects.toMatchObject({code:302});
  mode="auth";await expect(client.photo("/portraits/read-back.png")).rejects.toMatchObject({code:403,kind:"api"});
  for(const bad of ["html","invalid","huge"]){mode=bad;await expect(client.photo("/portraits/read-back.png")).rejects.toMatchObject({kind:"protocol"});}
  mode="slow";await expect(client.photo("/portraits/read-back.png")).rejects.toMatchObject({kind:"transient",stage:"read"});
  expect(reads).toBe(7);expect(problems).toEqual([]);
 }finally{client.close();server.closeAllConnections();await new Promise<void>(r=>server.close(()=>r()));if(old===undefined)delete process.env.CHINESETEST_FIXTURE;else process.env.CHINESETEST_FIXTURE=old;await rm(dir,{recursive:true,force:true});}
},15000);
