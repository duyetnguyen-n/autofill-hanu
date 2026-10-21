# Kiểm thử HANU Coordinator 1.3.1 (2026-10-12)

## Bản 1.3.4 — chuyển trang Google chậm (2026-10-16)

- Đối chiếu lượt production `e8a4ca92-e061-49c5-9f74-ae82f71261df` từ trang quản lý mở trên Cốc Cốc: một profile báo không chuyển trang sau khi điền họ tên / loại giấy tờ, nhưng Chrome thực tế đã tới trang CCCD trống. Trang mới nhận trạng thái `waiting_manual` do lượt đã bị dừng trước khi Google trả trang.
- Tăng hạn chờ phản hồi đầu tiên của nút Tiếp lên 60 giây, vẫn nhận thay đổi DOM ngay và ngắt ngay khi có lỗi nhập liệu hoặc lệnh Dừng. Chỉ thử thao tác chuột dự phòng sau hạn này, tối đa thêm 7 giây; không áp dụng lại thao tác Gửi. Không thay đổi nội dung hồ sơ hoặc quyền chạy.
- Ca hồi quy phản hồi chậm 22 giây thất bại trên bản cũ, qua sau sửa và không có click dự phòng hoặc trạng thái dừng nhầm. Kiểm tra thêm Dừng ở giây thứ 5 vẫn có hiệu lực khi trang mới xuất hiện muộn. Toàn bộ **307 ca / 39 file qua**, typecheck qua.
- Nhật ký kiểm thử lặp thực tế từ Cốc Cốc lưu riêng trong `test-results/coccoc-repeat-production-20261016.json`; chỉ ghi metadata kết quả, không chứa hồ sơ/ảnh.

## Bản 1.3.3 — hai Chrome profile chạy đồng thời (2026-10-16)

- Tái hiện trên form Google mẫu `1FAIpQLSdwGr_cZjiXs_AapAIHmP1cdHp5q4_tLWI3fNytLWHtUJW5JQ`, production Render, hai Chrome profile đang dùng. Cùng lượt `2562daae-9111-449e-8be5-02cc77d50ec0`: một profile tới câu xác thực, profile còn lại báo câu bắt buộc ngay trang đầu. Hồ sơ thứ hai để trống `recordGoogleEmail`; checkbox email độc lập không được nhận diện là bắt buộc. Bản nháp đã tích email có thể che lỗi trong lần thử lại.
- Sửa nhận diện checkbox ghi email của Google, tự ghi khi hồ sơ chưa chọn. Giữ lựa chọn từ chối rõ ràng và dừng với đúng câu cần xử lý; tích thủ công sẽ kích hoạt tự tiếp tục. Chỉ áp dụng mặc định này cho ô email tài khoản Google, không áp dụng cho các ô cam kết khác. Hiển thị cùng lựa chọn mặc định trong extension và trang quản lý.
- Nạp bản 1.3.3 vào cả hai Chrome profile, xóa câu trả lời của hai bản nháp trên form mẫu (giữ nguyên hồ sơ và ảnh đã lưu), chọn cả hai và bấm Bắt đầu Test một lần. Cùng lượt `19679215-8d6b-47de-87b8-e9f1a3819e4e`, cùng thời điểm bắt đầu: **2/2 tự tích email, tự điền, Google xác nhận upload ảnh và tới câu xác thực cuối**, không thao tác tay trong lúc chạy. Không trả lời câu xác thực, `submitAttempted=false` ở cả hai.
- `npm test -- --maxWorkers=4`: **305 ca / 39 file qua**. `npm run typecheck` và `npm run build:cloud` qua. Ca hồi quy mới thất bại trước bản sửa với cả giá trị email trống và thiếu; kiểm tra thêm từ chối, tích thủ công tự tiếp tục, không tự đồng ý ô cam kết khác.
- Bằng chứng metadata không chứa hồ sơ/ảnh: `test-results/parallel-profiles-production-20261016.json`. Gói cập nhật: `releases/hanu-autofill-online-1.3.3-20261016.zip`.

## Sửa deploy thiếu migration quản lý người dùng - 15/10/2026

- Kiểm tra project thật xác nhận thiếu `hanu.accounts`. Đã chạy migration
  `202610150001_user_access.sql` thành công; bật RLS và giữ nguyên dữ liệu cũ.
  Số lượng trước/sau: 2 tài khoản Auth, 7 profile, 5 attachment, 94 lượt chạy,
  0 khóa gửi. Không claim/release lease hoặc khởi động coordinator từ máy local.
- Đã cấp `nguyentheduyet.mtp@gmail.com` role `admin`, trạng thái `active`, dựa
  trên Google identity có email khớp và `email_verified=true`. Đã ghi sự kiện
  quản trị; không giả lập đăng nhập hoặc thay đổi cookie người dùng.
- `cloud:check` qua với database thật: bảng HANU/RLS/bucket private, Google
  provider/public key và Storage/backend key. Website `/healthz` và `/readyz`
  trả 200 nhưng `/admin` còn 404 ở lúc kiểm tra, cho thấy bản cũ vẫn phục vụ;
  cần thử lại deploy commit mới trên Render.
- Sửa log startup để giữ nguyên chẩn đoán `CloudReadinessError` an toàn, ghi rõ
  file migration bị thiếu và tiếp tục che raw error có thể chứa credentials.
  `typecheck` qua; 8 ca readiness/rolling deploy qua, gồm regression test từ
  chối thiếu migration trước khi claim lease/recovery và che thông tin nhạy cảm.

## Quản lý người dùng và trang quản trị - 15/10/2026

- `npm run typecheck`: qua. `npm test -- --maxWorkers=4`: 290 ca trong 39 file
  qua. Bao gồm pending/approval, admin bootstrap từ Google identity xác minh,
  chống tự nâng quyền, RLS, quota Start/Resume đồng thời, quyền Live, hết hạn,
  thu hồi extension, giữ khóa gửi qua khóa/mở tài khoản và nhật ký quản trị.
- Một lần chạy toàn suite cùng lúc với hai Vite build gây timeout 5 giây ở các
  fixture PostgreSQL WASM. Chạy riêng với 4 worker qua; không tăng timeout để
  che lỗi nghiệp vụ.
- `npm run build:cloud`, `npm run build:manager:assets`, `npm run test:cloud-ui`,
  `npm run test:access-ui`, `npm run test:manager-ui`: qua. UI kiểm tra đăng ký
  thông tin, chờ duyệt, cấp quyền, khóa, quyền cấp trước, nhật ký, tách admin/user,
  sáng/tối và viewport 390 px. Ảnh tại `test-results/access-*.png`; dữ liệu giả.
- `npm run test:cloud-flow`: 3 Chrome profile ban đầu thu nhỏ, extension cloud
  thật, WebSocket và PGlite, câu cuối dùng chung, dropdown, upload và chuyển
  tài liệu. Test dừng trước gửi; Live nhận đúng một phản hồi/profile; Resume
  không gửi lại. Test mất 4.780 ms, 3 renderer lease và dropdown chồng thời gian.
  Harness nhận diện worker qua dấu fixture vì Chromium mới có component
  extension `background.js` riêng; không gắn nhầm worker tích hợp của Chrome.
- Build cuối `dist-cloud/build-info.json`: production origin
  `https://hanu-autofill.onrender.com`, `development=false`, `accessPolicy=1`.
  Chưa chạy migration hoặc triển khai trên production, chưa cấu hình email
  admin thật, chưa thay extension trong thư mục Chrome người dùng đang nạp.
  Hướng dẫn kích hoạt: `docs/USER-ACCESS.md`.

## Kiểm tra lại Google Picker trên Render — 15/10/2026

- Tái hiện từ màn quản lý `https://hanu-autofill.onrender.com/`: extension báo đã chuyển ảnh nhưng Picker vẫn ở màn trống, chưa có tệp được xác nhận trên form.
- Bỏ đường tắt coi thông báo “Đã mở bộ chọn” là sẵn sàng upload. Chờ tối thiểu 5 giây từ khi tài liệu Picker bắt đầu và input hiện tại ổn định 1 giây. Giữ kiểm tra tên tệp, nút xóa tệp và Picker đóng trước khi đi tiếp; không tự upload lại khi chưa rõ kết quả.
- Build Online với đúng production origin, cập nhật `background.js` trong thư mục Chrome đang nạp `releases/dist-cloud`, Reload cả 4 profile; giữ nguyên manifest, liên kết, hồ sơ và ảnh đã lưu.
- Test trực tiếp: DN chạy riêng thành công; sau đó ND và The pinned effigy.contact trong nhóm 3 profile upload thành công, đi qua phần thanh toán, dừng ở câu xác thực cuối. Không trả lời câu xác thực và không bấm Gửi.
- The pinned effigy: lần đầu Picker chưa sẵn sàng trong hạn chờ; chạy riêng lại thấy Google nhận đúng tên tệp và hiện tiến trình upload, sau đó báo “Lỗi không mong muốn” / “Không tải lên được”. Thử PNG 1×1 qua nút Duyệt qua của Google thành công, gỡ tệp thử khỏi bản nháp rồi tạo lượt Test mới với đúng ảnh đã lưu: upload thành công, tới câu xác thực cuối trong 20 giây.
- Kết quả cuối **4/4 profile đã qua upload**, đều dừng ở câu xác thực, 0 lượt đang tự chạy, 0 đã gửi. Đây là 1 profile chạy riêng + nhóm 3 + thử lại profile lỗi; không phải 4 profile thành công cùng một lượt không cần thử lại. Lỗi Google gián đoạn vẫn có thể xảy ra. Không đổi hồ sơ hoặc ảnh đã lưu. Bằng chứng: `test-results/render-upload-retest-20261015.png`.
- `node scripts/run-node24.mjs node_modules/vitest/vitest.mjs run --maxWorkers=2`: **260/260 ca, 37 file qua**; `npm run typecheck` qua. Chạy toàn bộ với số worker mặc định có các timeout thay đổi giữa các lần ở PGlite và full-registration; không coi các lần đó là đạt.
- Gói extension cập nhật: `releases/hanu-autofill-online-stable-upload-20261015.zip`. Không cần deploy server để áp dụng sửa ở extension; các gói ZIP cũ chưa có sửa này.

## Bổ sung kiểm thử Windows ngày 2026-10-13

- Bản sửa khóa thực thi và nhận biết trạng thái: **120 ca trong 20 file qua**, typecheck qua. Kiểm tra khóa không có chủ, chủ đã kết thúc, tab độc lập đã đóng, bỏ lỡ sự kiện đóng tab sau worker restart, app/extension khác mã lượt, tạo tab thất bại, hai lệnh bắt đầu đồng thời, đóng tab lượt cũ không ghi đè lượt mới, giữ nguyên khóa gửi Live khi Dừng profile. Lỗi khởi tạo managed không chuyển lại thành Tạm dừng khi kết nối lại.
- Native Messaging báo lượt thực tế đang giữ profile, gồm lượt độc lập; content script báo có đang tự chạy để giao diện phân biệt hoạt động và giữ profile. Fixture UI hiển thị lượt độc lập khi lượt app thất bại, chặn Bắt đầu trong lúc profile bị giữ, Dừng ngay trên hàng rồi bắt đầu được. `test:manager-ui` và `test:navigation` qua; ảnh fixture `test-results/manager-execution-owner.png`.
- Trên Chrome thật, xác minh hai profile nạp build `2026-10-13-execution-owner`. DUYET NGUYEN đã hết khóa thực thi (`execution=null`); dừng/đối chiếu lượt cũ thành idle, nút Bắt đầu Test bật được. The Pinned Effigy còn tạm dừng ở câu xác thực, giao diện báo 0 profile tự chạy và 1 cần xử lý. Bấm profile chỉ mở Chrome/form, không tạo cửa sổ extension. Không điền/gửi lại hồ sơ thật trong lượt kiểm tra này. Ảnh giao diện `test-results/manager-execution-fixed.png`.
- Các kết quả mở cửa sổ extension dưới đây là kiểm tra của bản trước khi người dùng yêu cầu bỏ tính năng tự mở extension.
- Bản sửa Dừng/Chạy lại và mở profile: 105 ca trong 19 file qua. Fixture giao diện xác minh Dừng nhóm → Tiếp tục nhóm → Dừng → Chạy lại từng profile bằng link/chế độ cũ; lỗi cũ không khóa Bắt đầu, lượt mới có ID mới. Unit/integration kiểm tra nhóm cũ không điều khiển lượt mới, Tiếp tục một profile không chạy profile khác và khóa gửi vẫn giữ. Đóng tab sau Dừng/Xong Test/Đã gửi không đổi trạng thái kết thúc.
- Kiểm tra mở form/cửa sổ extension gắn đúng tab, tìm lại form khi tab cũ đóng, dùng lại cửa sổ extension cả khi worker khởi động lại và khi có hai yêu cầu đồng thời. `test-results/manager-restart.png` là kết quả fixture riêng.
- Native Messaging thật trên hai Chrome profile đang dùng: bấm tên ở Edge mở đúng form và URL cửa sổ extension chứa đúng `tabId`. Lặp lệnh FOCUS trả cùng tab/cửa sổ, không tạo thêm controller. Trên màn quản lý thật, chọn profile đã dừng và nhập link làm Bắt đầu Test/Chạy lại đều được bật; bằng chứng `test-results/manager-restart-ready.png`. Chỉ mở/đối chiếu cửa sổ trong lượt kiểm tra này, không bắt đầu điền hồ sơ thật. Công cụ không được phép đọc nội dung trang `chrome-extension://`; xác minh cửa sổ dựa trên danh sách tab và kết quả Native Messaging.
- Lần kiểm thử autofill/upload ban đầu: `npm run typecheck` và `npm test` qua, 94 ca trong 18 file. Extension và giao diện quản lý đã được build vào thư mục đang sử dụng.
- `npm run test:manager-ui`: qua trên Edge, dùng dữ liệu cục bộ riêng. Sửa các trường chưa lưu, upload ảnh, tiếp tục sửa trong khi upload, lưu rồi mở lại: giữ đủ giá trị, câu tùy chỉnh, mapping và ảnh mới.
- `npm run test:navigation`: qua trên Edge với extension và form fixture riêng. Đi qua các lần tải tài liệu mới bằng đường dẫn `/forms/u/0/d/e/.../formResponse`; Test dừng trước Gửi; Live gửi đúng một lần và nhận trang xác nhận; Tiếp tục sau gửi không gửi lần hai.
- Thử trực tiếp màn quản lý trên Edge và profile đã liên kết trên Chrome: Google Form mẫu tự điền, chuyển trang, upload ảnh giả qua Google Picker và đến trang cuối. Câu xác thực được nhập theo phép người dùng; Tiếp tục đạt **Xong Test**, `ready_to_submit`, `submitAttempted=false`. Không bấm Gửi trên Google Form thật. Live chỉ được thử trên fixture riêng.
- Đã sửa nguyên nhân dừng sau trang đầu: URL của tài liệu do Google POST có tiền tố tài khoản `/forms/u/0/`, khác URL hiển thị sau chuyển hướng. Đồng thời sửa nhận diện nút Gửi với dấu Unicode tổ hợp, lỗi còn khóa nút Test sau Dừng và khôi phục trạng thái sau chuyển trang.
- Sau thử, hồ sơ và ảnh gốc được khôi phục, đồng bộ rồi đọc lại từ extension để so sánh khớp bản sao trước thử. Bản nháp Google chứa câu trả lời giả đã được xóa theo xác nhận người dùng. Bản sao hồ sơ tạm trên máy đã được dọn.
- Ảnh kết quả cục bộ: `test-results/google-test-complete.png` và `test-results/manager-upload-draft.png`. Các kết quả này không thay thế nghiệm thu nhiều profile hoặc bộ cài Windows.

## Kết quả đã xác minh

- `npm run typecheck`, `npm test`, `npm run build`: qua. 81 ca trong 15 file.
- Thử trực tiếp trên Chrome đang dùng: liên kết profile Duyệt, giữ ID extension cũ, đọc hồ sơ/ảnh, ping phản hồi, chọn đúng cửa sổ, reload extension và kết nối lại app. Kiểm tra SQLite toàn vẹn và SHA-256 ảnh khớp. Không điền hoặc gửi hồ sơ thật trong lần kiểm tra này.
- Native Messaging chạy thật trên 2 và 5 Chrome for Testing riêng. Mỗi profile dùng hồ sơ giả và PNG 672.673 byte. Kiểm tra đúng tên, giấy tờ, ảnh; câu hỏi đảo thứ tự; cửa sổ form được mở nền.
- Fixture Test tới trang cuối, mỗi phiên upload đúng một tệp và không gửi. Replay cùng START hai lần không mở tab hay chạy lại.
- Fixture Live hai phiên: một có xác nhận, một server nhận nhưng trang không xác nhận. Server nhận mỗi phiên đúng một lần; Resume và khởi động lại app không gửi thêm.
- Giao diện sáng/tối và 390 px được chụp kiểm tra, không lỗi JS, không tràn ngang toàn trang. Nút Kiểm tra kết nối có thông báo phản hồi trong ngăn hồ sơ.
- Mô phỏng lỗi ổ đĩa trong kiểm thử: app chặn lượt mới và extension dừng, không cấp quyền gửi khi coordinator không lưu được trạng thái.

## Số đo fixture trên Mac M1 16 GB

Đây là HTML/HTTPS cục bộ, không phải tốc độ Google Forms. Mỗi profile là một tiến trình Chrome riêng, ảnh PNG nhiễu tổng hợp. CPU đo tổng cả harness, Chrome và cầu nối; 100% bằng một lõi. RAM là tổng RSS, có thể đếm lặp các trang nhớ dùng chung.

| Phiên | Nhận lệnh (ms) | Tới trang cuối (ms) | Upload từ tải trang (ms) | RSS đỉnh (MB) | CPU đỉnh (%) | Kẹt |
|---|---:|---:|---:|---:|---:|---:|
| 2 | 8–10 | 326–326 | 206–221 | 4078 | 128 | 0 |
| 5 | 383–512 | 902–1011 | 278–450 | 6375 | 196 | 0 |

Phép thử 24 phiên bị gián đoạn trong lúc chuẩn bị do ổ đĩa đầy; chưa có kết quả nghiệm thu. Đã dọn tệp fixture/runtime sinh ra và thêm kiểm tra dung lượng trước khi thử. `npm run bench:fixture -- --sizes=24` cần ít nhất 1.664 MB trống theo ngưỡng của harness, cộng dung lượng máy cần cho swap và ứng dụng khác.

Kết quả máy đọc được ở `test-results/browser-2.json`, `browser-5.json`, ảnh giao diện `manager-light.png`, `manager-dark.png`, `manager-detail.png`, `manager-mobile.png`. Dữ liệu fixture không chứa hồ sơ thật.

Đã chạy smoke test gói Mac Apple Silicon: runtime kèm gói, HTTP có xác thực, cầu nối kèm gói, liên kết/import hồ sơ thử và mở lại app không tạo coordinator thứ hai. Không dùng Node hệ thống. Lệnh: `node scripts/run-node24.mjs scripts/package-smoke.mjs`.

## Chưa nghiệm thu

- Hiệu năng 24 Chrome profile trên Google Forms thật, Google Picker thực tế với ảnh dung lượng thường dùng, và cửa sổ nền trên nhiều máy.
- Runtime/cầu nối/bộ cài trên Windows 10/11 x64 và Mac Intel thật. Gói Mac Apple Silicon được tạo; đóng gói hai nền tảng còn lại bị chặn bởi dung lượng trống hiện tại.
- App Mac phát hành chưa ký/notarize. Không đánh dấu Windows, Intel hay hiệu năng 24 phiên là đạt từ kết quả fixture 2/5.

Kết quả form Google thật của bản 1.2.1 được lưu riêng ở `tests/live/TESTING-1.2.1.md`; không dùng nó để tuyên bố bản điều phối mới đã được nghiệm thu trên Google Forms.

## Kiểm thử chạy nhiều cửa sổ nền — 13/10/2026

- `npm test`: 142 ca trong 23 file qua; typecheck, manager UI và navigation qua. Thử lại với 5 profile bằng `node scripts/run-node24.mjs scripts/background-flow-check.mjs --profiles=5` cũng qua cả Test và Live, không bấm xem từng form.
- Đã sửa lỗi quét form khi viewport hoặc thẻ câu hỏi có chiều rộng 0; chờ câu bắt buộc tải điều khiển, kiểm tra lại đáp án trước Tiếp, nhận đúng thông báo “Đây là một câu hỏi bắt buộc”. Dropdown chờ lựa chọn tải trễ, thử lại có giới hạn và kiểm tra giá trị thực sự được chọn.
- Các thao tác cần trang hoạt động dùng hàng đợi chung giữa các profile. Extension dùng `Page.bringToFront` và `Emulation.setFocusEmulationEnabled` qua quyền debugger sẵn có trong phạm vi thao tác; tắt và detach khi kết thúc. Trusted click/key dùng lại kết nối này. Dừng hoặc đổi tài liệu hủy quyền cũ; Dừng/Tiếp tục nhanh không để execution cũ khóa lần mới.
- `npm run test:background-flow`: đạt trên Windows với 3 tiến trình Edge riêng, ban đầu thu nhỏ, không bấm xem từng form. Luồng gồm câu cam kết tạo qua requestAnimationFrame sau tải trang, dropdown Material tạo lựa chọn sau 1,8 giây, ảnh giả, chuyển tài liệu `/forms/u/0/...`. Cả 3 đạt `ready_to_submit`, không bấm Tiếp khi thiếu đáp án, Test không gửi; Live gửi vào máy chủ thử đúng 1 lần/profile, Resume không gửi lại.
- Harness chỉ gắn CDP vào service worker để nối cầu Native Messaging thử, không gắn Playwright vào trang form trong khi chạy, không dùng flags tắt throttling/occlusion. Việc giữ trang hoạt động đến từ mã extension cần nghiệm thu, không từ harness. Coordinator, hàng đợi, storage và mã content/background trong dist được dùng thực tế. Các profile, tài khoản, ảnh, HTTPS server và SQLite đều riêng; không dùng hồ sơ thật hay gửi lên Google.
- Báo cáo: `test-results/background-flow.json`; ảnh 3 profile **Xong Test**: `test-results/background-flow-manager.png`. Đây là kiểm thử Chromium và luồng điều phối cục bộ, chưa thay thế nghiệm thu 24 Chrome profile hoặc Google Picker thật ở bản sửa này.
- Đã cập nhật tiến trình bộ điều phối đang sử dụng, dừng 3 lượt thử cũ bị kẹt. Cả 3 kết nối lại, `idle`, hồ sơ/revision giữ nguyên và dữ liệu ảnh khớp SHA-256 trước/sau; SQLite `integrity_check=ok`.
- Sau người dùng Reload, Native Messaging PING xác nhận cả 3 Chrome profile đang dùng build `2026-10-13-background-forms`, kết nối bình thường, `idle`, `execution=null`. Không chạy lại/gửi hồ sơ thật trong bước xác nhận bản đã cài.

## Chạy đồng thời giữa các profile — 13/10/2026

- Renderer được cấp quyền độc lập theo profile, không giữ hàng đợi foreground trong lúc chọn dropdown, upload, chuyển trang hoặc chờ xác nhận gửi. Cửa sổ bình thường không bị gọi `Page.bringToFront` ở mỗi bước. Chỉ sửa viewport 0x0 hoặc chế độ foreground cũ mới cần đưa cửa sổ lên trước.
- Kiểm thử kiểm tra số bước chồng lấn thực sự, không chỉ phát START đồng thời. Với cùng fixture 5 profile: chế độ tuần tự 17.956 ms, tối đa 1 dropdown; bản đồng thời 6.582 ms, tối đa 5 dropdown và 5 renderer lease. Với 3 profile, bản đồng thời 4.886 ms và 3 dropdown chồng lấn. Đây là thời gian Test của form cục bộ, không phải cam kết tốc độ Google thật.
- Cả 3/5 profile đi từ cửa sổ thu nhỏ qua toàn bộ form; debugger được detach khi Test xong, không bấm Tiếp lúc thiếu dữ liệu, Test không gửi. Live trên fixture xác nhận đúng 1 lần/profile và Resume không gửi lại. Profile dừng/hết hạn không hủy quyền của profile khác; Dừng ngay khi đang attach/đọc viewport không để lại debugger hoặc focus muộn.
- `npm test`: 152 ca trong 23 file qua; typecheck qua. Báo cáo mới: `test-results/parallel-background-flow-3.json`, `parallel-background-flow-5.json`; đối chứng: `serial-background-flow-5.json`. Ảnh: `parallel-background-flow-5-manager.png`. Lệnh đối chứng dùng cùng harness với `--profiles=5 --serial`; bản đồng thời dùng `--profiles=5`.
- Sau Reload, cả 3 Chrome profile thật phản hồi build `2026-10-13-parallel-forms`, kết nối bình thường, `idle`, `execution=null`; màn quản lý có 3/3 kết nối và 3 hồ sơ sẵn sàng. Đối chiếu hồ sơ khớp extension hiện tại, 4 ảnh lưu trong SQLite khớp SHA-256 và integrity check đạt. Một khác biệt chỉ là dấu cách cuối tên ngân hàng đã được đồng bộ về cùng giá trị.

## Đáp án câu hỏi cuối dùng chung — 13/10/2026

- Màn quản lý khai báo một nội dung/đáp án cho các profile được chọn; đọc câu hỏi từ trang form đang mở để chọn mã entry/item ổn định và loại điều khiển. Chỉ điền trên trang có Gửi, đối chiếu toàn bộ tiêu đề; trùng câu, sai form, sai loại hoặc nội dung đã đổi đều dừng. CAPTCHA vẫn cần thao tác thủ công.
- Snapshot câu cuối riêng từng lượt, không thay hồ sơ/ảnh. Có thể cập nhật các lượt đang chờ rồi tiếp tục đồng thời; Chạy lại giữ cấu hình. Kiểm tra capability của mọi extension trước START để không âm thầm bỏ qua cấu hình trên bản cũ. Đọc câu hỏi chỉ thực hiện khi profile không đang chạy, giữ renderer đủ để đọc form bị che và detach sau khi đọc.
- `npm run typecheck` và `npm test`: 175 ca trong 24 file qua. Có ca xác thực biết trước, trả lời ngắn/đoạn văn/radio/dropdown/checkbox, loại Có không bị coi như cam kết boolean, bỏ lựa chọn checkbox cũ, trùng tiêu đề, sai form/loại, mã câu còn nhưng tiêu đề đổi, snapshot nhiều profile và từ chối extension thiếu capability. Hai ca navigation dùng sleep cố định được đổi sang chờ sự kiện có giới hạn để tránh lỗi timing dưới tải kiểm thử.
- `npm run test:final-question-ui` qua: đọc câu trực tiếp, tự chọn loại/mã, đáp án chung tới 2 profile, START bị khóa khi thiếu dữ liệu, cập nhật/tiếp tục lượt chờ, đổi link xóa khai báo. `test:manager-ui` và `test:navigation` qua, giữ sửa hồ sơ chưa lưu khi upload và chống gửi trùng.
- `node scripts/run-node24.mjs scripts/background-flow-check.mjs '--profiles=3' --final-question` và cùng lệnh với 5 profile qua trên HTTPS fixture cục bộ. Các cửa sổ bắt đầu thu nhỏ, đi hết 4 trang; dừng ở câu xác thực, đọc từ một profile, cập nhật 2026 một lần và Resume toàn bộ. Test không gửi; Live khởi chạy với snapshot đã chọn gửi đúng 1 lần/profile, Resume không gửi lại. 5 dropdown vẫn chồng lấn. Báo cáo `test-results/shared-final-question-flow-3.json`, `shared-final-question-flow-5.json`; ảnh giao diện `shared-final-question-manager.png`.
- Build extension cập nhật tại `dist`, manager tại `build`. Bộ điều phối thật đã cập nhật, kiểm tra 4 hồ sơ/ảnh giữ nguyên và SQLite integrity đạt. Extension thật cần người dùng Reload bản `2026-10-13-shared-final-question`; không chạy/gửi hồ sơ thật để kiểm thử tính năng này.
- Sau người dùng Reload, cả 4 profile thật phản hồi PING build `2026-10-13-shared-final-question`, kết nối và idle, execution=null. Đã mở màn quản lý Edge với mục câu hỏi cuối hiển thị, 4/4 profile sẵn sàng; ảnh phần mới `test-results/shared-final-question-ready.png`. Việc xác nhận bản cài không chạy/điền/gửi form thật.

## Rút gọn thao tác câu hỏi cuối — 13/10/2026

- Chỉ sửa manager UI. Đọc form tự chọn câu xác thực đang chặn hoặc câu cuối đã đọc, tự gắn mã/loại, loại checkbox ghi email do scanner cũ nối vào cuối danh sách. Bỏ checkbox bật tính năng và placeholder "Chọn câu hỏi cuối đã biết"; thông tin câu hỏi hiện dạng kết quả, đáp án lựa chọn dùng Select khi đọc được options. Đổi nguồn/câu, nhập trước và tắt đáp án chung nằm trong mục phụ thu gọn.
- Typecheck và `test:final-question-ui` qua: một lần bấm đọc tự chọn đúng câu/mã/loại, giữ đáp án đang nhập, không ghép nhầm checkbox ghi email, không phải chọn lại câu, cập nhật hai lượt đang chờ trong một lần áp dụng; vẫn nhập trước và xóa khai báo được. `test:manager-ui` qua, upload vẫn giữ bản nháp và nút Dừng/Chạy lại đúng luồng. Ảnh fixture: `test-results/compact-final-question-manager.png`.
- Build chỉ cập nhật `build/manager-ui`, không đổi extension hay bộ điều phối; không yêu cầu Reload extension. Màn Edge được refresh và khôi phục link, chế độ, 4 profile đã chọn cùng câu/đáp án người dùng đang nhập.
- Trên màn quản lý thật, bấm Đọc một lần đã nhận diện câu "Năm nay là năm bao nhiêu?今年是哪一年？ *" và loại text, giữ đáp án 2026. Không bấm Áp dụng/Tiếp tục và không điền/gửi form thật. Ảnh kết quả: `test-results/compact-final-question-ready.png`.
## Supabase cloud — 13/10/2026

- Thêm Google OAuth/PKCE qua Supabase SSR, cookie HttpOnly, getUser xác minh
  phía server; không có chế độ bỏ qua auth trong CLI production.
- `npm run typecheck` và `npm test`: 199 ca trong 29 file qua. 175 ca local vẫn
  giữ. Ca mới chạy migration/RLS trên PostgreSQL WASM (PGlite), kiểm tra tenant
  isolation, column grants/token hash, one-use pairing, token revocation, submit
  transaction, lease fencing, stale events, shared-answer/state race, reconnect
  ordering và migration profile/ảnh/lịch sử/khóa gửi. Supabase SDK PKCE/cookie/
  getUser/logout được kiểm thử qua Auth HTTP fixture; không phải Google thật.
- `test:cloud-ui` qua: login/callback fixture, đổi tài khoản xóa dữ liệu/lựa chọn/
  link trước, pairing không cần native ID, upload giữ bản nháp, Save sync, logout
  và login mobile. `test:manager-ui` qua sau refactor async store; assertion đợi
  command acknowledgement thay vì giả định request HTTP hoàn tất ngay sau click.
- `test:cloud-flow` qua với 3 profile và cùng script `--profiles=5`: extension
  online thực, WebSocket thực, PostgreSQL fixture, 4 trang HTTPS Forms fixture.
  Cửa sổ bắt đầu minimized, không attach/focus form từ harness; dropdown delayed,
  cam kết, ảnh, câu xác thực chung và navigation đều qua. Test không gửi; Live
  đúng 1 lần/profile; Resume không gửi lại. Lease peak 3/5; dropdown chồng lấn.
  Không chạy/gửi form Google hay hồ sơ người dùng thật.
- Cloud build ra thư mục riêng; không ghi đè dist local. Docker Compose config
  được validate; Docker image/VPS thật chưa chạy vì Docker daemon hiện chưa mở
  và chưa có Supabase/domain. Cần nghiệm thu Auth/Storage/TLS production theo
  docs/CLOUD.md. Không coi fixture là xác nhận dịch vụ bên ngoài đã hoạt động.
- Ảnh fixture: cloud-login.png, cloud-login-mobile.png, cloud-manager.png,
  cloud-background-flow-3-manager.png và cloud-background-flow-5-manager.png.
  Báo cáo full flow trong test-results/cloud-background-flow-3.json / -5.json.

## Upload và điền chồng lấn trên Render — 15/10/2026

- Kiểm thử bằng UI tại https://hanu-autofill.onrender.com/ với 4 Chrome profile đang kết nối và mẫu Google Form thử do người dùng cung cấp. Chỉ Test, để trống câu xác thực, không Gửi.
- Sau khi người dùng deploy/reload: cả 4 tới câu xác thực trong 24–27 giây, không thử lại upload. Phát hiện điều kiện kiểm tra lỗi đã loại ô bắt buộc còn trống khỏi nhóm điền trong lúc upload. Sửa điều kiện này; vẫn kiểm tra giá trị sau điền và sau Google xác nhận ảnh. Thu hẹp fingerprint chuyển trang về nút Tiếp/Gửi để nút upload thay đổi không gây nhận nhầm trang mới.
- Build lại extension và reload 4 bản đang dùng từ releases/dist-cloud. Hai lượt tiếp theo đều 4/4 tới câu xác thực, không thử lại upload. Mỗi lượt đặt lại ảnh và các ô văn bản tại trang ảnh của 3 profile; profile thứ tư giữ ảnh đã có. Dropdown và thông tin các trang khác vẫn có dữ liệu bản nháp. Không coi đây là thử nghiệm bản nháp trống hoàn toàn hoặc đối chứng tốc độ.
- Lượt thứ hai: ND 18 giây, DN 20 giây, The pinned effigy 18 giây; profile giữ ảnh 10 giây. Thời gian Google nhận ảnh lần lượt 8087/7877/7855 ms, chuẩn bị Picker 5216/5284/5250 ms.
- Lượt thứ ba: ND 19 giây, DN 17 giây, The pinned effigy 18 giây; profile giữ ảnh 10 giây. Thời gian Google nhận ảnh 8193/7918/7947 ms, chuẩn bị Picker 5358/5337/5372 ms. Nhật ký xác nhận mở Picker trước, điền Email/Ngày sinh/Số điện thoại trong khi chờ upload, chỉ bấm Tiếp sau Google xác nhận ảnh.
- Khoảng chờ sàn 5 giây cho Picker vẫn giữ nguyên; thay đổi này không loại bỏ nó và không tăng nó. Hai lượt qua không chứng minh không thể lỗi hoặc đảm bảo tốc độ khi tranh suất/Google quá tải. Chưa nghiệm thu 24 profile. Bảng quản lý đôi lúc cập nhật trạng thái chậm; số thời gian cuối và nhật ký được đọc sau khi cập nhật.
- Typecheck qua; Vitest 263 ca/37 file qua với --maxWorkers=2. Có hồi quy cho ô required trống, thay đổi giá trị sau upload và nút upload xuất hiện trong khi chờ chuyển trang. Không chạy Live trên Google.
- content.js SHA-256: 6a87c336f5a64375da98d4f2257cf9eae6899964899c42917c475b2bf9dd03b8. Gói: releases/hanu-autofill-online-overlap-upload-20261015.zip. Ảnh màn quản lý: test-results/overlap-upload-retest-20261015.png. Source sửa trong workspace; chưa commit/push/deploy lại Render trong lượt kiểm thử này.

## Áp dụng câu cuối theo profile đã tới — 15/10/2026

- Bỏ điều kiện giao diện yêu cầu mọi profile cùng chờ. Nút hiển thị số profile đang chờ đúng câu hỏi hoặc ở bước trước Gửi. Profile đang chạy, lỗi ảnh, mất kết nối, sai form hoặc đã khóa gửi được giữ nguyên; profile tới muộn có thể áp dụng ở lần bấm sau. Backend kiểm tra từng profile, không có hàng rào chờ đọc/flush/kiểm tra toàn nhóm. Cập nhật lỗi riêng không ngăn profile thành công tiếp tục.
- Kiểm thử backend có 8 profile lẫn trạng thái, lần áp dụng sau với đáp án khác, lưu/history/mode, lỗi riêng, khóa gửi, thay run ID, profile đọc database chậm và profile chậm xác nhận. Cloud RunBuffer/PostgreSQL fixture vẫn xác nhận lưu đáp án trước Resume và giữ Test mode.
- UI fixture 4 profile: một chờ câu cuối, một đang chạy, một lỗi upload, một mất kết nối. Áp dụng chỉ gửi SET_FINAL_QUESTION/RESUME cho profile đầu; ba profile còn lại giữ snapshot cũ. Sau đó cho profile đang chạy tới câu cuối, áp dụng riêng thành công trong lần bấm tiếp. Count và thông báo bỏ qua đúng; không cần bỏ chọn profile lỗi. Ảnh: test-results/partial-final-question-ready.png và partial-final-question-applied.png.
- Typecheck qua; Vitest 265 ca/37 file qua; test:final-question-ui qua. build:manager:assets và build:cloud-server qua. Chưa deploy lên Render, chưa thử đáp án chung trên Google thật trong lượt này. Không đổi upload/extension: sàn chờ Picker 5 giây và thời gian upload Google còn nguyên.

## Bấm Tiếp và xác nhận trang sẵn sàng — 15/10/2026

- Tiếp dùng browser input ngay lần đầu sau khi cuộn và hit-test; không bấm xuyên overlay/nút disabled. Chỉ fallback DOM khi bridge xác nhận chưa bắt đầu gửi input. Sau press không rõ kết quả hoặc mất acknowledgement, chờ trang thay vì bấm lặp. Timeout 7 giây vẫn là giới hạn xác nhận, không còn là thời gian chờ để chuyển từ click DOM sang browser input. Không thay đổi đường Gửi.
- Fingerprint gồm mã câu hỏi, toàn bộ nhãn và heading của section; không cắt 700 ký tự. Không nhận màn hình trống, modal/loading hay card required chưa có điều khiển là trang mới sẵn sàng. Trang chỉ có hướng dẫn vẫn hợp lệ. Alert cũ trong lúc trang mới dựng chưa hoàn tất không làm dừng sớm.
- Khi Google gắn đúng tên tệp và đóng Picker, MutationObserver đánh thức bước upload thay vì luôn chờ thêm vòng polling 250 ms. Không lặp upload, không đi tiếp chỉ vì đã gán File, giữ sàn khởi tạo Picker 5 giây.
- Đối chứng Edge headless bằng chính content.ts bundle trong bộ nhớ, bridge/attention giả và browser click CDP, mỗi tình huống một lượt: click synthetic bị bỏ qua giảm từ 7079 xuống 52 ms; chuyển tiếp trống 800 ms từ báo lỗi sớm thành hoàn tất sau 866 ms; trang chậm 1,2 giây chỉ nhận một click ở cả hai bản. Trang bình thường tăng từ 22 lên 111 ms trong lần đo này. Đây không phải benchmark Google hay bảo đảm tăng tốc tổng. Dữ liệu: test-results/navigation-optimized-check.json.
- Đã sửa các phần tối ưu quản lý đang dở: cache SQLite chỉ cập nhật sau SQL thành công, invalidation khi rollback, trả bản sao để tránh sửa cache ngoài saveSession; so sánh đủ mọi trường ExecutionView; dọn timer broadcast trước khi đóng DB; sửa hai lỗi TypeScript của heartbeat map. Giữ các thay đổi có sẵn, không gộp flush cả nhóm.
- Typecheck, build:cloud-server và extension cloud build qua. Vitest 296 ca/40 file qua, gồm rollback/cache isolation, đủ trường execution, input bị mất acknowledgement, Stop, Next ngoài viewport/bị che/disabled, trang loading/required dựng trễ, section chỉ hướng dẫn và nhận upload trước khi Picker đóng. Không có unhandled error shutdown.
- Reload bản extension mới ở 4 Chrome profile thật từ releases/dist-cloud. Google Test lượt đầu 4/4 tới câu xác thực, khoảng 51 giây; nhật ký cho thấy các trang đầu được điền từ trống, cả 4 upload. Lượt này trùng Vitest/build nên không dùng kết luận tăng/giảm hiệu năng. DN upload 24525 ms/chuẩn bị 12669 ms, ND 15218/12358, The pinned effigy 10706/8188, contact 17475/13512.
- Lượt lặp sau khi Vitest/build đã xong: đặt lại ảnh và các textbox ở trang ảnh của DN, ND, The pinned effigy; contact giữ ảnh có sẵn. Cả 4 tới câu xác thực: ND 21 giây, DN 18 giây, The pinned effigy 18 giây, contact 10 giây. DN upload 7672 ms/Picker 5256 ms; ND 8241/5379; The pinned effigy 7717/5279. Các trang khác giữ dữ liệu bản nháp, không coi đây là đăng ký từ trống. Chưa có bằng chứng tốc độ tổng tăng rõ rệt, chưa nghiệm thu 24 profile hoặc tải tranh suất.
- Không trả lời câu xác thực, không bấm Gửi, chỉ Test. Ảnh: test-results/navigation-optimized-google-20261015.png. Gói: releases/hanu-autofill-online-navigation-20261015.zip. Background SHA-256 40a92f812be17f4bc86d7b277776ceb0b2acf980dc63f0301f84f8e4128050dc; content e3b0dd712a9f95f7f0841eb04b58511c034583fdd4b1e1a6928715f93450ab1f. Chưa commit/push/deploy backend Render; extension trên 4 profile đã cập nhật tại máy.

## Rút lại thay đổi chuyển trang sau hồi quy thực tế — 15/10/2026

- Người dùng báo lỗi không chuyển trang/dừng tăng lên. Qua màn quản lý ở trình duyệt riêng: ND dừng sau 4 giây, DN sau 5 giây với lỗi chuyển trang; ba profile khác Xong Test. Nhật ký DN ghi chuẩn bị Tiếp và lỗi cùng giây ngay sau chọn loại giấy tờ, chưa tới timeout 7 giây. Tại lúc quan sát lại, nút không disabled, không có modal và hit-test trỏ đúng nút; chưa đủ bằng chứng xác định điều kiện guard nào sai tại chính thời điểm dừng.
- Một lần bấm Tiếp trực tiếp trên tab DN đã sang trang số giấy tờ, không báo validation. Việc này chứng minh form vẫn đi tiếp được; không chứng minh mọi trường hợp dừng cùng nguyên nhân.
- Rút toàn bộ thay đổi content.ts/background.ts của commit e9023d6, khôi phục chính hai file tại e9023d6^ (luồng DOM click trước, browser fallback sau khi chưa chuyển trang). Khôi phục các fixture tương ứng và rút các test chỉ mô tả tính năng đã bỏ. Bản thử và test rút lại được giữ trong Git và test-results/withdrawn-navigation. Giữ sửa cache/rollback, execution fields, shutdown/TypeScript và áp dụng đáp án từng profile.
- Typecheck, extension build qua; 277 test/38 file qua. content.js SHA-256 6a87c336f5a64375da98d4f2257cf9eae6899964899c42917c475b2bf9dd03b8, background.js 3ffe72898c8beec5a9b76af68b16f1012d72fa1c4b005bfe7c4c40ad6d91e9ec: khớp bản trước tối ưu navigation. Đã cập nhật releases/dist-cloud và gói releases/hanu-autofill-online-navigation-restored-20261015.zip; gói navigation gây hồi quy đổi tên .withdrawn.zip.
- Người dùng xác nhận Reload cả 5 profile. Test thật sau khôi phục, không chạy build/Vitest đồng thời: lượt đầu 4/5 tự tới câu xác thực (ND 24s, Yen 21s, contact 23s, Hiền 20s). DN dừng sau 27s với “Không tìm thấy nút Tiếp hoặc Gửi”; kiểm tra trực tiếp thấy dialog Google “Tiến trình đã được lưu / có một bản nháp mới hơn”, không phải upload thất bại (Google đã nhận ảnh sau 7919 ms). Bấm Cập nhật rồi Tiếp tục riêng DN: form chạy lại và tới câu xác thực. Chưa xác định nguồn xung đột bản nháp; chưa thêm tự động chấp nhận bản nháp hay tuyên bố trường hợp này đã được sửa trong code.
- Hai lượt lặp tiếp theo đều 5/5 tự tới câu xác thực, không can thiệp trong lúc chạy. Mỗi lượt đặt lại ảnh và 3 ô văn bản trên trang ảnh của ND, DN, Yen, Hiền; contact giữ ảnh có sẵn. Lượt hai: ND 28s, DN 20s, Yen 19s, contact 22s, Hiền 21s. Lượt ba: ND 19s, DN 17s, Yen 19s, contact 12s, Hiền 18s. Lượt ba đợi UI Google báo đã lưu bản nháp rồi đóng 4 tab Test cũ trước khi mở lượt mới. Không suy ra chắc chắn thao tác này là nguyên nhân hết xung đột.
- Lượt ba: mỗi profile cần ảnh chỉ mở upload một lần; thời gian Google nhận ảnh/khởi tạo Picker: ND 8069/5251 ms, DN 7765/5174 ms, Yen 8848/5216 ms, Hiền 8166/5315 ms. Nhật ký không có lỗi chuyển trang, sai giá trị hoặc thử lại upload. Không tăng timeout: fallback Tiếp tối đa 7 giây và sàn Picker 5 giây còn nguyên. Lượt hai vẫn có một khoảng chuyển trang ND khoảng 8 giây; không tuyên bố đã giải quyết độ trễ fallback.
- Sau lượt hai, dừng tự động và quay lại từng trang của 4 tab Chrome truy cập được. Đối chiếu 14 trường/profile với hồ sơ trên quản lý: họ tên, loại/số giấy tờ, email, ngày sinh, điện thoại, giới tính, quốc tịch, tiếng mẹ đẻ, thời gian học, phương thức chuyển khoản, số/chủ tài khoản và ngân hàng đều khớp; tên tệp khớp upload và hai trang cam kết đã chọn. Profile contact chỉ kiểm tra qua nhật ký quản lý; công cụ trình duyệt không thấy tab của profile này. Trong lúc chuẩn bị test đã thử xóa hai ô ngân hàng của DN, Google chặn Quay lại vì required; đã điền lại đúng giá trị hồ sơ rồi đối chiếu lại, không coi đây là lỗi autofill.
- test:final-question-ui chạy lại qua: chỉ profile đã tới câu hỏi được áp dụng/Tiếp tục, profile đang chạy/lỗi upload/offline giữ nguyên; profile tới muộn áp dụng ở lượt bấm sau. Đây là fixture local, không phải trả lời câu xác thực trên Google thật. Google thật vẫn Test, để trống xác thực, không Gửi.
- Các trang khác còn dữ liệu bản nháp; chưa test bản nháp trống hoàn toàn, 24 profile hoặc tải tranh suất. Báo cáo không chứa giá trị hồ sơ: test-results/navigation-restored-google-20261015.json; ảnh quản lý: test-results/navigation-restored-google-20261015.jpg. Extension hiện tại là bản khôi phục đã Reload; không cần build/Reload thêm vì lượt này không sửa runtime sau kiểm thử.


## Đăng nhập chỉ cần xét duyệt và hủy liên kết profile — 15/10/2026

- Bỏ biểu mẫu thông tin liên hệ, bước xác nhận và điều kiện hoàn tất liên hệ
  trong CloudGate, API và RLS. Tài khoản Google đã xác minh dùng được ngay khi
  admin duyệt; chờ duyệt, khóa, từ chối, hết hạn và quota vẫn được kiểm tra.
  Giữ dữ liệu liên hệ cũ để tương thích; không điền dữ liệu giả để vượt điều kiện.
- Thêm Hủy liên kết ở dòng profile và Chi tiết, có xác nhận, dùng được cả khi
  offline. Trạng thái liên kết lấy từ cột revoked trong database, tách khỏi
  trạng thái kết nối. Hủy token và mã liên kết lại chưa dùng; giữ hồ sơ, ảnh,
  lịch sử và khóa gửi. Liên kết lại dùng đúng profile cũ với token mới.
- Typecheck và build:cloud-server qua. Vitest 293 ca / 39 file qua với
  --maxWorkers=4, gồm ca duyệt không có thông tin liên hệ qua HTTP/RLS,
  email chưa xác minh bị chặn, offline unlink, mã cũ bị vô hiệu, giữ lịch sử/
  khóa gửi khi liên kết lại và không ảnh hưởng token profile khác.
- test:access-ui và test:cloud-ui qua. Fixture kiểm tra chờ duyệt không có form,
  duyệt vào thẳng manager, hủy liên kết qua dòng profile, xác nhận trong Chi tiết,
  hủy thao tác, trạng thái offline/unlinked, nút liên kết lại, light/dark/mobile.
  Ảnh tại test-results/access-pending*.png và access-unlink*.png. Dữ liệu giả;
  không đăng nhập Google hay gửi form thật trong lượt kiểm thử này.
- Đã áp dụng 202610150002_google_approval_only.sql vào Supabase đang cấu hình
  và xác minh function vẫn giữ điều kiện active, email_verified, expires_at.
  Số hàng trước/sau không đổi: 3 account, 7 profile, 5 attachment, 94 run,
  0 khóa gửi. Backend/UI mới chưa commit, push hoặc deploy Render trong lượt này.
  Không cần cập nhật extension vì không đổi giao thức kết nối.


## Gỡ vòng chờ khi extension yêu cầu Tiếp tục — 15/10/2026

- Tái hiện timeout bằng WebSocket thật và PostgreSQL fixture: extension gửi
  CONTROL/RESUME hoặc AUTO_RESUME; server đợi RESULT của lệnh RESUME, trong khi
  extension phải đợi REPLY của CHECK_FORM trước khi trả RESULT. Hàng đợi từng
  profile giữ CHECK_FORM phía sau yêu cầu đang đợi, gây vòng chờ. Hai ca hồi quy
  đều thất bại trước sửa và qua sau sửa.
- Cho CHECK_FORM lồng trong yêu cầu điều khiển/LOAD_FAILURE đang đợi command
  được xử lý ngoài hàng đợi đó. Giữ xác thực tài khoản, socket, session, run và
  form. CHECK_FORM thông thường vẫn theo thứ tự STATE; SUBMIT vẫn đi qua hàng
  đợi và transaction khóa gửi. Không tăng timeout, không gỡ khóa hoặc đổi quyền.
- Typecheck, build:cloud-server và 295 ca Vitest / 39 file qua với maxWorkers=4.
  Ca mới kiểm tra cả CONTROL và AUTO_RESUME, từ chối form sai/lượt cũ và không
  tạo khóa gửi trong Test. Đây là fixture; chưa tái hiện trên nick người dùng vì
  chưa có email/profile cụ thể. Công cụ trình duyệt lỗi request-header policy,
  chưa kiểm tra trực tiếp phiên Google hoặc thao tác trên form thật.
- Đã đọc trạng thái quyền và metadata chạy ở Supabase, không đọc/ghi ảnh hay
  thông tin thí sinh, không thay quyền, không chạy form, không xóa khóa gửi.
  Backend mới chưa commit/push/deploy; bản sửa này không đổi extension.


## Đồng nhất điều khiển extension và tự tiếp tục — 16/10/2026, v1.3.2

- Extension cloud có Bắt đầu/Test/Live qua chính coordinator của website, chỉ
  cho profile của socket đã xác thực. Cùng kiểm tra email đã gán, quyền Live,
  quota, hồ sơ/ảnh và khóa gửi; không cho lượt local cũ chạy/gửi độc lập.
- Tách RPC điều khiển ở background khỏi hàng đợi thông điệp của trang, trả đúng
  RunState cho nút Dừng, và giữ bản sửa vòng chờ CHECK_FORM ở server. Deadline
  điều khiển khớp lệnh server; submit vẫn giữ timeout ngắn và khóa durable.
- Phân biệt bản nháp ở manager với thay đổi chỉ từ extension để Start không
  báo xung đột giả. Thay đổi đồng thời hai phía vẫn cần chọn bản giữ.
- Sửa trường hợp lệ rồi ngừng gõ 650 ms sẽ tự tiếp tục, không cần blur. Yêu cầu
  tạm lỗi giữ theo dõi và thử lại tối đa 3 lần trên đúng run/document còn chờ;
  không tự mở lại Pause, Stop, recovery hoặc lượt đã khóa gửi.
- Typecheck và 299 ca / 39 file Vitest qua. Có ca kiểm tra Live bị từ chối,
  quota, form sai, draft xung đột và lỗi tạm khi tự tiếp tục.
- test:cloud-controls qua với 3 Chromium profile cô lập, extension/background/
  content thật, WebSocket và PostgreSQL fixture. Kiểm tra bốn nút điều khiển,
  ba trường sai tự tiếp tục sau input hợp lệ không blur và giữ đáp án sửa,
  Pause chủ động không tự mở, Test gửi 0, Live fixture đúng 1 lần/profile và
  không gửi lại. Báo cáo test-results/cloud-controls-flow-3.json.
- Harness cloud build trong thư mục tạm HANU_CLOUD_OUT_DIR riêng, không ghi
  đè dist-cloud mà Chrome người dùng đang nạp. Build production tại dist-cloud
  dùng đúng https://hanu-autofill.onrender.com, development=false, v1.3.2.


### Kiểm tra sau deploy và dữ liệu legacy — 16/10/2026

- Đã push/deploy d08fe15 và xác nhận Render Live, /healthz và /readyz 200.
  Hai Chrome profile đang mở được Reload v1.3.2, giữ nguyên thư mục nạp, ID,
  token và dữ liệu. Trên profile bị lỗi, nút Tiếp tục đã đi qua các trang form
  thử Google, ảnh được Google xác nhận, dừng đúng câu xác thực; chỉ Test.
- Kiểm tra nút Bắt đầu thật phát hiện xung đột giả trên dữ liệu legacy chưa
  synced: hai profile JSONB bằng nhau ở database nhưng thứ tự khóa JSON trả từ
  extension khác. Đổi pull sang isDeepStrictEqual và bổ sung ca hồi quy. Không
  tự ghi đè hồ sơ khác giá trị hoặc gỡ khóa.
- Panel theo run mới sang tab mới, không nhận đè acknowledgement eventSeq thấp,
  tabId=-1 hoặc sự kiện của lượt cũ; có test trực tiếp với DOM sidepanel.
- Sau bổ sung: typecheck và 301 ca / 39 file qua; build production v1.3.2 qua.


## 1.8.0 — chạy ngay, tab chờ, link sai và xác thực từng HSK (21/10/2026)

- Sửa fence revision sau đồng bộ: bước chuẩn bị trả về revision đã xác nhận, hoàn tất là tự đánh thức dispatch. Bỏ gate chờ giờ; phát từng HSK/profile độc lập. Lý do chờ hiển thị trong lịch.
- Ngừng reload Facebook khi đã chốt nguồn cho các cấp còn chờ; phản hồi nhận link trả trạng thái pause cùng revision để lease cũ không bật reload trở lại. Link bị loại thủ công không được nguồn Facebook ghi đè.
- Thủ công không cần Facebook/giờ đặt; chờ link tối đa 30 phút. Loại/thay link dừng đúng các run của cấp đó, đổi requestId và xóa đáp án của form cũ; khóa gửi và run mới khác được giữ.
- Trang chờ nội bộ `ready.html` được tạo trước và dùng lại khi START. Kiểm tra bằng Chrome thật phát hiện `about:blank` không lộ URL với quyền hiện có; bản cuối dùng trang của extension và không thêm quyền tabs.
- Tái hiện lỗi điền xong nhưng không xử lý trang tiếp: timer chạy trước khi async release renderer kết thúc làm rơi requestExecute. Bản cuối giữ trang tiếp trong hàng đợi, chỉ chạy sau release; Stop vẫn hủy hàng đợi. Có regression test nhả quyền chậm và Stop.
- Đáp án riêng theo HSK, tự nhận diện tiêu đề blocking verification, áp dụng khi đến muộn; kiểm tra run/form/nội dung, bỏ qua CAPTCHA/upload/run khác. Lỗi áp dụng hiện trong hàng HSK.
- `test:scheduled-hsk-ui`: ba profile giả, hai HSK; chuẩn bị trước, dán link, chỉ chạy cấp có link, câu hỏi tự hiện, đáp án độc lập, profile đến sau, loại/thay link riêng cấp, desktop và mobile không tràn ngang.
- `test:final-question-ui` và `test:manager-ui` vẫn qua; luồng chạy trực tiếp và sửa hồ sơ giữ hành vi cũ.
- `node scripts/run-node24.mjs scripts/browser-check.mjs --test-only --profiles=2`: hai Chrome profile thật trong thư mục tạm, Native Messaging thật, ảnh giả 672.673 byte. Xác nhận PREPARE lặp không mở tab mới, START dùng đúng tab chờ, cả hai tới Xong Test, gửi 0 lần, duplicate START không tạo run/tab mới; UI sáng/tối/mobile không lỗi. Dữ liệu ở `test-results/browser-2.json`.
- Google hostname được ánh xạ localhost. Chưa dùng Facebook hoặc Google Forms thật trong đợt này; không coi tốc độ fixture là tốc độ đăng ký thực. Không triển khai lên hosting trong đợt sửa mã này.


## 1.8.1 — nhập trước đáp án, tự hiện câu, báo lỗi đọc ngay (21/10/2026)

- `HskVerificationAnswer` cho phép chỉ có value; FinalQuestion vẫn giữ kiểm tra đầy đủ. Không đưa cấu hình thiếu tiêu đề trực tiếp vào START. Khi đúng lượt/HSK báo blocker verification mới ghép đáp án với tiêu đề, form, entry và loại trường đã đọc.
- Câu xác thực tự hiện từ blocker và snapshot đã áp dụng của đúng run trong lịch; không lấy câu từ run cũ cùng profile. Lỗi thiếu nội dung hiện role=alert ngay.
- Lấy câu xác thực là SCAN_FORM chỉ đọc, chạy ngoài hàng đợi START và không giành renderer/focus/pause. Giới hạn backend 2 giây, UI 2,5 giây; timeout hiển thị lỗi có thể thử lại. Không chọn câu cuối trong danh sách làm fallback.
- Form diễn tập có một ô đáp án chung; form đăng ký theo HSK giữ các ô riêng.
- `test:scheduled-hsk-ui`: nhập HANU/2026 trước khi biết câu, bật lịch và tự áp dụng đúng từng HSK; profile tới muộn; đọc không có câu báo lỗi, không nhận nhầm cam kết cuối trang; đọc lại phục hồi blocker thiếu tiêu đề; giao diện mobile; riêng mẫu diễn tập dùng CHUNG cho cả ba profile với một input.
- `scripts/browser-check.mjs --test-only --profiles=2 --scheduled-verification`: hai Chrome profile thật, Native Messaging thật, form giả nhiều trang. Đáp án HANU/2026 được cấu hình trước, câu xác thực HSK 4/5 chỉ xuất hiện sau Next. Cả hai tự ghép/điền đúng câu, tới Xong Test, gửi 0 lần; tab chờ, upload, duplicate START và UI sáng/tối/mobile đều qua.
- Kiểm thử này dùng HTTPS fixture với hostname Google ánh xạ localhost; không gửi form Google hoặc đọc Facebook thật.
