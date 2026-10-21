import {build} from 'esbuild';
import {build as viteBuild} from 'vite';
process.env.HANU_CLOUD_BUILD='1';
await build({entryPoints:['manager/cloud/main.ts'],outfile:'build/cloud-server/main.mjs',platform:'node',target:'node24',bundle:true,format:'esm',packages:'external'});
await viteBuild({configFile:'manager/vite.config.ts'});

// Documentation only; runner archives are produced by package:hcmue after this build.
const {cp}=await import('node:fs/promises');
await cp('docs/hcmue','build/cloud-ui/hcmue-downloads',{recursive:true});
