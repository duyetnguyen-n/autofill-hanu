# Google Forms Direct — Chrome Windows, 28/10/2026

## Cập nhật 1.9.6 — chạy lại sau khi dọn phản hồi LAB

Khóa `received` của lượt LAB thành công vẫn được lưu trong lịch sử, nhưng
không chặn **lượt Direct mới được chủ động bắt đầu** trên hai LAB trong
allowlist. Backend áp dụng cùng quy tắc ở preflight, giao dịch bắt đầu và
giao dịch cấp quyền gửi. Chạy lại riêng profile và đổi/chạy lại link HSK đều
áp dụng. Khóa chưa rõ kết quả vẫn chặn; một runId không được nhận quyền gửi
lần hai. Classic và form ngoài allowlist giữ nguyên quy tắc chống gửi trùng.

Đây là sửa backend/UI; extension Online 1.9.5 đang mở vẫn tương thích, không
cần Reload extension để nhận sửa đổi sau khi backend được triển khai.
Ghi chú giữ khóa ở phần dọn dữ liệu bên dưới mô tả trạng thái bản 1.9.5 trước
sửa lỗi này; lịch sử đã gửi được giữ nguyên, không đổi thành “chưa nhận”.

## Phạm vi

Kiểm tra trên Chrome thật: profile quản lý `nguyentheduyet.mtp`, profile gửi
`ntduyet260602`. Dùng website quản lý đã triển khai và extension Online trong
`dist-cloud`. Người dùng xác nhận đã Reload và thấy phiên bản **1.9.5**.
Chỉ dùng hai form LAB trong allowlist, hồ sơ giả và PNG fixture 68 byte.

## Vì sao trang upload vẫn được điền

Đây vẫn là luồng kết hợp. Các trang đầu chuẩn bị và gửi dữ liệu bằng request.
Riêng trang chứa upload, Google phải ghi nhận ảnh và các trường cùng trang
bằng trạng thái giao diện của chính Google. Executor mở Picker, tải Blob đã
lưu, chuẩn bị các ô cùng trang rồi dùng nút Tiếp của Google. Các trang tài khoản,
cam kết và câu xác thực sau đó tiếp tục bằng request, không điền từng ô.
Giao diện có thể còn đứng ở trang tài khoản trong khi bộ gửi đã xử lý trang sau.

## Lỗi tìm được và sửa

- Dropdown có thể tô sáng đúng hàng nhưng hidden input vẫn rỗng. Có lượt lỗi
  tại Giới tính, có lượt tại Thời gian học. Executor dừng trước khi gửi.
- Menu Google xử lý Lên/Xuống nhưng bỏ qua Home. Thay Home bằng đủ phím Lên
  để về đầu danh sách, rồi xuống đúng vị trí. Không dùng highlight làm bằng
  chứng đã chốt; vẫn kiểm tra hidden input.
- Bổ sung ký tự Enter cho sự kiện keypress. Thêm 40 ms giữa các phím vì menu
  áp dụng lựa chọn qua animation frame; gửi liên tiếp quá nhanh có thể đọc
  lại chỉ số cũ. Kiểm thử có mô phỏng cập nhật lựa chọn bị trì hoãn.
- Nút Dùng link có thể vừa kích hoạt lưu khi input mất focus, vừa kích hoạt
  đổi link/chạy lại khi START trả về trước click. Khi focus chuyển sang các
  nút của cùng ô link, chỉ nút nhận thao tác đó. Có kiểm thử hồi quy.
- Tăng package, lockfile và manifest từ 1.9.4 lên 1.9.5.

Sửa dropdown thuộc engine Direct. Không thay thuật toán điền của classic.
Sửa blur thuộc UI quản lý dùng chung; đã build cục bộ, chưa triển khai lại
website production trong lượt kiểm tra này.

## Kết quả trực tiếp

| Lượt | Kết quả |
| --- | --- |
| LAB HSK3, thiếu đáp án | Dừng chờ đúng câu lệ phí |
| LAB HSK3, nhập `1.350.000` | Dừng vì không khớp validation, chưa gửi |
| LAB HSK3, đổi thành `1350000`, Test | Tự tiếp tục, dừng trước Gửi; số phản hồi vẫn 2 |
| LAB HSK3, Live sau bản 1.9.5 | Google xác nhận; phía chủ form tăng 2 → 3 |
| LAB HSK4, Test sạch, nhánh hộ chiếu | Tự dùng đáp án nhập trước, Xong Test, khoảng 29 giây |
| LAB HSK4, xóa nháp rồi Live sạch | Google xác nhận; phía chủ form tăng 5 → 6, khoảng 28 giây |

Sau sửa có ba lượt sạch liên tiếp qua được upload và dropdown: HSK3 Live,
HSK4 Test, HSK4 Live. Đây là mẫu kiểm tra nhỏ, chưa phải benchmark tải đồng thời.

Giá trị `1350000` và `1234567` dùng theo cấu hình của LAB ở thời điểm kiểm tra;
không dùng báo cáo này làm nguồn lệ phí chính thức. LAB HSK4 ghi rõ đáp án giả.

Phản hồi mới HSK3 có tên `NGHIEN CUU CHROME MOT`, lệ phí `1350000`, Nam,
thời gian học 1 năm và tệp `upload-fixture - Duyệt Nguyễn.png`.
Phản hồi mới HSK4 có tên `NGHIEN CUU CHROME HAI`, hộ chiếu `AB0000000`,
CCCD trống, lệ phí giả `1234567` và ảnh fixture.

Run Live HSK3: `d3c87e41-8699-46a9-b02d-c4042092ce50`.
Bằng chứng văn bản và ảnh nằm trong `test-results/google-direct-chrome-20261028/`.

## Dọn dữ liệu

- Đã xóa đúng phản hồi mới số 3 của LAB HSK3 và số 6 của LAB HSK4.
- Số phản hồi trở lại **2** và **5**, giữ nguyên phản hồi cũ.
- Đã xóa bản nháp của cả hai form và đóng các tab trả lời còn mở. Email
  checkbox ở trang đầu trở về chưa chọn sau khi xóa.
- Khôi phục và so sánh đủ 21 trường hồ sơ với bản trước khi thử: khớp.
- Nạp lại ảnh gốc cùng tên và kích thước hiển thị, Lưu và đồng bộ thành công.
- Đưa cấp HSK về 5, chế độ Test, bỏ chọn profile; không còn lượt đang chạy.
- Không xóa lịch sử/khóa chống gửi trùng trong tool. Xóa phản hồi Google không
  tự gỡ khóa đã gửi của tool; báo cáo vẫn lưu dấu hai lượt đã được Google nhận.

## Giới hạn

Chỉ một profile gửi thực tế và ảnh rất nhỏ. Chưa kiểm tra ảnh lớn, nhiều
profile đồng thời, CAPTCHA hoặc phiên đăng nhập hết hạn. Khi chạy lại một
lượt theo HSK, dùng điều khiển của HSK để giữ đúng liên kết câu xác thực;
Chạy lại riêng profile tạo nhóm mới và bảng HSK cũ không áp đáp án sang nhóm đó.

## Kiểm thử và bản build

- Toàn bộ Vitest trên Windows: **96 file đạt; 867 bài đạt, 1 bài bỏ qua**.
- `npm run typecheck` và `git diff --check` đạt.
- Các bộ kiểm thử Direct, lịch HSK và UI liên quan: 105 bài đạt.
- Build extension local và Online 1.9.5 thành công; bản Online đã Reload và
  được dùng cho ba lượt sạch cuối. Build UI quản lý thành công.
- Mã và bản build sửa UI link chưa được publish lên website; không ghi đè
  bản production trong lúc kiểm tra. Bản sửa dropdown có hiệu lực trên
  extension 1.9.5 đã được kiểm tra trực tiếp.
