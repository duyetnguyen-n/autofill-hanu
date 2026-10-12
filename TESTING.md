# Kiểm thử HANU Coordinator 1.3.1 (2026-10-12)

## Kết quả đã xác minh

- `npm run typecheck`, `npm test`, `npm run build`: qua. 81 ca trong 15 file.
- Thử trực tiếp trên Chrome đang dùng: liên kết profile Duyệt, giữ ID extension cũ, đọc hồ sơ/ảnh, ping phản hồi, chọn đúng cửa sổ, reload extension và kết nối lại app. Kiểm tra SQLite toàn vẹn và SHA-256 ảnh khớp. Không điền hoặc gửi hồ sơ thật trong lần kiểm tra này.
- Native Messaging chạy thật trên 2 và 5 Chrome for Testing riêng. Mỗi profile dùng hồ sơ giả và PNG 672.673 byte. Kiểm tra đúng tên, giấy tờ, ảnh; câu hỏi đảo thứ tự; cửa sổ form được mở nền.
- Fixture Test tới trang cuối, mỗi phiên upload đúng một tệp và không gửi. Replay cùng START hai lần không mở tab hay chạy lại.
- Fixture Live hai phiên: một có xác nhận, một server nhận nhưng trang không xác nhận. Server nhận mỗi phiên đúng một lần; Resume và khởi động lại app không gửi thêm.
- Giao diện sáng/tối và 390 px được chụp kiểm tra, không lỗi JS, không tràn ngang toàn trang. Nút Kiểm tra kết nối có thông báo phản hồi trong ngăn hồ sơ.
- Mô phỏng lỗi ổ đĩa trong kiểm thử: app chặn lượt mới và extension dừng, không cấp quyền gửi khi coordinator không lưu được trạng thái.

## Số đo fixture trên Mac M1 16 GB

Đây là HTML/HTTPS cục bộ, không phải tốc độ Google Forms. Mỗi profile là một tiến trình Chrome riêng, ảnh PNG nhiễu tổng hợp. CPU đo tổng cả harness, Chrome và cầu nối; 100% bằng một lõi. RAM là tổng RSS, có thể đếm lặp các trang nhớ dùng chung.

| Phiên | Nhận lệnh (ms) | Tới trang cuối (ms) | Upload từ tải trang (ms) | RSS đỉnh (MB) | CPU đỉnh (%) | Kẹt |
|---|---:|---:|---:|---:|---:|---:|
| 2 | 8–10 | 326–326 | 206–221 | 4078 | 128 | 0 |
| 5 | 383–512 | 902–1011 | 278–450 | 6375 | 196 | 0 |

Phép thử 24 phiên bị gián đoạn trong lúc chuẩn bị do ổ đĩa đầy; chưa có kết quả nghiệm thu. Đã dọn tệp fixture/runtime sinh ra và thêm kiểm tra dung lượng trước khi thử. `npm run bench:fixture -- --sizes=24` cần ít nhất 1.664 MB trống theo ngưỡng của harness, cộng dung lượng máy cần cho swap và ứng dụng khác.

Kết quả máy đọc được ở `test-results/browser-2.json`, `browser-5.json`, ảnh giao diện `manager-light.png`, `manager-dark.png`, `manager-detail.png`, `manager-mobile.png`. Dữ liệu fixture không chứa hồ sơ thật.

Đã chạy smoke test gói Mac Apple Silicon: runtime kèm gói, HTTP có xác thực, cầu nối kèm gói, liên kết/import hồ sơ thử và mở lại app không tạo coordinator thứ hai. Không dùng Node hệ thống. Lệnh: `node scripts/run-node24.mjs scripts/package-smoke.mjs`.

## Chưa nghiệm thu

- Hiệu năng 24 Chrome profile trên Google Forms thật, Google Picker thực tế với ảnh dung lượng thường dùng, và cửa sổ nền trên nhiều máy.
- Runtime/cầu nối/bộ cài trên Windows 10/11 x64 và Mac Intel thật. Gói Mac Apple Silicon được tạo; đóng gói hai nền tảng còn lại bị chặn bởi dung lượng trống hiện tại.
- App Mac phát hành chưa ký/notarize. Không đánh dấu Windows, Intel hay hiệu năng 24 phiên là đạt từ kết quả fixture 2/5.

Kết quả form Google thật của bản 1.2.1 được lưu riêng ở `tests/live/TESTING-1.2.1.md`; không dùng nó để tuyên bố bản điều phối mới đã được nghiệm thu trên Google Forms.
