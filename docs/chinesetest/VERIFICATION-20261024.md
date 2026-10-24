# Kiểm chứng Windows và gói Mac — 24/10/2026

## Phần đã sửa

- Chọn ảnh bắt đầu job upload qua runner ngay, không yêu cầu điền xong hồ sơ.
- Chỉ báo **Đã tải ảnh thành công** sau khi nhận đường dẫn, đọc lại bytes từ ChineseTest và phần tử ảnh trên giao diện đã tải/giải mã thành công.
- Không ghi ảnh gốc/bản nháp mới lên Supabase Storage hoặc DB. DB chỉ nhận đường dẫn và metadata; thông tin hồ sơ được lưu trong kho mã hóa trên máy chạy khi bấm Lưu.
- Cả upload và đọc lại ảnh dùng job có tiến trình để không giữ một lệnh web mở suốt thời gian chờ mạng chậm.
- Nếu đã nhận đường dẫn nhưng đọc ảnh lỗi, runner giữ đường dẫn để thử GET lại; phục hồi được sau khi khởi động lại. Không tự retry POST upload/đăng ký.
- Lỗi đọc ảnh 403 được đối chiếu bằng API danh tính trước khi kết luận hết phiên. Timeout và lỗi upload mã ứng dụng 500 không tự coi là hết phiên.
- Endpoint lưu bản gốc/bản nháp cũ trả 410 yêu cầu cập nhật. Dữ liệu cũ chỉ được dọn khi đã có ảnh ChineseTest thay thế đọc/hiển thị được; chưa xóa hàng loạt trên production.
- Cùng mã nguồn cho Windows, Mac Apple Silicon và Mac Intel. Gói Mac tạo trên Windows giữ quyền Unix thực thi cho Node và launcher.

## Kết quả kiểm tra

| Kiểm tra | Kết quả |
| --- | --- |
| Toàn bộ Vitest, tối đa 2 workers | 696 đạt, 1 bỏ qua, 80 files đạt |
| Riêng ChineseTest | 79 đạt, 15 files đạt |
| TypeScript | Đạt cả cấu hình extension và manager |
| Build server/web và runner | Đạt |
| Giao diện bằng Edge thật trên Windows | Đạt: upload khi chọn, chờ upload, lỗi GET, lỗi giải mã, retry không POST trùng, mở lại, lưu không upload lại, DB không có bản gốc/nháp, phí, điểm thi, xác minh đã hủy, lịch Test, mobile/dark |
| Gói Windows mới với Node đóng kèm | Đạt: DPAPI, worker, liên kết, relay mã hóa, chống replay, UI local, bảo vệ Origin và dừng |
| Chrome thật trên Windows | Đạt: giữ nội dung sau 46 giây trang chậm, phục hồi sau lỗi mạng, đóng thủ công, mở lại, redirect |
| ZIP cả ba nền tảng | SHA256, CRC, hash runner khớp; runtime đúng kiến trúc; Mac có quyền thực thi |
| Native Mac của bản sửa này | Chưa chạy; không coi kiểm tra ZIP là kiểm chứng native |

Bộ kiểm tra đầy đủ ban đầu gặp `openssl ENOENT` ở test HCMUE không liên quan thay đổi. Chạy lại với OpenSSL sẵn có của Git trong PATH của riêng tiến trình kiểm tra: toàn bộ đạt như bảng trên; không thay cài đặt hệ thống hay mã HCMUE.

## Đo đường truyền và phiên thật

- Trên Windows: trang chính ChineseTest khoảng **1,2–3,24 giây**, API công khai **0,34–1,03 giây**. DNS/TCP/TLS/TTFB đã được ghi riêng; chưa tái hiện các lần treo gần một phút từng thấy trên Mac. Mẫu đo này chưa đủ xác định nguyên nhân là đường truyền hay tải máy chủ.
- Phiên mới được người dùng đăng nhập trong Chrome riêng và được API danh tính xác minh. API hồ sơ phản hồi khoảng **607 ms**. Phiên phục vụ nghiên cứu được giữ mã hóa riêng, không chép đè kho của runner đang chạy.
- `getLastBm` và hồ sơ local cùng tài khoản chưa có đường dẫn ảnh. Vì vậy chưa kiểm tra được ảnh chân dung thật đọc lại sau thời gian dài/hết phiên; không tự upload ảnh thật lần nữa để tạo mẫu.
- Đã thử bộ đọc ảnh mới với một PNG công khai trên website chính thức: **546 ms**, 12.484 bytes, đúng PNG; không lưu file. Đây không phải ảnh chân dung của người dùng và không chứng minh ảnh chân dung đọc được khi hết phiên.
- JWT mới quan sát chỉ có `login_user_key`, không có `exp`. Chưa xác định TTL, gia hạn theo hoạt động hoặc ảnh hưởng của đăng nhập đồng thời. Không mặc định phiên là 30 phút hoặc vô hạn.
- Phép đo để yên client nghiên cứu từ **15:06:44 đến 15:36:46, giờ Việt Nam** (không gọi trong khoảng chờ): lần kiểm tra danh tính cuối trả **401/auth/identity**. Kiểm tra xác nhận lúc **15:37:36** vẫn 401. Đã đối chiếu token mới khác token cũ trong runner và token nhập khớp cookie; không nhầm với phiên cũ trước lần đăng nhập này. Kết quả chỉ cho biết phiên mới không dùng được ở thời điểm kiểm tra sau 30 phút; không cho biết chính xác nó mất hiệu lực lúc nào, TTL cố định, hay gọi API thường xuyên có gia hạn được không. Cần thêm phiên mới để thử nhánh có hoạt động trong lượt nghiên cứu sau; không tự suy ra một chu kỳ keepalive.

Mã frontend chính thức đã xem dùng `Img_API=/`, ghép đường dẫn upload để hiển thị ảnh. Interceptor phản hồi đã xem chuyển về đăng nhập khi gặp mã ứng dụng 401/403; chưa thấy cơ chế refresh riêng trong phần này. Nguồn: [ChineseTest](https://www.chinesetest.cn/), [bundle frontend được khảo sát](https://www.chinesetest.cn/_nuxt/eb81829.js). Đây là quan sát frontend, không khẳng định toàn bộ backend không có cơ chế gia hạn.

## Đo lại trên Mac/mạng khác

Trong workspace đã cập nhật và có dependencies:

```sh
npm run diagnose:chinesetest-network
```

Lệnh chỉ gọi trang/API công khai, không đọc kho phiên và không gửi đăng ký. JSON kết quả nằm trong `test-results/chinesetest/network-*.json`. So sánh cùng lệnh trên Wi-Fi ở nhà và mạng khác giúp phân biệt đường truyền với sự chậm của dịch vụ.

Gói ở `releases/chinesetest-direct-photo-20261024-v2/`. Website và runner cần được cập nhật cùng nhau; sửa local chưa tự thay website đang deploy hoặc runner đang mở. Không có thao tác push/deploy hay khởi động lại runner production trong lần này.
