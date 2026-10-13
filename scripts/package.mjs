import {mkdir,readFile,writeFile,copyFile,cp,chmod,stat,rm,statfs} from 'node:fs/promises';
import {join,resolve} from 'node:path';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {inject} from 'postject';

const version='24.21.0',base=`https://nodejs.org/dist/v${version}`;
const appVersion=JSON.parse(await readFile('package.json','utf8')).version;
const disk=await statfs('.');const required=(process.argv.includes('--current-only')?256:1024)*1024**2;if(disk.bavail*disk.bsize<required)throw new Error('Không đủ dung lượng trống để đóng gói. Chưa tải thêm runtime.');
const sums=await (await fetch(`${base}/SHASUMS256.txt`)).text();
const architectures=[['mac-arm64','darwin-arm64','tar.gz'],['mac-x64','darwin-x64','tar.gz'],['windows-x64','win-x64','zip']];
await mkdir('releases',{recursive:true});await mkdir('.runtime',{recursive:true});
async function download(file){const target=join('.runtime',file);try{await stat(target);}catch{const response=await fetch(`${base}/${file}`);if(!response.ok)throw new Error(`Download failed: ${file}`);await writeFile(target,Buffer.from(await response.arrayBuffer()));}const bytes=await readFile(target);const expected=sums.split('\n').find(l=>l.endsWith(`  ${file}`))?.split(' ')[0];if(!expected||createHash('sha256').update(bytes).digest('hex')!==expected)throw new Error(`Checksum mismatch: ${file}`);return target;}
const seaConfig=resolve('.runtime/sea-config.json');await writeFile(seaConfig,JSON.stringify({main:resolve('build/server/bridge.cjs'),output:resolve('.runtime/bridge.blob'),disableExperimentalSEAWarning:true,useSnapshot:false,useCodeCache:false}));execFileSync(process.execPath,['--experimental-sea-config',seaConfig],{stdio:'inherit'});
for(const [name,platform,format]of architectures){
  if(process.argv.includes('--current-only')&&platform!==`${process.platform==='win32'?'win':process.platform}-${process.arch}`)continue;
  const nodeSource=join('.runtime',`node-v${version}-${platform}`,platform.startsWith('darwin')?'bin/node':'node.exe');
  try{await stat(nodeSource);}catch{const file=`node-v${version}-${platform}.${format}`,archive=await download(file),entry=`node-v${version}-${platform}/${platform.startsWith('darwin')?'bin/node':'node.exe'}`,license=`node-v${version}-${platform}/LICENSE`;if(format==='zip')execFileSync('unzip',['-qo',archive,entry,license,'-d','.runtime']);else execFileSync('tar',['-xzf',archive,'-C','.runtime',entry,license]);}
  const root=resolve('releases',`HANU-${name}`),mac=platform.startsWith('darwin'),app=mac?join(root,'HANU Coordinator.app'):root,resources=mac?join(app,'Contents/Resources'):app;
  await rm(root,{recursive:true,force:true});await rm(`${root}.zip`,{force:true});
  await mkdir(resources,{recursive:true});await cp('build',resources,{recursive:true});await cp('dist',join(resources,'extension'),{recursive:true});await cp('README.md',join(resources,'README.md'));
  await cp('TESTING.md',join(resources,'TESTING.md'));
  await mkdir(join(resources,'runtime'),{recursive:true});const nodeTarget=join(resources,'runtime',mac?'node':'node.exe');await copyFile(nodeSource,nodeTarget);
  await copyFile(join('.runtime',`node-v${version}-${platform}`,'LICENSE'),join(resources,'runtime/LICENSE'));
  await writeFile(join(root,'BUILD.json'),JSON.stringify({version:appVersion,node:version,platform,checksum:createHash('sha256').update(await readFile(nodeTarget)).digest('hex'),realMachineVerified:false},null,2));
  if(mac){await chmod(nodeTarget,0o755);const host=join(resources,'native-host');await writeFile(host,'#!/bin/sh\nSELF_DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)\nexec "$SELF_DIR/runtime/node" "$SELF_DIR/server/bridge.cjs" --bridge "$@"\n');await chmod(host,0o755);
    const launcherDir=join(app,'Contents/MacOS');await mkdir(launcherDir,{recursive:true});await writeFile(join(launcherDir,'HANU'),'#!/bin/sh\nRES=$(CDPATH= cd -- "$(dirname -- "$0")/../Resources" && pwd)\nexport HANU_NATIVE_LAUNCHER="$RES/native-host"\nexec "$RES/runtime/node" "$RES/server/main.mjs" --serve\n');await chmod(join(launcherDir,'HANU'),0o755);
    await writeFile(join(app,'Contents/Info.plist'),`<?xml version="1.0" encoding="UTF-8"?><!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd"><plist version="1.0"><dict><key>CFBundleName</key><string>HANU Coordinator</string><key>CFBundleIdentifier</key><string>vn.hanu.coordinator</string><key>CFBundleExecutable</key><string>HANU</string><key>CFBundleVersion</key><string>${appVersion}</string><key>LSMinimumSystemVersion</key><string>13.5</string><key>LSUIElement</key><true/></dict></plist>`);
    execFileSync('ditto',['-c','-k','--sequesterRsrc','--keepParent',root,`${root}.zip`]);
  }else{
    const host=join(resources,'native-host.exe');await copyFile(nodeSource,host);await inject(host,'NODE_SEA_BLOB',await readFile('.runtime/bridge.blob'),{sentinelFuse:'NODE_SEA_FUSE_fce680ab2cc467b6e072b8b5df1996b2'});
    await writeFile(join(resources,'Start HANU.cmd'),'@echo off\r\nset "HANU_NATIVE_LAUNCHER=%~dp0native-host.exe"\r\n"%~dp0runtime\\node.exe" "%~dp0server\\main.mjs" --serve\r\nif errorlevel 1 pause\r\n');
    execFileSync('zip',['-q','-r',`${root}.zip`,`.`],{cwd:root});
  }
  console.log(`Packaged ${name}`);
}
