import type {SessionView} from '../../src/protocol';
import type {RegistrationSchedule} from '../../src/registration-schedule';

export function facebookProfileLabel(s:SessionView){
  const access=s.facebookAccess;
  const state=!s.connected?'chưa kết nối':access?.permission==='missing'?'chưa cấp quyền':access?.reader==='error'?'lỗi bộ đọc':access?.permission==='granted'&&access.reader==='ready'?'đã có quyền · bộ đọc sẵn sàng':'chưa xác nhận quyền · cập nhật extension';
  return `${s.name} · …${s.id.slice(-8)} · ${state}`;
}
export function facebookMonitorTone(s:RegistrationSchedule):'warning'|'error'|'success'{
  const error=s.lastError??s.watcher?.error;
  if(error)return /chưa.*(quyền|kết nối)|cho phép theo dõi|cấp quyền|mở chrome profile|đang (tải|chờ)|chờ (đọc|nội dung)|đăng nhập|chưa mở hết nội dung|chưa (tìm|thấy)|không có.*link/i.test(error)?'warning':'error';
  if(s.dateWarning)return 'warning';
  return s.linksCaptured?'success':'warning';
}
