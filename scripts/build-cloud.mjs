import { buildCloudExtension } from './build-cloud-extension.mjs';
const outDir=process.env.HANU_CLOUD_OUT_DIR??'dist-cloud';
const extensionOnly=process.argv.includes('--extension-only');
const origin=process.env.PUBLIC_ORIGIN?.trim();
if(!origin||/YOUR_|REPLACE_|<|>/.test(origin))throw new Error('Cần PUBLIC_ORIGIN. Copy .env.cloud.example thành .env.cloud và điền tên miền.');
await buildCloudExtension(origin,outDir);
if(!extensionOnly)await import('./build-cloud-server.mjs');
console.log(`Cloud build ready: ${new URL(origin).origin} -> ${outDir}${extensionOnly?'':' + build/cloud-server + build/cloud-ui'}`);
