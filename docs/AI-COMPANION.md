# AI đồng hành HANU

## Sử dụng

1. Mở **Hỏi AI** trên Google Forms, Direct, ChineseTest, Tài khoản, Quản trị hoặc Kho tri thức; HCMUE dùng **Trợ lý HCMUE**.
2. Thanh nhỏ dưới tiêu đề dành cho **Gợi ý**, **Theo dõi** và **Ngữ cảnh**. Hội thoại có toàn bộ vùng cuộn; không ghim bảng ngữ cảnh lên trên tin nhắn.
3. Bấm **Gợi ý**, hoặc chọn nút trên trang rồi hỏi “Nút này vì sao bị khóa?”. Trợ lý nhận trạng thái mới tại thời điểm gửi câu hỏi, trả lời bằng lời dễ hiểu và chỉ vị trí qua nút riêng. ID điều khiển, tên trường dữ liệu và dấu thời gian UTC không xuất hiện trong câu trả lời.
4. **Ngữ cảnh** mở thành một màn riêng trong khung trợ lý để xem trạng thái, lưu **Mục tiêu đang làm** và chọn lịch. Bấm **Về cuộc trò chuyện** để đọc chat. Màn này không đè lên nội dung hội thoại.
5. Khi chat đang mở, chuyển trang qua liên kết nội bộ để tiếp tục trò chuyện ở trang đích. Đóng và mở lại giữ lịch sử. Hai trợ lý giữ hội thoại riêng, dùng chung mục tiêu và các tin cập nhật đăng ký.

## Nhận tiến trình và kết quả chủ động

- Bấm **Theo dõi** hoặc nhắn “Sắp đki rồi, theo dõi và báo kết quả giúp mình”. Trợ lý bám lịch của tài khoản/profile đang chọn; nếu chỉ có một lịch đang hoạt động thì dùng lịch đó. Nếu có nhiều lịch chưa xác định đối tượng, chọn đúng lịch trong **Ngữ cảnh → Theo dõi đăng ký**.
- Chưa có lượt phù hợp: chọn tài khoản/profile trước, chuẩn bị và bật lịch trên giao diện. Theo dõi không tạo lịch, sửa giờ, bật lịch hoặc đăng ký thay người dùng.
- Khung chat tự có tin khi lịch chuyển sang chờ giờ, kiểm tra điều kiện, gửi yêu cầu, chờ phản hồi, cần xử lý hoặc có kết quả. Trạng thái không đổi sẽ không nhắc lại mỗi lần làm mới. Đóng riêng khung chat vẫn theo dõi và có dấu số tin mới trên nút mở trợ lý.
- Một lần gửi chỉ được báo là đã gửi. ChineseTest chỉ báo xác nhận khi trạng thái đã đối chiếu kèm mã đăng ký; HCMUE cần trạng thái đã xác nhận kèm mã đăng ký. Diễn tập luôn được báo riêng, không coi là đơn thật. Với kết quả chưa rõ, cần đối chiếu trước khi chạy lại.
- Mở **Ngữ cảnh** và chọn **Dừng theo dõi của AI**, hoặc nhắn “Dừng theo dõi”, để dừng tin cập nhật. Thao tác này không dừng lịch trên Runner.
- Theo dõi thuộc đúng ứng dụng và máy đã chọn. Giữ trang đăng ký đó mở và Runner có kết nối. Rời màn đăng ký hoặc đổi máy sẽ tạm ngừng cập nhật; khi quay lại đúng nguồn, trợ lý tiếp tục đối chiếu trạng thái. Chế độ ChineseTest đã bật theo dõi tiếp tục yêu cầu trạng thái khi tab ẩn, trong giới hạn bộ định thời của trình duyệt.
- Đóng tab/trình duyệt hoặc máy ngủ không có dịch vụ đẩy kết quả bên ngoài. Lịch có thể vẫn chạy trên Runner. Mở lại để đọc kết quả; không coi việc mất kết nối là đăng ký thất bại.

## Trạng thái được quan sát

- Khu vực hiện tại, hộp thoại đang mở, thông báo hiện tại, nhãn nút và lý do khóa được ứng dụng cung cấp.
- Google Forms: kết nối trang quản lý, số profile, lựa chọn, trạng thái profile đang xem, chế độ và bước cần làm tiếp.
- HCMUE: kết nối và đối chiếu Runner, tài khoản đang chọn, kỳ thi đã tải, lịch hoạt động/cần kiểm tra, chế độ mẫu và điều kiện còn thiếu. Chẩn đoán của lịch đang chọn vẫn đi qua luồng đọc Runner hiện có.
- ChineseTest: kết nối và đối chiếu Runner, số tài khoản đang chọn, lịch hoạt động, lỗi thao tác, hồ sơ đang mở và bước cần làm tiếp.
- Tối đa 12 sự kiện mở trang, chọn thao tác, đổi trường và thông báo gần đây. Đổi trường chỉ ghi nhãn trường, không ghi giá trị. Một lần bấm không chứng minh yêu cầu đã hoàn tất.

Không đọc giá trị nhập, lựa chọn trong ô select, ảnh/tệp, mật khẩu, cookie, token, mã liên kết hoặc nội dung các tab khác. Văn bản thông báo và lịch sử chat được che email, số định danh dài và bí mật có nhãn trước khi gửi. Không có cơ chế nhìn toàn bộ máy hoặc theo dõi website khác. Bản local chưa có khung trợ lý cloud này.

## Bộ nhớ và chi phí

Bộ nhớ dùng `sessionStorage`, riêng theo tài khoản và tab, khôi phục nếu hoạt động gần nhất cách dưới 2 giờ. Đăng xuất hoặc phiên xác thực bị kết thúc sẽ xóa bộ nhớ của tài khoản trong tab. Tối đa 10 tin nhắn được đưa vào lượt hỏi tiếp; lịch sử khôi phục chỉ giữ nội dung, không khôi phục đề xuất có thể thực hiện hoặc nút đánh dấu từ trang cũ.

Theo dõi trạng thái chạy trong trình duyệt, không gọi model theo mỗi cú click. Chỉ khi gửi câu hỏi, frontend gửi bản ngữ cảnh được giới hạn kích thước đến backend. Backend kiểm tra cấu trúc, lọc trường lạ, che dữ liệu và bỏ snapshot cũ quá 5 phút. Hướng dẫn và gợi ý từ trạng thái trang vẫn hoạt động khi không có khóa model hoặc model lỗi.

## Phạm vi bản này và triển khai

Đây là lớp quan sát, bộ nhớ phiên, chỉ dẫn và theo dõi tiến trình theo trạng thái thực tế. Công cụ thay đổi dữ liệu qua MCP chưa được triển khai. Các thao tác lịch HCMUE vẫn dùng đề xuất và xác nhận hiện có. Không thay model mặc định và không thêm dịch vụ bên ngoài.

Build/deploy lại backend và giao diện bằng `npm run build:cloud-server`. Không có migration cơ sở dữ liệu mới. Khi kho tri thức đã được lập chỉ mục, quản trị viên chọn **Lập chỉ mục bài có sẵn** để đưa hướng dẫn `system-companion` mới vào kho.

## Kiểm tra

- `npm run typecheck`
- `npm test -- tests/assistant-tracking.test.ts tests/companion.test.ts tests/cloud/system-assistant.test.ts tests/hcmue/assistant.test.ts tests/chinesetest/monitor.test.tsx --maxWorkers=1`
- `npm run build:cloud-server`
- `npm run test:companion-ui`, `npm run test:companion-tracking-ui` và `npm run test:assistant-ui` sau khi build.

Các kiểm tra dùng tài khoản và API giả lập; không gửi đăng ký thật hoặc gọi dịch vụ model thật.
