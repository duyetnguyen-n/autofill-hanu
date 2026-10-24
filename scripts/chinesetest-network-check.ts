// Anonymous, read-only measurements. No runner/Engine/vault, cookies or login.
import {request} from "node:https";
import {mkdir,writeFile} from "node:fs/promises";
import {join} from "node:path";
import {performance} from "node:perf_hooks";
import {ChineseTestClient} from "../integrations/chinesetest/runner/client";
import {ORIGIN} from "../integrations/chinesetest/protocol";

function measure(path:string):Promise<Record<string,unknown>> {
  return new Promise(resolve=>{
    const start=performance.now(),result:Record<string,unknown>={path};let settled=false;
    const elapsed=()=>Math.round(performance.now()-start);
    const finish=()=>{if(settled)return;settled=true;clearTimeout(deadline);result.totalMs=elapsed();resolve(result);};
    const req=request(new URL(path,ORIGIN),{agent:false,headers:{Accept:"text/html"}},res=>{
      result.status=res.statusCode;result.ttfbMs=elapsed();let size=0;
      res.on("data",part=>{size+=part.length;if(size>2*1024*1024){result.error="response-size-limit";req.destroy();finish();}});
      res.on("end",()=>{result.bytes=size;finish();});
      res.on("error",()=>{result.error="response-interrupted";finish();});
    });
    const deadline=setTimeout(()=>{result.error="timeout-20s";req.destroy();finish();},20000);
    req.on("socket",socket=>{
      socket.once("lookup",()=>{result.dnsMs=elapsed();});
      socket.once("connect",()=>{result.tcpConnectedMs=elapsed();});
      socket.once("secureConnect",()=>{result.tlsReadyMs=elapsed();});
    });
    req.on("error",(e:NodeJS.ErrnoException)=>{result.error=e.code || "network-error";finish();});req.end();
  });
}
const samples=Number(process.argv.find(a=>a.startsWith("--samples="))?.slice(10) || 2);
if(!Number.isInteger(samples)||samples<1||samples>5)throw Error("samples must be between 1 and 5");
const web:Record<string,unknown>[]=[],api:Record<string,unknown>[]=[];
for(let i=0;i<samples;i++)web.push(await measure("/"));
const client=new ChineseTestClient();
try{
 for(const [name,read] of [["options",()=>client.options()],["Vietnam-directory-IBT",()=>client.directory("2")]] as const){
  const start=performance.now();
  try{await read();api.push({name,success:true,totalMs:Math.round(performance.now()-start)});}
  catch{api.push({name,success:false,totalMs:Math.round(performance.now()-start)});}
 }
}finally{client.close();}
const checkedAt=new Date().toISOString(),report={checkedAt,platform:process.platform,arch:process.arch,web,api,authenticated:false,registrationPosts:0,profileWrites:0};
const directory="test-results/chinesetest";await mkdir(directory,{recursive:true});
await writeFile(join(directory,`network-${process.platform}-${checkedAt.replace(/[:.]/g,"-")}.json`),JSON.stringify(report,null,2));
console.log(JSON.stringify(report,null,2));
