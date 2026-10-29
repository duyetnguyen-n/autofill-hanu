# Google Forms Direct 1.9.13–1.9.16 — form đăng ký ngoài LAB

Ngày 29/10/2026. Sửa giới hạn hai mã form LAB đã gây lỗi khi dùng form đăng ký.
Chức năng Google Forms cũ vẫn riêng, không thay engine cũ.

## Phạm vi thay đổi

- Server và extension nhận URL trả lời `docs.google.com/forms/d/e/<id>/viewform`
  hoặc `formResponse`, gồm đường dẫn `/forms/u/<n>/d/e/…` và query.
  Không thêm mã form mới vào allowlist; nhận mã hợp lệ bất kỳ từ URL đã chọn.
- Schema, entry ID, nhánh, lựa chọn và validation lấy từ chính form đang mở.
  Tiếp tục kiểm tra đúng origin, tài khoản, form và fingerprint giữa các trang.
- Bổ sung mã chuyển trang `-2` = tiếp tục section kế tiếp. Đã quan sát trực
  tiếp Google chuyển từ trang cam kết tới thông tin thí sinh bằng nút Tiếp
  trên form độc lập, không suy đoán `-2` là Gửi hoặc tự dựng lịch sử trang.
- Giữ ngoại lệ chạy lặp chỉ cho hai LAB. Form đăng ký ngoài LAB giữ khóa khi
  đã gửi thành công hoặc chưa rõ kết quả, kể cả executor độc lập.
- Trang Direct độc lập truyền URL đã đọc vào executor; bỏ mặc định URL LAB
  khỏi API executor. Chọn Test/Live rõ ràng, Test mặc định. Kiểm tra khóa chưa
  rõ kết quả và thao tác đối chiếu theo đúng form đang chọn.
- Nhãn giao diện là Google Forms Direct; bỏ thông báo giới hạn hai LAB.
- Server nhận capability `googleDirectForms` để yêu cầu Reload 1.9.13 trên
  extension cũ, tránh gửi lệnh form ngoài LAB tới executor cũ còn bị giới hạn.

Đây là mở hỗ trợ form đăng ký theo cấu trúc đọc được, không cam kết tự xử lý
mọi loại câu Google Forms. Câu không biết đáp án/kiểu chưa hỗ trợ giữ luồng
tiếp quản trên form; hiện uploader tự động xử lý một câu tải ảnh trên tuyến.
Link rút gọn cần mở thành URL trả lời đầy đủ trước khi đưa vào Direct.

## Kiểm tra

- Typecheck cả extension và manager đạt.
- Toàn bộ 100 file: **963 đạt, 1 bỏ qua**. Sau thay đổi API URL bắt buộc,
  chạy lại 6 file liên quan: **108 đạt**.
- Build `dist-cloud` và cloud server thành công, phiên bản **1.9.13**.
- Kiểm thử mới gồm URL ngoài LAB trong Test/Live, origin giả/credential/đường
  dẫn sai, extension cũ báo cần Reload, giữ khóa đăng ký đã nhận, không gửi
  cuối ở Test, page độc lập gửi đúng URL đã inspect và schema ID độc lập.
- Fixture đã rút gọn từ form người dùng cung cấp (chỉ mã câu hỏi, lựa chọn,
  nhánh, validation; không có token, tài khoản hoặc câu trả lời cá nhân):
  `tests/fixtures/google-direct-registration.json`.
- URL đối chiếu:
  `https://docs.google.com/forms/d/e/1FAIpQLSdwGr_cZjiXs_AapAIHmP1cdHp5q4_tLWI3fNytLWHtUJW5JQ/viewform`.
  Đã đọc schema thật, kiểm tra nhánh CCCD và câu hỏi năm. Chưa gửi phản hồi.

## Chrome 1.9.13 và bản sửa 1.9.14

Server commit `919bee1` Live lúc 10:02:02. Extension 1.9.13 đã Reload.
Run `f4241407-05ed-4a2a-8d98-1e829056a7fa`, Test với toàn bộ hồ sơ giả:

- Qua các trang cam kết, tên, CCCD và các câu trên trang upload.
- Google xác nhận ảnh tổng hợp 1.229.883 byte sau 9,3 giây (10:03:08–18).
- Sau upload, lúc đi trang ngân hàng Google báo có bản nháp mới hơn, cập nhật
  rồi quay về phần email đầu. Executor phát POST rỗng thay cho khởi tạo
  checkbox/phiên gốc và hết hạn 35 giây. Không có request Gửi cuối.
- Đã Dừng và xóa bản nháp do lượt này tạo. Không tính lượt này thành công.

1.9.14 đổi các bước sau upload trong Test sang điền điều khiển thật và dùng
Next của Google, để chính Google commit bản nháp trước chuyển trang. Live
đủ đáp án vẫn giữ request tuần tự đã kiểm chứng. Nếu cập nhật bản nháp quay
về phần đầu, khởi tạo lại bằng Next gốc và làm mới dấu vết đã thăm một lần;
nếu lặp lại thì giữ form để tiếp quản, không chạy vô hạn hoặc tự Gửi lại.

Typecheck và 111 kiểm thử liên quan đạt, gồm native Next sau upload, quay
về phần đầu không phát POST rỗng, và chặn lặp đổi bản nháp. Đã build extension
1.9.14. Toàn bộ suite bản này: 966 đạt, 1 bỏ qua trên 100 file.

## Chrome 1.9.14 và bản sửa nhãn 1.9.15

Run `820485d5-3352-410b-8e83-ab01e0d27d2f`, Test: Google nhận ảnh sau 11,0
giây (10:07:56–10:08:07), qua ngân hàng lúc 10:08:08, cam kết lúc 10:08:15
và tới trang câu năm lúc 10:08:20. Không còn xung đột bản nháp ở lượt này.
Tại câu cuối, bộ tìm card chưa ghép được nhãn; chưa có request Gửi cuối.

Đối chiếu DOM thật: nhãn chứa `<div>` xuống dòng giữa phần Việt và Trung.
`textContent` ghép sát hai ngôn ngữ, còn metadata có newline; trang này không
có `data-item-id` để làm định danh thay thế. 1.9.15 dùng `innerText` của heading
(fallback `textContent` ở môi trường không có layout), cả ô nhập và câu upload.
Thêm kiểm thử tương ứng không có `data-item-id`. Đồng thời chuyển lỗi injection
thành thông tin câu cụ thể, chờ kết quả injection tạm chưa có và giữ dừng trước
request nếu gặp mã điều hướng chưa nhận diện.

Typecheck và 121 kiểm thử liên quan đạt. Extension 1.9.15 đã build. Giữ form
ở câu cuối để kiểm tra Tiếp tục sau Reload mà không điền lại hay tải ảnh lại.

## Khôi phục 1.9.15 trên Chrome

Sau khi Reload, bấm Tiếp tục trên chính run `820485d5-3352-410b-8e83-ab01e0d27d2f`:
10:15:40 xử lý trang 9/9, 10:15:41 Xong Test. Ô Google thật có giá trị **2026**,
không có request Gửi, không điền lại các trang trước hoặc bàn giao ảnh lần nữa.
Ảnh cục bộ: `test-results/google-direct-registration-20261029/resumed-final-1.9.15.png`.
Sau ghi nhận bằng chứng đã Dừng, xóa bản nháp thử và đóng tab.

Toàn bộ suite cuối: **100 file, 970 đạt, 1 bỏ qua**. Typecheck và build cloud
extension/server đạt; Vite vẫn có cảnh báo kích thước chunk giao diện.

## Lượt sạch 1.9.15

Server commit `fdb63f3` Live lúc 10:17:23. Run
`f9707a9a-fd95-47ab-8624-cb8cf14aa702` chạy Test từ đầu, không can thiệp giữa lượt:
trang 2 lúc 10:17:53, upload 10:17:58–10:18:07 (9,3 giây), ngân hàng
10:18:08, cam kết 10:18:09, câu năm và Xong Test lúc 10:18:11. Manager hiển thị
0:21, tương đương khoảng 22 giây theo log. Câu năm Google thật có **2026**,
hiển thị đã lưu bản nháp. Không phát request Gửi và không tạo phản hồi.
Không coi đây là benchmark tải hoặc cam kết thời gian đăng ký thật.

Ảnh bằng chứng: `test-results/google-direct-registration-20261029/clean-final-1.9.15.png`.
Không đọc được partialResponse qua công cụ do giá trị bị che; không kết luận
đã kiểm toán đầy đủ các reference ẩn từ lần đọc đó.

## Bổ sung dự phòng khi tiếp tục công việc

- Giao diện manager đã thêm nút **Xem hồ sơ của lượt này** trong lịch sử.
  Nút mở snapshot để xem/sửa, không tự ghi đè hoặc đồng bộ; vẫn phải dùng
  nút Lưu và đồng bộ hiện có. Typecheck và build server đạt.
- 1.9.16 cho request Back gốc có `back=1` đi qua bộ giữ Submit trên trang
  cuối, ở cả Test và Live. Back không xin quyền Gửi và không tạo bản Submit
  đã chuẩn bị. Các kiểm thử Gửi Test/Live và khóa Gửi hiện có vẫn đạt.
- 140 kiểm thử liên quan đạt cho thay đổi cuối này. Lượt Chrome hoàn chỉnh
  ở trên dùng 1.9.15; chưa ghi nhận lượt Chrome 1.9.16.
- Khi tiếp tục buổi tối, profile test không còn kết nối, dữ liệu giả vẫn đang
  được lưu trên manager. Đã tìm được bản hồ sơ gốc từ run
  `66edcbd6-fdcb-4e46-aea9-64060552d017` bắt đầu 09:41:25, đủ 19 trường và
  tham chiếu ảnh gốc. Bản khôi phục riêng tư nằm trong thư mục test-results
  được Git bỏ qua. Còn phải đồng bộ trả lại và dọn bản nháp khi profile mở lại.
- Render yêu cầu đăng nhập lại trước khi triển khai nút mở snapshot mới;
  không ghi nhận phần này đã Live khi chưa xác nhận trên dashboard.

## Hoàn tất sau khi kết nối lại

- Người dùng mở lại profile ntduyet260602 và đăng nhập Render. Đã khôi phục
  đủ 19 trường từ snapshot 09:41:25, tên profile/email liên kết giữ nguyên.
  Ảnh gốc `2303220045529.jpg` (1.232.696 byte) được nạp lại từ tệp gốc.
  Manager báo đã lưu và đồng bộ; đóng/mở Chi tiết kiểm tra lại 19/19 trường
  khớp và đúng ảnh gốc. Không gửi hồ sơ gốc tới Google Form.
- Xóa bản nháp Test ở đúng tài khoản Google trên form được cung cấp, xác nhận
  checkbox email trở lại chưa chọn và đóng tab thử. Đã Dừng lượt cũ; dashboard
  giữ Test, ND bỏ chọn, không có profile đang chạy. Không tạo phản hồi mới.
- Người dùng đã xác nhận Reload Online 1.9.16.
- Render báo **Live commit `f9b031e` lúc 22:29:01 ngày 29/10/2026**.
- Kiểm tra UI thực tế nút **Xem hồ sơ của lượt này** trên lịch sử run
  `f9707a9a-fd95-47ab-8624-cb8cf14aa702`: mở đúng dữ liệu giả của snapshot,
  có thông báo chưa lưu. Đóng không bấm Lưu, mở lại kiểm tra đủ 19 trường
  gốc và ảnh gốc vẫn nguyên, trạng thái đồng bộ vẫn đúng.
- Ảnh UI chỉ chứa snapshot giả:
  `test-results/google-direct-registration-20261029/backup-history-control-1.9.16.png`.
- Sau xác nhận khôi phục, xóa bản JSON riêng tư tạm dùng để phục hồi; snapshot
  lịch sử trong app vẫn được giữ nguyên. Không đưa dữ liệu cá nhân vào Git.

Giới hạn đối chiếu: lượt Chrome tự động đầy đủ đã ghi ở trên dùng 1.9.15.
1.9.16 được Reload, kiểm tra nút xem snapshot trên server và 140 test liên
quan đạt; không tạo thêm lượt gửi Google sau khi khôi phục hồ sơ gốc.
