# Giảm băng thông dashboard — 21/10/2026

Dashboard trước đây nhận toàn bộ sessions và tối đa 100 nhóm chạy trong mỗi
bản tin STATE, kể cả khi chỉ một trường tiến độ thay đổi. Mỗi tab mở thêm nhận
một bản sao. Phiên bản này gửi snapshot đầy đủ khi kết nối, sau đó chỉ gửi các
trường thay đổi bằng STATE_PATCH. Nhật ký và danh sách đang tăng được gửi phần
mới thêm; trường bị xóa được xóa ở client. Thay đổi lớn dùng lại snapshot nếu
ngắn hơn patch. Thông báo không có dữ liệu thay đổi không gửi lại.

Server tính patch một lần cho mỗi tài khoản trong mỗi lần broadcast, dùng
chung cho các tab đang có cùng revision. Dữ liệu vẫn tách theo tài khoản. Tab
mới hoặc nối lại luôn nhận snapshot đầy đủ; client kiểm tra revision, nếu
không khớp thì đóng kết nối dashboard và tự nối lại để tải đầy đủ. Patch được
áp dụng nguyên tử, không sửa trực tiếp state React cũ.

Tần suất progress giữ nguyên khoảng 100 ms. Không sửa giao thức extension,
luồng START/STOP/PAUSE/RESUME, cấp quyền trang, ghi database hay khóa Gửi.
Client không khai báo `stateStream: 1` trong AUTH vẫn nhận STATE đầy đủ, nên
tab cũ đang mở tiếp tục hoạt động. Client mới cũng đọc được STATE từ server cũ.
Không bổ sung nén WebSocket hoặc dịch vụ ngoài.

## Số đo mô phỏng

Chạy `npm run bench:state-stream`. Mỗi kịch bản gồm 100 cập nhật, 100 nhóm,
50 log ban đầu/profile, hồ sơ giả khoảng 2 KB/profile, snapshot đầu tiên và
một lần kết nối lại. Tất cả kết quả nhận được được đối chiếu với state nguồn.
Đếm byte JSON UTF-8, chưa gồm framing/TLS. Không có hồ sơ hay ảnh thật.

| Profile | Trước (byte) | Sau (byte) | Giảm | Encode p95 trên máy local |
| ---: | ---: | ---: | ---: | ---: |
| 1 | 1.905.602 | 58.431 | 96,93% | 0,32 ms |
| 5 | 4.240.763 | 104.182 | 97,54% | 0,51 ms |
| 20 | 13.100.723 | 277.952 | 97,88% | 1,77 ms |
| 100 | 60.632.723 | 1.210.032 | 98,00% | 6,83 ms |

Đây là mức giảm dữ liệu trạng thái của fixture, không phải mức giảm tổng
bandwidth Render đã xác nhận. Snapshot ban đầu, số nhóm/log, kích thước hồ sơ,
thời gian chạy và số tab quyết định mức giảm thực tế. Thời gian encode phụ thuộc
máy và tải; bảng đo khi không chạy đồng thời bộ unit test. Không cải thiện hay
đo lại phần service-initiated, truyền ảnh hoặc tốc độ Google Forms trong đợt này.

## Kiểm tra và triển khai

- `npm run typecheck`
- `npm test` — 542 test, 54 file đều pass, gồm luồng điều khiển/khóa gửi hiện có.
- `npm run build:cloud-server`
- `npm run test:state-stream-ui` — UI đã build nhận patch, kết nối lại sau mất
  mạng và sau patch sai revision, khôi phục snapshot; không có lỗi JavaScript.
- Test WebSocket thật trong fixture kiểm tra client cũ/mới, nhiều tab, tách tài
  khoản, thêm/xóa/đổi thứ tự dữ liệu, trường optional, nhật ký và không gửi lặp.

Để có hiệu lực trên website thật, deploy backend và UI cùng nhau theo
[DEPLOY-AGAIN.md](DEPLOY-AGAIN.md), sau đó tải lại trang quản lý để dùng giao
thức mới. Không cần migration, build lại hay Reload extension. Chưa deploy
production trong đợt chỉnh code này. Sau deploy cần theo dõi chênh lệch lượng
WebSocket trong Render Metrics qua một phiên test tương đương; tổng lượng
đã dùng trong tháng không giảm ngược lại.
