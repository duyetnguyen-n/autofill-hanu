# Kiểm thử v1.2.1 — 2026-10-08

## Các lỗi đã sửa và kiểm tra

- Checkbox ghi email nhận diện nhãn động theo tài khoản, bằng tiếng Việt và tiếng Anh; không phụ thuộc một địa chỉ email cố định.
- Câu ảnh được nhận diện ngay từ tiêu đề, kể cả khi Google Forms chưa dựng xong nút Thêm tệp sau chuyển trang. Extension chờ nút xuất hiện và cuộn tới nó trước khi mở Picker.
- Luồng dropdown CCCD giữ nguyên thuật toán của bản ZIP gốc. Sau nạp lại extension/tab, hai lượt chạy từ form trống đều tự chọn CCCD và điền số CCCD; không chọn giúp dropdown trong hai lượt này.

## Kiểm thử Chrome thật

Dùng Chrome profile Duyệt, form test HANU và hồ sơ giả: tên NGUYEN TEST AUTOFILL, số giấy tờ toàn số 0, email/điện thoại thử, ảnh PNG 1×1 `upload-fixture.png`. Hồ sơ gốc và tham chiếu ảnh gốc được sao lưu cục bộ trong extension trước khi thử.

1. Clear câu trả lời, bắt đầu lúc 00:15:11. Extension tự check email, cam kết đầu, chọn loại giấy tờ, điền số CCCD, các trường thông tin, tự upload ảnh, điền ngân hàng và tới trang cuối lúc 00:15:30.
2. Bấm Dừng, Clear toàn bộ câu trả lời, nạp v1.2.1 và tải lại trang đầu. Checkbox email ban đầu trống. Bắt đầu lúc 00:19:18; extension đi lại toàn bộ, upload lại ảnh (00:19:27–00:19:31), tự đi tới trang cuối lúc 00:19:40.

Sau thử đã khôi phục hồ sơ gốc, đối chiếu toàn bộ hồ sơ khớp bản sao và đọc lại được Blob ảnh gốc.

Không dùng nút Tiếp thủ công hoặc điền giúp trường hồ sơ trong hai lượt thành công. Không bấm Gửi. Cả hai lượt đều dừng ở câu xác thực năm trên trang cuối theo cơ chế có sẵn. Chưa xác minh trực tiếp trạng thái ready_to_submit trên form thật vì còn chờ xác nhận giải câu xác thực. Không được gọi hai lượt này là đã điền xong câu xác thực hoặc đã gửi thành công.

Minh chứng: `tests/live/full-run-1.png`, `tests/live/full-run-2.png`, `tests/live/full-run-2.json` (nhật ký lượt hai, submitAttempted=false).

## Kiểm tra tự động

- `npm test`: 56/56 ca qua, 11 file.
- `npx tsc --noEmit`: qua.
- `npm run build`: qua; manifest và panel v1.2.1.
- Thêm test nhãn checkbox tiếng Việt theo hai tài khoản và nhãn tiếng Anh.
- Thêm test nút upload xuất hiện muộn: không bỏ sót câu ảnh, không chuyển trang trước khi nhận ảnh.
- Thêm bài kiểm tra cả chu trình nhiều trang từ trống, so sánh toàn bộ giá trị, chờ upload, xử lý câu xác thực thủ công trong fixture cục bộ, đạt ready_to_submit, clear và lặp lại. Không Submit trong Test; mỗi lượt chỉ upload một lần.

## Giới hạn

- Chưa thử ảnh lớn, nhiều tài khoản hoặc Cốc Cốc trên trình duyệt thật.
- Câu xác thực/CAPTCHA vẫn là bước người dùng xử lý, đúng với thiết kế bản cũ.
- Hồ sơ vẫn dùng chung trong một extension profile; chưa có quản lý riêng nhiều thí sinh.
