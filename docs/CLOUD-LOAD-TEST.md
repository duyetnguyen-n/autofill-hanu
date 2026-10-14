# Kiểm thử tải đồng loạt

Lệnh mặc định mô phỏng **10 người × 5 profile**, rồi **10 người × 10 profile**.
Mỗi kịch bản có server và database thử nghiệm mới, dùng tiến trình Node riêng
cho backend. Không đọc `.env.cloud`, không truy cập website production, không
mở hoặc gửi Google Forms. Các thay đổi của bài test chỉ ở server/database giả.

```sh
npm run test:cloud-load
```

Trên PowerShell dùng `npm.cmd` nếu cần truyền tham số sau `--`, để tránh wrapper
`npm.ps1` bỏ các tham số dài:

```powershell
npm.cmd run test:cloud-load -- --users=10 --profiles-per-user=10
```

Mỗi người có một dashboard WebSocket và các extension giả lập. Các profile
được liên kết, đồng bộ một tệp giả 64 KiB, rồi cả 10 người cùng bấm START qua API.
Sau 12 đợt tiến độ/chuyển trang, **mọi profile cùng xin quyền Gửi**, với timeout
5 giây giống extension thật. Tiếp đó mỗi profile thử xin quyền lần thứ hai:
server phải từ chối. Cuối bài test kiểm tra kết quả, lịch sử và khóa đã lưu
trong PostgreSQL, đồng thời kiểm tra dữ liệu giữa các tài khoản được tách riêng.

Kết quả: `test-results/cloud-load-report.json`. `p95` nghĩa là 95% yêu cầu hoàn
thành trong thời gian đó. Xem riêng các mục START, quyền xử lý trang, quyền Gửi,
timeout, quyền gửi trùng, CPU, RAM, event-loop delay và thời gian chờ kết nối DB.
Exit code khác 0 nếu bài test có lỗi hoặc không cấp đủ quyền trong hạn 5 giây.

## Kiểm thử với giới hạn giống cấu hình Free

Cần Docker Desktop/Engine hoạt động. Bài test tạo project Compose tên ngẫu
nhiên, PostgreSQL riêng có 10 kết nối trong pool và backend giới hạn **0,1 CPU /
512 MiB RAM**, không swap. Database không có cổng public và dữ liệu nằm trên
tmpfs; các container của project thử nghiệm được dừng/xóa khi bài test kết thúc.
Ứng dụng production và Dockerfile deploy production không thay đổi.

```powershell
npm.cmd run test:cloud-load -- --constrained --profiles-per-user=10 --output=test-results/cloud-load-free.json
```

Để đo tác động của mạng tới DB, có thể **thêm độ trễ giả lập** 25 ms vào mỗi
truy vấn. Con số này không được suy ra từ nút Kiểm tra kết nối 300–500 ms:

```powershell
npm.cmd run test:cloud-load -- --constrained --profiles-per-user=10 --db-delay-ms=25 --output=test-results/cloud-load-free-db25.json
```

So sánh với backend 1 CPU, vẫn cùng database và cùng độ trễ giả lập:

```powershell
npm.cmd run test:cloud-load -- --constrained --cpus=1 --profiles-per-user=10 --db-delay-ms=25 --output=test-results/cloud-load-cpu1-db25.json
```

Docker giới hạn tài nguyên bằng CPU quota và memory limit. Đây là mô phỏng cấu
hình phần cứng, chưa thay thế số đo trên Render. [Tài liệu giới hạn Docker](https://docs.docker.com/engine/containers/resource_constraints/)

## Chạy từ máy cá nhân tới một backend staging

Tạo **dịch vụ thử nghiệm riêng**, dùng `deploy/load/Dockerfile`. Không thay
Dockerfile, biến môi trường hoặc backend của website đang sử dụng.

Server này dùng auth giả dành cho bài test, được bảo vệ bằng khóa ngẫu nhiên
`HANU_LOAD_TEST_KEY` (64 ký tự hex). Trên staging cần:

- `HOST=0.0.0.0`, `HANU_LOAD_USERS=10`, `HANU_LOAD_TEST_KEY=...`.
- `HANU_LOAD_ORIGIN=https://URL_STAGING`; trên Render có thể tự lấy
  `RENDER_EXTERNAL_URL`.
- `HANU_LOAD_DATABASE_URL` trỏ tới **PostgreSQL trống riêng tên `hanu_load_test`**.
  Server từ chối database có tên khác hoặc đã có bảng ứng dụng. Không dùng
  `DATABASE_URL`, project Supabase production, hoặc database chứa dữ liệu thật.
- `HANU_LOAD_DB_CA` nếu PostgreSQL remote cần CA riêng; TLS remote vẫn xác minh.

Chạy một kịch bản trên server staging mới. Giữ khóa trong biến môi trường,
không ghi vào Git hoặc chia sẻ report có cấu hình credentials:

```powershell
# Đặt HANU_LOAD_TEST_KEY trên máy chạy test giống khóa của staging.
npm.cmd run test:cloud-load -- --origin=https://URL_STAGING --profiles-per-user=10 --output=test-results/cloud-load-staging.json
```

Client kiểm tra endpoint nhận diện fixture trước khi tạo profile; nếu trỏ nhầm
website bình thường, nó chỉ thực hiện một GET và dừng. Không có endpoint load
test trong backend production. PostgreSQL staging giữ dữ liệu giả để kiểm tra;
dùng database trống mới nếu chạy lại, không tự động xóa dữ liệu cũ.

## Diễn giải kết quả

- Mặc định dùng **PGlite trong tiến trình backend**, chỉ có một kết nối. CPU/RAM
  bao gồm cả database WASM, không thể coi đó là nhu cầu tài nguyên của backend
  production có Supabase riêng.
- Extension là client giao thức giả lập: kiểm tra backend, không đo tốc độ
  Chrome/Google Forms, mạng của 10 người thật hay khả năng upload của Google.
- Auth và object storage giả không đo độ trễ Supabase Auth/Storage thật. Tệp và
  tài khoản được chuẩn bị trước đợt chạy đồng loạt.
- Chưa đủ căn cứ kết luận Render Free chịu được 100 profile nếu chỉ chạy local
  không giới hạn CPU/RAM. Ưu tiên kết quả staging cùng cấu hình, rồi nghiệm thu
  bằng một nhóm người với hồ sơ/form thử.
- Tiêu chí bắt buộc: đủ quyền Gửi trong hạn 5 giây, không lỗi quyền xử lý trang,
  không cấp quyền Gửi trùng, không lộ dữ liệu giữa tài khoản, khóa/kết quả/lịch sử
  lưu đủ. Ngoài ra, thời gian chờ p95/p99 phải phù hợp với yêu cầu đăng ký.

## Số đo đầu tiên, 14/10/2026

Local chưa giới hạn tài nguyên, PGlite, mạng localhost:

| Profile | START p95 | Quyền trang p95 | Quyền Gửi p95 | Timeout / quyền trùng |
| --- | ---: | ---: | ---: | ---: |
| 50 (10 × 5) | 164 ms | 2,35 ms | 202 ms | 0 / 0 |
| 100 (10 × 10) | 258 ms | 6,66 ms | 447 ms | 0 / 0 |

Cả hai lượt đều có 0 truy vấn trong pha điền; đủ khóa/kết quả được lưu và không
lộ dữ liệu giữa các tài khoản. Đây là số đo chức năng/tải local, **không phải
chứng nhận cấu hình Render Free**.
