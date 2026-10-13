import {existsSync,mkdirSync,writeFileSync,readFileSync} from 'node:fs';
import {join,resolve} from 'node:path';
import {createHash} from 'node:crypto';
import {spawn,execFileSync} from 'node:child_process';
const version='24.21.0',platform=`${process.platform==='win32'?'win':process.platform}-${process.arch}`,root=resolve('.runtime'),directory=join(root,`node-v${version}-${platform}`),binary=join(directory,process.platform==='win32'?'node.exe':'bin/node');
if(!existsSync(binary)){
  mkdirSync(root,{recursive:true});const suffix=process.platform==='win32'?'zip':'tar.gz',name=`node-v${version}-${platform}.${suffix}`,base=`https://nodejs.org/dist/v${version}`;
  const sums=await(await fetch(`${base}/SHASUMS256.txt`)).text();const bytes=Buffer.from(await(await fetch(`${base}/${name}`)).arrayBuffer());const hash=sums.split('\n').find(l=>l.endsWith(`  ${name}`))?.split(' ')[0];if(createHash('sha256').update(bytes).digest('hex')!==hash)throw new Error('Runtime checksum mismatch.');const archive=join(root,name);writeFileSync(archive,bytes);
  if(process.platform==='win32')execFileSync('powershell',['-NoProfile','-Command',`Expand-Archive -LiteralPath '${archive.replaceAll("'","''")}' -DestinationPath '${root.replaceAll("'","''")}' -Force`]);else execFileSync('tar',['-xzf',archive,'-C',root]);
}
const child=spawn(binary,process.argv.slice(2),{stdio:'inherit',env:process.env});for(const signal of ['SIGINT','SIGTERM'])process.on(signal,()=>child.kill(signal));child.on('exit',code=>process.exit(code??1));
