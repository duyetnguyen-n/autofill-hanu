import {build} from 'esbuild';
import {build as viteBuild} from 'vite';
import {copyFile,writeFile,readFile} from 'node:fs/promises';
import {execFileSync} from 'node:child_process';
import {resolve} from 'node:path';
await build({entryPoints:['manager/server/main.ts'],outfile:'build/server/main.mjs',platform:'node',target:'node24',bundle:true,format:'esm',external:['bufferutil','utf-8-validate'],banner:{js:"import { createRequire as __createRequire } from 'node:module'; const require = __createRequire(import.meta.url);"}});
await build({entryPoints:['manager/server/bridge.ts'],outfile:'build/server/bridge.cjs',platform:'node',target:'node24',bundle:true,format:'cjs',external:['bufferutil','utf-8-validate']});
if(process.platform==='win32'&&!process.argv.includes('--skip-native-exe')){
  const {inject}=await import('postject');const config=resolve('build/server/sea-config.json'),blob=resolve('build/server/bridge.blob'),exe=resolve('build/server/native-host.exe');
  await writeFile(config,JSON.stringify({main:resolve('build/server/bridge.cjs'),output:blob,disableExperimentalSEAWarning:true,useSnapshot:false,useCodeCache:false}));execFileSync(process.execPath,['--experimental-sea-config',config],{stdio:'inherit'});await copyFile(process.execPath,exe);await inject(exe,'NODE_SEA_BLOB',await readFile(blob),{sentinelFuse:'NODE_SEA_FUSE_fce680ab2cc467b6e072b8b5df1996b2'});
}
await viteBuild({configFile:'manager/vite.config.ts'});
