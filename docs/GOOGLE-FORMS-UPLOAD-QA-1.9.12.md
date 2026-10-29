# Google Forms Direct 1.9.12 — trang upload

Ngày kiểm tra: 29/10/2026. Phạm vi: Direct trên hai LAB; không thay engine
Google Forms cũ hoặc cách chọn tuyến CCCD/hộ chiếu.

## Thay đổi

- Chuẩn bị câu không phải tệp trên trang upload trước khi mở Picker, tương
  tự thứ tự của engine cũ. Sau upload vẫn đối chiếu lại đáp án.
- Chọn dropdown bằng chuỗi pointer của engine cũ, xác nhận giá trị hidden
  đã commit. Nếu không thành công mới dùng chuột thật, rồi phím mũi tên
  có chặn đầu/cuối. Không chấp nhận riêng highlight `aria-selected`.
- Chỉ cuộn khi điều khiển nằm ngoài viewport, cuộn tới vị trí gần nhất.
- Một lần bàn giao ảnh cho mỗi lượt; sau đó chỉ kiểm tra trạng thái.
  Giữ guard khởi động Picker 5 giây và input ổn định 1 giây.
- Giữ nguyên node bảng thông báo khi chỉ đổi tiến độ, tránh chèn lại phía
  trên form ở mỗi poll. Giữ các guard Gửi và sự kiện khi cập nhật văn bản.
- Bảng theo dõi manager nằm dưới hộp Chi tiết, không che nút Lưu và đồng bộ.

Mục hộ chiếu có dấu sao nhưng trống trong kết quả của tuyến CCCD là hợp lệ:
đó là câu bắt buộc trên tuyến hộ chiếu, không phải một đáp án CCCD bị bỏ sót.

## Kiểm tra tự động

- Typecheck extension và manager đạt.
- 84 kiểm thử liên quan đạt; toàn bộ suite: 99 file, 941 đạt, 1 bỏ qua.
- Build cloud extension và cloud server đạt. Vite vẫn cảnh báo chunk lớn.
- Trường hợp bổ sung: giá trị commit bất đồng bộ, popup trùng template,
  fallback chuột/phím, lựa chọn ngoài màn hình, native select, Dừng giữa
  pointer press, chuẩn bị lựa chọn trước Picker, poll không bàn giao ảnh
  lại, và giữ node/guard của bảng thông báo trong chế độ Test.

## Kiểm tra Chrome thật

Dùng profile test, hồ sơ giả và PNG tổng hợp 1.229.883 byte. Không gửi hồ
sơ hoặc ảnh gốc. Baseline LAB HSK4 là 5 phản hồi có sẵn; không xóa chúng.

- Ca Nữ / 1 năm: đã quan sát hai lựa chọn chính xác và các trường văn bản
  có dữ liệu trước khi Picker mở. Không cần chạy dài qua danh sách bằng phím.
- Picker ở lượt đầu hiển thị trắng; đọc DOM iframe thấy body rỗng, không
  script, không input file. Đóng bằng Escape, tiếp quản và tiếp tục giữ
  nguyên dữ liệu đã điền. Mở trực tiếp bằng nút Google cũng cho iframe rỗng.
  Đây chưa phải một lượt upload/gửi thành công và không dùng làm số đo tốc độ.

- Ca Nam / 10 năm trở lên: Google nhận ảnh sau 9,2 giây theo log thực
  (09:13:22 → 09:13:32); chuẩn bị lựa chọn khoảng 1 giây. Lượt tới trang
  ngân hàng thì server triển khai khởi động lại, dừng trước Gửi và hiện
  “Cần đối chiếu sau gián đoạn”. Không tính thời gian này thành benchmark.
- Render đã báo Live commit `6463c38` lúc 09:13:25.

## Lượt hoàn chỉnh trên server ổn định

Run `01e58cbe-121c-4137-b762-a5bb5aed40ac`, hồ sơ giả `NGHIEN CUU UPLOAD HAI`:

| Mốc | Giờ Chrome |
| --- | --- |
| Bắt đầu | 09:15:31 |
| Chuẩn bị điều khiển trên trang upload | 09:15:37 |
| Mở Picker | 09:15:39 |
| Bàn giao ảnh | 09:15:44 |
| Google xác nhận ảnh | 09:15:48 (9,1 giây từ mở Picker) |
| Request trang ngân hàng / cam kết / lệ phí | 09:15:49–50 |
| Request Gửi cuối | 09:15:51 |
| Google xác nhận phản hồi | 09:15:58 |

Manager hiển thị 0:26. Đây là một lượt chức năng khoảng 27 giây, không phải
benchmark so sánh có kiểm soát hoặc cam kết thời gian khi tranh suất.
Trang Google thật hiển thị “Câu trả lời của bạn đã được ghi lại”. Phía chủ
form có phản hồi mới thứ 6, tên giả khớp, **Nam / 10 năm trở lên**, đúng
ảnh PNG tổng hợp, MB BANK, các cam kết LAB và đáp án giả **1234567**.
Đã đợi nội dung phản hồi đổi xong trước khi đối chiếu: Google có thể đổi
spinbutton/số phản hồi trước khi thay nội dung các câu trả lời.

Lượt bị triển khai gián đoạn trước đó đã thử Tiếp tục nhưng báo thiếu xác
nhận request trang ngân hàng; không tính là recovery thành công. Đã Dừng,
xóa bản nháp thử và tạo lượt sạch sau khi server Live. Chưa kết luận được
nguyên nhân Picker trắng ở lượt đầu; mở trực tiếp cũng trắng. Không bỏ guard
hoặc tự retry request Gửi để che các tình huống này.

## Dọn dữ liệu và giao diện

- Xóa duy nhất phản hồi thứ 6 của lượt trên; Google trở về **5 phản hồi**.
- Các bản nháp thất bại do lượt này tạo đã xóa trước khi chạy lượt sạch.
- Khôi phục các trường gốc và ảnh gốc; đóng/mở lại Chi tiết xác nhận mọi
  trường đã sửa khớp backup và manager báo đã đồng bộ extension.
- Giữ HSK4, chuyển dashboard về Test và bỏ chọn profile thử.
- Kiểm tra hit-test thực tế sau triển khai: tâm nút Lưu và đồng bộ trỏ vào
  chính button, không còn bảng theo dõi nổi che phía trên.
- Ảnh bằng chứng chỉ trang xác nhận Google, không chứa hồ sơ gốc:
  `test-results/google-direct-chrome-20261028/confirmation-1.9.12.png`
  (artifact cục bộ, Git bỏ qua).
