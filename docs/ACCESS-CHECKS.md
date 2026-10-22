# Giảm kiểm tra quyền lặp lại — 22/10/2026

Trước đây mỗi tab gọi `/api/auth/me` mỗi 30 giây, kể cả khi tab ẩn hoặc đã
đăng xuất. Bản này dùng thông báo `ACCOUNT_UPDATED` / `ACCESS_CHANGED` trên
WebSocket dashboard hiện có để yêu cầu kiểm tra ngay khi quản trị viên đổi
quyền, kèm lịch kiểm tra dự phòng:

| Trạng thái | Kiểm tra định kỳ |
| --- | --- |
| Đã đăng nhập, quyền ổn định | 5 phút/lần khi tab đang hiện |
| Đang chờ duyệt, không có kênh dashboard | 30 giây/lần khi tab đang hiện |
| Tab ẩn hoặc đã đăng xuất | Không gọi theo lịch |
| Trở lại tab sau ít nhất 30 giây kể từ lần kiểm tra thành công | Kiểm tra lại |
| API báo lỗi quyền / WebSocket báo thay đổi quyền | Kiểm tra ngay |
| Có thời điểm hết hạn quyền | Kiểm tra khi đến hạn, nếu sớm hơn lịch dự phòng |

Mỗi tab chỉ có một request kiểm tra đang chạy; focus, thông báo quyền và lịch
dự phòng dùng chung request đó. Request có thời hạn 15 giây. Lỗi mạng/xác thực
tạm thời không tháo workspace hoặc xóa lựa chọn; retry giãn từ 5 lên tối đa
60 giây, dừng retry theo lịch khi tab ẩn. Đăng xuất bỏ kết quả request cũ và
gửi thông báo giữa các tab bằng storage event, không ghi token/hồ sơ vào đó.

Trong một giờ mở tab liên tục với quyền ổn định, số lần gọi theo lịch giảm từ
120 xuống 12 (90%), chưa tính lần mở trang, thông báo quyền, đổi tab và retry.
Trang tài khoản/quản trị không có WebSocket dashboard nên dùng lịch dự phòng
và kiểm tra khi trở lại tab; không hứa cập nhật giao diện tức thì trên các trang
này. Người chờ duyệt vẫn được phát hiện quyền mới sau tối đa khoảng 30 giây
khi tab hiện và mạng bình thường.

Backend tiếp tục xác minh đăng nhập thật cho mỗi HTTP request và đọc tài khoản
qua `Accounts.identify`. Bỏ lần đọc quyền thứ hai dư thừa trong cùng API.
Các profile cùng tài khoản kiểm tra quyền đồng thời dùng chung truy vấn đang
chạy. Giữ cache quyền tối đa 2 giây và các lần kiểm tra fresh ở START/RESUME,
kết nối và vòng kiểm tra server 5 giây. Không cache cookie/token Supabase hoặc
nới điều kiện cấp quyền. Quản trị viên đổi quyền làm mất hiệu lực cả cache và
truy vấn đang chạy, tránh kết quả cũ ghi đè quyền mới. Tài khoản khác không dùng
chung kết quả. Lỗi database vẫn được trả lên cơ chế dừng an toàn hiện có.

## Kiểm tra

- `npm run typecheck`
- `npm test -- --maxWorkers=4` — giới hạn số worker để tránh các PostgreSQL WASM
  fixture cùng khởi tạo làm vượt timeout trên máy local.
- `npm run build:cloud-server`
- `npm run test:access-polling-ui` — UI đã build không gọi lại sau 30 giây,
  gọi dự phòng sau 5 phút và phản ứng ngay khi admin khóa qua WebSocket.
- `npm run test:access-ui` — duyệt/khóa, phân quyền admin/member, quota,
  pre-approval, hủy liên kết offline và giao diện account/admin.

Unit tests có tab ẩn/hiện, chờ duyệt, hết hạn, lỗi mạng/backoff, đăng xuất khi
request chưa xong, gộp 75 lần kiểm tra quyền, invalidation trong lúc đọc và
không dùng lại quyền của tài khoản khác. Các test/browser dùng dữ liệu giả.

Chỉ cần deploy backend và UI cùng nhau theo [DEPLOY-AGAIN.md](DEPLOY-AGAIN.md),
rồi tải lại trang. Không cần migration hoặc cập nhật extension. Chưa deploy
production trong đợt chỉnh code này. Lịch sử lượt chạy và refresh trang quản
trị là các luồng riêng, không nằm trong thay đổi lịch `/auth/me` này.
