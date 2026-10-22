import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { crc32, deflateRawSync } from 'node:zlib';
import { createHash } from 'node:crypto';

const templateOrigin = 'https://hanu-extension.invalid';

// A small, standard ZIP archive. Names come exclusively from our build output.
function zip(files: { name: string; bytes: Buffer }[]) {
  const local: Buffer[] = [], central: Buffer[] = []; let offset = 0;
  for (const file of files) {
    const name = Buffer.from(file.name), bytes = deflateRawSync(file.bytes), crc = crc32(file.bytes);
    const header = Buffer.alloc(30);
    header.writeUInt32LE(0x04034b50); header.writeUInt16LE(20,4); header.writeUInt16LE(0x800,6); header.writeUInt16LE(8,8);
    header.writeUInt16LE(0x21,12); header.writeUInt32LE(crc,14); header.writeUInt32LE(bytes.length,18); header.writeUInt32LE(file.bytes.length,22); header.writeUInt16LE(name.length,26);
    local.push(header,name,bytes);
    const record = Buffer.alloc(46);
    record.writeUInt32LE(0x02014b50); record.writeUInt16LE(20,4); record.writeUInt16LE(20,6); record.writeUInt16LE(0x800,8); record.writeUInt16LE(8,10);
    record.writeUInt16LE(0x21,14); record.writeUInt32LE(crc,16); record.writeUInt32LE(bytes.length,20); record.writeUInt32LE(file.bytes.length,24); record.writeUInt16LE(name.length,28); record.writeUInt32LE(offset,42);
    central.push(record,name); offset += header.length+name.length+bytes.length;
  }
  const directory = Buffer.concat(central), end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50); end.writeUInt16LE(files.length,8); end.writeUInt16LE(files.length,10); end.writeUInt32LE(directory.length,12); end.writeUInt32LE(offset,16);
  return Buffer.concat([...local,directory,end]);
}

export async function extensionArchive(directory: string, origin: string) {
  const url = new URL(origin);
  if (url.origin !== origin || url.protocol !== 'https:' && !(url.protocol === 'http:' && ['127.0.0.1','localhost'].includes(url.hostname))) throw new Error('Website extension không hợp lệ.');
  const files: {name:string;bytes:Buffer}[] = [];
  async function walk(path: string, prefix='') {
    for (const entry of await readdir(path,{withFileTypes:true})) {
      const name = prefix+entry.name;
      if (entry.isDirectory()) await walk(join(path,entry.name),name+'/');
      else if (entry.isFile()) {
        let bytes = await readFile(join(path,entry.name));
        if (/\.(js|json|txt|html|css)$/.test(name)) bytes = Buffer.from(bytes.toString().replaceAll(templateOrigin,()=>origin).replaceAll(templateOrigin.replace('https:','wss:'),()=>origin.replace(/^http/,'ws')));
        files.push({name,bytes});
      }
    }
  }
  await walk(directory);
  const manifest = JSON.parse(files.find(f=>f.name==='manifest.json')!.bytes.toString());
  if (manifest.permissions.includes('nativeMessaging') || !manifest.host_permissions.includes(origin+'/*')) throw new Error('Gói extension chưa được cấu hình đúng website.');
  const info = files.find(f=>f.name==='build-info.json')!, data = JSON.parse(info.bytes.toString());
  if (data.origin !== origin) throw new Error('Gói extension không khớp website.');
  data.development = url.protocol === 'http:';
  for (const name of Object.keys(data.hashes)) data.hashes[name] = createHash('sha256').update(files.find(f=>f.name===name)!.bytes).digest('hex');
  info.bytes = Buffer.from(JSON.stringify(data,null,2)+'\n');
  return zip(files);
}
