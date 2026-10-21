# HANU Coordinator 1.9.0

App cục bộ quản lý nhiều Chrome profile, mỗi profile giữ một hồ sơ thí sinh và ảnh riêng. Người dùng tự mở profile, đăng nhập Google, liên kết extension rồi chọn các phiên để chạy Test hoặc Live. Bản này chưa dùng AI.

## Săn link tức thì, câu xác thực theo HSK

Bản 1.9.0 chuẩn bị sẵn tab/hồ sơ khi bật, có link hợp lệ đúng HSK là chạy ngay,
ngừng reload Facebook khi đã chốt đủ nguồn link, hỗ trợ dán link không cần Facebook,
loại/thay link và chạy lại riêng từng HSK. Mỗi HSK có đáp án xác thực riêng; profile
đến sau tự dùng đáp án đã lưu. Có thể nhập chỉ đáp án trước khi biết câu hỏi; tới
câu xác thực, tool tự hiện nội dung và ghép đáp án. Không đọc được sẽ báo lỗi ngay
và có nút **Lấy câu xác thực** để đọc lại. Lý do chưa chạy hiện ngay theo cấp và profile.
Bật toggle đăng ký theo HSK, chọn cấp ngay trong bảng profile. Chỉ các cấp có profile được chọn mới hiện ô điều khiển. Diễn tập nhận link test trực tiếp, giữ đáp án riêng từng HSK và không chờ link đăng ký thật. Thanh Live cố định có thời gian, tiến độ, Tạm dừng/Tiếp tục và Dừng đúng toàn bộ lượt đã bật, độc lập với tick chọn sau đó.
Xem [hướng dẫn HSK](docs/SCHEDULED-HSK.md) về thao tác, nâng cấp và kiểm thử.

## Bản online với Supabase

Quản lý truy cập: tài khoản mới chờ duyệt; chủ sản phẩm dùng `/admin` để cấp
quyền, khóa, gia hạn, đặt giới hạn profile và quyền Live. Xem
[thiết lập quản trị và nâng cấp cơ chế cấp quyền](docs/USER-ACCESS.md) trước khi
triển khai bản này: cần migration mới và cập nhật extension cloud.

Chỉ cần một link website để chia sẻ, chưa mua tên miền: xem
[triển khai miễn phí với Render + Supabase](docs/DEPLOY-FREE.md).
`npm run cloud:check` kiểm tra cấu hình Supabase mà không sửa dữ liệu;
`npm run build:cloud-extension` build riêng extension gắn URL website.

Bản online dùng đăng nhập Google qua Supabase Auth, dữ liệu PostgreSQL riêng
theo tài khoản và ảnh trong Supabase Storage private. Một Node.js backend quản
lý kết nối WebSocket và điều phối các extension chạy đồng thời; extension vẫn
Load unpacked. Bản local giữ SQLite/Native Messaging, dữ liệu không tự upload.

Tạo **project Supabase mới**, bật Google provider, chạy migration và điền
`.env.cloud` theo [hướng dẫn triển khai](docs/CLOUD.md). `npm run build:cloud`
tạo `dist-cloud`, `build/cloud-server`, `build/cloud-ui`; `npm run cloud` khởi
động server. Docker Compose + Caddy có trong `deploy/cloud`.

Chuyển dữ liệu: dừng lượt local -> **Xuất dữ liệu** -> đăng nhập website ->
**Nhập từ bản local** -> **Liên kết lại** từng profile. Giữ hồ sơ/ảnh/lịch sử và
khóa gửi, không nhập thành lượt đang chạy. Không cài bản local và online cùng
điều khiển một Chrome profile. Trước khi phân phối, build lại extension với
tên miền production; bản trong `dist-cloud` sau kiểm thử có thể trỏ localhost.

Kiểm thử cloud: `npm test`, `npm run test:cloud-ui`, `npm run test:cloud-flow`.
Kiểm thử tải 10 người / 50–100 profile: `npm run test:cloud-load`, xem
[hướng dẫn kiểm thử tải](docs/CLOUD-LOAD-TEST.md) cho local, Docker giới hạn
CPU/RAM và staging riêng. Bài test không gửi Google Forms thật.
Các fixture không dùng tài khoản Google hoặc hồ sơ thật. Đăng nhập Google,
Storage, TLS và hosting thật cần nghiệm thu sau khi cấu hình project/tên miền.

## Sử dụng gói đóng sẵn

Gói Mac Apple Silicon nằm trong `releases`. Script đóng gói hỗ trợ thêm Mac Intel và Windows x64; hai gói này chưa được hoàn tất vì ổ đĩa hiện tại không đủ dung lượng. Node 24.21.0 được kèm theo; không cần cài Node riêng. Mac cần macOS 13.5 trở lên, Windows cần Windows 10/11 x64. Windows và Mac Intel vẫn cần nghiệm thu trên máy thật.

1. Giải nén vào thư mục cố định. Mac mở `HANU Coordinator.app`; Windows mở `Start HANU.cmd`. Mở lại app sẽ đưa màn hình quản lý của tiến trình đang chạy lên.
2. Trên từng Chrome profile, mở `chrome://extensions`, bật Developer mode và Load unpacked thư mục `extension` trong gói. Nếu extension đã được cài trước, làm theo phần nâng cấp bên dưới để giữ ID và dữ liệu.
3. Mở HSK Autofill. Sao chép **ID extension** trong panel. Trong app, chọn **Thêm profile**, dán ID và bấm **Tạo mã liên kết**. App đăng ký cầu nối Native Messaging ở cấp người dùng trước khi cấp mã.
4. Dán mã vào panel và bấm **Liên kết profile**. Chờ thông báo **Đã kết nối app**. Mã dùng một lần, hết hạn sau 5 phút. Mỗi Chrome profile chỉ cần liên kết một lần.
5. Trong Chi tiết, bấm **Kiểm tra kết nối** và **Mở profile**. Đối chiếu mã phiên trên tab extension. Gán tên profile và email Google sẽ hiển thị trên form; email này độc lập với email liên hệ của thí sinh.
6. Hồ sơ và ảnh cũ được đọc từ extension. Sửa hồ sơ tại app rồi bấm **Lưu và đồng bộ**; chỉ coi là đồng bộ khi extension xác nhận đã lưu. Khi có xung đột, chọn bản app hoặc bản extension. Ảnh thường dưới 1 MB nhưng app không đặt giới hạn upload mới ở 1 MB.
7. Dán link Google Form, chọn các profile và Test/Live, bấm Bắt đầu. Các lệnh mở form được phát cùng lượt. Mỗi phiên kiểm tra tài khoản thực tế sau chuyển hướng trước khi điền.

Bấm tên profile hoặc **Xem form** để đưa đúng cửa sổ Chrome và form đang giữ profile lên trước. Thao tác này không mở cửa sổ extension và không tự bắt đầu điền. Nếu tab cũ đã đóng, extension tìm lại form đang mở hoặc link còn lưu; khi chưa có form, mở Chrome profile. Profile đóng vẫn còn trong bảng và hiện mất kết nối; mở lại profile để kết nối. Màn hình quản lý còn có nút mở từ panel extension.

Khi chạy nhiều profile, không cần tự bấm xem từng cửa sổ. App khôi phục cửa sổ thu nhỏ, chọn tab form rồi các profile tự điền, chọn dropdown, upload và chuyển trang đồng thời. Mỗi profile giữ trang hoạt động riêng bằng quyền debugger đã có; Chrome có thể hiện thanh thông báo điều khiển trong lúc này. Mỗi bước kết thúc hoặc bị Dừng sẽ trả quyền điều khiển. Những trường hợp phải dùng cửa sổ phía trước vẫn có hàng đợi riêng, nhưng không chặn các profile đang chạy nền. Tốc độ thực tế còn phụ thuộc máy và phản hồi của Google.

## Test, Live và xử lý sự cố

**Câu hỏi cuối dùng chung:** chọn các profile, bấm **Đọc câu hỏi trên form**, nhập/chọn đáp án rồi bắt đầu hoặc áp dụng cho các lượt đang chờ. App tự chọn profile đang chờ câu xác thực, đọc câu đang chặn hoặc câu cuối trên trang, gắn mã câu hỏi và nhận diện loại trường; không cần bật checkbox hay chọn lại câu vừa đọc. Câu và loại xuất hiện ngay trong khung kết quả. Các lựa chọn đọc được xuất hiện trực tiếp ở ô đáp án. Muốn đổi profile/câu hoặc nhập trước khi mở trang cuối, mở **Chọn câu khác / nhập trước**. Khi thực thi, app vẫn kiểm tra mã/nội dung/loại/form ở từng profile; không tự điền dựa vào vị trí câu cuối hay một phần tiêu đề.

Khi có profile đã tới câu cuối, nhập đáp án rồi chọn **Áp dụng và tiếp tục N profile đã tới câu cuối**. Không cần chờ cả nhóm: profile đang chạy, lỗi ảnh, mất kết nối hoặc chưa tới câu hỏi được giữ nguyên. Khi các profile đó tới câu cuối, bấm áp dụng tiếp; có thể giữ hoặc đổi đáp án cho lần áp dụng sau. Giao diện báo số đã áp dụng, số bỏ qua và lỗi riêng từng profile. Test vẫn dừng trước Gửi; Live tiếp tục theo chế độ đã chọn. Đáp án nằm trong snapshot của lượt, không sửa hồ sơ/ảnh cá nhân; **Chạy lại** giữ cấu hình câu cuối của lượt trước. Đổi link trên màn quản lý sẽ xóa phần khai báo chung để tránh dùng nhầm form. Hỗ trợ trả lời ngắn, đoạn văn, radio, dropdown, ngày và một đáp án checkbox. Đáp án lựa chọn cần khớp tên lựa chọn; không tự giải CAPTCHA. Thiếu câu, trùng tiêu đề, nội dung/loại đã đổi hoặc không điền được đều dừng với lý do cụ thể.

- **Test** điền, chuyển trang và upload, dừng trước Gửi. Upload Test vẫn đưa ảnh lên Google; thử form thật bằng hồ sơ và ảnh giả.
- **Live** chỉ cấp quyền bấm Gửi một lần sau khi khóa đã lưu ở cả app và extension. Thành công cần xác nhận từ Google. Khi chưa thấy xác nhận, giữ trạng thái **Chưa rõ đã gửi** và giữ khóa; Dừng/Tiếp tục/reload không cấp lại quyền.
- Kiểm tra kết quả Google trước khi dùng **Đã xác minh đã gửi** hoặc **Đã xác minh chưa gửi**. Lựa chọn thứ hai cho phép tạo lượt mới; lượt cũ vẫn không được gửi lại. Khóa cùng profile/form được giữ trong lịch sử.
- CAPTCHA, câu xác thực chưa khai báo đáp án, câu chưa nhận diện, form đóng, hết đăng nhập hoặc lỗi dữ liệu dừng riêng phiên. Xử lý trong cửa sổ tương ứng rồi chủ động Tiếp tục để quét và đối chiếu lại.
- Lỗi tải trước Gửi được thử lại ba lần, đợi 2/5/10 giây; không xóa form. Ít nhất 3 phiên và 25% danh sách lượt cùng lỗi tải/chặn trong 30 giây sẽ tạm dừng nhóm.
- Khởi động lại app/Chrome không tự chạy lại nhóm. Trạng thái được đối chiếu và chờ người dùng tiếp tục. Nhóm đã Dừng có thể **Tiếp tục nhóm** cho các lượt chưa gửi. **Tiếp tục** trong Chi tiết chỉ chạy lại profile đó; các profile khác vẫn giữ trạng thái dừng.
- **Chạy lại** ở hàng profile hoặc trong Chi tiết dừng lượt cũ và tạo lượt mới cho riêng profile đó, dùng hồ sơ hiện đã đồng bộ cùng link/chế độ của lượt trước. Lượt đã khóa gửi vẫn cần xác minh kết quả trước khi tạo lượt mới; nút Chạy lại không mở lại quyền gửi.
- Màn quản lý hiển thị số profile đang tự chạy và số cần xử lý. Lượt mở trực tiếp trong extension cũng được đối chiếu, dù khác lượt mà app ghi nhận. **Dừng** trên hàng profile dừng cả lượt đó; khóa gửi vẫn được giữ. Lượt đã kết thúc hoặc tab đã đóng được giải phóng khỏi khóa chạy. Khi form chưa xác nhận đang tự chạy, giao diện ghi **Lượt còn giữ profile** thay vì coi là đang chạy.
- Extension vẫn dùng độc lập. Một profile chỉ chạy một lượt tại một thời điểm; không chạy độc lập chồng lên lượt app đang điều phối.

## Nâng cấp Load unpacked, giữ hồ sơ và ảnh

**Giữ nguyên thư mục extension đang được Chrome nạp**, chép nội dung bản `extension` mới vào thư mục đó rồi bấm Reload. Không Remove extension, không chuyển sang thư mục nạp mới, không áp manifest key/ID khác. Extension này không ép ID mới. App đăng ký đúng ID đang hiển thị trên Chrome và giữ được nhiều ID đã đăng ký.

Với workspace hiện tại, thư mục nạp là `dist`. `npm run build:extension` cập nhật nội dung tại đây; sau build bấm Reload extension. Không sửa/xóa Chrome storage hay IndexedDB để nâng cấp. Dữ liệu cũ vẫn dùng các khóa `profile` và cơ sở `hanu-hsk-autofill`.

## Chạy và phát triển từ mã nguồn

```bash
npm install
npm run build
npm run manager
```

Script quản lý và kiểm thử tự tải runtime Node 24.21.0 đúng nền tảng và kiểm SHA-256 từ Node.js chính thức vào `.runtime`; không thay Node hệ thống. Máy phát triển cần Node để chạy npm; gói phát hành đã kèm runtime.

```bash
npm run typecheck
npm test
npm run test:manager-ui
npm run test:navigation
npm run test:background-flow
npx playwright install chromium --no-shell
npm run test:browser
npm run bench:fixture
npm run package
```

Browser fixture cần OpenSSL và dùng Chrome for Testing riêng, dữ liệu giả và máy chủ HTTPS cục bộ. Công cụ benchmark hiện dành cho Mac; package đa nền tảng chạy trên Mac với `ditto`, `tar`, `unzip`, `zip`. Gói Windows được tạo bằng Node SEA nhưng cần kiểm chứng chạy thực tế trên Windows.

Hai lệnh `test:manager-ui` và `test:navigation` dùng dữ liệu thử riêng, mặc định Edge đã cài trên Windows, Chromium của Playwright trên nền tảng khác. Có thể chọn browser bằng biến môi trường `HANU_TEST_BROWSER`. Chúng kiểm tra giữ thông tin chưa lưu khi upload và luồng chuyển trang Test/Live, không gửi dữ liệu lên Google Forms thật.

## Kiến trúc và dữ liệu

React/TypeScript/Vite + Fluent UI; bộ điều phối Node 24 + SQLite WAL, đồng bộ FULL. App chỉ nghe `127.0.0.1` ở cổng ngẫu nhiên. HTTP/WS giao diện kiểm tra Host, Origin và cookie HttpOnly/SameSite; cầu nối có thông tin xác thực riêng và allowlist ID extension. Mã mở app và token cầu nối nằm trong descriptor riêng tư trên máy. Không đọc/copy cookie hoặc mật khẩu Google.

Mỗi profile có tiến trình Native Messaging cầu nối tới một coordinator chung. Giao thức có phiên bản, sessionId/runId/commandId và thứ tự sự kiện; journal lưu lệnh thay đổi, bỏ qua lệnh trùng và sự kiện cũ. Ảnh chuyển theo phần 64 KiB và kiểm SHA-256. Mỗi lượt khóa snapshot hồ sơ/ảnh; upload đọc tại extension.

App lưu dữ liệu tại `~/Library/Application Support/HanuCoordinator` (Mac), `%USERPROFILE%/AppData/Local/HanuCoordinator` (Windows). Hồ sơ và ảnh cũng giữ trong Chrome storage/IndexedDB của từng profile. Không đưa thư mục dữ liệu này hoặc bản sao hồ sơ lên git. `.gitignore` loại build, runtime, releases và kết quả cục bộ.

Đọc `TESTING.md` để xem phạm vi đã kiểm chứng và phần chưa nghiệm thu. Phát lệnh đồng thời không phải bằng chứng 24 phiên hoàn tất nhanh trên Google Forms thật.
