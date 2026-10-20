import {build as viteBuild} from 'vite';
import {readFile,writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';

const outDir=process.env.HANU_CLOUD_OUT_DIR??'dist-cloud';
const extensionOnly=process.argv.includes('--extension-only');
const origin=process.env.PUBLIC_ORIGIN?.trim();
if(!origin||/YOUR_|REPLACE_|<|>/.test(origin))throw new Error('Cần PUBLIC_ORIGIN. Copy .env.cloud.example thành .env.cloud và điền tên miền.');
const url=new URL(origin);
if(url.pathname!=='/'||url.search||url.hash||url.username||url.password||url.protocol!=='https:'&&!(process.env.HANU_CLOUD_DEV==='1'&&url.protocol==='http:'&&['localhost','127.0.0.1'].includes(url.hostname)))throw new Error('PUBLIC_ORIGIN phải là HTTPS origin (localhost HTTP chỉ dùng cho dev).');
process.env.HANU_CLOUD_ORIGIN=url.origin;
process.env.HANU_CLOUD_BUILD='1';
for(const mode of ['panel','background','content','facebook-content'])await viteBuild({configFile:'vite.config.ts',mode});
const manifest=JSON.parse(await readFile('public/manifest.json','utf8'));
manifest.name='HSK Google Forms Autofill · Online';
manifest.description='Điền Google Forms HSK và liên kết với trang quản lý cá nhân.';
manifest.minimum_chrome_version='116';
manifest.permissions=manifest.permissions.filter(p=>p!=='nativeMessaging');
manifest.permissions.push('alarms');
manifest.host_permissions.push(`${url.origin}/*`);
const wsOrigin=url.origin.replace(/^http/,'ws');
manifest.content_security_policy={extension_pages:`script-src 'self'; object-src 'self'; connect-src 'self' ${url.origin} ${wsOrigin}`};
await writeFile(`${outDir}/manifest.json`,JSON.stringify(manifest,null,2)+'\n');
const files=['background.js','content.js','facebook-content.js','manifest.json'];
const hashes={};for(const file of files)hashes[file]=createHash('sha256').update(await readFile(`${outDir}/${file}`)).digest('hex');
await writeFile(`${outDir}/build-info.json`,JSON.stringify({origin:url.origin,development:process.env.HANU_CLOUD_DEV==='1',protocol:1,accessPolicy:1,builtAt:new Date().toISOString(),hashes},null,2)+'\n');
await writeFile(`${outDir}/README.txt`,`HSK Autofill Online\nWebsite: ${url.origin}\n\n1. Chrome: chrome://extensions -> Developer mode -> Load unpacked -> chọn thư mục này.\n2. Đăng nhập Google trên website, bấm Thêm profile và lấy mã.\n3. Mở HSK Google Forms Autofill · Online trong đúng Chrome profile, nhập mã liên kết.\n\nKhông cần sao chép ID extension vào website. Mỗi profile dùng một mã riêng, hiệu lực 5 phút.\nChrome 116 trở lên. Không cần cài app local hoặc Native Messaging host.\nTắt bản local khi dùng Online trong cùng profile; giữ bản local nếu còn dữ liệu cũ.\nDữ liệu local không tự chuyển sang Online: xuất từ app local và nhập bằng nút Nhập từ bản local trên website.\nSau reload, chờ extension tự nối lại với mã phiên đã lưu; không xóa dữ liệu hoặc nhập mã mới chỉ vì mất kết nối tạm thời.\n`);
if(!extensionOnly){
  await import('./build-cloud-server.mjs');
}
console.log(`Cloud build ready: ${url.origin} -> ${outDir}${extensionOnly?'':' + build/cloud-server + build/cloud-ui'}`);
