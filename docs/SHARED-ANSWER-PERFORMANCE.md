# Tốc độ áp dụng đáp án chung

Nút **Áp dụng và tiếp tục các profile đã chọn** gửi một POST `/api/final-question`
với `resume: true`. Coordinator kiểm tra mọi profile trước khi cập nhật, đọc tối
đa 4 profile song song và giữ run ID của từng profile từ lần kiểm tra này.

Sau đó từng profile thực hiện độc lập: xác nhận `SET_FINAL_QUESTION`, lưu đáp án
vào lượt và lịch sử, rồi `RESUME` đúng run ID. Profile phản hồi nhanh có thể tiếp
tục trong lúc profile khác còn chờ xác nhận. Website vẫn chờ kết quả của mọi
profile để báo thành công hoặc chỉ ra các profile lỗi.

Trước đây website đợi toàn bộ nhóm cập nhật xong rồi gửi thêm một HTTP request
Resume cho mỗi profile. Với N profile, luồng mới giảm từ 1 + N request xuống 1,
đồng thời bỏ một lần đọc session dư cho mỗi profile. Lệnh đến extension vẫn được
xác nhận; quyền Gửi vẫn phải đi qua khóa gửi đã lưu. Test vẫn dừng trước Gửi.

Profile cập nhật lỗi không được tiếp tục; các profile cập nhật thành công vẫn
tiếp tục. Nếu lưu được đáp án nhưng Resume lỗi, kết quả chỉ rõ hai trạng thái
này để người dùng đối chiếu. API không truyền `resume: true` vẫn chỉ cập nhật
đáp án, tương thích với giao diện cũ.

Thêm profile lưu trong danh sách làm tăng dữ liệu dashboard. Chạy nhiều Chrome
profile đồng thời còn tăng tải CPU, RAM, mạng và database; thời gian không nhất
thiết tỷ lệ thuận với số profile vì các bước điền chạy đồng thời. Giới hạn đọc
4 profile là giới hạn kiểm tra ban đầu, không phải giới hạn số form đang điền.

Kiểm thử có profile chậm xác nhận, lỗi cập nhật/lưu/Resume, thay run ID, khóa gửi,
cloud RunBuffer với PostgreSQL fixture và thao tác giao diện xác nhận luồng mới.
Chưa đo mức giảm thời gian trên Google Forms production.

Triển khai backend và website cùng nhau bằng `npm run build:cloud-server` và
quy trình hiện có trong `DEPLOY-AGAIN.md`. Không cần đổi extension hoặc migration.
