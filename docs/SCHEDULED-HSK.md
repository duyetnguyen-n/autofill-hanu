# Đặt lịch săn link và chạy theo HSK

Bản 1.7.0 thêm một bảng link HSK dùng chung và lịch bền vững trên bộ điều phối.

1. Chọn các profile cùng cấp độ, dùng **Gán HSK cho nhóm chọn** một lần. Khai báo được giữ cho các lần sau, không làm hồ sơ/ảnh mất đồng bộ.
2. Tại một Chrome profile dùng đọc bài, mở panel extension → **Cho phép theo dõi Facebook**. Đây là quyền tùy chọn; những profile đăng ký khác không cần cấp quyền Facebook.
3. Chọn đúng bài Facebook, giờ bắt đầu theo Việt Nam (UTC+7), các profile và chế độ Test/Live. Bật lịch.

Lịch chuẩn bị trước 5 phút, mở bài và kiểm tra hồ sơ/ảnh. Trước giờ chạy 30 giây, chuyển sang chu kỳ yêu cầu tải lại khoảng 1,5 giây khi lượt tải trước đã hoàn tất. MutationObserver đọc riêng phần nội dung bài khi DOM cập nhật. Lượt tải bị treo được thử lại sau 8 giây; lỗi làm giãn nhịp, không tạo nhiều request chồng nhau.

Đúng giờ, nhóm có link hợp lệ được phát lệnh riêng từng profile; không chờ cấp độ còn thiếu hoặc profile bị chậm. Một lần ghi bền vững lưu ý định phân phối cho các profile sẵn sàng, sau đó các START độc lập dùng cơ chế idempotency/khóa gửi hiện có.

Bảng link cập nhật qua WebSocket. Có thể đóng màn quản lý nhưng phải giữ máy, Chrome và bộ điều phối hoạt động. Bản online cần kết nối server; khi mất bộ điều phối, watcher dừng và lượt chạy tuân theo cơ chế phục hồi hiện có. Lịch quá giờ 2 phút không tự chạy muộn. Sau server restart, lịch được đọc lại khi tài khoản/extension kết nối.

## Chọn đúng link

- Chỉ đọc phần message của đúng permalink, không quét cả feed hoặc bình luận.
- Ghép nhãn HSK 1–6 với link trong mục đó; HSKK không được suy thành HSK.
- Loại nhãn form thử, gộp link lặp Việt/Trung; giữ tham số điền sẵn có ý nghĩa.
- Hai link khác nhau của cùng HSK là mâu thuẫn, không tự chọn cái đầu.
- Khi bài ghi rõ giờ/ngày mở đăng ký, chỉ lấy mục phù hợp lịch đặt. Đọc được nội dung mới sẽ thay thế link tự động cũ, kể cả khi link bị xóa.
- Link tự động phải được đọc gần đây (10 giây), không dùng nội dung lỗi/cũ để bắt đầu.
- Profile đã nhận lệnh giữ URL đã chốt; sửa bảng không chuyển form giữa chừng.

Nếu Facebook không đọc được, dán link trực tiếp vào ô HSK (paste áp dụng ngay, gõ tay áp dụng khi rời ô), hoặc dán nội dung bài vào mục dự phòng. Link nhập tay ưu tiên hơn Facebook. Khi đã tới giờ, profile đang chờ đúng HSK tự nhận link, không cần bấm từng profile.

**Hủy lịch chờ** chỉ ngừng watcher và bỏ các lượt chưa phát. **Dừng các lượt theo lịch** dừng những run còn đúng mã của lịch; không chạm một run mới khác trong cùng profile. Nút Dừng/Tạm dừng riêng của profile cũng bỏ chờ profile đó trong lịch hiện tại.

## Cập nhật

Chạy migration bổ sung `supabase/migrations/202610200001_registration_schedule.sql` trước khi deploy backend. Migration chỉ thêm bảng riêng có RLS; không xóa/chỉnh dữ liệu hồ sơ cũ. Nạp extension 1.7.0 vào đúng thư mục extension cũ, Reload, không Remove hoặc xóa storage.

Độ trễ 1,5 giây là khoảng mục tiêu giữa các lần yêu cầu khi trang tải bình thường, không phải cam kết Facebook cập nhật trong 1,5 giây. Phiên đăng nhập, giao diện Facebook thay đổi, mạng, giới hạn truy cập, CAPTCHA và tốc độ Google vẫn có thể làm chậm. Chạy Test trước khi dùng Live; Test vẫn có thể truyền hồ sơ/ảnh sang form đích, luôn kiểm tra đúng đích và dữ liệu được phép dùng.

## 1.7.2 — phiên Facebook, tín hiệu nội dung và diễn tập

Cửa sổ nhỏ dùng phiên Facebook của đúng Chrome/Cốc Cốc profile chứa extension;
không dùng cookie/mật khẩu của profile hoặc trình duyệt khác. Có thể chọn
**Profile đọc Facebook** riêng với các profile đăng ký. Nếu đã đăng nhập trong
profile đó, cửa sổ dùng ngay phiên sẵn có. Với bài công khai đã tải được, extension
đóng lời mời đăng nhập tùy chọn và mở rộng nội dung bài; trang đăng nhập/checkpoint
không có bài công khai vẫn được giữ để người dùng xử lý.

Không lấy HTTP `complete` làm dấu hiệu Facebook đã dựng xong bài. Chỉ khi bộ đọc
xác nhận nội dung bài mới thả chốt tải lại; lượt chưa đọc được có tối đa 8 giây để
khôi phục. Cửa sổ sở hữu được dùng lại khi đặt lịch mới cho cùng bài.

Link đọc được vẫn hiển thị khi ngày bài không khớp lịch, kèm lỗi chặn rõ ràng.
Không tự chạy link của một đợt cũ trong lịch thường/Live. Muốn kiểm tra trọn luồng
với bài cũ: chọn Test và bật **Diễn tập bằng form thử trong bài**. Tool vẫn phân
loại link HSK, nhưng mọi profile chỉ mở link được ghi rõ là form thử trong chính
bài. Thiếu/mâu thuẫn/xóa link form thử thì giữ chờ; không chuyển sang form thật.
Diễn tập không dùng được với Live và luôn dừng trước Gửi. Test vẫn truyền dữ liệu
hồ sơ và ảnh lên Google, nên chỉ chọn hồ sơ được phép dùng trên mẫu thử đó.

## 1.7.3 — chạy ngay khi có link và giữ màn quản lý khi mạng lỗi

- Lịch mới mặc định chuẩn bị ngay sau khi bật; có link hợp lệ đúng HSK là phát lệnh, kể cả trước giờ đặt. Có thể bỏ chọn để chờ đúng giờ.
- Link đã xác nhận không mất hiệu lực chỉ vì Facebook đang dựng lại trang; nội dung bài mới đọc được vẫn thay thế/xóa link và chặn nhầm ngày, cấp độ hoặc form thử nhập nhằng.
- Lỗi mạng/502/503 khi kiểm tra đăng nhập không đưa người dùng về màn Google. Chỉ auth/me xác nhận 401 mới kết thúc phiên; dịch vụ xác thực gián đoạn trả 503 thay vì 401.
- Bàn giao quyền render giữa trang cũ và mới chờ thao tác nhả quyền thực sự hoàn tất; gộp yêu cầu xin quyền trùng cùng trang. Mỗi profile vẫn độc lập.
