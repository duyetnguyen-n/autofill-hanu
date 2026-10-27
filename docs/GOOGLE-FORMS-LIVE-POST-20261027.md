# Thử trực tiếp gửi Google Form LAB — 27/10/2026

## Kết quả

**Bản thử POST độc lập chưa gửi hoàn tất được form đầy đủ.** Phần dữ liệu chữ
chuẩn bị sẵn được Google giữ qua các trang. Một ID ảnh đã upload không được
nhận thành tệp đính kèm trong biến thể đã thử; câu upload vẫn báo bắt buộc.

Đây là kết quả của ba payload nghiên cứu cụ thể, không chứng minh mọi cách gửi
trực tiếp đều bất khả thi. Chưa thử POST từ content script trong origin Google
với toàn bộ trạng thái phiên thật, và chưa làm được upload mới trực tiếp từ trang đầu.

## Môi trường và phạm vi

- Chrome người dùng đang đăng nhập, tài khoản chủ form. Chỉ form LAB lệ phí
  HSK4 được gửi dữ liệu; không gửi form HANU.
- [Form LAB](https://docs.google.com/forms/d/e/1FAIpQLSevBk_8863gvlRtkeaKONg6H7y4teYgGU11SBQgg3LSAJNhlw/viewform),
  [trang quản lý và phản hồi](https://docs.google.com/forms/d/19SwlZsmR72R7nL6q6VIdYr7hqiT5V5iR1NhGApkf3mc/edit#responses).
- Dữ liệu hồ sơ, giấy tờ, ngân hàng và lệ phí đều giả. Email Google thu thập là
  tài khoản đăng nhập thật; gửi bản sao email đã tắt.
- Bản thử riêng trong `test-results/direct-submit-research-20261027/live-post-lab.mjs`.
  Không import vào app/extension, không sửa source chạy thật, không triển khai.
- Bản thử phục vụ trang local tại `127.0.0.1:4179`, chỉ cho native HTML form
  POST tới đúng ID LAB nằm trong whitelist. Máy chủ local không gửi request ra Google.
  Mọi thao tác trình duyệt dùng giao diện/CUA. Không lấy cookie, không xuất token
  phiên Google. Máy chủ thử đã dừng sau khảo sát.

## Những lượt đã thực hiện

| Lượt | Cách gửi | Kết quả quan sát |
| --- | --- | --- |
| Đối chứng | Prefill 17 trường chữ/lựa chọn, đi qua các trang, upload `fixture.png` qua Picker, bấm Gửi | Google xác nhận đã ghi nhận; phía chủ form có đúng 1 phản hồi |
| POST 1, 15:11:38 | 17 trường `entry.*`, email, `fvv=1`, lịch sử nhánh dự kiến, nút submit; không file | Trả trang đầu, không có xác nhận hoàn tất |
| POST 2, 15:12:57 | Như POST 1, thêm ID ảnh giả đã upload vào entry của câu file | Trả trang đầu, không có xác nhận hoàn tất |
| POST 3, 15:13:50 | Như POST 2, thử thêm `partialResponse` chứa các đáp án và nonce ngẫu nhiên | Trả trang đầu; đi tiếp thấy tên riêng của POST được giữ nhưng danh sách tệp trống |

Thời gian trên là Asia/Ho_Chi_Minh. Nonce của POST 3 là dữ liệu thử, **không phải**
token xác thực của Google. Lịch sử phần/đóng gói là giả thuyết nghiên cứu dựa trên
schema, chưa được đối chiếu với request hợp lệ của Google. Vì vậy không gọi các
payload này là payload tương đương hoàn toàn với request Gửi thật.

Sau ba POST, đọc lại trang quản lý vẫn có **1 phản hồi**, tên `THI SINH THU NGHIEM`
của lượt đối chứng. Không có phản hồi tên `THI SINH GUI THANG` của POST thử.

### Đối chứng lưu đúng những gì

Đã kiểm tra giao diện từng phản hồi của chủ form: tên giả, CCCD, nhánh CCCD,
giới tính, ngày sinh, quốc tịch, tiếng mẹ đẻ, email câu trả lời, điện thoại,
thời gian học, phương thức thanh toán, số tài khoản/chủ tài khoản/ngân hàng giả,
hai cam kết và đáp án lệ phí `1234567`. Tên tiếng Trung và hộ chiếu để trống.

Câu file hiển thị bản sao `fixture - Duyệt Nguyễn.png`. Mở từ chính phản hồi
đã gửi hiện ảnh hình học đúng, nên không chỉ dựa vào thông báo thành công.
Đây là lượt điền qua giao diện với prefill, **không phải** lượt chạy tự động toàn
bộ của ứng dụng và cũng không phải thành công của cơ chế gửi thẳng.

### Vướng mắc có bằng chứng cụ thể

Với POST 3, sau khi đi tới phần thông tin chung:

- Tên `THI SINH GUI THANG`, CCCD và các trường chữ/lựa chọn được giữ.
- Câu ảnh không có tệp đã chọn, dù đã POST ID của ảnh tải lên trước đó.
- Bấm Tiếp báo **“Đây là một câu hỏi bắt buộc”** tại câu ảnh.

Chưa xác định thiếu định dạng tham chiếu file, liên kết phiên, trạng thái chuyển
trang, trường gửi nào hoặc kết hợp các yếu tố đó. Các request bắt đầu từ trang
local khác origin Google; không suy kết quả này sang một request hợp lệ phát
trong content script của tab Google. Việc nhìn thấy đúng tài khoản sau POST cũng
không chứng minh toàn bộ trạng thái cần thiết cho gửi cuối đã được truyền.

## Hiệu năng và quyết định

Chưa có lượt gửi thẳng hoàn tất nên **không có số giây thành công để so với
34–40 giây hiện tại**. Không lấy thời gian trả lại trang đầu làm tốc độ submit.
Lượt đối chứng có thao tác thủ công và xử lý hộp chọn tệp, không dùng làm benchmark
của app. Lần chờ xác nhận ban đầu dùng nhãn khác với thông báo Google thực tế;
đã đọc lại và xác minh thành công, không bấm gửi lại. Không công bố số đo từ lần
chờ đó.

Chưa tích hợp cơ chế POST thử vào luồng đăng ký. Bước nghiên cứu có ý nghĩa tiếp
theo là đối chiếu request cuối hợp lệ trong đúng phiên, giải quyết upload và
tham chiếu file, rồi mới thử lại từ trang đầu và đối chiếu phản hồi chủ form.
Chỉ sau đó mới kiểm tra nhánh hộ chiếu, dữ liệu sai, chống gửi trùng, Dừng và
đo nhiều lượt. Lượt này mới kiểm thử sống nhánh CCCD của bản lệ phí.

## Bằng chứng local

Trong `test-results/direct-submit-research-20261027/`:

- `live-post-lab.mjs`: mã thử riêng, không chứa cookie/token Google.
- `live-post-attempts.jsonl`: ba thời điểm kích hoạt POST, không có credentials.
- `baseline-recorded.jpg`: thông báo Google ghi nhận lượt đối chứng.
- `baseline-owner-verified.txt`, `baseline-owner-response.txt`: phản hồi phía chủ form.
- `baseline-stored-image.jpg`: ảnh trong phản hồi đã lưu mở được.
- `direct-no-file-result.txt`, `direct-with-file-result.txt`, `direct-packed-result.txt`:
  các trang Google trả lại sau POST.
- `direct-packed-kept-name.txt`: tên riêng của POST được giữ qua trang.
- `direct-file-required.txt`, `direct-file-required.jpg`: lỗi file bắt buộc.

Để người dùng đối chiếu, giữ lại phản hồi LAB thành công và các tab kết quả.
Không xóa phản hồi; lượt POST thử còn bản nháp dữ liệu giả, chưa hoàn tất.
