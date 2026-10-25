# Các trường hợp không lấy được hoặc không dùng được link Facebook

Rà soát theo luồng của bản 1.9.3 ngày 25/10/2026. Đây là danh sách các điểm chặn trong mã và các điều kiện vận hành đã xác định; Facebook có thể thay đổi giao diện hoặc cách phân phối nội dung về sau.

## Lỗi đã sửa

- Website chưa nhận trạng thái quyền/bộ đọc của từng profile, chỉ thử lần lượt profile đang kết nối. Nay extension báo quyền khi kết nối, khi quyền thay đổi, khi kiểm tra lại và theo heartbeat. Website gắn trạng thái vào đúng kết nối đã xác thực, không dùng chung giữa tài khoản hay profile.
- Sau khi thử profile thiếu quyền rồi chuyển sang profile chạy được, `lastError` cũ có thể còn hiển thị. Nay lỗi nguồn được theo dõi riêng và xóa khi WATCH thành công.
- Có quyền Facebook chưa đồng nghĩa script đọc bài đã được đăng ký. Nay tự khôi phục đăng ký script khi đã có quyền; panel giữ nút “Kiểm tra lại bộ đọc Facebook”. Không tự xin thêm quyền.
- Nguồn đọc trước đây nằm trong phần thu gọn, không đổi được khi lịch đã bật. Nay luôn hiện tên, 8 ký tự cuối mã profile, trạng thái quyền/bộ đọc; có thể đổi nguồn trong lịch đang chờ.
- Banner đọc Facebook trước đây luôn dùng nền xanh. Nay thiếu điều kiện/chờ là vàng, lỗi là đỏ; xanh khi chốt đủ link hợp lệ. Quyền được cấp chỉ xác nhận khả năng đọc, không xác nhận bài đã đọc thành công.

## A. Chưa thể kết nối đến bộ đọc

| # | Trường hợp | Dấu hiệu và cách xử lý |
|---|---|---|
| 1 | Cấp quyền ở Chrome profile khác | Đối chiếu 8 ký tự cuối mã profile trên panel với nguồn đọc trên website. Cấp quyền hoặc chọn đúng nguồn. |
| 2 | Profile extension liên kết với tài khoản website khác | Quyền không xuất hiện trong tài khoản đang xem. Mở đúng tài khoản quản lý; không dùng quyền của profile thuộc tài khoản khác. |
| 3 | Chưa cấp quyền, từ chối hoặc thu hồi quyền Facebook | Vàng “chưa cấp quyền”. Bấm Cho phép trong extension của đúng profile. |
| 4 | Có quyền nhưng mất/chưa đăng ký script | Tự khôi phục khi kết nối/kiểm tra; dùng nút kiểm tra lại. Nếu Chrome chặn scripting, báo lỗi cụ thể. |
| 5 | Extension cũ chưa hỗ trợ săn link | Kiểm tra năng lực qua PING; không gửi WATCH vào phần điều khiển form cũ. Cập nhật extension trong đúng profile. |
| 6 | Extension hỗ trợ đọc nhưng quá cũ để báo quyền | Website hiện “chưa xác nhận quyền · cập nhật extension”; vẫn có thể thử đọc theo năng lực, không tự khẳng định thiếu quyền. |
| 7 | Extension tắt, bị gỡ, bị lỗi hoặc thư mục extension bị di chuyển | Profile mất kết nối. Bật/nạp đúng bản extension. |
| 8 | Chrome/profile đóng; máy ngủ, tắt, hết mạng | Bộ đọc không hoạt động. Giữ máy và đúng Chrome profile mở, có mạng. Website mở riêng không thay thế bộ đọc. |
| 9 | Profile bị hủy liên kết/xóa; token không hợp lệ | Không dùng được kết nối cũ. Liên kết mới nếu muốn sử dụng lại. |
| 10 | WebSocket đến bộ điều phối lỗi, proxy/VPN/tường lửa chặn | Thiếu heartbeat/không xác nhận lệnh; kết nối lại. Không coi thông báo quyền cục bộ là bằng chứng server đã nhận. |
| 11 | Backend đang deploy, khởi động lạnh, mất lease/DB hoặc tài khoản bị chặn | Điều phối chưa sẵn sàng; khôi phục backend/quyền tài khoản. Hệ thống dừng cấp lệnh khi không lưu được tiến độ. |
| 12 | Ghim nguồn đọc vào profile offline/thiếu quyền trong khi profile khác đủ quyền | Đổi Profile đọc Facebook sang nguồn đúng hoặc tự chọn. Không tự bỏ qua lựa chọn ghim của người dùng. |
| 13 | Tất cả nguồn đọc đều không xác nhận WATCH hoặc lỗi | Luân phiên các nguồn hợp lệ, có nhịp nghỉ sau khi thử hết; sửa lỗi cụ thể hoặc dán link thủ công. |

## B. Mở được Facebook nhưng không đọc đúng bài

| # | Trường hợp | Dấu hiệu và cách xử lý |
|---|---|---|
| 14 | URL không phải liên kết trực tiếp được hỗ trợ | Chỉ nhận HTTPS `facebook.com`/`www.facebook.com`, `story.php?story_fbid=…&id=…` hoặc `/OWNER/posts/ID`. Link share, mobile, permalink.php, reel, trang cá nhân/feed cần đổi sang link trực tiếp. |
| 15 | Chuyển hướng sang một mã bài khác/khác dạng ID | Khóa bài không trùng; từ chối để tránh đọc nhầm. Kiểm tra URL cuối cùng, sửa lịch nếu cần. |
| 16 | Bài đã xóa, ẩn, giới hạn đối tượng/tuổi/khu vực, hoặc tài khoản bị chặn | Không có nội dung bài. Đăng nhập tài khoản được phép xem hoặc dùng nguồn công khai phù hợp. |
| 17 | Facebook bắt đăng nhập thực sự, checkpoint, CAPTCHA, xác minh | Người dùng cần hoàn tất trên đúng profile. Chỉ đóng lời mời đăng nhập có thể bỏ qua khi bài công khai đã có nội dung. |
| 18 | Facebook/mạng lỗi, tải trang trắng, timeout, rate limit | Đợi tải và thử lại; bộ đọc chừa thời gian cho SPA. Nếu lỗi kéo dài cần khôi phục mạng/phiên Facebook. |
| 19 | Script chưa chạy trong tab mở từ trước, worker lỗi/extension vừa reload | Khôi phục script; tải lại đúng cửa sổ bài. Server cần nhận lại trạng thái quyền và WATCH. |
| 20 | Facebook đổi DOM, không tìm thấy vùng nội dung bài | Không quét cả feed để đoán. Cần cập nhật selector theo DOM thực tế; có thể dán nội dung/link tạm thời. |
| 21 | Có nhiều bài/vùng nội dung không xác định duy nhất | Từ chối đọc nhầm; mở permalink của đúng bài, đóng lớp xem bài khác. |
| 22 | Bài bị thu gọn, nút Xem thêm không nhận diện/bấm được | Link chưa có trong DOM. Mở rộng bài; cần cập nhật cách nhận diện nếu Facebook đổi nhãn. |
| 23 | Link chỉ trong ảnh, video, bình luận, tệp đính kèm hoặc trang bên ngoài | Bộ đọc hiện đọc phần thông điệp bài, không OCR và không suy đoán từ bình luận. Dán link xác minh được hoặc sửa nguồn. |
| 24 | Nội dung quá dài trên 120.000 ký tự, dữ liệu sai cấu trúc | Bị giới hạn/từ chối báo cáo; rút gọn/dán trực tiếp link đúng HSK. |
| 25 | Đóng cửa sổ theo dõi, chuyển tab đó sang bài khác | Phiên đọc dừng hoặc khóa bài không khớp; hệ thống cần mở lại đúng bài. |
| 26 | Lịch/nguồn đã đổi, token cũ, frame/tab gửi sai | Báo cáo bị từ chối có chủ đích. Chỉ nguồn được chọn, top frame, lịch và token hiện tại được nhận. |

## C. Đã đọc nội dung nhưng chưa có link hợp lệ

| # | Trường hợp | Dấu hiệu và cách xử lý |
|---|---|---|
| 27 | Đơn vị tổ chức chưa đăng link, đăng trễ hoặc đã gỡ link | Đọc bài được nhưng HSK vẫn “Chờ link”. Theo dõi lần đọc gần nhất; dán link khi đã xác minh. |
| 28 | Link không phải Google Forms được hỗ trợ hoặc sai URL | Chỉ HTTPS forms.gle và docs.google.com/forms ở đường dẫn nhận diện hợp lệ; không nhận link chỉnh sửa, HTTP, domain giả, URL có thông tin đăng nhập. |
| 29 | Facebook bọc link qua bộ chuyển hướng lạ/nhiều lớp | Chỉ giải mã các wrapper l.php được nhận diện; không theo link tùy ý. Dán URL Google Forms thật. |
| 30 | Thiếu nhãn HSK 1–6, chỉ ghi HSKK hoặc cách đặt nhãn mới | Không đoán cấp độ. Dán vào ô đúng HSK hoặc cập nhật parser theo mẫu thực tế. |
| 31 | Một dòng gộp nhiều HSK nhưng không chỉ rõ từng URL | Không thể gán duy nhất; từ chối chọn bừa. Tách từng link theo HSK. |
| 32 | Link cách nhãn quá xa hoặc rơi sang mục khác | Parser chỉ gắn trong ngữ cảnh gần nhãn; dán từng link đúng cấp độ. |
| 33 | Một HSK có nhiều URL khác nhau | Báo xung đột, không dùng URL đầu tiên. Xác minh link đúng rồi nhập tay. Lặp lại cùng URL song ngữ được gộp. |
| 34 | Ngày/giờ đăng ký trong bài khác lịch cấu hình | Hiện link cùng lỗi đối chiếu, chặn chạy theo link sai đợt. Sửa lịch hoặc dùng diễn tập đúng mục đích. |
| 35 | Chỉ có form thử hoặc thiếu nhãn form thử khi diễn tập | Không lấy form thử làm link thật; diễn tập cũng không tự lấy form thật khi thiếu form thử. |
| 36 | Có link nhưng thuộc HSK khác danh sách profile đã chọn | Chỉ chốt các HSK cần dùng, không gán link cấp khác sang profile. |
| 37 | Link đã bị người dùng loại hoặc nhập tay ghi đè | Facebook không được phục hồi link đã loại/đè link thủ công. Dùng “Dùng link này” hoặc “Đổi link & chạy lại” sau khi kiểm tra. |

## D. Bộ đọc đã dừng theo trạng thái lịch

| # | Trường hợp | Dấu hiệu và cách xử lý |
|---|---|---|
| 38 | Chưa bật lịch, chọn dán thủ công hoặc diễn tập có link thử trực tiếp | Không mở Facebook là hành vi đúng. |
| 39 | Lịch tạm dừng, bị hủy, đã phát hết lệnh, đã hết hạn | Không tiếp tục săn link. Lịch Facebook hiện hết hạn sau giờ cấu hình 2 phút; tạo lịch mới/điều chỉnh nếu bài đăng muộn. |
| 40 | Lease bộ đọc 25 giây không được gia hạn | Bộ đọc tự dừng an toàn; khôi phục kết nối để điều phối mở lại. |
| 41 | Đã chốt đủ link cho các HSK cần dùng | Ngừng tải lại Facebook; vẫn giữ cửa sổ để xem. Không phải lỗi. |

## E. Đã có link nhưng profile chưa chạy — cần phân biệt

Các trường hợp sau không phải lỗi lấy link: chưa gán HSK/chưa chọn profile; thiếu email/hồ sơ/ảnh; hồ sơ chưa đồng bộ hoặc xung đột; tab form chưa chuẩn bị; profile offline/bận; hết hạn mức chạy đồng thời; tài khoản không được Live; form đóng/chưa mở/bị xóa/cần đăng nhập Google hoặc sai tài khoản; thiếu đáp án xác thực; khóa chống gửi lại/lượt gửi chưa chắc chắn; lịch bị dừng. Website phải hiển thị tại đúng HSK/profile thay vì quay lại yêu cầu quyền Facebook.

## Kiểm thử và phạm vi

- Có kiểm thử chọn nguồn đã cấp quyền, bỏ nguồn biết chắc thiếu quyền, quyền vừa thay đổi, đổi nguồn đang chạy, xóa lỗi nguồn cũ, kiểm tra năng lực extension cũ và cách ly tài khoản.
- Có kiểm thử DOM bài HANU thực tế đã lưu, link song ngữ HSK 3–6, form thử, wrapper Facebook, nhầm ngày, nhiều link và vùng bình luận.
- Có kiểm thử việc xóa profile qua website và extension, yêu cầu xác nhận, ảnh Storage, lịch sử, khóa, mã relink cũ, profile offline, dữ liệu tài khoản khác và lỗi Storage có thể thử lại.
- Kiểm thử tự động dùng dữ liệu giả; không gửi đăng ký thật và không xóa profile thật của người dùng.
