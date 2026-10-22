import {build} from 'esbuild';
import {build as viteBuild} from 'vite';
import {buildCloudExtension} from './build-cloud-extension.mjs';
// Bind the download to this server's validated origin when it is requested.
await buildCloudExtension('https://hanu-extension.invalid','build/cloud-extension');
process.env.HANU_CLOUD_BUILD='1';
await build({entryPoints:['manager/cloud/main.ts'],outfile:'build/cloud-server/main.mjs',platform:'node',target:'node24',bundle:true,format:'esm',packages:'external'});
await viteBuild({configFile:'manager/vite.config.ts'});

// Documentation only; runner archives are produced by package:hcmue after this build.
const {cp}=await import('node:fs/promises');
await cp('docs/hcmue','build/cloud-ui/hcmue-downloads',{recursive:true});
await cp('docs/chinesetest','build/cloud-ui/chinesetest-downloads',{recursive:true});
await cp('docs/forms','build/cloud-ui/extension-downloads',{recursive:true});
for(const file of ['guide.css','guide.js'])await cp(`docs/chinesetest/${file}`,`build/cloud-ui/extension-downloads/${file}`);
