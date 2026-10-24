import {expect,it,vi} from 'vitest';
import {synchronizeProfile} from '../../integrations/chinesetest/ui/profile-sync';
import {personal} from './support';
it('polls one job through upload and save without repeating the start request',async()=>{
 vi.useFakeTimers();
 try{
  let reads=0;const request=vi.fn(async(command:string)=>command==='start-profile-sync'?{id:'job'}:{id:'job',accountId:'a',phase:++reads===1?'uploading':'done',result:reads>1?{personal,photoVersion:'v'}:undefined});
  const update=vi.fn(),result=synchronizeProfile(request as any,{accountId:'a'},update);await vi.advanceTimersByTimeAsync(1500);
  expect((await result).personal).toEqual(personal);expect(request.mock.calls.filter(([c])=>c==='start-profile-sync')).toHaveLength(1);expect(request.mock.calls.filter(([c])=>c==='profile-sync-status')).toHaveLength(2);expect(update.mock.calls[0][0]).toContain('Đang tải ảnh');
 }finally{vi.useRealTimers();}
});
it('surfaces the upload error while leaving the retry decision to the user',async()=>{
 const request=vi.fn(async(command:string)=>command==='start-profile-sync'?{id:'job'}:{id:'job',phase:'failed',error:'ChineseTest chưa xác nhận tải ảnh.'});
 await expect(synchronizeProfile(request as any,{accountId:'a'},()=>{})).rejects.toThrow('chưa xác nhận tải ảnh');expect(request).toHaveBeenCalledTimes(2);
});
