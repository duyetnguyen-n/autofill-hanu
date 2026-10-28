# Google Forms Direct 1.9.11 — tab chờ, request và giao diện

Kiểm tra ngày 28/10/2026 trên Chrome hiện có, một profile, hai form LAB.
Direct vẫn chỉ cho phép hai LAB; Google Forms cũ giữ nguyên engine.

## Thay đổi thực tế

| Phần | Trước | Sau |
| --- | --- | --- |
| Tab chờ | Direct luôn tạo tab khác | Dùng lại tab `ready.html` đã chuẩn bị; nếu người dùng đã chuyển tab đó sang trang khác thì tạo tab mới, không ghi đè trang của họ |
| Đáp án nhập trước theo HSK | Chỉ có giá trị, chưa có định danh câu hỏi nên có thể chờ đến cuối mới ghép | Gửi giá trị cùng lệnh Direct; khi đọc schema thật, chỉ ghép sớm nếu có duy nhất một câu xác thực bắt buộc được nhận diện |
| Sau upload, các đáp án đã biết | Chuyển trang thật và điền/kiểm tra điều khiển câu cuối | Gửi từng request không phải Gửi, lấy trạng thái Google cấp; đến trạng thái cuối mới POST đáp án cuối và mở trang kết quả thật |
| Câu chưa biết hoặc đáp án không hợp lệ | Mở trang để xử lý | Giữ cách xử lý này; không đoán đáp án từ biểu thức validation |
| Test | Dừng trên trang cuối, không Gửi | Giữ nguyên, có ô Google thật để xem/sửa |
| Request chuyển nhanh bị từ chối | Cần xử lý lỗi | Trước Gửi: khôi phục trang từ trạng thái Google đã nhận, tắt chuyển nhanh cho lượt đó và tiếp tục bằng luồng trang thật một lần |
| Kết quả Gửi chưa rõ | Giữ khóa chống lặp | Giữ nguyên; không tự retry request cuối |

Trang upload vẫn dùng Google Picker và nút Tiếp gốc, gồm cả các câu nằm
cùng trang upload. Sau đó bỏ thao tác điền từng điều khiển khi có đủ đáp án,
nhưng **không bỏ các bước xác nhận trạng thái của Google**.

Thử nghiệm POST trực tiếp từ trang ngân hàng đã bị loại bỏ: Google có thể
hiện xác nhận nhưng không lưu cam kết/lệ phí ở trang bị bỏ qua. Thử tự thay
history cũng bị trả về đầu form, không có phản hồi mới. Không gộp hoặc tự
dựng `partialResponse`, history, revision hay reference ảnh trong bản này.
Có rào chắn từ chối request cuối khi history thực chưa đủ tuyến trang.

## Kết quả trên Google thật

Dùng toàn bộ thông tin giả và PNG tổng hợp, không gửi hồ sơ/ảnh gốc.
Các cam kết trên LAB được chủ form ghi rõ chỉ là dữ liệu mô phỏng.

| LAB | Run | Thời gian toàn lượt | Đối chiếu phía chủ form |
| --- | --- | --- | --- |
| HSK3, đáp án `1350000` | `967dee3f-87c7-45ec-9fe8-2d2fc6ad9dce` | 27,123 giây (23:40:00.221 → 23:40:27.344) | Phản hồi 4: các trường bắt buộc, ảnh, ngân hàng, cam kết cuối và lệ phí có dữ liệu; gửi lúc 23:40 |
| HSK4, đáp án giả `1234567` | `255e378f-255d-4ec9-bae7-62aa55683939` | 33,101 giây (23:41:40.861 → 23:42:13.962) | Phản hồi 3: các trường bắt buộc, ảnh, ngân hàng, cam kết cuối và lệ phí có dữ liệu; gửi lúc 23:42 |

HSK3: request trang ngân hàng lúc 23:40:20.780, cam kết 21.365, lệ phí
22.234; không đợi hiện rồi điền ô lệ phí. HSK4: xin khóa Gửi lúc
23:42:04.960, xác nhận Google lúc 13.958; gần 9 giây ở bước cuối phụ thuộc
Google/mạng.

Đã quan sát tab chờ được dùng lại: cùng tab ID, tổng số tab giữ 10 → 10,
con trỏ tab chờ được xóa sau khi nhận. Tab chờ đã chuyển sang trang riêng
của người dùng được bảo vệ bằng kiểm thử tự động.

Đây là hai lượt chức năng trên một profile, không phải benchmark tải.
So với lượt tự động khoảng 36 giây ở QA trước, kết quả lần này thấp hơn
khoảng 3–9 giây, nhưng không kiểm soát cùng điều kiện mạng/Google nên không
cam kết mức giảm hoặc thời gian dưới 40 giây khi đăng ký thật. Chưa kiểm
chứng CAPTCHA khi tranh slot, form thật đang mở hay nhiều profile đồng thời.

## Giao diện

- Giữ Fluent UI, màu xanh và Geist của ứng dụng; ưu tiên mật độ dashboard.
  Thiết lập taste: variance 3, motion 1, density 5.
- Sửa ba lớp CSS xung đột: input đáp án và hai nút cùng cao 38px, thẳng
  hàng ở desktop. Hint ở dòng riêng, có liên kết truy cập cho input.
- Khung hẹp xếp nút xuống dưới. Đã xem ở 1423, 1024, 390 và 320px;
  không có tràn ngang. Đã kiểm tra sáng/tối.
- Bảng theo dõi cố định góc phải dưới, mặc định thu gọn: rộng 352px ở
  desktop, tối đa theo màn hình ở mobile; chiều cao khoảng 118–124px khi gọn.
  Không dùng dropdown liệt kê các nhóm lịch sử trong bảng nổi.
- Đã bấm Tạm dừng/Tiếp tục, mở/thu gọn, đóng và mở lại trong fixture UI.
  Nút dừng vẫn dùng handler và nhãn truy cập hiện có. Khi có bảng nổi, khu
  tổng quan cũ không còn sticky tạo thêm lớp lớn che nội dung.
- Sửa ghép nhầm hai run ID còn trống: lịch chỉ đang chờ link đã hủy hiển
  thị đúng “Đã dừng”, không báo giả chưa xác nhận dừng. Profile có execution
  đang chạy thật vẫn được giữ cảnh báo và nút thử dừng lại.

Ảnh QA cục bộ, chỉ chứa fixture giả, trong thư mục Git bỏ qua:
`test-results/ui-prepared-finish-20261028/{desktop,mobile,dark}.png`.

## Kiểm tra và hoàn trả dữ liệu

- Toàn bộ 98 file, **933 test** qua với `npm test -- --maxWorkers=2`.
- Typecheck cả extension và manager qua.
- Build extension, cloud extension/server và manager assets qua; Vite còn
  cảnh báo kích thước chunk giao diện, không có lỗi build.
- Kiểm thử gồm: tab chờ, giá trị đáp án theo HSK, ghép câu duy nhất/không
  rõ, Test không Gửi, đáp án sai, HTTP bị từ chối và khôi phục trước quyền
  Gửi, Dừng chặn tự khôi phục, history chưa đủ, khóa Gửi chưa rõ kết quả.
- Fallback mạng/validation và CAPTCHA có kiểm thử tự động; không tạo CAPTCHA
  hoặc chủ động gây lỗi mạng trên lượt Google thật này.
- Hồ sơ và tham chiếu ảnh gốc đã khôi phục bằng bản sao trước thử, so sánh
  toàn bộ JSON bằng nhau; manager xác nhận đồng bộ, execution rỗng.
- Giữ các phản hồi giả để đối chiếu; không xóa phản hồi thật hoặc xóa vĩnh
  viễn dữ liệu Google. Những lượt thử giao thức bị loại không được tính là
  kết quả thành công đầy đủ.

Bản mới cần triển khai server và cập nhật/reload extension cùng phiên bản
để dùng cả giao diện lẫn truyền đáp án theo HSK. Hai lượt Google ở trên dùng
extension mới và câu hỏi có định danh rõ trên server hiện tại; việc truyền
giá trị chưa biết định danh qua scheduler được xác minh bằng kiểm thử
coordinator + ManagedDirect, chưa dùng server production mới để chạy LAB.
