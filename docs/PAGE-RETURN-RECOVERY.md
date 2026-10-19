# Phục hồi khi form trở lại — 1.6.0

Lượt mới giữ ý định `autoContinue` độc lập với trạng thái trang. CAPTCHA/lỗi mạng tạm thời không hủy ý định này. Dừng, Tạm dừng và đóng tab hủy tự tiếp tục; mất kết nối coordinator vẫn yêu cầu đối chiếu như trước.

Content script nhận `pageshow.persisted`, `popstate`, `online`, đồng thời quan sát form khi bị chặn. Trang mới hoặc trang khôi phục chỉ được tiếp tục sau khi background xác nhận cùng run, form, document, tài khoản và quyền quản lý. Trang vừa hiện chưa đủ: CAPTCHA phải hết chặn và điều khiển form phải sẵn sàng. Giữ nguyên các giá trị khớp hồ sơ/đáp án sửa tay; đọc lại dữ liệu thực tế khi Google làm mất bản nháp.

Theo yêu cầu chấp nhận gửi trùng, lượt mới cho phép **tối đa hai lần thử gửi lại** khi đúng form khôi phục sau một document đã gửi. Không tự refresh CAPTCHA, lặp Gửi trên cùng document, hay thử lại sau xác nhận thành công. Mỗi lần thử có số thứ tự; PostgreSQL cấp lại quyền trong transaction, nhật ký vẫn ghi kết quả trước chưa rõ. Quyền cấp lại là idempotent và tiến độ cũ không thể ghi đè lần mới. Dừng hủy tự tiếp tục. Hết hai lần thử vẫn có thể cần xác minh thủ công.

Lưu tiến độ được phép chạy cùng lúc với thao tác điền độc lập; chờ hoàn tất tiến độ trước chuyển trạng thái hoặc chuyển trang. Không bỏ đối chiếu giá trị, tài khoản, ảnh và quyền gửi.

Upload từ máy vẫn giữ điều kiện đã kiểm chứng. Chưa bật chọn ảnh Drive khi chưa xác thực bộ chọn của chính form hỗ trợ và chấp nhận ảnh ở bước Tiếp; không thay tệp bằng URL Drive hoặc giả dữ liệu đính kèm.

## Kiểm chứng

- Unit/integration: document mới, Back từ bộ nhớ, CAPTCHA mất rồi form xuất hiện, Pause/Stop, dữ liệu giữ nguyên, RPC lặp, số lần gửi, PostgreSQL và tiến độ cũ.
- Browser fixture: extension thật, nhiều profile cô lập, WebSocket và PostgreSQL; Back/Forward, reload, lỗi tải, CAPTCHA giả không tải được, tài nguyên chậm, gửi mất xác nhận và thử lại khi trở về form.
- Đo tốc độ tách fixture khỏi Google thật. Không dùng thời gian fixture để cam kết tốc độ Google hoặc suất thi.
