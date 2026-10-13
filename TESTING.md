# Kiểm thử HANU Coordinator 1.3.1 (2026-10-12)

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
