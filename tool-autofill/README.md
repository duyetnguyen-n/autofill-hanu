# HSK Safe Autofill

Extension Manifest V3 dành riêng cho `https://www.chinesetest.cn/*`. Công cụ lưu một hồ sơ đăng ký vào `chrome.storage.local`, điền tự động và có thể bấm `Next` qua bước 1–3.

## Nguyên tắc an toàn

- Chế độ nhanh chỉ được phép bấm nút có nội dung chính xác là `Next` trên ba URL bước 1–3.
- Bắt buộc dừng tại `/signtw0toth`; không bấm `Confirm`, `Submit` hoặc `Pay`.
- Không tự động đánh dấu các ô đồng ý điều khoản/đăng ký nhận tin ở bước xác nhận.
- Không đọc hoặc lưu mật khẩu, OTP, CAPTCHA hay mã xác minh.
- Hỗ trợ lưu ảnh thẻ trong hồ sơ (tự động nén chuẩn JPEG < 100KB) và tự động tải lên ở bước 2; tự động xác nhận hộp thoại cắt ảnh nếu có.
- Tự động đóng các popup cảnh báo, nhắc nhở hoặc tips trong các bước 1–3 để quy trình không bị gián đoạn.
- Không ghi đè trường đã có dữ liệu; các trường đó được giữ nguyên và tính riêng trong tiến độ.
- Mọi trường trong hồ sơ cấu hình đều không bắt buộc: để trống nghĩa là dành cho người dùng tự nhập/chọn.
- Nếu trường cần tự điền phụ thuộc vào một trường để trống, extension chờ lựa chọn thủ công rồi tiếp tục ngay khi trường phụ thuộc khả dụng.
- Khi chạy nhanh, extension mở một cửa sổ tiến độ cố định có nút **Dừng ngay**.
- Chỉ có quyền chạy trên `www.chinesetest.cn`.
- Hồ sơ được lưu cục bộ trong trình duyệt; extension không gửi dữ liệu tới máy chủ riêng hay bên thứ ba.
- Danh mục dropdown chỉ dùng các API `GET` mà giao diện ChineseTest đang dùng; endpoint và tham số đều nằm trong danh sách trắng.
- API danh mục không được dùng để bấm `Next`, tạo hồ sơ đăng ký, gửi thông tin cá nhân hoặc `Submit`.
- Extension không đọc, sao chép hay lưu cookie, token đăng nhập hoặc header xác thực.
- Request danh mục được chuyển cho chính lớp API đang chạy trong trang ChineseTest; lớp này tự xử lý session/header như giao diện gốc.

## Cài đặt thủ công trên Cốc Cốc/Chrome

1. Mở trang quản lý extension và bật **Chế độ dành cho nhà phát triển**.
2. Chọn **Tải tiện ích đã giải nén / Load unpacked**.
3. Chọn thư mục này: `/Users/macbook/IntellJProject/tool-autofill`.
4. Sau mỗi lần bấm Reload extension, tải lại toàn bộ tab `chinesetest.cn` đang mở. Popup phải hiển thị đúng phiên bản extension và content script.
5. Nếu trang quản lý extension còn hiển thị lỗi cũ, bấm **Clear all** trước khi chạy thử lại để chỉ quan sát lỗi mới.

## Cách dùng

1. Mở extension và chọn **Nhập / sửa hồ sơ**.
2. Mở và đăng nhập ChineseTest trong một tab. Trong trang hồ sơ, bấm **Đồng bộ dropdown từ ChineseTest** để lấy danh mục hiện tại.
3. Chọn lần lượt các mục cần dùng. Danh sách sau được tải theo lựa chọn trước; các trường không muốn tự động hóa có thể để trống.
4. Bấm **Lưu hồ sơ**.
5. Tại bước đầu đăng ký, chọn **Chạy nhanh đến bước 4**.
6. Theo dõi thanh tiến độ trong cửa sổ riêng; có thể chọn **Dừng ngay** bất cứ lúc nào.
7. Extension chỉ điền trường trống và bấm `Next` qua bước 1–3.
8. Tại bước 4, extension dừng để người dùng kiểm tra; không chạm vào ô đồng ý hoặc nút **Submit**.

Nếu vừa Reload extension, phải tải lại tab ChineseTest trước khi đồng bộ. Danh mục đã tải được cache cục bộ để mở trang hồ sơ nhanh hơn; bấm đồng bộ lại khi muốn lấy lịch/địa điểm mới nhất.

Các dropdown Element UI được điền tuần tự để hỗ trợ chuỗi phụ thuộc như loại thi → cấp độ → hình thức → ngày → trung tâm.
Mỗi bước được quét lại sau khi Vue render. `MutationObserver` chọn option ngay khi nó xuất hiện (kèm kiểm tra nhanh mỗi 60 ms), rồi chỉ tiếp tục khi giá trị vừa chọn đã được đọc lại đúng trên giao diện.
