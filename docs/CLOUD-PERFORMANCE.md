# Tối ưu tốc độ đăng ký trên cloud

Dashboard đã được bổ sung truyền phần thay đổi để giảm băng thông realtime;
xem [số đo và cách triển khai ngày 21/10/2026](REALTIME-BANDWIDTH.md). Tần suất
cập nhật và luồng điền/điều khiển extension giữ nguyên.

Trong lượt chạy, coordinator giữ tiến độ, trạng thái thực thi và heartbeat của
từng profile trong bộ nhớ. Website nhận trạng thái trực tiếp từ bộ nhớ, cập nhật
tối đa khoảng 10 lần/giây; không đọc lại PostgreSQL cho từng câu hỏi. Extension
vẫn lưu trạng thái và khóa của nó trong Chrome storage như trước.

## Khi nào phải chờ database

- **Trước START:** kiểm tra hồ sơ, phiên bản, ảnh và khóa gửi; lưu nhóm và snapshot
  của mọi profile trong một transaction. Kiểm tra tối đa 4 profile song song;
  thao tác lưu nhóm dùng truy vấn theo lô, khóa profile theo thứ tự ổn định.
- **Trong lúc điền/chuyển trang:** cập nhật tiến độ và quyền renderer dùng bộ nhớ,
  không truy vấn DB. Link rút gọn chưa biết form ID vẫn cần kiểm tra khóa một lần
  sau chuyển hướng. Coordinator tiếp tục gia hạn server lease dùng chung mỗi
  20 giây; mất lease hoặc không lưu được kết quả thì dừng kết nối.
- **Ngay trước Gửi:** ghi tiến độ mới nhất cùng khóa gửi trong một transaction có
  kiểm tra server lease và trạng thái nhóm. Chỉ trả quyền Gửi sau khi COMMIT.
  Không dời khóa này tới sau Gửi vì sẽ mất khả năng chống gửi trùng khi crash.
- **Khi kết thúc, chờ thao tác, dừng hoặc mất kết nối:** ghi snapshot mới nhất và
  trạng thái thực thi. Các thao tác quản lý cần dữ liệu mới cũng có barrier lưu
  tiến độ trước khi thay đổi dữ liệu.

Khi Stop/Pause được coordinator xử lý, bộ nhớ chặn cấp quyền trang ngay cả khi
DB còn đang ghi. Resume sau reconnect tạo lại gate từ dữ liệu đã lưu. Nếu server
crash lúc điền, DB còn snapshot khởi động; recovery đánh dấu lượt đang dở là
paused, cần đối chiếu với extension rồi chủ động tiếp tục. Tiến độ trung gian
trên server có thể mất trong crash, nhưng khóa Gửi đã cấp vẫn ở DB và extension.

## Số đo fixture, ngày 14/10/2026

Đây là mô phỏng độ trễ DB, không phải đo Google Forms/Render/Supabase production.
Dùng WebSocket handler, Coordinator và PostgresStore thật; PostgreSQL fixture
là PGlite. Kịch bản hàng đợi dùng một profile, không mở dashboard hay tải ảnh.

| Kịch bản | Trước | Sau |
| --- | ---: | ---: |
| 10 cặp STATE/EXECUTION rồi cấp quyền trang; thêm 100 ms/truy vấn | 17.913 ms | 17 ms |
| Truy vấn trên đường cấp quyền ở kịch bản trên | khoảng 164 | 0 |
| START 4 profile, một ảnh/profile; thêm 100 ms/truy vấn | 4.717 ms | 1.660 ms |
| Số truy vấn START | 52 | 36 |

Các thời gian có thể thay đổi theo tải máy. Các số trước thay đổi được ghi trong
lần chẩn đoán ban đầu; script chẩn đoán trong `test-results` là artifact cục bộ
và không được đưa vào gói deploy. Regression tests kiểm tra 0 truy vấn trong
luồng đăng ký, UI vẫn nhận tiến độ, lưu kết quả khi kết thúc, Stop/Resume,
recovery và quyền Gửi một lần kể cả khi server lease hết hạn.

Kiểm thử trình duyệt với **4 profile**: lần cuối Test hoàn thành khoảng **8,7 giây**,
có 4 renderer lease và 4 dropdown hoạt động chồng thời gian. Test không gửi;
Live gửi đúng một lần/profile; Resume sau khi gửi bị từ chối. Fixture có dropdown
chờ 1,8 giây, upload ảnh giả, chuyển tài liệu và đáp án câu cuối dùng chung. Đây
vẫn là form fixture cục bộ, không phải tốc độ đăng ký trên Google Forms thật.
Kiểm tra thêm sau Live: trạng thái completed, lịch sử và khóa gửi đã được lưu
cho cả bốn profile trong PostgreSQL.

## Triển khai

Chỉ cần build/deploy backend và website (`npm run build:cloud-server`). Không
đổi giao thức hay dữ liệu extension; extension Online hiện có tiếp tục dùng
được. Không cần migration mới. Dừng mọi lượt trước khi cập nhật backend và làm
theo `DEPLOY-AGAIN.md` vì coordinator hiện chỉ hỗ trợ một instance hoạt động.
