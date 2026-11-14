# AI đồng hành HANU

## Sử dụng

1. Mở **Hỏi AI** trên Google Forms, Direct, ChineseTest, Tài khoản, Quản trị hoặc Kho tri thức; HCMUE dùng **Trợ lý HCMUE**.
2. Bấm **Mình nên làm gì tiếp?**, hoặc chọn nút trên trang rồi hỏi “Nút này vì sao bị khóa?”. Trợ lý nhận ngữ cảnh mới tại thời điểm gửi câu hỏi.
3. Mở **Ngữ cảnh đang theo** để xem trạng thái ứng dụng và ba sự kiện gần đây. Nhập **Mục tiêu đang làm** rồi bấm **Lưu mục tiêu**. Mục tiêu này theo bạn qua các ứng dụng trong cùng tab.
4. Với gợi ý về nút bị khóa, bấm **Chỉ vị trí** để đánh dấu trên trang. **Bỏ qua gợi ý** ẩn gợi ý đó trong lần mở chat hiện tại. Trợ lý chỉ đánh dấu phần tử còn tồn tại và hiển thị, không tự bấm nút đó.
5. Khi chat đang mở, chuyển trang qua liên kết nội bộ để tiếp tục trò chuyện ở trang đích. Đóng và mở lại vẫn giữ lịch sử. Trợ lý chung và HCMUE giữ hội thoại riêng, dùng chung mục tiêu và sự kiện của tab.

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

Đây là lớp quan sát, bộ nhớ phiên và chỉ dẫn theo trạng thái. Công cụ thay đổi dữ liệu qua MCP chưa được triển khai. Các thao tác lịch HCMUE vẫn dùng đề xuất và xác nhận hiện có. Không thay model mặc định và không thêm dịch vụ bên ngoài.

Build/deploy lại backend và giao diện bằng `npm run build:cloud-server`. Không có migration cơ sở dữ liệu mới. Khi kho tri thức đã được lập chỉ mục, quản trị viên chọn **Lập chỉ mục bài có sẵn** để đưa hướng dẫn `system-companion` mới vào kho.

## Kiểm tra

- `npm run typecheck`
- `npm test -- tests/companion.test.ts tests/cloud/system-assistant.test.ts tests/hcmue/assistant.test.ts`
- `npm run build:cloud-server`
- `npm run test:companion-ui` và `npm run test:assistant-ui` sau khi build.

Các kiểm tra dùng tài khoản và API giả lập; không gửi đăng ký thật hoặc gọi dịch vụ model thật.
