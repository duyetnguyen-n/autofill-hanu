# HCMUE Runner

HCMUE là chức năng riêng của website. Google Forms tiếp tục dùng luồng hiện tại.

## Mở runner từ website và dùng nhiều máy

- Dùng gói mới, giải nén vào thư mục cố định rồi mở **Start HCMUE**. Start tự thiết lập nút mở từ web; không cài dịch vụ nền hoặc tự khởi động cùng máy.
- Lần đầu, Start mở ô nhập website trên trình duyệt. Dán link website HANU bằng Ctrl+V rồi bấm **Kết nối runner**; không cần dán trong CMD hay chạy quyền admin. Những lần sau Start tự nhớ website, hoặc trên trang HCMUE bấm **Mở runner trên máy này** và chọn **Mở ứng dụng** nếu trình duyệt hỏi. Website chỉ xác nhận kết nối khi nhận được trạng thái của runner.
- Nút luôn mở trên máy đang xem web, không bật máy ở xa. Nếu runner cùng chức năng đã chạy, nút mở lại cửa sổ hiện có, giữ nguyên lịch đang chạy. Mở lại sau khi đã thoát không tự bật lịch cũ.
- Chọn rõ **máy thực hiện đăng ký**. Khi có nhiều máy, trang không tự chọn máy đầu tiên; có thể đánh dấu máy ưu tiên, lưu riêng theo tài khoản/chức năng/trình duyệt. Đăng nhập web ở máy khác không chuyển phiên hoặc lịch và không tự chuyển việc chạy khi máy cũ mất kết nối.
- HCMUE và ChineseTest dùng liên kết mở app, kho phiên, khóa tiến trình và cổng cục bộ riêng; có thể chạy đồng thời. Mỗi chức năng vẫn chỉ chạy một tiến trình cho cùng kho dữ liệu.
- Giữ nguyên thư mục gói sau khi cài. Khi đổi thư mục hoặc cập nhật gói, mở **Start HCMUE** từ gói mới để cập nhật đường dẫn. Gói cũ có thể chạy **Enable web launch** riêng. Giữ nguyên kho dữ liệu để giữ liên kết và lịch sử.

## Dùng trên máy

Trên Windows, nếu thấy **Smart App Control blocked a file that may be unsafe**,
gói `.cmd` hiện có thể bị chặn và chưa được nghiệm thu tương thích SAC. Chạy admin
hoặc Unblock ZIP không bảo đảm giải quyết thông báo này. Cần bản phát hành có chữ
ký số tin cậy; deploy website không tự thêm chữ ký số. Xem `Read first - Windows.html`
trong gói và [FAQ Microsoft](https://support.microsoft.com/en-us/windows/security/threat-malware-protection/smart-app-control-frequently-asked-questions).

1. Tải gói đúng máy: macOS Apple Silicon (arm64), macOS Intel (x64), hoặc Windows x64. Giải nén vào thư mục riêng. Gói có Node.js kèm theo, không cần cài Node/npm.
2. macOS: mở `Start HCMUE.command`. Windows: mở `Start HCMUE.cmd`. Dán địa chỉ HTTPS của website điều khiển vào ô trên trình duyệt rồi bấm **Kết nối runner**. Giữ cửa sổ chạy runner mở. Các gói chưa ký số; cần kiểm tra nguồn tải.
3. Trên website, mở HSK HCMUE, chọn Liên kết máy, nhập mã từ cửa sổ Runner. Mã có hạn 5 phút. So sánh toàn bộ dấu vân tay trên hai cửa sổ rồi xác nhận.
4. Thêm tài khoản HCMUE bằng CCCD và mật khẩu. Mật khẩu chỉ dùng cho lần đăng nhập; phiên và cookie được mã hóa trên máy bằng khóa trong Keychain (Mac) hoặc DPAPI (Windows).
5. Hoàn tất ảnh thẻ và xác thực email tại trường. Bấm **Tải kỳ thi**. Danh sách giữ mọi đợt API trả về, kể cả hết hạn hoặc hết chỗ. Xem ngày thi, ngày mở/đóng, số chỗ, trạng thái gốc và toàn bộ dữ liệu kỳ thi trong phần **Kỳ thi từ trường**. Nhận xét theo thời gian của tool được tách riêng, không sửa trạng thái trường trả về.
6. Trên từng dòng tài khoản, chọn **Kỳ thi của tài khoản**, **Giờ gửi · Việt Nam** và **Chế độ**. Ví dụ A chọn HSK 2, B chọn HSK 4, C chọn HSK 6; có thể đặt cùng giờ hoặc khác giờ. Mẫu bên dưới chỉ dùng khi muốn áp dụng cùng thiết lập cho các tài khoản đang chọn và chưa bật lịch. Sửa thiết lập sau khi chuẩn bị thì cần chuẩn bị lại; không thể bật lịch cũ đã khác thiết lập.
7. Có ba thao tác riêng:
   - **Kiểm tra hồ sơ/API**: chỉ đọc hồ sơ, câu hỏi, đăng ký cũ và trùng lịch. Dùng được với đợt đã đóng nếu trường vẫn cho đọc API. Không tạo lịch hoặc gửi đơn. Báo cáo phân biệt đọc API thành công với điều kiện đăng ký, ví dụ “API đọc được; thiếu ảnh thẻ”.
   - **Diễn tập hẹn giờ, không gửi đơn**: chọn thời điểm ít nhất 6 giây phía trước, bấm **Chuẩn bị**, trả lời câu hỏi nếu có, rồi **Bật lịch** và xác nhận. Cho phép diễn tập với đợt đã đóng/đủ chỗ hoặc đã có đăng ký; vẫn cần hồ sơ, phiên và cấu trúc câu hỏi hợp lệ. Không gọi POST đăng ký. Diễn tập thành công không chứng minh còn slot hoặc API gửi thật đã thành công.
   - **Đăng ký thật**: cùng các bước nhưng kiểm tra thời gian mở/đóng, chỗ, ảnh thẻ, email, câu hỏi, đăng ký cũ và trùng lịch. Cần quyền Live trên website. Giờ gửi phải nằm trong khoảng đăng ký và trong 7 ngày tới. Chuẩn bị không tự bật lịch. Tài khoản lỗi được báo trên từng dòng, không chặn các tài khoản còn lại. Mỗi tài khoản chỉ bật một lịch tại một thời điểm.
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

## Gửi cho người khác sử dụng

Gửi địa chỉ website và trang `/hcmue-downloads/index.html` của website. Người nhận đăng nhập bằng Google của họ, chờ quản trị viên duyệt quyền sử dụng (và Live nếu cần), tải Runner đúng máy, giải nén rồi mở `Start HCMUE.command` hoặc `Start HCMUE.cmd`. Nhập địa chỉ HTTPS của website khi được hỏi, sau đó tự liên kết bằng mã/dấu vân tay và tự thêm tài khoản trường. Không cần cài Node/npm, không cần sao chép extension Google Forms để dùng HCMUE.

Chỉ gửi gói tải sạch; không gửi thư mục kho phiên `HcmueRunner`, `state.enc`, mã liên kết hay tài khoản đang dùng của bạn. Dữ liệu trường và phiên đăng nhập được giữ riêng trên máy người nhận. Bản Windows và Mac Intel còn cần kiểm chứng trên máy thật trước đợt đăng ký chính thức.

## Cập nhật Runner

Website sẽ báo nếu Runner cũ chưa hỗ trợ kiểm tra API/diễn tập mới. Dừng các lịch đang bật, đóng Runner cũ, tải và giải nén bản mới vào thư mục riêng, rồi mở bản mới trên cùng máy. Kho mã hóa nằm trong thư mục dữ liệu hệ điều hành, nên liên kết và tài khoản được giữ lại. Lịch cũ không tự phát lại sau khi khởi động; hãy kiểm tra, chuẩn bị và bật lại. Không mở hai bản đồng thời.
