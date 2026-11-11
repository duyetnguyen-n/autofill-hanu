import {build} from 'esbuild';
import {build as viteBuild} from 'vite';
import {buildCloudExtension} from './build-cloud-extension.mjs';
import hcmueKnowledge from '../integrations/hcmue/knowledge/guides.json' with {type:'json'};
// Bind the download to this server's validated origin when it is requested.
await buildCloudExtension('https://hanu-extension.invalid','build/cloud-extension');
process.env.HANU_CLOUD_BUILD='1';
await build({entryPoints:['manager/cloud/main.ts'],outfile:'build/cloud-server/main.mjs',platform:'node',target:'node24',bundle:true,format:'esm',packages:'external'});
await viteBuild({configFile:'manager/vite.config.ts'});

// Documentation only; runner archives are produced by package:hcmue after this build.
const {cp,writeFile}=await import('node:fs/promises');
await cp('docs/hcmue','build/cloud-ui/hcmue-downloads',{recursive:true});
const escapeHtml = value => value.replace(/[&<>"]/g, char => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[char]));
const guides = hcmueKnowledge.guides.map(guide => `
<section id="${escapeHtml(guide.id)}">
  <h2>${escapeHtml(guide.title)}</h2>
  <ol>${guide.steps.map(step => `<li>${escapeHtml(step)}</li>`).join('')}</ol>
</section>`).join('\n');
await writeFile('build/cloud-ui/hcmue-downloads/knowledge.html', `<!doctype html>
<html lang="vi">
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Hướng dẫn HCMUE</title>
<style>body{max-width:720px;margin:32px auto;padding:0 20px;font:16px/1.65 system-ui;color:#19312a}section{padding-block:12px;border-top:1px solid #dce5df;scroll-margin-top:16px}li+li{margin-top:4px}a{color:#216951}</style>
<main><a href="/hcmue">Quay lại HCMUE</a><h1>Hướng dẫn HCMUE</h1>${guides}</main>
</html>\n`);
await cp('docs/chinesetest','build/cloud-ui/chinesetest-downloads',{recursive:true});
await cp('docs/forms','build/cloud-ui/extension-downloads',{recursive:true});
for(const file of ['guide.css','guide.js'])await cp(`docs/chinesetest/${file}`,`build/cloud-ui/extension-downloads/${file}`);
