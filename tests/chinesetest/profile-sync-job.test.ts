import {expect,it,vi} from 'vitest';
import {fixtureEngine,FakeClient,limits} from './support';
import {Engine} from '../../integrations/chinesetest/runner/engine';
import type {ChineseTestClient} from '../../integrations/chinesetest/runner/client';
it('returns a job immediately, bypasses a busy catalog queue for status, prioritizes saving and coalesces repeat clicks',async()=>{
 const f=await fixtureEngine(),id=f.data.accounts[0].view.id,version=crypto.randomUUID();let releaseCatalog!:()=>void,releaseUpload!:()=>void;
 const catalogGate=new Promise<void>(r=>releaseCatalog=r);f.shared.uploadGate=new Promise<void>(r=>releaseUpload=r);
 const original=FakeClient.prototype.call,spy=vi.spyOn(FakeClient.prototype,'call').mockImplementation(async function(this:FakeClient,path:string){if(path.includes('countryList'))await catalogGate;return original.call(this,path);});
 try{
  const catalog=f.engine.execute('catalog',{kind:'countries'},limits);const language=f.engine.execute('catalog',{kind:'languages'},limits);
  await f.engine.execute('stage-profile',{accountId:id,photoVersion:version},limits);
  const args={accountId:id,personal:f.data.accounts[0].personal,photoVersion:version,base64:'fixture',mimeType:'image/png'};
  const job=await f.engine.execute('start-profile-sync',args,limits);
  expect((await f.engine.execute('profile-sync-status',{accountId:id,id:job.id},limits)).phase).toBe('queued');
  expect((await f.engine.execute('start-profile-sync',args,limits)).id).toBe(job.id);
  await expect(f.engine.execute('start-profile-sync',{...args,personal:{...args.personal,phone:'another draft'}},limits)).rejects.toThrow('bản hồ sơ khác');
  await expect(f.engine.execute('profile-sync-status',{accountId:'another-account',id:job.id},limits)).rejects.toThrow('không còn lượt');
  releaseCatalog();await catalog;
  await expect.poll(async()=>(await f.engine.execute('profile-sync-status',{accountId:id,id:job.id},limits)).phase).toBe('uploading');
  expect(f.shared.calls.some(path=>path.includes('firstLanguageList'))).toBe(false);expect(f.shared.uploadCalls).toBe(1);
  releaseUpload();await language;
  await expect.poll(async()=>(await f.engine.execute('profile-sync-status',{accountId:id,id:job.id},limits)).phase).toBe('done');
  const result=await f.engine.execute('profile-sync-status',{accountId:id,id:job.id},limits);expect(result.result.personal.photo).toBe('/fixture/new-portrait.jpg');expect(result.result.photoVersion).toBe(version);
  const next=await f.engine.execute('start-profile-sync',args,limits);await expect.poll(async()=>(await f.engine.execute('profile-sync-status',{accountId:id,id:next.id},limits)).phase).toBe('done');expect(f.shared.uploadCalls).toBe(1);
  const restored=new Engine(structuredClone(f.data),{async write(){}},s=>new FakeClient(f.shared,s) as unknown as ChineseTestClient);
  try{await expect(restored.execute('profile-sync-status',{accountId:id,id:next.id},limits)).rejects.toThrow('khởi động lại');}finally{await restored.close();}
  expect(f.shared.submits).toHaveLength(0);
 }finally{releaseCatalog();releaseUpload();spy.mockRestore();await f.engine.close();}
});
it('preserves the pending photo and reports a failed upload without inventing registration errors',async()=>{
 const f=await fixtureEngine(),id=f.data.accounts[0].view.id,version=crypto.randomUUID();f.shared.uploadError=new Error('ChineseTest chưa xác nhận tải ảnh (quá thời gian chờ).');
 try{
  await f.engine.execute('stage-profile',{accountId:id,photoVersion:version},limits);
  const job=await f.engine.execute('start-profile-sync',{accountId:id,personal:f.data.accounts[0].personal,photoVersion:version,base64:'fixture',mimeType:'image/png'},limits);
  await expect.poll(async()=>(await f.engine.execute('profile-sync-status',{accountId:id,id:job.id},limits)).phase).toBe('failed');
  const status=await f.engine.execute('profile-sync-status',{accountId:id,id:job.id},limits);expect(status.error).toContain('tải ảnh');expect(status.error).not.toContain('gửi đơn');expect(f.data.accounts[0].syncedPhotoVersion).not.toBe(version);expect(f.shared.submits).toHaveLength(0);
 }finally{await f.engine.close();}
});
