import {expect,it} from 'vitest';
import {createServer} from 'node:https';
import {mkdtemp,readFile,rm} from 'node:fs/promises';
import {execFileSync} from 'node:child_process';
import {existsSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {CookieJar} from 'tough-cookie';
import {ChineseTestClient,requestSignature} from '../../integrations/chinesetest/runner/client';
it('sends real multipart bytes over HTTPS, retries failed clock GETs, allows slow uploads and never retries POSTs',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'chinesetest-upload-')),old=process.env.CHINESETEST_FIXTURE;process.env.CHINESETEST_FIXTURE='1';
 const ssl=join(process.env.ProgramFiles || 'C:/Program Files','Git/usr/bin/openssl.exe');
 execFileSync(process.platform==='win32'&&existsSync(ssl)?ssl:'openssl',['req','-x509','-newkey','rsa:2048','-nodes','-keyout',join(dir,'key.pem'),'-out',join(dir,'cert.pem'),'-days','1','-subj','/CN=localhost','-addext','subjectAltName=DNS:localhost'],{stdio:'ignore'});
 const ca=await readFile(join(dir,'cert.pem'),'utf8'),photo=Buffer.concat([Buffer.from('89504e470d0a1a0a','hex'),Buffer.alloc(20*1024)]);
 let clocks=0,uploads=0,mode:'slow'|'abort'|'clock-down'|'timeout'|'upload-auth'='slow';const failures:string[]=[];const timers:Array<ReturnType<typeof setTimeout>>=[];
 const server=createServer({key:await readFile(join(dir,'key.pem')),cert:ca},async(req,res)=>{
  try{
   const path=new URL(req.url!,'https://localhost').pathname;
   expect(req.headers['access-ch-ref-site']).toBe(requestSignature(Number(req.headers['access-ch-ref-stamp'])));
   res.setHeader('content-type','application/json');
   if(path.endsWith('/common/get_safe_stamp')){clocks++;if(clocks===1||mode==='clock-down'){req.socket.destroy();return;}res.end(JSON.stringify({code:200,data:Date.now()}));return;}
   expect(req.headers.authorization).toBe('Bearer fixture-upload-token');
   if(path.endsWith('/userInfo/getInfo')){res.end(JSON.stringify({code:200,data:{userEmail:'upload@example.test'}}));return;}
   expect(path.endsWith('/common/upload')).toBe(true);expect(req.method).toBe('POST');uploads++;
   const parts:Buffer[]=[];for await(const part of req)parts.push(Buffer.from(part));const body=Buffer.concat(parts);
   const boundary=String(req.headers['content-type']).match(/boundary=([^;]+)/)![1];
   expect(Number(req.headers['content-length'])).toBe(body.length);expect(body.subarray(0,100).toString()).toContain('name="file"');
   expect(body.includes(photo)).toBe(true);expect(body.subarray(-boundary.length-8).toString()).toContain('--'+boundary+'--');
   if(mode==='abort'){req.socket.destroy();return;}
   if(mode==='timeout')return;
   if(mode==='upload-auth'){res.end(JSON.stringify({code:500,msg:'认证失败，无法访问系统资源'}));return;}
   timers.push(setTimeout(()=>res.end(JSON.stringify({code:200,data:'/portraits/fixture.png'})),1200));
  }catch(e){failures.push((e as Error).message);res.writeHead(500);res.end('{}');}
 });
 await new Promise<void>(resolve=>server.listen(0,'localhost',resolve));
 const origin=`https://localhost:${(server.address() as any).port}`,session={token:'fixture-upload-token',cookies:JSON.stringify(new CookieJar().serializeSync()),email:'upload@example.test',key:'fixture'};
 const client=new ChineseTestClient(session,origin,ca,{readTimeoutMs:1000,uploadTimeoutMs:2000,retryDelayMs:1});
 try{
  await client.identity();expect(clocks).toBe(2);
  const start=Date.now();expect(await client.upload(photo,'image/png')).toBe('/portraits/fixture.png');expect(Date.now()-start).toBeGreaterThan(1000);expect(uploads).toBe(1);
  mode='abort';await expect(client.upload(photo,'image/png')).rejects.toMatchObject({kind:'transient',stage:'upload'});expect(uploads).toBe(2);
  mode='timeout';await expect(client.upload(photo,'image/png')).rejects.toMatchObject({kind:'transient',stage:'upload',message:expect.stringContaining('Chưa báo tải ảnh thành công')});expect(uploads).toBe(3);
  mode='upload-auth';await expect(client.upload(photo,'image/png')).rejects.toMatchObject({code:500,kind:'api',stage:'upload',message:expect.stringContaining('yêu cầu tải ảnh')});expect(uploads).toBe(4);await client.identity();
  mode='clock-down';const before=clocks;await expect(client.upload(photo,'image/png')).rejects.toMatchObject({kind:'transient',stage:'clock',message:expect.not.stringContaining('gửi đơn')});expect(clocks-before).toBe(2);expect(uploads).toBe(4);
  expect(failures).toEqual([]);
 }finally{client.close();for(const timer of timers)clearTimeout(timer);server.closeAllConnections();await new Promise<void>(r=>server.close(()=>r()));if(old===undefined)delete process.env.CHINESETEST_FIXTURE;else process.env.CHINESETEST_FIXTURE=old;await rm(dir,{recursive:true,force:true});}
},15000);
