# Bộ form kiểm thử HSK — 27/10/2026

Hai form thuộc tài khoản Google đang mở của người dùng. Mục tiêu là tái hiện sát
form thử HANU đã cung cấp, đồng thời tách riêng lỗi câu lệ phí từng gặp. Không
thay đổi source vận hành, bản triển khai hoặc form của HANU trong lượt này.

**Cập nhật thử sống:** [Báo cáo POST trực tiếp](GOOGLE-FORMS-LIVE-POST-20261027.md).
Một lượt đối chứng qua giao diện trên bản lệ phí đã lưu đúng dữ liệu và ảnh;
ba POST nghiên cứu chưa gửi hoàn tất. Các kết quả offline bên dưới không thay
thế việc kiểm thử toàn luồng của app.

## Mở form

| Bản | Trả lời | Quản lý | Đáp án cuối |
| --- | --- | --- | --- |
| Chuẩn, theo form thử gốc | [Mở form](https://docs.google.com/forms/d/e/1FAIpQLScRrul5GFZkLQD21oVlarFeb1AbomeKoqOJGVsnW3k3XbMtIA/viewform) | [Sửa / xem phản hồi](https://docs.google.com/forms/d/1FqHl_uWtJStIkPgsQ73L6WJhjGvPlBPSJLrvKw_R33k/edit) | `2026` |
| HSK4, câu lệ phí | [Mở form](https://docs.google.com/forms/d/e/1FAIpQLSevBk_8863gvlRtkeaKONg6H7y4teYgGU11SBQgg3LSAJNhlw/viewform) | [Sửa / xem phản hồi](https://docs.google.com/forms/d/19SwlZsmR72R7nL6q6VIdYr7hqiT5V5iR1NhGApkf3mc/edit) | `1234567` — giả |

Đăng nhập tài khoản chủ sở hữu `ntduyet260602@gmail.com` để mở. Cả quyền chỉnh
sửa và trả lời đều Hạn chế. Email Google được xác minh; giới hạn một phản hồi
đã tắt để thử nhiều lần; gửi email sao chép và chia sẻ tóm tắt kết quả đều tắt.
Muốn test bằng tài khoản khác cần cấp quyền cho đúng tài khoản đó.

## Đã tái hiện những gì

- 20 câu hỏi, 9 phần; đúng thứ tự, nhãn song ngữ/Morse và mô tả từng câu/phần.
- Đúng loại điều khiển, required/optional, lựa chọn và ô Other thực sự ở quốc
  tịch, tiếng mẹ đẻ, ngân hàng; hai cam kết có xáo trộn lựa chọn.
- Regex tên, tên tiếng Trung, CCCD, hộ chiếu, ngày sinh, email, điện thoại,
  chủ tài khoản, câu cuối; tài khoản ngân hàng dùng validation số.
- Nhánh CCCD: phần 1 → 2 → 3 → 4 → 6 → 7 → 8 → 9. Hộ chiếu:
  phần 1 → 2 → 3 → 5 → 6 → 7 → 8 → 9. Không bắt nhập giấy tờ ở nhánh bỏ qua.
- Hướng dẫn mở đầu, ảnh hướng dẫn, điều khoản Việt/Trung; nhằm giữ cả nội dung
  dài có thể gây nhầm giữa văn bản nói về lệ phí và câu thật cần trả lời.
- Câu file bắt buộc: một tệp ảnh/PDF, tối đa 10 MB. Đã kiểm tra UI cấu hình;
  thư mục nhận upload riêng của bản sao đã được khôi phục.

Bản lệ phí chỉ thay câu cuối bằng:
**“Lệ phí thi HSK4+HSK Khẩu ngữ Trung cấp năm 2026 là bao nhiêu?”**.
Giữ required và regex `^1234567$`; mô tả nói rõ đáp án giả, không phải lệ phí
chính thức. Không đưa một mức tiền suy đoán vào bộ kiểm thử.

## Bằng chứng đã kiểm tra

Metadata được đọc lại từ DOM của bản trả lời đã xuất bản, không chỉ dựa vào editor.

| Kiểm tra | Kết quả | Phạm vi |
| --- | --- | --- |
| Chuẩn so với form thử gốc | 32/32 mục không khác biệt theo trường so sánh | Metadata nội dung/cấu trúc |
| Lệ phí so với chuẩn | 31 mục không đổi; câu cuối chỉ đổi nhãn, mô tả, regex | Metadata |
| 2 form × 2 nhánh giấy tờ | 4/4 bộ dữ liệu đạt kiểm tra | Offline |
| Dữ liệu sai tên/giấy tờ/ngày/email/điện thoại/số tài khoản/câu cuối | 16/16 bị từ chối bởi bộ kiểm tra local | Offline |
| Test có sẵn về nhận diện/đáp án câu xác thực | 43/43 đạt | Vitest, không phải Google |
| Gửi qua giao diện và đối chiếu phản hồi Google | 1 lượt trên bản lệ phí/CCCD đã đạt | Prefill + thao tác qua các phần và Picker, chưa phải app tự chạy |
| POST độc lập với dữ liệu chuẩn bị sẵn | 3 lượt chưa hoàn tất | Chi tiết và giới hạn ở báo cáo thử sống |

So sánh bỏ qua ID mới của form/item/entry/section/ảnh, chuẩn hóa khoảng trắng,
coi Continue mặc định tương đương Continue explicit, so tập hợp khi lựa chọn
xáo trộn. Có kiểm tra nhãn, mô tả, loại, required, lựa chọn/Other, shuffle,
validation và đích chuyển phần; ảnh so tiêu đề/mô tả/kích thước, không so asset ID.
Không khẳng định trùng định dạng HTML/rich text hoặc chính sách Workspace.

Artifact trong `test-results/direct-submit-research-20261027/`:

- `source-items.json`, `lab-items-standard.json`, `lab-items-fee.json`.
- `compare-forms.mjs`, `standard-comparison.json`.
- `audit-lab.mjs`, `lab-audit.json` (bốn bộ đáp án giả và các đường đi).
- `fixture.png` — ảnh hình học giả, không chứa giấy tờ hoặc khuôn mặt.
- `standard-published.jpg`, `fee-question-editor.jpg` — ảnh chụp giao diện.

Chạy lại kiểm tra local:

```sh
node scripts/run-node24.mjs test-results/direct-submit-research-20261027/audit-lab.mjs
node scripts/run-node24.mjs node_modules/vitest/vitest.mjs run tests/final-question.test.ts tests/hsk-verification-answer.test.ts
```

## Dữ liệu và quy trình test toàn luồng

Dùng hồ sơ riêng với tên `THI SINH THU NGHIEM`, CCCD `000000000000` hoặc hộ chiếu
`A0000000`, sinh `2000-01-01`, điện thoại `0000000000`, email câu trả lời
`fixture@gmail.com`, ngân hàng BIDV, số tài khoản `0000000000`, chủ tài khoản
`THU NGHIEM`. Email này chỉ là chuỗi dữ liệu thử hợp regex, không khẳng định sở hữu
hộp thư; tắt bản sao email. Email Google thu thập vẫn là tài khoản đăng nhập.
Tên tiếng Trung có thể để trống. Các lựa chọn chính xác và file giả nằm trong
artifact; ảnh chỉ dùng thử upload, không đáp ứng tiêu chuẩn giấy tờ dự thi.

1. Dùng luồng điền hiện tại với mỗi tổ hợp form/nhánh. Cấu hình đáp án cuối theo
   đúng link và nhãn câu hỏi; không dùng đáp án lệ phí giả cho đăng ký thật.
2. Trước Gửi, đối chiếu toàn bộ dữ liệu, ảnh và câu cuối. Đo thời gian từng giai
   đoạn. Khi gửi thử lên form LAB, xác nhận thông báo thành công rồi kiểm tra
   từng câu, email tài khoản, nhánh và file mở được trong tab Câu trả lời.
3. Kiểm tra Other, dữ liệu sai, file sai loại/quá lớn, thiếu đáp án, sửa câu cuối,
   Dừng/Dừng nhóm khi đang điền và đang upload. Dừng xong không được tiếp tục
   click/chuyển trang/gửi ở lượt cũ. Trường hợp kết quả gửi chưa rõ không tự gửi lại.
4. Chạy lặp cùng hồ sơ/ảnh để đo trung vị, p95, lỗi và phản hồi trùng; không lấy
   thời gian dựng payload local làm tốc độ hoàn tất Google.

Các bước trên là bộ tiêu chí. Mới có một lượt đối chứng qua giao diện và ba POST
nghiên cứu trong báo cáo thử sống; chưa hoàn thành toàn bộ ma trận hoặc benchmark.

## Giới hạn còn lại

Form nền là bản thử gốc được cung cấp, không phải toàn bộ cấu hình form đăng ký
thật. Bản lệ phí tái hiện nhãn sự cố đã biết; chưa có bằng chứng về regex, đáp án,
thay đổi nội dung hoặc cách tổ chức phần của form thật. Tài khoản cá nhân cũng
không tái hiện chính sách Workspace, giới hạn một lượt và tải cao lúc mở đăng ký.

Vì vậy bộ này giúp thử kỹ hơn và phát hiện lỗi sớm, nhưng chưa cho phép kết luận
“đăng ký thật chắc chắn không lỗi”, “submit trực tiếp đã dùng được” hoặc một số
giây hoàn tất cụ thể. Trong lượt tạo bộ form chưa upload hay gửi phản hồi.
