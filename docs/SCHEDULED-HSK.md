# Săn link và chạy theo HSK — 1.8.1

1. Chọn profile, gán HSK một lần cho mỗi nhóm.
2. Chọn **Tự lấy từ Facebook** hoặc **Dán link thủ công**.
3. Bấm **Bật & chuẩn bị Test/Live**. Tool kiểm tra phiên bản extension, hồ sơ, email, ảnh và mở sẵn một tab chờ thuộc đúng profile. Profile chưa kết nối hiện lý do chờ riêng.
4. Khi có link Google Forms hợp lệ đúng HSK, profile đã chuẩn bị nhận lệnh ngay. Không chờ giờ đặt, HSK khác hay profile khác. Nếu đồng bộ làm đổi revision, bước chuẩn bị trả về revision thực tế và tự kích hoạt phân phối khi xong.

## Nguồn link

**Facebook:** cấp quyền tùy chọn tại một extension, dùng permalink của bài thông báo. Tool chỉ đọc nội dung của bài; ghép link theo nhãn HSK 1–6, bỏ form thử và bình luận, giữ tham số điền sẵn. Link trùng được gộp; nhiều link khác nhau cho cùng HSK hoặc ngày đăng ký khác lịch sẽ có lỗi rõ ràng. Giờ đặt dùng để đối chiếu đợt và tăng nhịp tìm link trước 30 giây; không phải điều kiện trì hoãn chạy.

Khi đã lấy đủ link cho các cấp độ còn chờ, tool chốt nguồn và yêu cầu extension **ngừng tải lại Facebook ngay trong phản hồi nhận link**, kể cả khi profile chưa kết nối hoặc đang chuẩn bị. Tab Facebook vẫn có thể xem lại. Những cấp chưa có link vẫn được tìm tiếp. Link bị loại thủ công không được Facebook tự khôi phục.

**Thủ công:** không cần bài Facebook, quyền Facebook hoặc chọn giờ. Bật để chuẩn bị, rồi dán link vào từng ô HSK; paste áp dụng ngay cho cấp chưa phát lệnh, gõ tay áp dụng khi Enter/rời ô. Phiên chờ thủ công tối đa 30 phút. Có thể dán nội dung bài có nhãn HSK để lấy nhiều link cùng lúc. Link nhập tay ưu tiên hơn nguồn tự động.

Mọi thao tác chạy vẫn kiểm tra kết nối, đồng bộ, email, ảnh và khóa gửi. Có link nhưng chưa sẵn sàng sẽ hiện lý do ngay trong hàng HSK và chi tiết profile.

## Link sai, cần thay link hoặc chạy lại

- **Loại link / dừng HSK:** chặn các lệnh đang xếp hàng, dừng những lượt của đúng HSK thuộc lịch này, bỏ link và giữ chờ nhập lại.
- Dán link đúng, dùng **Đổi link & chạy lại**. Bộ điều phối đợi phát lệnh cũ kết thúc, xác nhận dừng, tạo mã yêu cầu mới rồi chuẩn bị/chạy lại các profile đủ điều kiện. Các HSK khác tiếp tục độc lập.
- Lượt đã khóa gửi hoặc profile đã chuyển sang lượt khác sẽ được giữ lại với lý do cụ thể. Không cấp lại quyền gửi của lượt cũ. Đối chiếu kết quả trước khi xử lý khóa gửi.
- Đổi URL xóa cấu hình câu xác thực cũ của cấp đó để không dùng nhầm câu/form.
- **Hủy lịch chờ** bỏ các profile còn chờ. **Dừng toàn bộ lịch** dừng những lượt còn thuộc đúng lịch. Lệnh Dừng/Tạm dừng riêng vẫn chặn việc tự bắt đầu lại profile đó.

## Câu xác thực riêng từng HSK

Mỗi cấp có một ô đáp án riêng, nhập được trước khi bật lịch mà **không cần biết nội dung câu hỏi**. Khi đã bật lịch, Enter hoặc **Lưu đáp án trước** để lưu. Khi profile nhận diện câu xác thực, nội dung, loại trường và lựa chọn được gửi ngay cùng trạng thái chặn; không cần bấm nút đọc. Tool ghép đáp án đã lưu với đúng câu/form của chính profile đó và tiếp tục. Profile đến sau tự dùng đáp án cấp mình.

Không đọc được nội dung khi đã tới câu xác thực sẽ có cảnh báo ngay trong hàng HSK, cùng nút **Lấy câu xác thực**. Nút này đọc trực tiếp trang hiện tại, không dừng/focus form và không xếp sau lệnh START đang tải. Backend giới hạn đọc 2 giây, giao diện giới hạn 2,5 giây khi mất phản hồi mạng; lỗi được giữ rõ để thử lại, không có trạng thái chờ vô hạn.

Bộ đọc dùng câu đang chặn xác thực hoặc câu có dấu nhận diện verification từ extension; không lấy câu cuối chỉ vì nó đứng cuối trang. Khi có nhiều câu xác thực, hiện danh sách các câu thực tế để chọn. Một lượt cũ trong cùng profile không được dùng để tự hiển thị câu của lịch mới.

Chế độ **Diễn tập bằng form thử trong bài** có đúng một ô **Đáp án form thử**, áp dụng chung cho các HSK trên mẫu đó. Test trên các form đăng ký riêng vẫn giữ câu/đáp án độc lập theo HSK.

Đáp án nằm trong lịch và snapshot từng lượt; cấu hình chỉ có đáp án chưa được ép thành FinalQuestion thiếu tiêu đề. Khi tới câu xác thực mới gắn nội dung, mã form, mã trường và loại trường thật. CAPTCHA, lỗi upload, câu khác, lượt đã dừng hoặc đã khóa gửi không được tự tiếp tục bằng đáp án này. Test dừng trước Gửi; Live theo chế độ đã chọn. Có thể **Xóa đáp án** để bỏ cấu hình đã lưu.

## Chuẩn bị trình duyệt và triển khai

Chrome và extension phải đang kết nối. Tab chuẩn bị được lưu qua worker restart và chỉ được dùng lại nếu vẫn là trang chờ của chính extension; tab người dùng đã điều hướng không bị ghi đè. Có link, tool điều hướng tab sẵn có thay vì tạo tab mới. Việc tải form, đăng nhập và phản hồi Google vẫn phụ thuộc trình duyệt/mạng.

Backend, giao diện và extension cần cùng bản 1.8.1. Build cập nhật `dist` (local), `dist-cloud` (online) và `build`. Chép vào **đúng thư mục extension Chrome đang nạp**, Reload extension và khởi động lại backend. Không Remove extension hoặc xóa storage. Cấu hình lịch dùng JSON hiện có, không cần migration mới cho 1.8.1. Bản online vẫn cần migration HSK đã có: `202610200001_registration_schedule.sql`.

Kiểm thử fixture, không dùng bài Facebook/form đăng ký thật:

```sh
npm run typecheck
npm test
npm run build
npm run test:scheduled-hsk-ui
npm run test:final-question-ui
```

Bài UI kiểm tra chuẩn bị tab, link thủ công, phân phối từng HSK, tự nhận câu xác thực, đáp án độc lập, profile tới muộn, loại/thay link theo cấp, và giao diện điện thoại. Độ trễ tìm link thực tế trên Facebook và thời gian hoàn tất Google Forms cần nghiệm thu trên các profile thật.
