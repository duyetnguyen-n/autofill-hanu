# Tự tiếp tục sau khi sửa lỗi dữ liệu

Khi một lượt chưa gửi dừng vì thiếu dữ liệu hoặc sai định dạng, extension theo
dõi thao tác sửa và trạng thái lỗi ngay trên trang. Với trường văn bản/ngày,
người dùng kết thúc nhập bằng change hoặc rời ô (Tab/click ra ngoài). Sau khoảng
180 ms ổn định, nếu dữ liệu hợp lệ và lỗi đã hết, lượt tự tiếp tục.

Lỗi định dạng tại bước điều hướng yêu cầu các câu bắt buộc trên trang đã hoàn
tất và mọi lỗi hiển thị/native validity đã hết. Câu bắt buộc chưa có dữ liệu
được tự quét tiếp sau khi người dùng hoàn tất câu đó; các câu còn thiếu vẫn
chặn điều hướng. Upload và lựa chọn thủ công tiếp tục được nhận diện.

Những đáp án người dùng vừa sửa được giữ nguyên khi quét lại cùng trang và
cùng lượt; không ghi đè bằng dữ liệu sai từ hồ sơ. Không sửa hồ sơ đã lưu,
không mang đáp án sửa sang lượt mới. Câu cuối dùng chung vẫn được kiểm tra
đúng form, mã câu, nội dung và loại trước khi giữ đáp án đã sửa.

Theo dõi bị hủy khi Pause/Stop hoặc có lệnh chạy mới. Background kiểm tra run
ID, document epoch, form, trạng thái chờ và khóa gửi. Lượt quản lý gửi một yêu
cầu AUTO_RESUME khi đã sửa xong; coordinator mở lại gate đúng lượt rồi gửi
RESUME với `automatic: true`. Nhóm đã Pause/Stop, lượt recovery, lượt đã gửi,
CAPTCHA và câu xác thực chưa khai báo không được tự tiếp tục bằng cơ chế này.
Trạng thái local được kiểm tra lại ngay trước khi lưu running để tránh một
lệnh tự tiếp tục đến muộn ghi đè Pause/Stop.

Test dừng trước Gửi. Live vẫn cần quyền Gửi và khóa chống gửi trùng. Lỗi xuất
hiện sau khi đã cấp quyền/bấm Gửi giữ khóa; không tự gửi lại.

Kiểm tra:

- `npm test`
- `npm run typecheck`
- `npm run build:extension`
- `node scripts/run-node24.mjs scripts/validation-resume-browser-check.mjs`

Kiểm thử trình duyệt chặn URL fixture, không gửi Google Forms thật. Bao gồm
native format validation, nhiều ô lỗi, giữ đáp án sửa, Test/Live và Halt.
Regression tests riêng kiểm tra scope, Pause/Stop, recovery và cloud RunBuffer.

Để dùng Online cần cập nhật cả backend lẫn extension; build extension với
PUBLIC_ORIGIN production rồi Reload trong từng Chrome profile. Không cần
migration database. Deploy backend theo `docs/DEPLOY-AGAIN.md`.
