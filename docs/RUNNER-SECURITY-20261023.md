# Kiểm tra mở runner và chống chèn mã — 23/10/2026

## Phạm vi thay đổi

- Chuyển bước nhập website lần đầu từ CMD sang form trên trình duyệt, hỗ trợ Ctrl+V và link trang quản lý có đường dẫn/#runs.
- Giữ nguyên website đã lưu và kiểm tra chặt website/provider trong deep link. Link mở app không nhận lệnh shell, không tải hoặc thực thi mã từ website.
- Form thiết lập chỉ nghe 127.0.0.1 ở cổng ngẫu nhiên, có token ngẫu nhiên, cookie HttpOnly/SameSite, kiểm tra Host/Origin, giới hạn dữ liệu và thời gian mở. Dữ liệu nhập được escape trước khi đưa vào HTML. Form không chạy JavaScript.
- Thêm hướng dẫn Windows và phân biệt Smart App Control với dấu nguồn tải thông thường.

Không sửa engine đăng nhập, hồ sơ/ảnh, thời điểm gửi, Test/Live, khóa chống gửi trùng, dữ liệu lưu trữ hoặc giao thức điều khiển đang có. Không thay đổi quyền Windows hoặc cấu hình bảo vệ. Không deploy trong lượt này.

## Những đường đã kiểm tra

- Website đang phục vụ trả CSP `script-src 'self'`, không cho inline script/eval; chặn bị nhúng trong frame và đặt `nosniff`.
- Không tìm thấy `dangerouslySetInnerHTML`, `innerHTML`, `eval` hoặc `new Function` trong mã UI/runner đã rà.
- Browser test đưa tên runner chứa HTML và onerror qua fixture relay: UI hiển thị nguyên văn, không tạo phần tử ảnh/script. Browser test riêng xác nhận CSP chặn inline JavaScript.
- Kiểm tra đường dẫn static không đọc được tệp bên ngoài thư mục public, API cần đăng nhập và từ chối Host khác.
- Tệp hồ sơ tải qua API được trả dưới dạng attachment/octet-stream với nosniff; các kiểm tra phân quyền giữa hai người dùng, mã hóa, token, chống phát lại và khóa gửi có trong suite hiện có.
- `npm audit --omit=dev`: 0 lỗ hổng đã được công bố mà npm audit nhận diện ở thời điểm kiểm tra. Kết quả này không phải chứng nhận phần mềm không có lỗ hổng.

## Xác minh

- Typecheck và build cloud/runner: qua.
- Toàn bộ suite lần đầu: 65/68 file qua, 644 ca qua, 1 ca macOS bỏ qua trên Windows; 3 ca lỗi (2 timeout PGlite, 1 thiếu openssl trong PATH).
- Chạy lại các file lỗi sau khi thêm đường dẫn OpenSSL đã cài, cùng transport và kiểm tra static/CSP mới, một worker: 5 file / 31 ca qua. Không tăng timeout hoặc thay logic nghiệp vụ để làm test qua.
- Kiểm thử hai runner native: qua; website/provider sai bị từ chối, mở lặp dùng lại tiến trình và dữ liệu tạm.
- Kiểm thử form nhập website: qua với clipboard Ctrl+V thật trên Edge, nhập sai rồi sửa, desktop/mobile và hai provider.
- Kiểm thử browser chống chèn mã: qua với dữ liệu giả.
- UI mở runner cũ trên desktop/mobile: qua. Smoke test gói Windows mới với DPAPI, worker, liên kết fixture, phản hồi mã hóa và nút dừng cục bộ: qua.

Các test chỉ dùng fixture/kho tạm; không gọi API trường để gửi đăng ký thật. Gói Windows sửa form được tạo trong `releases/runner-browser-setup-20261023`, không ghi đè thư mục runner đang chạy hoặc kho dữ liệu của người dùng.

## Giới hạn phát hành Windows

Ảnh người dùng cung cấp là thông báo **Smart App Control blocked a file that may be unsafe**. Gói `.cmd` chưa được chứng nhận tương thích SAC, hiện chưa có cấu hình/chứng thư ký số phát hành. Chạy admin hoặc deploy website không tạo chữ ký số và không bảo đảm bỏ chặn SAC. Cần bộ khởi chạy/bộ cài được ký bởi nhà phát hành tin cậy, rồi nghiệm thu lại luồng tải/giải nén/mở trên Windows bật SAC. Không tự tạo chứng thư tin cậy hoặc tắt bảo vệ của máy.

Tham khảo: [FAQ Smart App Control của Microsoft](https://support.microsoft.com/en-us/windows/security/threat-malware-protection/smart-app-control-frequently-asked-questions), [yêu cầu ký số](https://learn.microsoft.com/en-us/windows/apps/develop/smart-app-control/code-signing-for-smart-app-control).

Đây là kiểm tra các đường tấn công và hồi quy nêu trên, không phải kiểm toán toàn bộ hạ tầng hoặc bảo đảm tuyệt đối không thể bị xâm nhập. Quyền truy cập hosting/repository, bí mật triển khai và chuỗi cung ứng vẫn là các ranh giới bảo mật riêng.
