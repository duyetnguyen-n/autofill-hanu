# Chạy lại sau gửi thành công — 1.9.19

Theo yêu cầu người dùng, cả Google Forms cũ (Classic) và Direct cho phép
chủ động chạy lại sau khi Google xác nhận thành công, trên mọi form. Bỏ
giới hạn chỉ hai LAB. Không đánh dấu một phản hồi đã nhận thành chưa nhận.

- UI hiển thị Chạy lại cho cả hai engine sau completed.
- Bộ điều phối, SQLite và PostgreSQL bỏ khóa received của lượt cũ khi
  kiểm tra hoặc cấp quyền cho một run ID mới; vẫn giữ bản ghi và lịch sử.
- Cùng một run ID không nhận quyền Gửi lần hai, kể cả khóa received.
- Khóa uncertain/pending/local_reserved chưa được giải quyết vẫn chặn.
- Classic cập nhật khóa cục bộ thành received khi ghi nhận completed.
  Khóa của bản cũ chỉ được nâng lên received khi còn run được lưu với
  đúng ID/form và trạng thái completed, submitAttempted=true. Không suy
  từ tab đóng, idle hoặc timeout.
- Direct bỏ chặn khóa received của run trước, vẫn chặn run ID cũ và
  khóa chưa rõ, kể cả khóa chưa rõ của Classic cùng form.
- Không tự động tạo lượt mới khi completed; cần hành động chủ động từ
  người dùng. Profile, ảnh và thuật toán điền/request không thay đổi.

Không cần migration xóa dữ liệu: khóa received hiện có được bỏ qua cho
lượt mới theo quy tắc mới. Google vẫn có thể giới hạn một phản hồi/tài
khoản theo cài đặt riêng của biểu mẫu; thay đổi này chỉ bỏ khóa của tool.

Cần cập nhật cả website/server và Reload extension Online từ dist-cloud
để quy tắc có hiệu lực ở hai phía. Tình trạng build/triển khai phải được
đối chiếu khi bàn giao; không coi build cục bộ là đã cập nhật website.

Kiểm tra 30/10/2026: typecheck và build cloud (extension, server, UI) đạt.
Các kiểm thử liên quan ở 8 file đạt tổng 247 ca sau khi cập nhật quy tắc:
Classic background, Direct executor, coordinator/SQLite, UI repeat helper,
PostgreSQL/preflight/grant, archive và run-buffer. Có kiểm tra Chạy lại và
đổi/chạy lại link lịch cho cả hai engine trên form bất kỳ; lần Gửi thứ hai
cùng run ID và pending của lượt mới vẫn bị từ chối. Không tạo thêm phản
hồi trên Google trong lượt sửa khóa này.

Công cụ Chrome hiện trả về “Local browser use is disabled in Work settings”.
Chưa thể thao tác Render hoặc xác minh UI online bằng Chrome. Render cấu
hình autoDeployTrigger off, nên push GitHub không tự triển khai server.
