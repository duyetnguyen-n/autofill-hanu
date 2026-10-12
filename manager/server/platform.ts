import { mkdirSync, writeFileSync, readFileSync, existsSync, chmodSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';
import { execFileSync } from 'node:child_process';
import { NATIVE_HOST } from '../../src/protocol';
export function dataDirectory() {return process.env.HANU_DATA_DIR || join(homedir(),process.platform==='win32'?'AppData/Local/HanuCoordinator':'Library/Application Support/HanuCoordinator');}
export function privateWrite(path:string,data:string){mkdirSync(resolve(path,'..'),{recursive:true,mode:0o700});writeFileSync(path,data,{mode:0o600});if(process.platform!=='win32')chmodSync(path,0o600);}
export function ensureNativeLauncher(dir:string,bridgeFile:string,bundledLauncher?:string){
  if(bundledLauncher&&existsSync(bundledLauncher))return bundledLauncher;
  if(process.platform==='win32'){const exe=join(resolve(bridgeFile,'..'),'native-host.exe');if(existsSync(exe))return exe;throw new Error('Cầu nối Windows chưa được build. Chạy npm run build:manager hoặc mở gói Windows đã đóng gói.');}
  if(!existsSync(bridgeFile))throw new Error('Không tìm thấy cầu nối. Chạy npm run build:manager.');
  const quote=(value:string)=>`'${value.replaceAll("'","'\\''")}'`;
  const launcher=join(dir,'native-host');privateWrite(launcher,`#!/bin/sh\nexport HANU_DATA_DIR=${quote(dir)}\nexec ${quote(process.execPath)} ${quote(resolve(bridgeFile))} --bridge "$@"\n`);chmodSync(launcher,0o700);return launcher;
}
export function registerNativeHost(extensionId:string,dir:string,launcher:string,manifestDirectory?:string){
  if(!/^[a-p]{32}$/.test(extensionId))throw new Error('ID extension phải có 32 ký tự a-p.');
  if(!existsSync(launcher))throw new Error('Không tìm thấy chương trình cầu nối.');
  const configPath=join(dir,'allowed-extensions.json');const ids:string[]=existsSync(configPath)?JSON.parse(readFileSync(configPath,'utf8')):[];if(!ids.includes(extensionId))ids.push(extensionId);
  const path=manifestDirectory?join(manifestDirectory,`${NATIVE_HOST}.json`):process.platform==='win32'?join(dir,`${NATIVE_HOST}.json`):join(homedir(),'Library/Application Support/Google/Chrome/NativeMessagingHosts',`${NATIVE_HOST}.json`);
  privateWrite(path,JSON.stringify({name:NATIVE_HOST,description:'HANU profile coordinator',path:resolve(launcher),type:'stdio',allowed_origins:ids.map(id=>`chrome-extension://${id}/`)},null,2));
  if(process.platform==='win32'&&!manifestDirectory)execFileSync('reg',['ADD',`HKCU\\Software\\Google\\Chrome\\NativeMessagingHosts\\${NATIVE_HOST}`,'/ve','/t','REG_SZ','/d',path,'/f'],{windowsHide:true});
  privateWrite(configPath,JSON.stringify(ids));return ids;
}
