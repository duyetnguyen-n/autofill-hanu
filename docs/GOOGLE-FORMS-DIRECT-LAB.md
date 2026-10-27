# Google Forms Direct · Lab — 27/10/2026

Chức năng nghiên cứu mới, độc lập với bộ tự điền Google Forms hiện tại.
Mở Side Panel extension → **Google Forms Direct · Lab** → **Mở chức năng Lab**.
Trang riêng là `google-direct.html`; mã riêng nằm trong `src/google-direct/`.
Không sửa engine `background.ts`/`content.ts`, protocol, khóa gửi, lịch chạy,
dữ liệu hồ sơ hay backend quản lý. Bản mới có executor tự động riêng, nút
**Tự chạy và gửi form test**, và chỉ cho phép đúng published ID của form Lab.

Executor dựng POST từ FormData của document hiện tại, thay answers bằng snapshot
hồ sơ, đi qua đúng nhánh bằng request (không điền từng control). Tại câu file,
tool tự mở Picker và bàn giao ảnh qua helper thuần `StoredPickerUploads` với
job/guard riêng. Tab form được kích hoạt để Google Picker có thể render. Request
tiếp giữ nguyên upload reference/partialResponse do Google tạo. POST cuối dùng
`fetch` cùng origin trong MAIN world, gửi toàn bộ nhánh và đọc nội dung HTTP;
không cần tải lại các trang sau câu upload chỉ để điền ô. Trước POST cuối,
executor lưu khóa riêng `googleDirectSubmit:<formId>:<account>`; kết quả chưa rõ
không được tự gửi lại. Token phiên không rời document form, không lưu cookie/token.
Khi đã đối chiếu phía chủ form là chưa có phản hồi, nút đối chiếu chỉ giải quyết
đúng run ID đang pending và giữ metadata đối chiếu. Reload Lab không xóa khóa.

Trạng thái nghiệm thu thật sẽ cập nhật sau lượt chạy bằng extension; kiểm thử
fixture không được coi là bằng chứng Google đã nhận phản hồi.

## Kết quả khảo sát trên form được cung cấp

[Form Lab](https://docs.google.com/forms/d/e/1FAIpQLScRrul5GFZkLQD21oVlarFeb1AbomeKoqOJGVsnW3k3XbMtIA/viewform)
có tiêu đề “LAB — Mô phỏng đăng ký HSK / thử submit”. GET không có phiên Google
trả trang yêu cầu đăng nhập; Chrome đã đăng nhập đọc được metadata.

- Script `FB_PUBLIC_LOAD_DATA_` tại trang người trả lời chứa toàn bộ 20 câu hỏi,
  9 trang, entry IDs, lựa chọn, validation và nhánh điều hướng. Bản Lab đọc
  script dưới dạng JSON, không dùng `eval` hay truy cập trạng thái JS nội bộ.
- Mỗi nhánh CCCD hoặc hộ chiếu đi qua 8 trang. Chỉ lấy trường bắt buộc của
  nhánh đã chọn. `pageHistory` dùng chỉ số trang; đích rẽ nhánh dùng ID section.
  Slot 5 của page-break mô tả đích ra của section **trước đó**. Quan sát Chrome
  đã xác nhận nhánh CCCD bỏ qua trang hộ chiếu để đến trang giới tính/upload.
- Hai câu cam kết có tiêu đề tương tự nhau; phải phân biệt bằng nội dung
  lựa chọn. Một giá trị đồng ý có thể có lựa chọn tiếng Trung và tiếng Việt.
  Planner ưu tiên giá trị chính xác rồi thứ tự alias đã khai báo trong rule.
- Câu xác thực `entry.1045827748` có validation `^2026$`. Lab không suy luận
  đáp án; hồ sơ giả dùng đáp án mô phỏng khai báo sẵn hoặc người dùng nhập riêng.
- Upload `entry.1365092776` là bắt buộc, chấp nhận ảnh/PDF tối đa 10 MB theo UI.
  Attachment ID nội bộ/tên ảnh/base64 chưa phải mã tệp Google; không đưa chúng
  vào `entry.*` như thể ảnh đã upload thành công.
- Đích form quan sát được là
  `https://docs.google.com/forms/u/0/d/e/<published-id>/formResponse`.
  Các hidden field gồm `fvv`, `partialResponse`, `pageHistory`, `token`, `tag`,
  `fbzx`, `submissionTimestamp`. Chưa kết luận field nào bắt buộc cho POST cuối.
  Lab chỉ trả tên các field phiên, không xuất giá trị token/cookie.

Trong lượt khảo sát này, Google Picker mở ra nhưng iframe vẫn trống; đã đóng
Picker bằng Escape. Chưa upload tệp và chưa quan sát được handshake/file reference
để đối chiếu POST có ảnh. Form còn bản nháp dữ liệu giả, chưa gửi phản hồi.

Schema fixture ở `tests/fixtures/google-direct-lab.json` được rút gọn trực tiếp
từ DOM form này: giữ ID, lựa chọn, validation, metadata phân trang; bỏ mô tả,
tài khoản và dữ liệu phiên. Các test không truy cập mạng và không tạo phản hồi.

## Cách dùng bản khảo sát

1. Build extension (`npm run build:extension`) và reload bản extension phát triển.
2. Mở Lab từ Side Panel. Bấm **Mở form test** nếu chưa mở form trong profile đó.
3. Chọn tab cụ thể, chọn **Hồ sơ giả** hoặc **Hồ sơ đã lưu trên Chrome này**,
   rồi bấm **Đọc form và lập dữ liệu**.
4. Xem nguồn ghép, giá trị, quy tắc chưa đạt và lộ trình trang. Có thể sửa đáp án
   riêng trong Lab; không lưu đè hồ sơ. Với lựa chọn, dùng nguyên văn lựa chọn
   hoặc giá trị đã có alias trong rule (ví dụ `CCCD`, `HỘ CHIẾU`, `Nam`).
5. Payload mặc định ẩn giá trị; chỉ hiện khi tick lựa chọn tương ứng. Đây là
   **bản nháp phần answers/pageHistory**; executor tự ghép các field phiên ngay
   trong document Google tại mỗi request.
6. Bấm **Tự chạy và gửi form test**. Hồ sơ giả dùng PNG fixture 1×1; hồ sơ đã
   lưu dùng Blob đính kèm trong Chrome hiện tại. Lệnh này thực sự gửi phản hồi.
   Không cần tự điền, chọn dropdown, tìm ảnh trên ổ đĩa hoặc bấm Tiếp/Gửi.

Bước đọc form/xem trước vẫn chỉ đọc. Chỉ khi bấm nút chạy, executor mới upload
và gửi request. Nó không đổi run/lease/khóa gửi của luồng cũ, và từ chối chạy nếu
luồng cũ đang giữ profile/khóa form. Dữ liệu hồ sơ gốc không bị lưu đè.

## Thiết kế bước tiếp theo

Google Forms REST API chính thức chỉ có `responses.get` và `responses.list`,
không có endpoint tạo câu trả lời: xem
[forms.responses](https://developers.google.com/workspace/forms/api/reference/rest/v1/forms.responses).
Vì vậy hướng đang nghiên cứu là giao thức responder web, không phải một API
submit chính thức. `FB_PUBLIC_LOAD_DATA_` và vị trí các slot có thể thay đổi.

Các phần còn cần nghiệm thu trên Google thật:

1. Quan sát một lượt mô phỏng qua UI, ghi cấu trúc request đã loại dữ liệu phiên
   để xác định chính xác `partialResponse`, cách ghi email và trạng thái upload.
   Không lấy cookie từ profile khác hoặc chuyển token về server quản lý.
2. Viết uploader mới, độc lập với run cũ. Có thể tái sử dụng helper thuần
   `assignPickerFile` nhưng phải có session/guard riêng. Chỉ chốt khi Google
   trả file reference gắn đúng account, form, entry và lượt. Kiểm tra cả ảnh
   đã lưu nhỏ và ảnh lớn, lỗi kích thước/định dạng, đổi tài khoản và hết phiên.
3. So sánh payload từ planner với request UI thực tế cho cả CCCD và hộ chiếu;
   loại trường ở nhánh không đi qua, xử lý sentinel/multi-value nếu cần.
   Các mã điều hướng âm, grid, date/time thật, Other và nhiều checkbox hiện
   báo chưa hỗ trợ; không đoán cách mã hóa.
4. Executor riêng đã kiểm tra lại schema/account và dữ liệu trước POST, khóa
   bền vững trước gửi và không tự retry khi chưa rõ. Trước khi mở cho form ngoài
   allowlist Lab hoặc nối website, phải áp dụng quyền Live/quota ở backend.
5. Xác nhận response-only acknowledgement và đối chiếu phản hồi phía chủ form.
   HTTP 200 hoặc `fetch` hoàn tất không đủ chứng minh Google đã ghi phản hồi.
6. Nghiệm thu dữ liệu giả trên form Lab; chỉ cân nhắc thay engine cũ sau khi
   upload, phân nhánh, xác thực tài khoản và chống gửi trùng đều đã được chứng minh.

Hướng khả thi trước mắt là chuẩn bị toàn bộ dữ liệu từ schema, hoàn tất upload
trong phiên hợp lệ rồi dùng một request gửi cuối. Chưa có bằng chứng trong lượt
nghiên cứu này rằng form upload bắt buộc có thể bỏ toàn bộ điều hướng trang.

## Kiểm tra

`npm test -- tests/google-direct.test.ts` kiểm tra schema thực đã rút gọn, hai
nhánh, tiêu đề cam kết trùng, thiếu/sai xác thực, validation, ảnh local không
thay mã upload, metadata sai và vòng lặp điều hướng. Xem kết quả kiểm tra cuối
trong phản hồi bàn giao; tài liệu không coi test fixture là nghiệm thu gửi thật.

Kết quả ngày 27/10/2026: **91 file test qua, 821 test qua, 1 bỏ qua**;
`npm run typecheck`, `npm run build:extension` và `git diff --check` qua.
Lệnh test dùng `node scripts/run-node24.mjs node_modules/vitest/vitest.mjs run --maxWorkers=2`
với `C:\Program Files\Git\usr\bin` bổ sung vào PATH của tiến trình test để có
OpenSSL. Lượt chạy mặc định nhiều worker gặp timeout ở test cloud; giảm số
worker giải quyết được mà không đổi timeout hoặc mã của các test đó.

Giao diện đã được kiểm tra trong Chrome bằng build thực + shim fixture offline
chỉ phục vụ xem thử cục bộ. Ảnh ở `test-results/google-direct-lab-preview.png`.
Kiểm tra UI gồm hiển thị đúng 19 câu/17 entry trên nhánh CCCD, sửa đáp án riêng,
ẩn/hiện payload, bỏ kết quả cũ khi đổi nguồn và không gửi request/ghi storage.
Đã mở trang Lab từ extension Online thật và đọc được schema form qua phiên Google.
Không tính preview offline là nghiệm thu upload hoặc gửi phản hồi.

Bản executor có thêm 8 ca kiểm tra: chạy tự động theo nhánh, lưu khóa trước POST
cuối, giữ khóa khi chưa rõ, chặn lượt cũ đang chạy, đổi tài khoản, Google trả lại
trang validation, không POST lặp và giữ nguyên reference upload Google. Bộ chung
đã qua **829 test, 92 file; 1 test bỏ qua**. Bản build có cả `dist` và `dist-cloud`.
