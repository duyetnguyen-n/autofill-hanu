# Upload ảnh đã lưu lên Google Forms — 2026-10-07

## Kết quả upload v1.2.0

Đã xác minh upload tự động trên form test HANU trong Chrome profile Duyệt. Người dùng cho phép nạp extension và tải ảnh giả `tests/upload-fixture.png` (PNG 1×1, 68 byte) lên Google bằng tài khoản hiện tại. Sau khi chọn ảnh một lần trong Side Panel, lượt Bắt đầu tự mở Picker và gắn ảnh vào câu hỏi mà không mở cửa sổ tìm đường dẫn. Picker mở lúc 23:19:54; form nhận ảnh lúc 23:19:58. Minh chứng: `tests/upload-auto-success.png`.

Agent dừng lượt chạy sau khi ảnh đã gắn vào form. Không gửi form. Lỗi số điện thoại sẵn có trong bản nháp ngăn chuyển trang tiếp theo; chưa xác minh toàn bộ hồ sơ hoặc nhiều tài khoản.

## Cách triển khai

- Code cũ chỉ tìm `input[type=file]` trong câu hỏi. Google Forms dùng iframe `https://docs.google.com/picker?...hostId=file-upload` nên cần xử lý trong iframe.
- Content script mở đúng câu upload, nhận diện URL và phiên Picker. Background đọc Blob đã lưu trong IndexedDB, kiểm tra tab/form đang chạy rồi dùng `chrome.scripting.executeScript` để đưa helper vào các frame.
- Helper chỉ nhận đúng Picker theo `rpcService` và `rpctoken`. Nó tạo File từ dữ liệu ảnh đã lưu, gắn qua DataTransfer và phát sự kiện input/change. Đánh dấu request để không upload lặp.
- Chỉ xác nhận hoàn tất khi Picker đã đóng và câu hỏi hiện đúng tên tệp cùng nút xóa. `input.files.length` trong Picker chỉ chứng minh đã đưa tệp vào uploader.
- Nếu có tệp khác, Picker không rõ ràng, lỗi định dạng/kích thước hoặc hết thời gian chờ, extension dừng để người dùng kiểm tra. Không tự xóa tệp khác.
- Test vẫn upload lên Google Drive nhưng không bấm Gửi.

## Quyền và tài liệu

Manifest vốn đã có host permission `https://docs.google.com/forms/*`. Chrome bỏ qua phần path trong host permission, nên quyền này bao phủ host docs.google.com; vấn đề cũ là content script không chạy trong Picker. Bản sửa sử dụng quyền scripting hiện có, không thêm quyền host mới.

- [Chrome match patterns](https://developer.chrome.com/docs/extensions/develop/concepts/match-patterns)
- [Chrome scripting API](https://developer.chrome.com/docs/extensions/reference/api/scripting)

51 test tự động, kiểm tra TypeScript và build đều qua. Test mô phỏng được bổ sung bằng lượt upload trên Chrome thật; kết quả một ảnh nhỏ không bảo đảm tốc độ cho ảnh CCCD lớn hoặc kết nối khác.

## Kiểm tra lại toàn luồng v1.2.1 — 2026-10-08

Đã sửa nhãn checkbox email tiếng Việt và nhận diện câu ảnh trước khi nút upload dựng xong. Hai lượt từ trang đầu đều tự đi tới trang cuối, có Clear toàn bộ câu trả lời giữa hai lượt. CCCD và số CCCD được điền tự động trong cả hai lượt; ảnh được upload lại sau Clear. Chi tiết, nhật ký và giới hạn về câu xác thực nằm trong TESTING.md. Bộ test hiện có 56 ca qua; chưa bấm Gửi.
