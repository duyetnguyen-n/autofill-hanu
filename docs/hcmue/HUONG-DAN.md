# HCMUE Runner

HCMUE là chức năng riêng của website. Google Forms tiếp tục dùng luồng hiện tại.

## Dùng trên máy

1. Tải gói đúng máy: macOS Apple Silicon (arm64), macOS Intel (x64), hoặc Windows x64. Giải nén vào thư mục riêng. Gói có Node.js kèm theo, không cần cài Node/npm.
2. macOS: mở `Start HCMUE.command`. Windows: mở `Start HCMUE.cmd`. Nhập địa chỉ HTTPS của website điều khiển. Giữ cửa sổ này mở. Các gói chưa ký số; cần kiểm tra nguồn trước khi cho phép chạy trong cài đặt bảo mật của hệ điều hành.
3. Trên website, mở HSK HCMUE, chọn Liên kết máy, nhập mã từ cửa sổ Runner. Mã có hạn 5 phút. So sánh toàn bộ dấu vân tay trên hai cửa sổ rồi xác nhận.
4. Thêm tài khoản HCMUE bằng CCCD và mật khẩu. Mật khẩu chỉ dùng cho lần đăng nhập; phiên và cookie được mã hóa trên máy bằng khóa trong Keychain (Mac) hoặc DPAPI (Windows).
5. Hoàn tất ảnh thẻ và xác thực email tại trường. Chọn tài khoản, tải kỳ thi và chọn đúng cấp/đợt. Danh sách lấy từ HCMUE, không giới hạn cứng theo cấp.
6. Giờ gửi mặc định là giờ mở chính thức, hoặc thời điểm tương lai nếu đợt đã mở. Có thể chọn muộn hơn. “Chuẩn bị chạy ngay” chọn một thời điểm gần nhất có thời gian để kiểm tra, chưa tự bật lịch.
7. Dùng chế độ “Kiểm tra, không gửi đơn” trước. Chuẩn bị, trả lời các câu hỏi riêng nếu có, rồi bấm Bật lịch và xác nhận. Live dùng cùng luồng nhưng gửi đăng ký thật, cần quyền Live trên website.
8. Máy phải bật, Runner còn chạy và có mạng. Runner cố giữ máy thức, nhưng đóng nắp laptop hoặc chính sách hệ điều hành vẫn có thể làm máy ngủ. Bật tự đồng bộ giờ trong hệ điều hành. Không chỉnh giờ khi đã bật lịch.
9. Nếu website đóng hoặc mất kết nối, lịch đã được máy xác nhận vẫn chạy. Dùng “Dừng tất cả trên máy” trong cửa sổ local để dừng. Website chỉ báo dừng sau khi máy xác nhận. Không thể thu hồi yêu cầu đã gửi tới trường.
10. Khi có mã đăng ký, mở lịch sử đăng ký trên HCMUE để kiểm tra và thanh toán trong hạn. Runner không tự thanh toán hoặc hủy đơn.

## Kết quả cần hiểu đúng

- “Sẵn sàng”: đã chuẩn bị nhưng CHƯA bật lịch.
- “Đã bật lịch” / “Sắp gửi”: đã lưu lịch trên máy.
- “Đang gửi”: đã bắt đầu gọi API; chưa khẳng định có slot.
- “Trong hàng đợi”: theo dõi job của trường, chưa khẳng định có slot.
- “Chờ thanh toán”: đã có mã đăng ký. Hạn hiển thị được đối chiếu từ trường nếu API trả đủ dữ liệu.
- “Chưa rõ kết quả”: kiểm tra kết quả ở trường. Không bấm gửi lại khi chưa đối chiếu. Runner không tự lặp POST vì timeout.

Mỗi máy tối đa 20 tài khoản, có thể thấp hơn tùy quyền website. Mỗi tài khoản chỉ bật một lịch cùng lúc. Không dùng cùng một tài khoản trên nhiều máy. Mỗi máy có kho riêng nên không thể khóa gửi trùng xuyên máy.

Runner khởi động lại không phát lại lịch đã bật. Lịch chưa gửi sẽ dừng; lịch đã có khả năng gửi sẽ chuyển sang cần đối chiếu. Nếu câu hỏi, hồ sơ hoặc kỳ thi thay đổi, phải chuẩn bị lại. Không hỗ trợ vượt CAPTCHA, diện liên kết có mã, thanh toán hoặc hủy đơn.

## Dữ liệu và vận hành

- macOS: `~/Library/Application Support/HcmueRunner`; Windows: `%LOCALAPPDATA%\HcmueRunner`.
- Kho `state.enc` chứa phiên, khóa thiết bị và lịch đã mã hóa. Không chia sẻ kho hoặc xuất token.
- Mỗi kho chỉ có một tiến trình Runner. Đóng bằng Ctrl+C ở cửa sổ khởi chạy để dừng ứng dụng.
- Hủy liên kết thiết bị sẽ dừng lịch và xóa tài khoản/lịch khỏi kho Runner khi máy nhận được thông báo. Máy đang offline phải được dừng tại chỗ trước.
- Gửi đúng giờ trên máy không bảo đảm slot: mạng, hàng đợi và xử lý của máy chủ trường quyết định kết quả cuối. Số mili giây hiển thị là độ lệch lúc bắt đầu gửi trên máy, không phải thời điểm máy chủ nhận.
