# Tốc độ áp dụng đáp án chung

Nút **Áp dụng và tiếp tục N profile đã tới câu cuối** gửi một POST
`/api/final-question` với `resume: true`. Chỉ cần một profile đang chờ đúng câu
hỏi hoặc đã tới bước trước Gửi là có thể áp dụng; không yêu cầu cả nhóm cùng bước.

Coordinator flush, đọc và kiểm tra từng profile độc lập. Profile đang chạy,
mất kết nối, đã khóa gửi, sai form hoặc đang mắc ở câu khác được trả về với
`ok: false, skipped: true`, không nhận SET_FINAL_QUESTION/RESUME. Một profile
đọc database chậm hoặc lỗi không ngăn các profile khác bắt đầu cập nhật.

Sau đó từng profile thực hiện độc lập: xác nhận `SET_FINAL_QUESTION`, lưu đáp án
vào lượt và lịch sử, rồi `RESUME` đúng run ID. Profile phản hồi nhanh có thể tiếp
tục trong lúc profile khác còn chờ xác nhận. Website chờ kết quả request để báo
số đã tiếp tục, số bỏ qua và lỗi riêng. Profile tới muộn có thể áp dụng trong lần
bấm sau. Đáp án mới không được lưu vào profile chưa tới, và không tự tiếp tục chúng.

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
thiết tỷ lệ thuận với số profile vì các bước điền chạy đồng thời. Pool database
điều tiết số truy vấn đồng thời, không giới hạn số form đang điền.

Kiểm thử có profile chậm xác nhận, lỗi cập nhật/lưu/Resume, thay run ID, khóa gửi,
cloud RunBuffer với PostgreSQL fixture, nhóm lẫn trạng thái, áp dụng lần sau cho
profile tới muộn và thao tác giao diện xác nhận luồng mới.
Chưa đo mức giảm thời gian trên Google Forms production.

Triển khai backend và website cùng nhau bằng `npm run build:cloud-server` và
quy trình hiện có trong `DEPLOY-AGAIN.md`. Không cần đổi extension hoặc migration.
