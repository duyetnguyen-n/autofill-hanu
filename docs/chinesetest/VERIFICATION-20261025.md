# ChineseTest: môn đi kèm, duy trì phiên và giao diện — 25/10/2026

## Nguyên nhân và sửa đổi

- API thật của Dong A HSK 4 IBT ngày 13/12/2026 trả hai dòng môn đi kèm: Speaking mới `60202044`, sau đó HSKK trung cấp `984459`. Điều kiện `jiList.length === 1` của runner gây lỗi “Cần kiểm tra thủ công danh sách môn đi kèm”.
- Mã trang chính thức dùng dòng đầu để gọi validJiLian và điền jlKmId. Runner làm giống luồng này, xác minh mã dòng đầu, không bỏ qua dòng đầu lỗi để đoán dòng sau. Giao diện chỉ hiển thị môn được chọn; quote giữ mã môn để chặn thay đổi dù phí không đổi.
- Phí API thật: điểm thi 35 USD, validJiLian 25 USD, getKsFees đã trả tổng 60 USD. Giữ 60, không cộng thêm 25 lần nữa.
- Sau Bật lịch, kiểm tra danh tính mỗi 5 phút, kể cả waiting_center. Chờ phản hồi trước khi lên lịch tiếp; dùng chung promise với kiểm tra trước giờ/gửi. Dừng theo vòng đời lịch; lỗi tạm thời có backoff và không tự báo hết phiên. Không làm lại phép thử thời hạn/401 theo yêu cầu người dùng.
- Kiểm thử trình duyệt bắt được hộp hồ sơ có lúc bị aria-hidden khi mở lại sau hộp khác, đặc biệt lúc mọi trường đang bị khóa để tải. Đã kích hoạt modal sau khi thư viện quan sát surface, giữ focus khi khóa các nút để xác minh. Kiểm tra mở lại nhiều lần, bàn phím và nút Đóng.
- Website kiểm tra enrollmentChecksVersion:1, cảnh báo và chặn chuẩn bị/bật lịch/kiểm tra API/phí bằng runner cũ; không chặn Dừng hoặc đọc trạng thái.

## Đối chiếu API thật

Phiên người dùng đăng nhập mới trong Chrome riêng, lưu mã hóa ở thư mục nghiên cứu riêng. Engine kiểm thử dùng hồ sơ giả, không ghi kho runner thật. Tất cả provider POST bị chặn ở lớp client.

Kết quả **23:57:23 ngày 24/10, giờ Việt Nam**: quote → inspect → prepare → arm → lịch Test đạt; tổng 60 USD, môn 60202044, **0 provider POST**. Không sửa hồ sơ, upload ảnh, gửi đăng ký hay thanh toán trên ChineseTest.

Nguồn đối chiếu: [frontend đăng ký chính thức](https://www.chinesetest.cn/_nuxt/059c7f0.js), API getJiLianList/getKsFees/validJiLian cho đúng mục tiêu đã nêu. Bằng chứng cục bộ không chứa token: test-results/chinesetest/audit-20261024/real-api-acceptance.json.

## Kiểm thử và phát hành

- ChineseTest: 94 bài đạt, 17 files; toàn dự án: 711 đạt, 1 bỏ qua, 82 files.
- Typecheck cả hai cấu hình và build server/web/runner đạt.
- Edge thật trên Windows: ảnh tải/đọc/giải mã trước thành công; lỗi đọc/giải mã và thử lại không POST trùng; không lưu bản gốc/nháp ở DB/Storage; danh mục 10 điểm với mục đã chọn; tìm trường ẩn; chỉ hiện môn đầu; API inspection và lịch Test; xác minh đã hủy có loading/lỗi/thành công; mobile/dark; mở lại hồ sơ ba lần khi tải chậm, focus bàn phím và Đóng; cảnh báo/chặn runner cũ. Không gửi đăng ký thật.
- Windows native và chính gói Windows mới với runtime đóng kèm đều đạt: DPAPI, worker, liên kết, relay mã hóa, chống replay, UI local, Origin và Dừng. Gói Mac ARM64/Intel và Windows đạt SHA256/CRC/hash runner; runtime Mac đúng kiến trúc và quyền thực thi.
- Cùng mã nguồn cho Windows, Mac ARM64 và Mac Intel. Kiểm tra ZIP/hash/kiến trúc/quyền thực thi không thay thế chạy native Mac; máy hiện tại là Windows.

Không kiểm chứng việc giữ phiên cả đêm hoặc tranh slot đúng giờ mở. Không dùng đăng ký Live để kiểm thử đợt này.

Một lần chạy toàn bộ suite đồng thời với nén gói/native smoke bị timeout 5 giây ở test rollback SQLite không thuộc ChineseTest. Chạy lại nguyên suite với cùng giới hạn hai workers sau khi đóng gói xong: **711 đạt, 1 bỏ qua, 82 files đạt**; không tăng timeout hay sửa test để bỏ qua lỗi.

## Bản đã deploy và kiểm tra production

Trong lúc thực hiện, origin/main có thêm commit Facebook 530bc86. Đã giữ nguyên thay đổi đó và rebase bản ChineseTest lên trên. **Bản kết hợp cuối: 720 bài đạt, 1 bỏ qua, 83 files đạt**, typecheck đạt, build server/web đạt, chạy lại toàn bộ luồng UI Edge đạt. Mã ChineseTest và các bundle runner không thay đổi bởi commit Facebook.

- Commit ứng dụng: **fd897ec2e6a8fd77d0f6c2ade03e6a0936986423**.
- [Deploy Render](https://dashboard.render.com/web/srv-db74o9qd0e5s73b25jng/deploys/dep-dbeec4ss728c73bvg21g): Deploy succeeded / Live; coordinator ready lúc **00:11:33 ngày 25/10, giờ Việt Nam**.
- `/healthz`, `/readyz`, `/api/auth/config` đạt; ChineseTest được bật. Asset `/assets/Page-KJWB8xnW.js` trên production khớp byte với bản local đã kiểm thử, SHA256 `eed5d58ffe1ea754cb7a1c8d84d05cb853dbb30aadc2e26ed646c54d13aa5379`.
- Đã tải đủ cả Windows x64, Mac ARM64 và Mac Intel từ production: HTTP 200, SHA256 khớp danh sách phát hành, ZIP CRC đạt, hash main/worker khớp bản Windows đã kiểm thử. Hai runtime Mac đúng CPU và có quyền thực thi.
- Đã giải nén **chính ZIP Windows tải từ production** và chạy native smoke bằng Node đóng kèm: DPAPI/worker/liên kết/relay mã hóa/chống replay/Origin/Dừng đạt. Không có request tới ChineseTest trong native smoke.
- Trình duyệt đã đăng nhập tải lại được trang production, đọc lại máy Windows và ba lượt lịch sử. Cảnh báo cần runner mới xuất hiện đúng; không có lỗi console của mã ứng dụng trong lượt này (log lỗi của extension ngoài ứng dụng được tách theo URL nguồn).
- Chưa thay tiến trình runner đang mở trên máy người dùng; cần dừng lịch, mở gói mới trên đúng máy và giữ nguyên kho dữ liệu/liên kết. Deploy website không tự thay executable. Không thay/khởi động lại runner hoặc sửa hồ sơ/lịch của thiết bị khác để phục vụ kiểm thử.
- Đã dừng client nghiên cứu định kỳ sau khi kiểm tra xong. Không để tác vụ thử nghiệm tiếp tục tạo lưu lượng nền.

Native Mac vẫn chưa chạy vì máy kiểm tra hiện tại là Windows. Các gói mới và mã dùng chung đã phát hành; kiểm tra ZIP không được báo thành kiểm chứng native macOS.

Bằng chứng cục bộ (được bỏ qua bởi Git): `test-results/chinesetest/production-20261025/production-check.json`, `package-verification.json`, `render-live.jpg`; ảnh luồng UI ở `test-results/chinesetest/`.
