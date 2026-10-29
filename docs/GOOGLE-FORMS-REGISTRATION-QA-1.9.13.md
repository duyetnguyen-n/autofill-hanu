# Google Forms Direct 1.9.13 — form đăng ký ngoài LAB

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

Kết quả chạy extension trên Chrome được ghi tiếp sau khi Reload bản mới.
