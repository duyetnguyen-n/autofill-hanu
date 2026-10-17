# Upload 1.5.1 — 18/10/2026

Đã triển khai hai thay đổi trong extension: chuẩn bị ảnh trong lúc Picker khởi tạo và chuyển ảnh vào đúng document Picker. Giữ nguyên guard document 5 giây/input ổn định 1 giây, bytes ảnh, cách điền các trường và điều kiện chặn Next/Gửi. Chưa chuyển bước kiểm tra checksum đầu lượt sang chạy cùng lúc với mở tab.

## Hành vi

- Chỉ sau khi metadata xác định duy nhất một Picker khớp mới bắt đầu đọc/mã hóa ảnh. Các lượt poll trong thời gian khởi tạo dùng cùng promise; không đọc lại ảnh mỗi poll và không chờ đọc xong mới trả trạng thái waiting.
- Metadata lần đầu được dò qua các frame; payload ảnh chỉ đến một `documentId`. URL/RPC/request vẫn được kiểm tra tại đích. Thiếu documentId hoặc nhiều Picker khớp thì chưa chuyển ảnh.
- Trước mọi lần bàn giao, kiểm tra lại runId, content epoch, trạng thái, lệnh ngắt và recovery/submit gate. Stop, đổi lượt/trang, đóng tab, tạm dừng hoặc block bỏ cache; giới hạn chuẩn bị 20 giây và không lưu bytes xuống trạng thái chạy.
- Document tạm có thể bị thay khi Picker đang tải. Khi chưa có lần bàn giao nào, được dò lại metadata và chuyển đích sang document mới; vẫn giữ guard và ảnh của đúng snapshot. Sau khi đã có khả năng bàn giao, không chuyển đích hoặc tự upload lần hai.
- Nếu mất phản hồi của lần bàn giao, dừng để đối chiếu. Nếu chỉ poll trạng thái bị ngắt vì Picker vừa đóng bình thường, tiếp tục đối chiếu tên tệp/nút xóa trên Forms với khoảng chờ hiện có; không coi việc iframe biến mất là lỗi upload và không gửi lại ảnh.
- Ghi riêng thời gian đọc, mã hóa, dò Picker và bàn giao khi Forms xuất hiện ảnh. Đây là xác nhận trên trang ảnh; vẫn phải qua validation/Next thành công và dừng trước câu xác thực trong bài Test Google.

Mã chính: `src/stored-picker-upload.ts`, tích hợp trong `src/background.ts`; log thời gian ở `src/content.ts`. Phần thực thi guard của `assignPickerFile` không thay đổi.

## Kiểm thử đã hoàn tất

| Bài | Kết quả | Bằng chứng cục bộ |
|---|---|---|
| Toàn bộ unit/runtime | 377 test, 44 file, pass | `test-results/upload-pipeline-20261018-unit.log` |
| TypeScript và build extension production | Pass; phiên bản 1.5.1, origin production, hash đúng build-info | `test-results/upload-pipeline-20261018-typecheck.log`, `test-results/upload-pipeline-20261018-build.log` |
| 10 Chrome profile độc lập, Picker mô phỏng, extension thật | Test không gửi; Live mô phỏng đúng 1 lần/profile; 20 upload đúng tên và SHA-256 ảnh riêng từng profile, 0 invalid Next; guard giữ tối thiểu 5 giây | `test-results/upload-pipeline-20261018-picker-10.json` |
| Bản cũ 9119db2 trên cùng fixture 10 profile | Pass các điều kiện nhận ảnh/gửi như trên | `test-results/upload-pipeline-20261018-baseline-10.json` |
| Bộ lỗi 10 profile | 12 mục kiểm chứng đạt; 500/503/429, hết lượt thử, Stop hủy timer, CAPTCHA mô phỏng, sửa tay/reload, Next 22 giây, mất kết nối, Reload worker, chống Chạy lại trùng, nút extension/manager và mất xác nhận gửi | `test-results/upload-pipeline-20261018-faults-10.json` |
| Google thật: hai tài khoản, hai lượt đồng thời từ bản nháp Test đã xóa câu trả lời | Cả bốn lần qua trang ảnh đến câu xác thực; đúng Google account ở lượt đầu, snapshot không đổi, 0 khóa gửi, không Gửi | `test-results/upload-pipeline-20261018-google.json`, `test-results/upload-pipeline-20261018-google-final.json`, `test-results/upload-pipeline-20261018-account-readback.json` |

Ca riêng cho pipeline bao gồm: đọc ảnh chậm nhưng poll không bị giữ; một lần chuẩn bị; không fan-out bytes; Stop giữa lúc đọc; pause/block/đổi epoch; nhiều đích hoặc thiếu documentId; document tạm bị thay; input bị thay trước khi gắn file; mất phản hồi bàn giao; iframe đóng trong lúc poll; lỗi chuẩn bị; hết thời gian cache; hai tab có bytes khác nhau. Bài content vẫn kiểm tra không Next trước chip, lỗi Google, tên ảnh sai, quá hạn upload, Stop và giá trị text bị đổi khi render lại.

Hai lỗi do race phát hiện trong bài 10 profile đã được xử lý trước bản cuối: document tạm bị thay trước bàn giao; và poll đang bay bị từ chối ngay khi upload thành công đóng iframe. Các lần chạy thất bại trong quá trình phát triển không được tính là pass. Bài cuối chạy lại cả Test lẫn Live mô phỏng và kiểm tra đầy đủ 20 lần nhận bytes.

Bài lỗi liên tiếp 500/503/429 phát hiện thêm một lỗi lịch phục hồi đã có trong baseline 9119db2: callback thức sớm hơn retryAt có thể return mà không đặt lại lịch. Test tái hiện early wake đã thất bại trước sửa. Bản cuối đặt lại đúng deadline cũ, giữ nguyên số lần thử và các gate Stop/Gửi; test Stop sau khi đặt lại lịch cũng pass. Bài trình duyệt riêng hai profile đã phục hồi chuỗi lỗi trong 25.557 ms, profile còn lại hoàn tất độc lập; Live mô phỏng vẫn đúng một lần/profile. Nguồn: `test-results/upload-pipeline-20261018-errors-fixed.json`; baseline bị kẹt được lưu ở `test-results/upload-pipeline-20261018-baseline-errors-summary.json`. Không coi unit test early wake là trace khẳng định thời điểm timer thực tế trong mọi ca timeout.

Bộ lỗi cuối 10 profile cũng qua chuỗi 500/503/429 (25.925 ms). Khi ba profile đồng thời treo document/CAPTCHA/lỗi upload, 7 profile khỏe sẵn sàng sau 5.216 ms, trong khi profile treo phục hồi sau 32.185 ms. Không có invalid Next; Live mô phỏng đúng một lần ở mỗi profile. Bộ lỗi này dùng native file input của fixture, bổ trợ cho bài Picker document thật/bytes/hash riêng và các ca unit pipeline; không phải 12 phép thử lỗi trên Google Picker thật.

## Tốc độ đo được

| Phạm vi | Bản cũ | Bản mới |
|---|---:|---:|
| Toàn nhóm 10 profile, fixture Picker | 13.205 ms | 12.196 ms |
| Khoảng thời gian sẵn sàng từng profile trong nhóm | 12.710–13.178 ms | 11.798–12.177 ms |
| Google thật, Duyệt: Start → câu xác thực | 25.735 ms (mẫu ngày 17/10) | 24.131 ms |
| Google thật, Huyền: Start → câu xác thực | 27.335 ms (mẫu ngày 17/10) | 25.580 ms |

Đây là mẫu quan sát, chưa phải tỷ lệ tăng tốc được chứng minh: hoạt động nền không được kiểm soát, Google/network khác thời điểm, và harness dùng esbuild cho source baseline trong khi bản mới được build bằng Vite. Không lấy chênh lệch toàn lượt làm thời gian do mã hóa song song tiết kiệm.

Google thật trong bản mới:

| Profile | Upload đến chip | Chuẩn bị Picker | Đọc ảnh | Mã hóa | Dò Picker cộng dồn | Bàn giao |
|---|---:|---:|---:|---:|---:|---:|
| Duyệt | 8.704 ms | 5.362 ms | 1 ms | 80 ms | 195 ms | 119 ms |
| Huyền | 8.846 ms | 5.537 ms | 2 ms | 81 ms | 520 ms | 132 ms |

Ảnh được chuẩn bị trong lúc chờ; phần đọc/mã hóa trong mẫu này chỉ khoảng 80 ms, không phải vài giây. Upload Google chưa nhanh hơn rõ rệt: mẫu cũ là 8.223/8.330 ms. Lợi ích chắc chắn từ cấu trúc là tránh đọc/mã hóa lặp và tránh cung cấp payload lớn cho các iframe không liên quan; chưa có số đo đủ để khẳng định mức giảm CPU/RAM hoặc thời gian dưới tải Google thật.

Lượt cuối sau sửa timer (`1c71c02f-77c4-4a70-8af3-78dfdd2dba3b`) cũng xóa bản nháp và Reload đúng build trước khi chạy: Duyệt 28.149 ms, Huyền 29.694 ms tới câu xác thực; upload đến chip 8.070/8.268 ms, chuẩn bị Picker 5.209/5.387 ms. Khi đó 10 browser fixture của bộ lỗi cũng đang tồn tại trên máy, nên không dùng lượt này làm so sánh tốc độ A/B. Thời gian mã hóa là 34/522 ms, cho thấy tải máy ảnh hưởng đáng kể đến số đo. Hồ sơ/snapshot vẫn khớp, không có khóa gửi hoặc lần Gửi thật. Ảnh bằng chứng `test-results/upload-pipeline-20261018-google-final.png`; dữ liệu chi tiết ở `test-results/upload-pipeline-20261018-google-final.json`.

## Cài đặt và phạm vi

Đã xác nhận cả hai profile Chrome Duyệt và Huyền nạp `dist-cloud`, Reload lên 1.5.1, giữ nguyên ID extension, liên kết, hồ sơ và ảnh. Lượt Google thật `4714aaa2-7c61-421c-9112-79077d3d6d21` chạy Test; đối chiếu read-only DB nhãn `upload-pipeline-google-first-20261018` trong `test-results/v150-production.json`. Đã dừng sau khi ghi nhận; không trả lời câu xác thực.

Thay đổi nằm ở extension; backend và giao thức không đổi, không cần migration hoặc restart/deploy backend cho lần này. Profile khác cần chép bản 1.5.1 vào đúng thư mục extension đã nạp và Reload; không gỡ extension hay xóa dữ liệu. Gói phân phối chỉ chứa `dist-cloud` production.

Kiểm thử tải 10 profile dùng HTTPS fixture tại máy, không gửi Google. Google thật mới kiểm tra hai profile, chưa chứng nhận 5–10 tài khoản Google đồng thời, giờ cao điểm, CAPTCHA thật hay tình huống hết slot. Giữ người dùng tự xử lý câu xác thực/CAPTCHA và giữ khóa nếu kết quả Gửi chưa rõ.

Lệnh tái hiện chính:

```sh
npm test
npm run typecheck
npm run build:cloud-extension
node scripts/run-node24.mjs --import tsx scripts/background-flow-check.mjs --cloud --profiles=10 --picker --report=upload-pipeline-picker-10
node scripts/run-node24.mjs --import tsx scripts/background-flow-check.mjs --cloud --profiles=10 --picker --baseline-ref=9119db2 --report=upload-pipeline-baseline-10
```

Fixture giữ nguyên origin HTTPS Google bằng host/port mapping riêng trong các browser kiểm thử; toàn bộ request được đưa về localhost, không nới origin check của extension. Tham khảo [Chromium HostMappingRules](https://chromium.googlesource.com/chromium/src/+/main/net/base/host_mapping_rules.h).
