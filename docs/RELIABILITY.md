# Điều khiển và phục hồi lượt chạy — v1.4.0

Website và extension dùng chung Coordinator cho Bắt đầu / Tạm dừng / Tiếp tục /
Dừng / Chạy lại. Cần cập nhật backend **và Reload extension trong từng profile**.
Giữ nguyên thư mục extension, ID, token và dữ liệu đã lưu. Không cần migration.

## Hành vi

- Mỗi profile chỉ có một lượt giữ quyền thực thi. Sự kiện và lệnh gắn với mã
  lượt/trang; phản hồi cũ không được khởi động lại lượt đã dừng hoặc thay thế.
- Dừng/Tạm dừng được ưu tiên ngay cả khi lệnh Bắt đầu còn chờ tải trang.
  Giao diện phân biệt đã gửi lệnh, đã xác nhận, thất bại và chưa rõ kết quả.
- Chạy lại chờ xác nhận Dừng, kiểm tra đồng bộ/khóa gửi rồi tạo mã lượt mới.
  Bấm đúp và gửi lại cùng mã thao tác không tạo thêm lượt.
- Lỗi mạng, tài liệu lỗi 429/500/502/503/504 và lỗi chuyển trang được thử lại tối
  đa ba lần mỗi lượt, chờ khoảng 2/5/12 giây cộng độ lệch ngẫu nhiên tối đa 1,5 giây.
  Chỉ mở lại URL GET của form; không reload POST hoặc bấm lại Tiếp đang treo.
  Hết ngân sách sẽ chờ người dùng. Dừng hủy lịch phục hồi.
- CAPTCHA, sai tài khoản/quyền truy cập và form đóng chờ người dùng, không có
  vòng tự tải lại. Mất kết nối/khởi động lại server hoặc worker cũng yêu cầu
  Tiếp tục để đối chiếu trang trước khi chạy.
- Đáp án hợp lệ được sửa tay khi đang chờ được lưu riêng trong lượt hiện tại.
  Tải lại có thể quay về trang đầu; hệ thống quét lại và khôi phục đáp án theo
  mã, nhãn và loại câu hỏi. Hồ sơ gốc được giữ nguyên. File và câu xác thực cần
  kiểm tra lại, không tự lưu đáp án xác thực để vượt bước này.
- Khóa gửi được lưu trước khi xin quyền Gửi. Sau khi đã giữ khóa mà không có
  xác nhận nhận phản hồi: chuyển “Chưa rõ đã gửi”, không tự tải lại/gửi lại/
  Chạy lại. Người quản lý đối chiếu kết quả rồi xác nhận đã nhận/chưa nhận.
- Một profile lỗi tải không tự tạm dừng cả nhóm. Tài khoản, bản chụp hồ sơ,
  file, khóa gửi và tiến độ vẫn tách theo profile.

## Giới hạn

Không bảo đảm Google nhận đăng ký khi server Google hết chỗ, lỗi hoặc chặn tài
khoản. Không tự giải CAPTCHA. Không thể xác định chắc chắn Google đã nhận một
POST khi mất phản hồi nếu không có nguồn đối chiếu của chủ form. Không bảo đảm
bản nháp/upload của Google tồn tại sau reload. Form đổi cấu trúc/nhãn hoặc file
không còn truy cập được có thể cần sửa tay. Đổi lại, lượt không bị gửi lại chỉ
vì một lỗi mạng hay mất xác nhận.

## Kiểm tra trước phát hành

```sh
npm run typecheck
npm test -- --maxWorkers=2 --testTimeout=20000
npm run build:manager:assets
npm run build:cloud-server
npm run test:cloud-ui
npm run test:cloud-reliability
npm run test:cloud-controls
```

`test:cloud-reliability` dùng hai cửa sổ Chromium thật, WebSocket và PostgreSQL
PGlite cùng extension cloud. Host Google được ánh xạ tới HTTPS fixture riêng
trong các profile tạm; dữ liệu hoàn toàn tổng hợp. Không gắn debugger từ công
cụ test vào trang form khi đang chạy (tránh che lỗi cửa sổ bị khuất).

Các ca lỗi: 500→503→429; lỗi liên tục và hết ba lần thử; hủy timer bằng Dừng;
CAPTCHA giả lập; sửa tay rồi tải lại về trang đầu; Tiếp chậm 22 giây; ngắt rồi
nối lại WebSocket; Reload extension giữa lượt và đối chiếu cùng profile; Chạy lại bấm đúp/lệnh Dừng cũ; nút thật trên panel và website;
fixture nhận Gửi nhưng trả 500, không phát sinh lần Gửi thứ hai. Live chỉ chạy
trên fixture. Kết quả JSON/ảnh nằm trong `test-results/` (không đưa dữ liệu thật
vào Git). Kiểm tra form thực tế dùng Test và dừng trước Gửi/câu xác thực.
