# Mở runner từ website

HCMUE và ChineseTest dùng chung giao diện mở app, nhưng có URL scheme riêng:
`hanu-hcmue://open?origin=...` và `hanu-chinesetest://open?origin=...`.
Nút chỉ mở runner trên máy đang dùng trình duyệt. Việc chọn máy điều khiển trên
website độc lập với nút mở app; không có chuyển lịch, chuyển phiên hay chạy thay
khi máy cũ mất kết nối.

## Cài một lần

Giải nén gói mới vào thư mục cố định rồi mở `Start HCMUE` / `Start ChineseTest`.
Start tự cài liên kết mở từ web; lần đầu mở ô nhập website trên trình duyệt.
Dán link website hoặc trang quản lý bằng Ctrl+V, rồi bấm **Kết nối runner**.
Không cần nhập link trong CMD và không cần Run as administrator.
Sau đó dùng nút **Mở runner trên máy này** và chọn **Mở ứng dụng** nếu trình duyệt hỏi.
Những lần mở Start tiếp theo dùng lại website đã lưu. Khi chuyển thư mục hoặc
cập nhật gói, chỉ cần mở Start từ gói mới để cập nhật liên kết.
Gói cũ có thể chạy `Enable web launch.cmd` / `Enable web launch.command` riêng.

## Windows chặn file tải xuống

Nếu thông báo là **Smart App Control blocked a file that may be unsafe**, đây
là Smart App Control, không phải lời nhắc UAC hay SmartScreen. Tính năng này không
có ngoại lệ cho từng app. Chạy admin hoặc Unblock ZIP không phải giải pháp cho
mọi trường hợp. Bản `.cmd` hiện tại chưa phải bản phát hành tương thích SAC đã
được nghiệm thu; cần bộ khởi chạy/bộ cài ký bằng chứng thư nhà phát hành được tin
cậy và kiểm thử lại toàn bộ luồng tải về. Deploy website không tạo chữ ký số.
Xem [FAQ Smart App Control của Microsoft](https://support.microsoft.com/en-us/windows/security/threat-malware-protection/smart-app-control-frequently-asked-questions)
và [yêu cầu ký ứng dụng](https://learn.microsoft.com/en-us/windows/apps/develop/smart-app-control/code-signing-for-smart-app-control).

Gói ZIP có runtime Node chính thức đã kiểm tra checksum, nhưng chưa có bộ cài
được ký số cho HANU. Windows có thể cảnh báo dựa trên nguồn tải và độ tin cậy của
ứng dụng; không thể bảo đảm hết cảnh báo bằng việc thay script khởi động.
Với dấu nguồn tải thông thường (khác thông báo SAC), nếu tin cậy đúng nguồn tải,
mở Properties của chính file ZIP → Unblock nếu có →
Apply trước khi giải nén lại. Chạy Start bằng tài khoản thường; không cần admin.
Gói Windows có `Read first - Windows.html` để đọc các bước này ngay trên máy.
Nếu Defender báo mã độc hoặc máy công ty chặn theo chính sách, kiểm tra với quản
trị viên; không tắt bảo vệ. Xem [hướng dẫn Microsoft](https://support.microsoft.com/en-gb/windows/security/information-about-the-attachment-manager-in-microsoft-windows).

Với gói cũ còn hỏi website trong CMD, có thể dùng Shift+Insert để dán. Ctrl+C có
thể dừng tiến trình; phím Ctrl+V còn phụ thuộc cấu hình console. Bản mới dùng ô
nhập trình duyệt. Nếu trình duyệt không tự mở, CMD in link trang nhập để mở thủ công.

Windows đăng ký URI dưới HKCU, không cần quyền quản trị. Mac tạo một AppleScript
app riêng cho từng chức năng trong `~/Applications`, ký ad-hoc và đăng ký với
LaunchServices. Lần mở đầu có thể cần cho phép app điều khiển Terminal. Không cài
dịch vụ, lịch khởi chạy hoặc tác vụ mở nền. Máy đang tắt không thể được bật từ nút này.

## Tiến trình và dữ liệu

- Các provider giữ kho mã hóa, khóa PID, cookie và cổng localhost độc lập.
- Link chỉ được chứa website HTTPS, không nhận lệnh chạy lịch hay dữ liệu tài khoản.
- Website trong link phải trùng địa chỉ đã lưu bằng lần mở Start thủ công. Link không
  được tự thay đổi website liên kết.
- Nếu runner đang chạy, mở lại trang điều khiển localhost của tiến trình đó. Thông tin
  mở cửa sổ nằm trong `runner-open.json` với quyền 0600, không đưa token lên cloud.
- Lần mở app mới sau khi đã thoát vẫn giữ quy tắc đối chiếu/phục hồi lịch hiện có;
  không tự bật lại lịch cũ.
- Máy ưu tiên được lưu theo người dùng website, provider và trình duyệt. Nếu có nhiều
  máy và chưa có ưu tiên hợp lệ, người dùng phải chọn máy. Trình duyệt khác vẫn cần
  xác minh dấu vân tay, không kế thừa quyền tin cậy từ việc đăng nhập website.

## Build và kiểm tra

Build cloud UI trước, sau đó đóng gói runner để thư mục tải không bị Vite xóa:

```sh
npm run typecheck
npm run build:cloud-server
npm run package:hcmue
npm run package:chinesetest -- --all-platforms
npm run test:runner-launch
npm run test:runner-launch-ui
npm run test:runner-setup-ui
```

`tests/runner` kiểm tra URL sai, tách provider, tự thiết lập qua Start, nhớ website,
lỗi thiết lập không ngăn mở runner, lệnh đăng ký Windows (mô phỏng),
và biên dịch/ký/xác minh app macOS trong thư mục tạm. Kiểm thử native chạy đồng thời
hai runner với dữ liệu tạm, bấm link lặp lại và thử sai website/provider, không gọi API
trường. Kiểm thử UI dùng hai runner cho mỗi provider và hai browser context để kiểm
tra chọn máy, ưu tiên, tin cậy riêng, hướng dẫn mở app và bố cục desktop/mobile.

Đã chạy smoke test gói Mac arm64. Luồng trình duyệt → URI handler trên Windows và
Mac Intel vẫn cần nghiệm thu trên máy tương ứng. Không có đăng ký thi thật trong
các kiểm thử này.
