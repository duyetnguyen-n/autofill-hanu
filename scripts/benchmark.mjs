import {spawn} from 'node:child_process';
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {cpus,totalmem,platform,arch,release} from 'node:os';
const sizes=(process.argv.find(a=>a.startsWith('--sizes='))?.split('=')[1]??'2,5,24').split(',').map(Number);
const reports=[];
for(const count of sizes){
  if(![2,5,24].includes(count))throw new Error('Chọn 2, 5 hoặc 24 phiên.');
  await new Promise((resolve,reject)=>{const child=spawn(process.execPath,['scripts/browser-check.mjs',`--profiles=${count}`,'--test-only'],{stdio:'inherit'});child.on('error',reject);child.on('exit',code=>code===0?resolve():reject(new Error(`Fixture ${count} thất bại: ${code}`)));});
  reports.push(JSON.parse(await readFile(`test-results/browser-${count}.json`,'utf8')));
}
await mkdir('test-results',{recursive:true});
await writeFile('test-results/benchmark.json',JSON.stringify({hardware:{platform:platform(),arch:arch(),osRelease:release(),cpu:cpus()[0]?.model,cpuCount:cpus().length,ramGb:Math.round(totalmem()/1024**3)},scope:'Synthetic local fixture; one isolated Chrome process per profile; not a speed guarantee for Google Forms or Windows',reports},null,2));
console.log('Wrote test-results/benchmark.json');
