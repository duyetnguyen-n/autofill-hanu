import {expect,it} from 'vitest';
import {facebookMonitorTone,facebookProfileLabel} from '../manager/ui/facebook-monitor';
import type {RegistrationSchedule} from '../src/registration-schedule';
it('never renders missing permission, waiting content or an actual failure as green',()=>{
  const tone=(extra:Partial<RegistrationSchedule>)=>facebookMonitorTone(extra as RegistrationSchedule);
  expect(tone({lastError:'Chưa mở hết nội dung bài. Đã thử mở tự động.'})).toBe('warning');
  expect(tone({lastError:'Đang chờ Facebook mở hết nội dung bài'})).toBe('warning');
  expect(tone({})).toBe('warning');expect(tone({lastError:'ND: Mở extension ở một profile → Cho phép theo dõi Facebook.'})).toBe('warning');
  expect(tone({lastError:'Có nhiều bài viết; không xác định được đúng bài.'})).toBe('error');
  expect(tone({linksCaptured:true})).toBe('success');expect(tone({linksCaptured:true,lastError:'Sai ngày đăng ký'})).toBe('error');
});
it('shows the exact profile suffix and distinguishes connection, grant and reader health',()=>{
  expect(facebookProfileLabel({id:'test-12345678',name:'ND',connected:true,facebookAccess:{permission:'granted',reader:'ready'}} as any)).toContain('ND · …12345678 · đã có quyền');
});
