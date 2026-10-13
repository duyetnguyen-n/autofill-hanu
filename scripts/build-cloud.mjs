import {build as viteBuild} from 'vite';
import {readFile,writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';

const extensionOnly=process.argv.includes('--extension-only');
const origin=process.env.PUBLIC_ORIGIN?.trim();
if(!origin||/YOUR_|REPLACE_|<|>/.test(origin))throw new Error('Cần PUBLIC_ORIGIN. Copy .env.cloud.example thành .env.cloud và điền tên miền.');
const url=new URL(origin);
if(url.pathname!=='/'||url.search||url.hash||url.username||url.password||url.protocol!=='https:'&&!(process.env.HANU_CLOUD_DEV==='1'&&url.protocol==='http:'&&['localhost','127.0.0.1'].includes(url.hostname)))throw new Error('PUBLIC_ORIGIN phải là HTTPS origin (localhost HTTP chỉ dùng cho dev).');
process.env.HANU_CLOUD_ORIGIN=url.origin;
process.env.HANU_CLOUD_BUILD='1';
for(const mode of ['panel','background','content'])await viteBuild({configFile:'vite.config.ts',mode});
const manifest=JSON.parse(await readFile('public/manifest.json','utf8'));
manifest.name='HSK Google Forms Autofill · Online';
manifest.description='Điền Google Forms HSK và liên kết với trang quản lý cá nhân.';
manifest.minimum_chrome_version='116';
manifest.permissions=manifest.permissions.filter(p=>p!=='nativeMessaging');
manifest.permissions.push('alarms');
manifest.host_permissions.push(`${url.origin}/*`);
const wsOrigin=url.origin.replace(/^http/,'ws');
manifest.content_security_policy={extension_pages:`script-src 'self'; object-src 'self'; connect-src 'self' ${url.origin} ${wsOrigin}`};
await writeFile('dist-cloud/manifest.json',JSON.stringify(manifest,null,2)+'\n');
const files=['background.js','content.js','manifest.json'];
const hashes={};for(const file of files)hashes[file]=createHash('sha256').update(await readFile(`dist-cloud/${file}`)).digest('hex');
await writeFile('dist-cloud/build-info.json',JSON.stringify({origin:url.origin,development:process.env.HANU_CLOUD_DEV==='1',protocol:1,builtAt:new Date().toISOString(),hashes},null,2)+'\n');
await writeFile('dist-cloud/README.txt',`HSK Autofill Online\nWebsite: ${url.origin}\n\n1. Chrome: chrome://extensions -> Developer mode -> Load unpacked -> chọn thư mục này.\n2. Đăng nhập Google trên website, bấm Thêm profile và lấy mã.\n3. Mở extension trong đúng Chrome profile, nhập mã liên kết.\n\nChrome 116 trở lên. Không cần cài app local hoặc Native Messaging host.\nBản local và bản online không nên cùng điều khiển một Chrome profile.\n`);
if(!extensionOnly){
  await import('./build-cloud-server.mjs');
}
console.log(`Cloud build ready: ${url.origin} -> dist-cloud${extensionOnly?'':' + build/cloud-server + build/cloud-ui'}`);
