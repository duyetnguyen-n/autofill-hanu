# HANU Coordinator 1.3.1

App cục bộ quản lý nhiều Chrome profile, mỗi profile giữ một hồ sơ thí sinh và ảnh riêng. Người dùng tự mở profile, đăng nhập Google, liên kết extension rồi chọn các phiên để chạy Test hoặc Live. Bản này chưa dùng AI.

## Sử dụng gói đóng sẵn

Gói Mac Apple Silicon nằm trong `releases`. Script đóng gói hỗ trợ thêm Mac Intel và Windows x64; hai gói này chưa được hoàn tất vì ổ đĩa hiện tại không đủ dung lượng. Node 24.21.0 được kèm theo; không cần cài Node riêng. Mac cần macOS 13.5 trở lên, Windows cần Windows 10/11 x64. Windows và Mac Intel vẫn cần nghiệm thu trên máy thật.

1. Giải nén vào thư mục cố định. Mac mở `HANU Coordinator.app`; Windows mở `Start HANU.cmd`. Mở lại app sẽ đưa màn hình quản lý của tiến trình đang chạy lên.
2. Trên từng Chrome profile, mở `chrome://extensions`, bật Developer mode và Load unpacked thư mục `extension` trong gói. Nếu extension đã được cài trước, làm theo phần nâng cấp bên dưới để giữ ID và dữ liệu.
3. Mở HSK Autofill. Sao chép **ID extension** trong panel. Trong app, chọn **Thêm profile**, dán ID và bấm **Tạo mã liên kết**. App đăng ký cầu nối Native Messaging ở cấp người dùng trước khi cấp mã.
4. Dán mã vào panel và bấm **Liên kết profile**. Chờ thông báo **Đã kết nối app**. Mã dùng một lần, hết hạn sau 5 phút. Mỗi Chrome profile chỉ cần liên kết một lần.
5. Trong Chi tiết, bấm **Kiểm tra kết nối** và **Mở profile**. Đối chiếu mã phiên trên tab extension. Gán tên profile và email Google sẽ hiển thị trên form; email này độc lập với email liên hệ của thí sinh.
6. Hồ sơ và ảnh cũ được đọc từ extension. Sửa hồ sơ tại app rồi bấm **Lưu và đồng bộ**; chỉ coi là đồng bộ khi extension xác nhận đã lưu. Khi có xung đột, chọn bản app hoặc bản extension. Ảnh thường dưới 1 MB nhưng app không đặt giới hạn upload mới ở 1 MB.
7. Dán link Google Form, chọn các profile và Test/Live, bấm Bắt đầu. Các lệnh mở form được phát cùng lượt. Mỗi phiên kiểm tra tài khoản thực tế sau chuyển hướng trước khi điền.

Bấm tên profile để chọn tab đăng ký và đưa đúng cửa sổ lên trước. Profile đóng vẫn còn trong bảng và hiện mất kết nối; mở lại profile để kết nối. Màn hình quản lý còn có nút mở từ panel extension.

## Test, Live và xử lý sự cố

- **Test** điền, chuyển trang và upload, dừng trước Gửi. Upload Test vẫn đưa ảnh lên Google; thử form thật bằng hồ sơ và ảnh giả.
- **Live** chỉ cấp quyền bấm Gửi một lần sau khi khóa đã lưu ở cả app và extension. Thành công cần xác nhận từ Google. Khi chưa thấy xác nhận, giữ trạng thái **Chưa rõ đã gửi** và giữ khóa; Dừng/Tiếp tục/reload không cấp lại quyền.
- Kiểm tra kết quả Google trước khi dùng **Đã xác minh đã gửi** hoặc **Đã xác minh chưa gửi**. Lựa chọn thứ hai cho phép tạo lượt mới; lượt cũ vẫn không được gửi lại. Khóa cùng profile/form được giữ trong lịch sử.
- CAPTCHA, câu chống bot, câu chưa nhận diện, form đóng, hết đăng nhập hoặc lỗi dữ liệu dừng riêng phiên. Xử lý trong cửa sổ tương ứng rồi chủ động Tiếp tục để quét và đối chiếu lại.
- Lỗi tải trước Gửi được thử lại ba lần, đợi 2/5/10 giây; không xóa form. Ít nhất 3 phiên và 25% danh sách lượt cùng lỗi tải/chặn trong 30 giây sẽ tạm dừng nhóm.
- Khởi động lại app/Chrome không tự chạy lại nhóm. Trạng thái được đối chiếu và chờ người dùng tiếp tục. Nhóm đã Dừng hẳn cần tạo lượt mới.
- Extension vẫn dùng độc lập. Một profile chỉ chạy một lượt tại một thời điểm; không chạy độc lập chồng lên lượt app đang điều phối.

## Nâng cấp Load unpacked, giữ hồ sơ và ảnh

**Giữ nguyên thư mục extension đang được Chrome nạp**, chép nội dung bản `extension` mới vào thư mục đó rồi bấm Reload. Không Remove extension, không chuyển sang thư mục nạp mới, không áp manifest key/ID khác. Extension này không ép ID mới. App đăng ký đúng ID đang hiển thị trên Chrome và giữ được nhiều ID đã đăng ký.

Với workspace hiện tại, thư mục nạp là `dist`. `npm run build:extension` cập nhật nội dung tại đây; sau build bấm Reload extension. Không sửa/xóa Chrome storage hay IndexedDB để nâng cấp. Dữ liệu cũ vẫn dùng các khóa `profile` và cơ sở `hanu-hsk-autofill`.

## Chạy và phát triển từ mã nguồn

```bash
npm install
npm run build
npm run manager
```

Script quản lý và kiểm thử tự tải runtime Node 24.21.0 đúng nền tảng và kiểm SHA-256 từ Node.js chính thức vào `.runtime`; không thay Node hệ thống. Máy phát triển cần Node để chạy npm; gói phát hành đã kèm runtime.

```bash
npm run typecheck
npm test
npx playwright install chromium --no-shell
npm run test:browser
npm run bench:fixture
npm run package
```

Browser fixture cần OpenSSL và dùng Chrome for Testing riêng, dữ liệu giả và máy chủ HTTPS cục bộ. Công cụ benchmark hiện dành cho Mac; package đa nền tảng chạy trên Mac với `ditto`, `tar`, `unzip`, `zip`. Gói Windows được tạo bằng Node SEA nhưng cần kiểm chứng chạy thực tế trên Windows.

## Kiến trúc và dữ liệu

React/TypeScript/Vite + Fluent UI; bộ điều phối Node 24 + SQLite WAL, đồng bộ FULL. App chỉ nghe `127.0.0.1` ở cổng ngẫu nhiên. HTTP/WS giao diện kiểm tra Host, Origin và cookie HttpOnly/SameSite; cầu nối có thông tin xác thực riêng và allowlist ID extension. Mã mở app và token cầu nối nằm trong descriptor riêng tư trên máy. Không đọc/copy cookie hoặc mật khẩu Google.

Mỗi profile có tiến trình Native Messaging cầu nối tới một coordinator chung. Giao thức có phiên bản, sessionId/runId/commandId và thứ tự sự kiện; journal lưu lệnh thay đổi, bỏ qua lệnh trùng và sự kiện cũ. Ảnh chuyển theo phần 64 KiB và kiểm SHA-256. Mỗi lượt khóa snapshot hồ sơ/ảnh; upload đọc tại extension.

App lưu dữ liệu tại `~/Library/Application Support/HanuCoordinator` (Mac), `%USERPROFILE%/AppData/Local/HanuCoordinator` (Windows). Hồ sơ và ảnh cũng giữ trong Chrome storage/IndexedDB của từng profile. Không đưa thư mục dữ liệu này hoặc bản sao hồ sơ lên git. `.gitignore` loại build, runtime, releases và kết quả cục bộ.

Đọc `TESTING.md` để xem phạm vi đã kiểm chứng và phần chưa nghiệm thu. Phát lệnh đồng thời không phải bằng chứng 24 phiên hoàn tất nhanh trên Google Forms thật.
