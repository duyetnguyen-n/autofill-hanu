# Kiểm chứng Google Forms 1.9.10 — 28/10/2026

## Phạm vi thay đổi

Direct tiếp tục tách riêng và chỉ chạy trên hai form LAB trong allowlist.
Các trang thường sau upload chuyển từ điền từng điều khiển + Google Next
sang POST có điều hướng thật. Không tạo hidden state thay cho trang đang
hiển thị. Upload, các câu cùng trang upload, kiểm tra Gửi của Google, quyền
Gửi từ điều phối và khóa chống gửi trùng được giữ lại.

Classic chỉ thay nhận diện CAPTCHA và đưa tab cần xác thực ra trước sau
khi nhường quyền cửa sổ; không đổi thuật toán điền/gửi. Bộ nhận diện bỏ
qua iframe ẩn và badge invisible, nhận challenge hiển thị kể cả khi có token
cũ. Direct phân loại CAPTCHA/đăng nhập/form đóng thay vì lỗi chung.

Bước chờ chuyển trang đọc ngay, sau đó thăm dò mỗi 100 ms thay vì chờ
250 ms trước mỗi lần đọc. Lỗi dữ liệu hiển thị rõ ràng được đưa sang chờ
xử lý ngay. Giữ trần chờ mạng 35 giây và upload 130 giây vì request có thể
vẫn đang được Google xử lý. Dừng trong kiểm tra Gửi được kiểm tra mỗi
100 ms, không đợi hết khoảng chờ 6 giây.

## Chrome thật, website đã triển khai

Extension Online 1.9.10, một profile Chrome trên macOS. Form LAB HSK3,
nhánh CCCD. Dữ liệu giả tên `NGHIEN CUU PHUC HOI`, số giấy tờ và điện
thoại toàn số 0, email fixture, ảnh PNG tổng hợp 1.161.102 byte. Không
chạy hoặc gửi form đăng ký thật. Hồ sơ/ảnh gốc được sao lưu trong bộ nhớ
trình duyệt, khôi phục sau test; đối chiếu bằng nhau và đồng bộ thành công.

| Lượt | Kết quả | Thời gian từ startedAt đến updatedAt cuối |
| --- | --- | --- |
| Test `99c4e446-c4d7-4656-85cc-f5fef164e563` | ready_to_submit; trang lệ phí thật có 1350000; không Gửi | 28,815 s |
| Live `55736609-fc7d-4568-94b8-86cde98dfa70` | completed; trang xác nhận Google thật | 34,504 s |

Test: bắt đầu 15:23:38.252Z, kết thúc 15:24:07.067Z. Từ thông báo
chuẩn bị trang ngân hàng lúc 15:24:05.435Z đến trang xác thực lúc
15:24:06.979Z là 1,544 giây. Riêng Picker khoảng 15,8 giây.

Live: trang ngân hàng 15:25:32.834Z, trang xác thực 15:25:34.729Z; hai
trang thường sau upload mất khoảng 1,895 giây. Bắt đầu Gửi 15:25:35.706Z,
Google xác nhận 15:25:46.235Z: riêng phản hồi cuối khoảng 10,5 giây.

Phía chủ form có đúng một phản hồi: tên giả, CCCD, email fixture, mục
file có tệp, E-BANKING, tài khoản 0, chủ tài khoản giả, BIDV, cam kết
và lệ phí 1350000 được lưu. Giữ lại phản hồi giả để đối chiếu; không xóa
phản hồi hoặc ảnh người dùng.

## Kiểm thử hồi quy

Bao phủ badge invisible, iframe ẩn, checkbox chưa/đã hoàn tất, nhiều iframe,
challenge tái xuất hiện dù còn token cũ, hCaptcha, chuyển hướng Google
/sorry và đăng nhập, closedform, lỗi validation không chờ timeout, CAPTCHA
trước/sau khóa gửi, callback xác thực đến muộn, Dừng trong preflight,
focus sau nhường quyền và Dừng trong khi nhường quyền.

Kết quả bản cuối:

- `npm test -- --maxWorkers=2`: 98 file, 916 kiểm thử đều qua.
- `npm run typecheck`: qua cả extension và manager.
- `npm run build:extension`, `npm run build:cloud-extension`,
  `npm run build:cloud-server`: thành công.
- Nạp lại extension cuối trên Chrome: phiên bản 1.9.10, kết nối/đồng bộ tốt,
  hồ sơ gốc khớp bản sao lưu, execution không còn hoạt động.

Lượt test toàn bộ đầu tiên có một timeout 5 giây ở kiểm thử admin-role không
liên quan luồng form. Chạy riêng không sửa mã kiểm thử đã qua; chạy lại
cả bộ với hai worker đạt kết quả trên. Cloud UI vẫn có cảnh báo chunk lớn
đã có từ trước, không chặn build.

Không xuất cookie, token, FormData, file reference hoặc response HTML.
Phân biệt badge invisible và bước xác thực tham khảo
[tài liệu Google](https://developers.google.com/recaptcha/docs/invisible).

## Giới hạn

Chưa có bản ghi lỗi CAPTCHA từ đăng ký thật. Kiểm thử CAPTCHA là mô
phỏng DOM/redirect và vòng đời callback; không khẳng định đã sửa mọi
trường hợp Google không tải/hiển thị challenge. Không có phép đo A/B
cùng điều kiện nên không dùng chênh lệch với các lượt 1.9.9 cũ để khẳng
định số giây tăng tốc. Không bảo đảm dưới 40 giây khi nhiều profile, mạng
chậm, Google quá tải hoặc yêu cầu xác thực.
