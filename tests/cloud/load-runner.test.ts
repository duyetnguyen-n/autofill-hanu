import { expect, it } from 'vitest';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { readFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { randomBytes, randomUUID } from 'node:crypto';

const execute=promisify(execFile);
it('runs a burst with independent users, durable locks and no duplicate grants',async()=>{
  const file=`test-results/load-runner-${randomUUID()}.json`;
  await execute(process.execPath,['node_modules/tsx/dist/cli.mjs','scripts/cloud-load-test.ts','--users=2','--profiles-per-user=2','--rounds=2','--interval-ms=0','--attachment-kb=1',`--output=${file}`],
    {timeout:40000,windowsHide:true,env:{...process.env,HANU_LOAD_DATABASE_URL:''}});
  const report=JSON.parse(await readFile(file,'utf8')),result=report.scenarios[0];
  expect(report.scenarios).toHaveLength(1);expect(result.totalProfiles).toBe(4);expect(result.passed).toBe(true);
  expect(result.phases.filling.metrics.queries).toBe(0);expect(result.phases.submit.granted).toBe(4);
  expect(result.duplicateGrants).toBe(0);expect(result.isolationErrors).toBe(0);
  expect(result.durableResult).toMatchObject({completed:4,receivedLocks:4,verified:true});
},40000);

it('only probes an ordinary website and refuses to create profiles there',async()=>{
  const requests:string[]=[];
  const server=createServer((req,res)=>{requests.push(`${req.method} ${req.url}`);res.setHeader('Content-Type','application/json');res.end(JSON.stringify({ok:true}));});
  await new Promise<void>(resolve=>server.listen(0,'127.0.0.1',resolve));
  const origin=`http://127.0.0.1:${(server.address() as {port:number}).port}`,file=`test-results/load-refusal-${randomUUID()}.json`;
  try{
    await expect(execute(process.execPath,['node_modules/tsx/dist/cli.mjs','scripts/cloud-load-test.ts',`--origin=${origin}`,`--output=${file}`],
      {timeout:15000,windowsHide:true,env:{...process.env,HANU_LOAD_TEST_KEY:randomBytes(32).toString('hex')}})).rejects.toMatchObject({code:1});
    expect(requests).toEqual(['GET /__load/info']);
    const report=JSON.parse(await readFile(file,'utf8'));expect(report.scenarios[0].passed).toBe(false);
    expect(report.scenarios[0].error).toContain('No profiles were created');
  }finally{await new Promise<void>(resolve=>server.close(()=>resolve()));}
},20000);
