import {build} from 'esbuild';
import {writeFile,stat} from 'node:fs/promises';
import {resolve} from 'node:path';
const directory=resolve('releases/dist-cloud');
const version=Date.now();
await stat(resolve(directory,'manifest.json'));
await build({entryPoints:['scripts/upload-picker-diagnostic.ts'],bundle:true,format:'esm',target:'chrome116',outfile:resolve(directory,`upload-diagnostic-${version}.js`)});
await writeFile(resolve(directory,`upload-diagnostic-${version}.html`),`<!doctype html><html lang="vi"><meta charset="utf-8"><title>Chẩn đoán upload HANU</title>
<style>body{font:16px system-ui;margin:24px;max-width:1000px}button,select{font:inherit;margin:4px;padding:10px}pre{white-space:pre-wrap;overflow-wrap:anywhere;background:#f4f4f4;padding:16px}p{line-height:1.5}</style>
<h1>Chẩn đoán upload trên form mẫu</h1><p>Chỉ đọc lỗi và thử ảnh trống 1×1. Không đọc ảnh đã lưu, sửa hồ sơ, chuyển trang hay bấm Gửi.</p>
<label>Tab form mẫu <select></select></label><p><button id="inspect">Đọc trạng thái hiện tại</button><button id="halt">Dừng tự động ở tab thử</button></p>
<p>Mỗi phép thử dừng tự động, đóng rồi mở Picker qua nút của form. Chỉ thử sau khi được phép tải ảnh giả lên Google.</p><button id="legacy">Thử ảnh giả · cách chọn tệp cũ</button><button id="isolated">Thử ảnh giả · kéo thả</button><button id="main">Thử ảnh giả · MAIN</button><button id="warm">Thử ảnh giả · chờ khởi tạo 5 giây</button><button id="fixed">Thử ảnh giả · bản sửa khởi tạo</button><button id="fast">Thử ảnh giả · kiểm tra ổn định 1 giây</button><button id="fast250">Thử ảnh giả · ổn định 250 ms</button><button id="announced">Thử ảnh giả · thông báo sẵn sàng</button><pre></pre><script type="module" src="upload-diagnostic-${version}.js"></script></html>`);
console.log(`chrome-extension://dgagolkmckholihngadgfcncmdndnbhf/upload-diagnostic-${version}.html`);




