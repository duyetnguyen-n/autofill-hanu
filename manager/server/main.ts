import {AttentionQueue} from './attention';
import {desktopFocus} from './desktop-focus';
import { createServer, type IncomingMessage } from 'node:http';
import { randomBytes, timingSafeEqual } from 'node:crypto';
import { existsSync, readFileSync, mkdirSync, rmSync } from 'node:fs';
import { join, resolve, extname, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFile } from 'node:child_process';
import { WebSocketServer, WebSocket } from 'ws';
import { Store, digest } from './store';
import { Coordinator } from './coordinator';
import { dataDirectory, privateWrite, registerNativeHost, ensureNativeLauncher } from './platform';
import { PROTOCOL_VERSION } from '../../src/protocol';
import {exportArchive} from './archive';

function openManager(url:string){if(process.platform==='darwin')execFile('open',[url]);else if(process.platform==='win32')execFile('rundll32',['url.dll,FileProtocolHandler',url]);}

export async function serve(options:{dir?:string;port?:number;uiDir?:string;launcher?:string;open?:boolean;nativeManifestDir?:string}={}){
  const dir=options.dir??dataDirectory();mkdirSync(dir,{recursive:true,mode:0o700});
  const store=new Store(join(dir,'hanu.sqlite'));const coordinator=new Coordinator(store,new AttentionQueue(desktopFocus()));
  const uiToken=randomBytes(32).toString('hex'),bridgeToken=randomBytes(32).toString('hex');
  const webSockets=new WebSocketServer({noServer:true,maxPayload:1024*1024});const browsers=new Set<WebSocket>();
  let origin='';const cookie=`hanu=${uiToken}`;const authenticate=(req:IncomingMessage)=>req.headers.cookie?.split(';').some(c=>c.trim()===cookie)===true;
  let emergencyError='';
  const state=()=>({sessions:store.sessions(),groups:store.groups(),platform:{os:process.platform,arch:process.arch},allowedExtensionIds:allowedIds(),emergencyError});
  function failClosed(error:unknown){if(!/database or disk is full|disk I\/O error/i.test(String(error)))return;emergencyError='Không lưu được tiến độ do ổ đĩa đầy hoặc lỗi ghi. Đã dừng các phiên. Giải phóng dung lượng rồi mở lại app.';for(const ws of coordinator.peers.values())if(ws.readyState===1){ws.send(JSON.stringify({type:'EMERGENCY_STOP',error:emergencyError}));ws.close(1011,'Storage unavailable');}try{coordinator.changed();}catch{}}
  function allowedIds():string[]{try{return JSON.parse(readFileSync(join(dir,'allowed-extensions.json'),'utf8'));}catch{return [];}}
  const peerLastSeen=new Map<string,number>();
  let changeTimer:ReturnType<typeof setTimeout>|undefined;let closing=false;
  const broadcastNow=()=>{changeTimer=undefined;const event=JSON.stringify({type:'STATE',...state()});for(const ws of browsers)if(ws.readyState===1)ws.send(event);};
  coordinator.changed=()=>{if(closing||changeTimer)return;changeTimer=setTimeout(broadcastNow,100);};
  const uiDir=options.uiDir??resolve(fileURLToPath(new URL('.',import.meta.url)),'../manager-ui');
  async function body(req:IncomingMessage){let size=0;const chunks:Buffer[]=[];for await(const chunk of req){size+=chunk.length;if(size>64*1024*1024)throw new Error('Yêu cầu quá lớn.');chunks.push(chunk);}return chunks.length?JSON.parse(Buffer.concat(chunks).toString()):{};}
  const server=createServer(async(req,res)=>{
    res.setHeader('Cache-Control','no-store');res.setHeader('Referrer-Policy','no-referrer');res.setHeader('X-Content-Type-Options','nosniff');res.setHeader('Content-Security-Policy',"default-src 'self'; connect-src 'self'; img-src 'self' blob: data:; style-src 'self' 'unsafe-inline'; script-src 'self'; frame-ancestors 'none'");
    const json=(data:unknown,code=200)=>{res.statusCode=code;res.setHeader('Content-Type','application/json');res.end(JSON.stringify(data));};
    try{
      if(req.headers.host!==new URL(origin).host)return json({error:'Host không hợp lệ.'},403);
      const path=new URL(req.url??'/',origin).pathname;
      if(path.startsWith('/api/')){
        if(path==='/api/auth/config'&&req.method==='GET')return json({cloud:false});
        if(req.method!=='GET'&&req.headers.origin!==origin)return json({error:'Origin không hợp lệ.'},403);
        if(path==='/api/auth'&&req.method==='POST'){const data=await body(req);const token=Buffer.from(String(data.token??''));const expected=Buffer.from(uiToken);if(token.length!==expected.length||!timingSafeEqual(token,expected))return json({error:'Mã mở app không hợp lệ.'},401);res.setHeader('Set-Cookie',`${cookie}; HttpOnly; SameSite=Strict; Path=/`);return json({ok:true});}
        if(!authenticate(req))return json({error:'Mở lại app để đăng nhập màn hình quản lý.'},401);
        if(emergencyError&&req.method!=='GET')return json({error:emergencyError},503);
        if(path==='/api/state'&&req.method==='GET')return json(state());
        if(path==='/api/export'&&req.method==='GET'){res.setHeader('Content-Disposition','attachment; filename="hanu-local-backup.json"');return json(exportArchive(store));}
        if(path==='/api/pair'&&req.method==='POST'){const b=await body(req);if(b.extensionId){const launcher=ensureNativeLauncher(dir,fileURLToPath(new URL('./bridge.cjs',import.meta.url)),options.launcher??process.env.HANU_NATIVE_LAUNCHER);registerNativeHost(String(b.extensionId).trim(),dir,launcher,options.nativeManifestDir);}return json({code:store.pairCode(),expiresIn:300});}
        if(path==='/api/register-host'&&req.method==='POST'){const b=await body(req);const launcher=ensureNativeLauncher(dir,fileURLToPath(new URL('./bridge.cjs',import.meta.url)),options.launcher??process.env.HANU_NATIVE_LAUNCHER);const ids=registerNativeHost(String(b.extensionId).trim(),dir,launcher,options.nativeManifestDir);coordinator.changed();return json({ids});}
        if(path==='/api/start'&&req.method==='POST'){const b=await body(req);return json(await coordinator.start(b.ids,b.url,b.mode,b.finalQuestion));}
        if(path==='/api/final-question'&&req.method==='POST'){const b=await body(req);return json(await coordinator.setFinalQuestion(b.ids,b.finalQuestion,b.resume===true));}
        const group=path.match(/^\/api\/groups\/([^/]+)\/(pause|resume|stop)$/);if(group&&req.method==='POST')return json(await coordinator.groupControl(group[1],group[2].toUpperCase() as 'PAUSE'|'RESUME'|'STOP'));
        const session=path.match(/^\/api\/sessions\/([^/]+)(?:\/(.*))?$/);
        if(session){const id=session[1],action=session[2];
          if(req.method==='PATCH'&&!action)return json(await coordinator.edit(id,await body(req)));
          if(req.method==='GET'&&action==='history')return json(store.history(id));
          if(req.method==='POST'){
            if(action==='ping')return json(await coordinator.command(id,'PING',{},undefined,5000));
            if(action==='focus')return json(await coordinator.command(id,'FOCUS'));
            if(action==='scan')return json(await coordinator.command(id,'SCAN_FORM'));
            if(action==='pull')return json(await coordinator.pull(id));
            if(action==='push'){const b=await body(req);return json(await coordinator.push(id,b.force===true));}
            if(action==='use-extension'){const s=store.session(id);if(!s.conflict)throw new Error('Không có xung đột.');await coordinator.importDocument(id,s.conflict);return json(store.session(id));}
            if(['pause','resume','stop'].includes(action??''))return json(await coordinator.control(id,action!.toUpperCase() as 'PAUSE'|'RESUME'|'STOP'));
            if(action==='reconcile')return json(await coordinator.command(id,'RECONCILE',{},store.session(id).run?.runId));
            if(action==='resolve'){const b=await body(req);if(!['received','not_received'].includes(b.result))throw new Error('Kết quả xác minh không hợp lệ.');await coordinator.resolve(id,b.result);return json({ok:true});}
            if(action==='attachment'){const b=await body(req);if(typeof b.base64!=='string'||typeof b.name!=='string'||typeof b.mimeType!=='string')throw new Error('Tệp không hợp lệ.');const bytes=Buffer.from(b.base64,'base64'),attachmentId=randomBytes(16).toString('hex');store.saveAttachment(id,attachmentId,bytes,digest(bytes));const s=store.session(id);if(!s.profile)throw new Error('Đọc hồ sơ trước khi thêm ảnh.');s.profile.attachments[String(b.key??'identityDocument')]={id:attachmentId,name:b.name,type:b.mimeType,size:bytes.length,updatedAt:new Date().toISOString()};s.synced=false;store.saveSession(s);coordinator.changed();return json(s);}
          }
        }
        return json({error:'Không tìm thấy API.'},404);
      }
      if(req.method!=='GET')return json({error:'Method không hợp lệ.'},405);
      const file=resolve(uiDir,'.'+decodeURIComponent(path==='/'?'/index.html':path));if(!file.startsWith(resolve(uiDir)+sep)||!existsSync(file))return json({error:'Không tìm thấy giao diện. Chạy build:manager.'},404);
      const types:Record<string,string>={'.html':'text/html; charset=utf-8','.js':'text/javascript','.css':'text/css','.svg':'image/svg+xml','.woff2':'font/woff2'};res.setHeader('Content-Type',types[extname(file)]??'application/octet-stream');res.end(readFileSync(file));
    }catch(e){failClosed(e);json({error:emergencyError||(e as Error).message},400);}
  });
  server.on('upgrade',(req,socket,head)=>{
    const native=req.url==='/native',validHost=req.headers.host===new URL(origin).host;
    const valid=native?req.headers['x-bridge-token']===bridgeToken && !req.headers.origin : authenticate(req)&&req.headers.origin===origin&&req.url==='/events';
    if(!validHost||!valid){socket.write('HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n');socket.destroy();return;}
    webSockets.handleUpgrade(req,socket,head,ws=>{
      if(!native){browsers.add(ws);ws.on('close',()=>browsers.delete(ws));ws.send(JSON.stringify({type:'STATE',...state()}));return;}
      const caller=String(req.headers['x-extension-origin']??'');const extensionId=caller.match(/^chrome-extension:\/\/([a-p]{32})\/?$/)?.[1];if(!extensionId||!allowedIds().includes(extensionId)){ws.close(1008,'Extension chưa được đăng ký.');return;}
      if(emergencyError){ws.send(JSON.stringify({type:'EMERGENCY_STOP',error:emergencyError}));ws.close(1011,'Storage unavailable');return;}
      let id:string|undefined;const handshakeTimer=setTimeout(()=>ws.close(1008,'Handshake timeout'),10000);
      ws.on('message',async raw=>{try{const m=JSON.parse(raw.toString());if(m.protocol!==PROTOCOL_VERSION)throw new Error('Phiên bản giao thức không khớp.');
        if(!id){if(!/^[a-zA-Z0-9-]{20,80}$/.test(m.sessionId))throw new Error('Mã phiên không hợp lệ.');if(m.type==='PAIR'){const token=store.pair(m.sessionId,m.code);await coordinator.connect(m.sessionId,ws);id=String(m.sessionId);peerLastSeen.set(id,Date.now());ws.send(JSON.stringify({type:'PAIRED',token,sessionId:id}));}
          else if(m.type==='HELLO'&&store.authenticate(m.sessionId,String(m.token??''))){await coordinator.connect(m.sessionId,ws);id=String(m.sessionId);peerLastSeen.set(id,Date.now());ws.send(JSON.stringify({type:'WELCOME',sessionId:id}));}
          else{ws.send(JSON.stringify({type:'UNPAIRED'}));return;}clearTimeout(handshakeTimer);void coordinator.pull(id!).catch(e=>{failClosed(e);try{const s=store.session(id!);s.error=(e as Error).message;store.saveSession(s);coordinator.changed();}catch(storageError){failClosed(storageError);}});
        }else {peerLastSeen.set(id,Date.now());if(m.sessionId!==id)throw new Error('Mã phiên không khớp kết nối.');if(m.type==='LOAD_FAILURE')await coordinator.failure(id,m.runId);else await coordinator.receive(id,m);}
      }catch(e){failClosed(e);if(ws.readyState===1)ws.send(JSON.stringify({type:'ERROR',error:(e as Error).message}));}});
      ws.on('close',()=>{clearTimeout(handshakeTimer);peerLastSeen.delete(id??'');if(id)void coordinator.disconnect(id,ws).catch(failClosed);});
    });
  });
  await new Promise<void>(resolve=>server.listen(options.port??0,'127.0.0.1',resolve));const address=server.address() as {port:number};origin=`http://127.0.0.1:${address.port}`;
  const url=`${origin}/#token=${uiToken}`;
  privateWrite(join(dir,'connection.json'),JSON.stringify({port:address.port,bridgeToken,pid:process.pid,launchUrl:url}));
  const heartbeat=setInterval(()=>{const now=Date.now();for(const[id,ws]of coordinator.peers){const seen=peerLastSeen.get(id)??0;if(now-seen>15000)ws.terminate();}},5000);
  coordinator.launchUrl=url;
  if(options.open)openManager(url);
  return {server,store,coordinator,origin,url,uiToken,bridgeToken,async close(){closing=true;clearTimeout(changeTimer);coordinator.attention.close();clearInterval(heartbeat);await Promise.all([...webSockets.clients].map(ws=>new Promise<void>(resolve=>{ws.once('close',()=>resolve());ws.terminate();})));await new Promise<void>(resolve=>server.close(()=>resolve()));webSockets.close();await coordinator.settledConnections();store.close();try{rmSync(join(dir,'connection.json'));}catch{}}};
}
if(process.argv.includes('--serve')){
  const dir=dataDirectory();mkdirSync(dir,{recursive:true,mode:0o700});const lock=join(dir,'instance.lock');
  let existing=false;
  try{const old=JSON.parse(readFileSync(lock,'utf8'));process.kill(old.pid,0);existing=true;const descriptor=JSON.parse(readFileSync(join(dir,'connection.json'),'utf8'));if(descriptor.pid===old.pid&&/^http:\/\/127\.0\.0\.1:\d+\/#token=[a-f0-9]{64}$/.test(descriptor.launchUrl)&&!process.argv.includes('--no-open'))openManager(descriptor.launchUrl);}catch(e){if(existing)throw new Error('App đang khởi động. Chờ vài giây rồi mở lại.');}
  if(existing){console.log('Đã mở lại bộ điều phối đang chạy.');process.exit(0);}
  privateWrite(lock,JSON.stringify({pid:process.pid}));
  const app=await serve({open:!process.argv.includes('--no-open')});console.log(`HANU đang chạy tại ${app.origin}`);
  for(const signal of ['SIGINT','SIGTERM'] as const)process.on(signal,()=>void app.close().then(()=>{rmSync(lock,{force:true});process.exit();}));
}
