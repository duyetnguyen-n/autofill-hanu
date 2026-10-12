import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { basename } from 'node:path';
import { WebSocket } from 'ws';
import { dataDirectory } from './platform';

// stdout is reserved exclusively for Chrome's length-prefixed binary protocol.
export function nativeFrame(value:unknown):Buffer {const bytes=Buffer.from(JSON.stringify(value));if(bytes.length>1024*1024)throw new Error('Native message exceeds 1 MiB.');const length=Buffer.alloc(4);length.writeUInt32LE(bytes.length);return Buffer.concat([length,bytes]);}
export class NativeDecoder {
  buffer=Buffer.alloc(0);
  feed(chunk:Buffer):unknown[]{this.buffer=Buffer.concat([this.buffer,chunk]);const messages:unknown[]=[];while(this.buffer.length>=4){const length=this.buffer.readUInt32LE(0);if(length>1024*1024)throw new Error('Invalid native frame length.');if(this.buffer.length<4+length)break;messages.push(JSON.parse(this.buffer.subarray(4,4+length).toString('utf8')));this.buffer=this.buffer.subarray(4+length);}return messages;}
}
if(process.argv.includes('--bridge')||basename(process.execPath).startsWith('native-host')){
  try{
    const caller=process.argv.find(arg=>/^chrome-extension:\/\/[a-p]{32}\/?$/.test(arg));if(!caller)throw new Error('Missing Chrome caller origin.');
    const descriptor=JSON.parse(readFileSync(join(dataDirectory(),'connection.json'),'utf8'));
    const ws=new WebSocket(`ws://127.0.0.1:${descriptor.port}/native`,{headers:{'x-bridge-token':descriptor.bridgeToken,'x-extension-origin':caller},maxPayload:1024*1024});
    const decoder=new NativeDecoder();const pending:unknown[]=[];
    process.stdin.on('data',chunk=>{try{for(const message of decoder.feed(Buffer.from(chunk))){if(ws.readyState===WebSocket.OPEN)ws.send(JSON.stringify(message));else {if(pending.length>=20)throw new Error('Bridge queue full.');pending.push(message);}}}catch(e){process.stderr.write(String(e));ws.close();process.exitCode=1;process.stdin.destroy();}});
    ws.on('open',()=>{for(const message of pending)ws.send(JSON.stringify(message));pending.length=0;});
    ws.on('message',raw=>{try{process.stdout.write(nativeFrame(JSON.parse(raw.toString())));}catch{ws.close();}});
    ws.on('close',()=>process.exit());ws.on('error',e=>{process.stderr.write(`HANU bridge: ${e.message}\n`);process.exit(1);});
    process.stdin.on('end',()=>ws.close());
  }catch(e){process.stderr.write(`HANU bridge: ${(e as Error).message}\n`);process.exit(1);}
}
