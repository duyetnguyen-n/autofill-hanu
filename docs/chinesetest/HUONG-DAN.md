# ChineseTest trên website HANU

ChineseTest được điều khiển tại /chinesetest trên website đang có. Một runner trên máy giữ phiên, hồ sơ và lịch riêng cho tối đa 20 tài khoản, còn tùy giới hạn quyền website. Google Forms và HCMUE giữ luồng riêng.

## Mở runner từ website và dùng nhiều máy

- Dùng gói mới, giải nén vào thư mục cố định rồi mở **Start ChineseTest**. Start tự thiết lập nút mở từ web; không cài dịch vụ nền hoặc tự khởi động cùng máy.
- Lần đầu, Start mở ô nhập website trên trình duyệt. Dán link website HANU bằng Ctrl+V rồi bấm **Kết nối runner**; không cần dán trong CMD hay chạy quyền admin. Những lần sau Start tự nhớ website, hoặc trên trang ChineseTest bấm **Mở runner trên máy này** và chọn **Mở ứng dụng** nếu trình duyệt hỏi. Website chỉ xác nhận kết nối khi nhận được trạng thái của runner.
- Nút luôn mở trên máy đang xem web, không bật máy ở xa. Nếu runner cùng chức năng đã chạy, nút mở lại cửa sổ hiện có, giữ nguyên lịch đang chạy. Mở lại sau khi đã thoát không tự bật lịch cũ.
- Chọn rõ **máy thực hiện đăng ký**. Khi có nhiều máy, trang không tự chọn máy đầu tiên; có thể đánh dấu máy ưu tiên, lưu riêng theo tài khoản/chức năng/trình duyệt. Đăng nhập web ở máy khác không chuyển phiên hoặc lịch và không tự chuyển việc chạy khi máy cũ mất kết nối.
- HCMUE và ChineseTest dùng liên kết mở app, kho phiên, khóa tiến trình và cổng cục bộ riêng; có thể chạy đồng thời. Mỗi chức năng vẫn chỉ chạy một tiến trình cho cùng kho dữ liệu.
- Giữ nguyên thư mục gói sau khi cài. Khi đổi thư mục hoặc cập nhật gói, mở **Start ChineseTest** từ gói mới để cập nhật đường dẫn. Gói cũ có thể chạy **Enable web launch** riêng. Giữ nguyên kho dữ liệu để giữ liên kết và lịch sử.

## Windows và Smart App Control

Nếu thấy **Smart App Control blocked a file that may be unsafe**, gói `.cmd` hiện có thể bị chặn và chưa được nghiệm thu tương thích SAC. Chạy admin hoặc Unblock ZIP không bảo đảm xử lý được thông báo này. Cần bộ khởi chạy/bộ cài ký số bằng chứng thư tin cậy và kiểm thử lại trên Windows bật SAC; deploy website không tự thêm chữ ký số. Không tắt bảo vệ để thay cho việc phát hành bản phù hợp. Xem [FAQ Microsoft](https://support.microsoft.com/en-us/windows/security/threat-malware-protection/smart-app-control-frequently-asked-questions). Trong gói có `Read first - Windows.html` giải thích riêng trường hợp này.

Nếu chỉ là dấu nguồn tải thông thường, khác thông báo SAC, và đã xác minh đúng nguồn tải, có thể mở Properties của ZIP → Unblock nếu có → Apply trước khi giải nén lại.

Gói mới nhập website trên trình duyệt. Gói cũ dùng CMD có thể thử Shift+Insert để dán; Ctrl+C có thể dừng runner.

## Liên kết và đăng nhập

Trang **Hướng dẫn kết nối** tại `/chinesetest-downloads/index.html` có các bước kết nối và nút tải runner cho Windows x64, Mac Apple Silicon, Mac Intel. Mở từ ChineseTest → Hướng dẫn kết nối.

1. Tải runner đúng máy, giải nén vào thư mục cố định, mở Start ChineseTest.cmd (Windows) hoặc Start ChineseTest.command (Mac). Cần cài Google Chrome. Gói có Node, không cần cài Node/npm.
2. Dán HTTPS URL của website điều khiển vào ô trên trình duyệt, bấm **Kết nối runner**. Trên website chọn ChineseTest → Liên kết máy, nhập mã một lần và đối chiếu toàn bộ dấu vân tay với cửa sổ runner.
3. Bấm Thêm tài khoản. Người dùng tự nhập mật khẩu và hoàn tất CAPTCHA/OTP trong Chrome riêng mở trên máy chạy. Không gửi mật khẩu hoặc mã xác minh trong chat/website điều khiển.
4. Bấm Hoàn tất đăng nhập. Runner kiểm tra API bằng Node, mã hóa phiên trên máy rồi đóng Chrome riêng. Chrome không tham gia lúc gửi đăng ký.
5. Mỗi tài khoản đăng nhập riêng. Đăng nhập lại cùng email giữ lịch sử và khóa gửi. Không sao chép kho runner để chạy cùng tài khoản trên nhiều máy.

## Chuẩn bị hồ sơ và kỳ thi

- Hồ sơ / ảnh: nhập thông tin ChineseTest hoặc sao chép trường phù hợp từ hồ sơ đang có trên website, rồi kiểm tra lại. Danh mục lấy từ ChineseTest, không suy đoán mã bằng tên gần giống.
- Ảnh chân dung JPG/PNG phải lớn hơn 15 KB và nhỏ hơn 1 MB theo giao diện đang khảo sát. Upload đưa ảnh lên ChineseTest ngay, chưa tạo đăng ký. Ảnh giấy tờ của Google Forms không tự chuyển thành ảnh chân dung.
- Với Speaking yêu cầu lịch sử HSK, khai báo đã/chưa từng thi và cấp/điểm trước đây theo thông tin thật.
- Mỗi tài khoản có cấp thi, hình thức, ngày thi, điểm thi, giờ bắt đầu dò theo giờ Việt Nam, giới hạn phí/tiền tệ và chế độ riêng. Có thể áp dụng mẫu cho nhiều tài khoản rồi sửa từng dòng.
- Mẫu: HSK 4, thi máy, ngày 13/12/2026, Dong A University（IBT）, mã 46750135. Mẫu không cung cấp giờ mở đăng ký; nhập đúng giờ theo thông báo của điểm thi.
- Danh mục điểm thi Việt Nam tự tải theo hình thức, không cần chọn châu lục/quốc gia. Chọn tên trong gợi ý để lưu mã chính xác; các điểm trùng tên vẫn có mã riêng. Khi đổi cấp/ngày/hình thức, danh sách điểm thi của kỳ đăng ký tự tải lại. Đổi hình thức cần chọn lại điểm thi.
- Có thể chọn từ danh mục hoặc nhập tên/mã điểm thi chưa xuất hiện cho ngày thi mong muốn. Danh mục chỉ gồm điểm đã được ChineseTest công bố, không bảo đảm mọi điểm ẩn đều có mặt. Runner chỉ gửi khi API đăng ký trả đúng điểm thi trong đúng ngày/cấp/hình thức và các kiểm tra khác đạt.
- Lưu cấu hình không bật lịch. Kiểm tra API chỉ đọc, báo phí/môn đi kèm hoặc dữ liệu còn thiếu. Chuẩn bị lưu bản hồ sơ cố định cho lượt. Sửa hồ sơ/cấu hình cần chuẩn bị lại.

## Test và Live

- Mặc định Diễn tập, không gọi POST đăng ký. Chọn giờ ít nhất 6 giây tới 7 ngày phía trước, chuẩn bị rồi bật lịch. Test đợi điểm thi và kiểm tra điều kiện thật; không chứng minh có slot.
- Live cần quyền trên website, đồng ý quy định/quyền riêng tư và giới hạn phí cụ thể. Sau chuẩn bị, bấm Bật lịch Live. Chỉ lịch được runner xác nhận mới có hiệu lực. Có thể chọn và bật nhiều lịch đã chuẩn bị.
- Mặc định nghỉ 1 giây sau mỗi lượt dò chưa đạt, chờ 10 phút sau giờ bắt đầu. Có thể đổi khoảng nghỉ 0–60 giây, chờ tối đa 120 phút. 0 giây nghĩa là kiểm tra xong phản hồi thì dò tiếp, không tạo request chồng; vẫn nhường xử lý cho lệnh Dừng và mạng. Các tài khoản cùng runner/cấp/ngày/hình thức chia sẻ request đang lấy điểm thi. Gặp giới hạn truy cập vẫn chờ theo phản hồi máy chủ hoặc báo lỗi, kể cả khi đặt 0.
- Runner kiểm tra phí cuối và tiền tệ. Khi khảo sát Dong A, danh sách trả 35 USD còn API phí cuối trả 60 USD.
- Một lượt Live gửi một lần. Timeout/phản hồi không rõ không kích hoạt gửi lại. Lỗi một tài khoản không dừng các tài khoản khác.
- Theo dõi selectOrder hoặc Test Records. Đã tạo đơn, đang xử lý và đã có mã đăng ký là các trạng thái khác nhau. Chưa thấy mã không có nghĩa đã thất bại.
- Đối chiếu kết quả không tạo đăng ký. Nếu đã hủy đăng ký cũ trên ChineseTest, chọn **Xác minh đã hủy / đăng ký lại** ngay trên lượt đã thành công. Với lượt chưa rõ kết quả/lỗi, dùng **Xác minh chưa đăng ký**. Chỉ xác nhận khi không còn đăng ký cùng cấp/ngày và không còn request đang xử lý; dừng lượt đang chạy trước. Runner kiểm tra lại phiên và toàn bộ Test Records trước khi ghi nhận. Lỗi API hoặc cấu trúc dữ liệu không rõ vẫn giữ khóa; không đoán mã trạng thái hủy.
- Sau xác minh, lượt cũ chuyển thành **Đã xác minh và mở khóa**, giữ mã đơn/mã đăng ký và thời điểm xác minh. Khóa của lượt đó được giải phóng trên runner và website; lượt mới phải Chuẩn bị rồi Bật lịch lại. Đối chiếu lượt cũ đã mở khóa không phục hồi khóa từ mã đơn lịch sử.
- Không thanh toán, hủy đơn, vượt CAPTCHA/OTP hoặc đăng ký trước khi máy chủ cho phép. Bản đầu chưa hỗ trợ hệ thống EU riêng, Trung Quốc đại lục cần SMS hoặc điểm thi bắt buộc bưu điện.

## Mất kết nối và dừng

- **KHÔNG đóng cửa sổ CMD / Terminal chạy runner, không nhấn Ctrl+C hoặc thoát tiến trình khi đang chờ lịch / chạy đăng ký.** Có thể thu nhỏ cửa sổ.
- **KHÔNG tắt hoặc khởi động lại máy, không để máy Sleep / Hibernate, không gập laptop.** Cắm sạc và giữ mạng ổn định đến khi có kết quả. Tạm đặt chế độ ngủ tự động thành Không bao giờ trong thời gian chạy.
- **KHÔNG đóng Chrome trong lúc đăng nhập / CAPTCHA / OTP.** Bấm Hoàn tất đăng nhập và chờ runner lưu phiên thành công; sau đó runner tự đóng Chrome, không cần giữ cửa sổ Chrome đăng nhập mở.
- Giữ runner và máy hoạt động, có mạng. Đóng website hoặc mất kết nối cloud không hủy lịch đã được runner lưu/xác nhận. Dùng Dừng tất cả trên máy tại cửa sổ local khi không kết nối website.
- Không thể thu hồi request đã gửi. Dừng lúc đang gửi giữ khóa để đối chiếu; phản hồi xác nhận đến muộn có thể cập nhật kết quả.
- Máy ngủ, đồng hồ thay đổi, runner treo hoặc thức quá trễ sẽ dừng lượt chưa gửi. Bật tự đồng bộ giờ hệ điều hành, không chỉnh đồng hồ khi đang bật lịch.
- Khởi động lại không tự phát lại lịch. Lượt có khả năng đã gửi cần đối chiếu. Hết phiên thì đăng nhập và chuẩn bị lại lượt chưa gửi.
- Khóa gửi giữ tại máy và website cho cùng tài khoản/cấp/ngày trong một tài khoản website, kể cả chọn điểm thi khác. Không xóa kho hoặc gỡ tài khoản để gửi lại.
- Thu hồi thiết bị áp dụng khi runner nhận thông báo. Nếu offline, dừng tại máy trước; không coi thao tác website là đã dừng khi chưa có xác nhận.

## Dữ liệu và kiểm chứng

### Khi kiểm tra phiên trước giờ mở thất bại

- Bản runner đầu gộp mọi lỗi kiểm tra thành thông báo “Phiên ChineseTest không còn hợp lệ”, kể cả lỗi mạng. Bản sửa giữ mã và nguyên nhân lỗi. Thông báo cũ không đủ để xác định lỗi của lượt đã qua.
- API trả mã xác thực 401/403: đăng nhập lại trên runner và bấm **Hoàn tất đăng nhập**, rồi chuẩn bị/bật lượt mới. Đăng nhập ở Chrome khác không tự cập nhật phiên đã lưu trong runner.
- Timeout, ngắt kết nối, 429 hoặc lỗi máy chủ 5xx trong lần kiểm tra sớm: runner giữ lịch và kiểm tra lại. Lần xác minh danh tính cuối được thử lại tối đa một lần khi còn thời gian. Nếu vẫn không xác minh được thì dừng trước khi gửi, kèm nguyên nhân. Request đăng ký không được thử gửi lại.
- Lỗi định dạng dữ liệu, lệch đồng hồ hoặc HTTP 403 từ tầng truy cập cần xử lý đúng nguyên nhân; không tự coi là hết phiên.
- Sửa này nằm trong runner. Cần dừng runner cũ và dùng gói mới; deploy website đơn thuần không cập nhật tiến trình runner trên máy. Giữ nguyên kho dữ liệu để giữ liên kết và khóa gửi. Không cần migration hoặc biến môi trường mới cho bản sửa.

Kho mã hóa ở %LOCALAPPDATA%/ChineseTestRunner trên Windows, ~/Library/Application Support/ChineseTestRunner trên Mac. Khóa được bảo vệ bằng DPAPI/Keychain. Không chia sẻ state.enc, thư mục đăng nhập tạm hoặc mã liên kết.

Đã kiểm chứng đăng nhập thủ công và API đọc bằng Node trên Windows, kể cả sau khi Chrome đóng. Ngày 22/10/2026, lượt Live từ website quản lý qua runner Windows đã tạo đơn thật Dong A HSK 4 IBT ngày 13/12/2026, phí cuối 60 USD, gửi đúng một lần; đối chiếu Test Records nhận được mã đăng ký và hạn phí. Không thanh toán; người dùng tự xử lý hủy lượt thử. Lượt này xác minh luồng khi điểm thi đang cho đăng ký, chưa chứng minh thời hạn phiên, hàng đợi hoặc khả năng tranh slot đúng giờ mở. Không có cam kết tỷ lệ giành slot.
