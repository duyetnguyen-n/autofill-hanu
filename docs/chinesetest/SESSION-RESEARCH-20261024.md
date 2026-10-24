# Nghiên cứu duy trì phiên ChineseTest — 24/10/2026

## Mục tiêu

Xác định liệu runner có thể giữ phiên bằng API đọc khi chờ giờ đăng ký, thay vì giữ Chrome mở hoặc tự đăng nhập lại. Chỉ gọi API đọc; không upload ảnh, sửa hồ sơ, gửi đăng ký hoặc lưu mật khẩu/CAPTCHA/OTP. Không thay kho phiên của hai runner production đang chạy.

## Quan sát trước phép thử mới

- Phiên được đăng nhập mới và xác minh thành công qua `/userInfo/getInfo`. Sau khi đóng Chrome và để client nghiên cứu yên 30 phút, API này trả mã ứng dụng 401; kiểm tra lại vẫn 401. Token mới đã được đối chiếu khác token cũ và khớp cookie nhập từ Chrome.
- Đây chỉ là một phép đo ở thời điểm sau 30 phút, không xác định chính xác thời điểm mất hiệu lực, TTL cố định hoặc ảnh hưởng của đăng nhập đồng thời.
- JWT quan sát chỉ có claim `login_user_key`, không có `exp`.
- Trong bundle chung và các chunk trang login, CAPTCHA, personal-test, personal-info đã khảo sát, chưa thấy endpoint refresh/renew/heartbeat riêng. Timer tìm thấy ở các chunk này phục vụ CAPTCHA, giao diện hoặc chờ tạo giấy tờ, chưa thấy timer tự duy trì đăng nhập.
- Luồng logout trong phần mã đã khảo sát gọi API từ thao tác Đăng xuất. Chưa thấy `sendBeacon` đăng xuất khi đóng cửa sổ; không khẳng định điều này bao phủ mọi đoạn mã trên website.

Nguồn chính thức: [bundle chung](https://www.chinesetest.cn/_nuxt/eb81829.js), [login](https://www.chinesetest.cn/_nuxt/be938e5.js), [personal-test](https://www.chinesetest.cn/_nuxt/a99b0e9.js), [personal-info](https://www.chinesetest.cn/_nuxt/da7c4b1.js).

## Manh mối về gia hạn phía máy chủ

Tên claim `login_user_key` giống hằng số của RuoYi. Mã TokenService của dự án đó giữ trạng thái phiên trong cache, có thể gia hạn khi xử lý request đã xác thực, và không cần cấp JWT mới mỗi lần. Bộ lọc JWT của dự án gọi bước kiểm tra/gia hạn khi tìm thấy phiên hợp lệ.

Đây là **giả thuyết dựa trên dấu hiệu tương tự**, không phải bằng chứng ChineseTest dùng đúng phiên bản, cấu hình hoặc logic RuoYi đó. Con số mặc định và ngưỡng trong mã RuoYi không được coi là thông số thực tế của ChineseTest.

Nguồn của tác giả framework: [Constants.java](https://github.com/yangzongzhuan/RuoYi-Vue/blob/master/ruoyi-common/src/main/java/com/ruoyi/common/constant/Constants.java), [TokenService.java](https://github.com/yangzongzhuan/RuoYi-Vue/blob/master/ruoyi-framework/src/main/java/com/ruoyi/framework/web/service/TokenService.java), [JWT filter](https://github.com/yangzongzhuan/RuoYi-Vue/blob/master/ruoyi-framework/src/main/java/com/ruoyi/framework/security/filter/JwtAuthenticationTokenFilter.java).

## Phép thử thật trên Windows

- Người dùng đăng nhập thủ công một lần trong Chrome riêng của helper. API danh tính xác minh thành công lúc **21:00:59 giờ Việt Nam**.
- Helper quan sát đường dẫn/phương thức/trạng thái của request API trong Chrome, không ghi headers, body đăng nhập hoặc dữ liệu hồ sơ.
- Gọi danh tính mỗi 5 phút bằng cùng phiên đã lấy. Mỗi lần đọc dùng luồng giờ máy chủ và danh tính như runner hiện tại; không gọi chồng và không retry POST.
- Đóng Chrome sau lần kiểm tra phút thứ 10, sau đó chỉ để Node tiếp tục đến phút thứ 55. Phần này kiểm tra một cách duy trì có thể chạy độc lập với cửa sổ Chrome.
- Sau khi xác nhận còn hợp lệ ở phút 55, đã ngừng toàn bộ request từ client nghiên cứu thêm 35 phút rồi kiểm tra lại. Phép thử không đo riêng nhánh Chrome mở hoàn toàn thụ động hơn 30 phút.
- Người dùng được đề nghị không đăng nhập lại cùng tài khoản ở thiết bị/cửa sổ khác trong lúc thử. Yêu cầu chống Sleep tự động chỉ tồn tại trong tiến trình nghiên cứu, không thay cấu hình nguồn của Windows; màn hình vẫn có thể tắt.
- Report nằm ở `test-results/chinesetest/session-activity-20261024/activity-report.json`; lần đối chiếu riêng nằm ở `confirmation.json`. Phiên được mã hóa riêng trong cùng thư mục, bị gitignore, không đưa vào báo cáo hoặc gói phát hành.

Kết quả:

| Phút sau xác minh | Chrome | API danh tính | Token cookie mới khác |
| --- | --- | --- | --- |
| 5 | Mở | Thành công, 1305 ms | Không |
| 10 | Mở | Thành công, 334 ms | Không |
| 15 | Đã đóng | Thành công, 344 ms | Không |
| 20 | Đã đóng | Thành công, 330 ms | Không |
| 25 | Đã đóng | Thành công, 346 ms | Không |
| 30 | Đã đóng | Thành công, 334 ms | Không |
| 35 | Đã đóng | Thành công, 805 ms | Không |
| 40 | Đã đóng | Thành công, 886 ms | Không |
| 45 | Đã đóng | Thành công, 335 ms | Không |
| 50 | Đã đóng | Thành công, 332 ms | Không |
| 55 | Đã đóng | Thành công, 1437 ms | Không |
| 90, sau 35 phút ngừng gọi | Đã đóng | 401, loại auth, bước identity | Không kiểm tra vì đã bị từ chối |

Tất cả 11 lần kiểm tra từ phút 5 đến phút 55 thành công. Chrome đã đóng lúc **21:11:00**; tại mốc cuối **21:55:59**, Node đã hoạt động độc lập khoảng 45 phút. Không có request API nền từ Chrome trong hai khoảng theo dõi đầu tiên. Cùng bearer token ban đầu được dùng suốt phép thử; chưa ghi nhận cookie token mới khác.

Ngừng gọi từ **21:56:00 đến 22:31:00**: API danh tính trả **401/auth/identity**. Đọc lại đúng phiên đã dùng trong phép thử bằng một client mới lúc **22:31:17** vẫn trả 401. Không nhầm với token cũ trong runner production.

Tiến trình đã kết thúc; yêu cầu chống Sleep tạm thời đã được giải phóng. Không restart hai runner production, không thay kho phiên của chúng, không gửi đăng ký hoặc sửa hồ sơ thật.

## Kết luận và giới hạn

**Hướng khả thi là dùng luồng API đọc danh tính của runner mỗi 5 phút khi cần chờ đăng ký, thay vì phụ thuộc vào cửa sổ Chrome.** Nhánh này đã giữ được khả năng xác thực tới phút 55 của phiên mới, bao gồm khoảng 45 phút sau khi đóng Chrome. Trong điều kiện bình thường, mỗi lượt là hai HTTP GET: lấy giờ máy chủ rồi đọc danh tính; retry GET có giới hạn có thể làm số request tăng khi lỗi mạng.

Kết quả phù hợp với giả thuyết gia hạn theo hoạt động phía máy chủ, nhưng không xác định TTL chính xác, giới hạn tuyệt đối của phiên hoặc toàn bộ cấu hình backend ChineseTest. Chưa kiểm chứng giữ được cả đêm/nhiều ngày, chưa kiểm tra riêng Chrome mở thụ động hơn 30 phút, và chưa chạy thử native Mac cho cơ chế này. Việc thay JWT mới không phải điều kiện đã quan sát thấy trong nhánh giữ nhịp.

## Hướng triển khai được đề xuất

Chưa ghép cơ chế duy trì định kỳ vào runner. Đề xuất dựa trên phép thử:

- Runner tự kiểm tra danh tính mỗi 5 phút, chỉ khi cần chuẩn bị/chờ đăng ký; dùng một tác vụ cho mỗi tài khoản, chia sẻ với các kiểm tra hiện có để không gọi trùng. Dừng tác vụ khi không còn lịch cần chạy, đã dừng hoặc đã gửi; không gắn nhịp này với khoảng dò điểm thi 0/1 giây.
- Chờ response xong mới đặt lượt sau; không gọi bù dồn khi máy vừa thức dậy. Tôn trọng lỗi mạng, rate limit và backoff.
- Giữ các bước kiểm tra trước giờ mở và trước gửi. Request đọc không thể cứu một phiên đã bị máy chủ từ chối.
- Nếu nhận lỗi xác thực thực sự, báo cần đăng nhập lại và dừng lượt chưa gửi; không tự nhập mật khẩu hay vượt CAPTCHA/OTP.
- Nhánh Node độc lập đã được kiểm chứng trong cửa sổ thử nói trên. Không coi request công khai hoặc thao tác rê chuột là bằng chứng phiên được gia hạn.
- Tiếp tục kiểm tra trên Mac/mạng khác và quan sát nhiều lần; kết quả một phiên không phải cam kết duy trì vô hạn hoặc chống vô hiệu hóa khi đăng nhập nơi khác.
