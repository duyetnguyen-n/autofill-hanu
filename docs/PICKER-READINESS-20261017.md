# Tìm điều kiện sẵn sàng cho Google Picker — 17/10/2026

## Kết luận hiện tại

Có hướng phản ứng theo sự kiện nhanh hơn mốc chờ 5 giây, nhưng **chưa có bằng chứng đủ để thay bản production bằng một điều kiện sẵn sàng chắc chắn hơn trên Google Forms thật**. Không triển khai lại các biến thể “popup đã mở”, “input đã tồn tại” hoặc chỉ giảm timer. Các biến thể đó đã từng đưa ảnh vào input cũ mà Forms không nhận kết quả.

**Cập nhật sau khi người dùng bật quyền upload:** công cụ đã truyền được PNG thử và Forms nhận tệp ở một lần Picker đã mở đủ lâu. Tuy nhiên, ở lần mở Picker mới, sự kiện chọn tệp xuất hiện tại 1.979 ms, bàn giao tệp xong tại 2.010 ms mà Forms không gắn ảnh; sau 78.892 ms tính từ bàn giao vẫn là màn Duyệt qua trống. Phản ví dụ đã xuất hiện trên Google thật: `fileChooserOpened` một mình không đủ để bỏ guard. Hiện không cần người dùng cấp thêm quyền cho phép thử này.

Tài liệu Action công khai của Google Picker nêu CANCEL/PICKED/ERROR, không cung cấp một hợp đồng `UPLOAD_CONTROLLER_READY` cho extension đứng ngoài Google Forms. Callback của Picker API là giao diện cho ứng dụng tự tạo Picker; không thể suy rằng mình có callback tương đương trong Picker do Google Forms sở hữu.

## Những hướng đã kiểm tra

| Điều kiện | Ưu điểm | Thiếu sót |
|---|---|---|
| Đợi document 5 giây, input ổn định 1 giây | Cơ chế production hiện tại có bằng chứng thực tế | Có thể đợi thừa khi tải nhanh; không bảo đảm controller đã sẵn sàng nếu khởi tạo lâu hơn. |
| DOMContentLoaded / readyState complete / input tồn tại | Dễ quan sát, nhanh | Không chứng minh listener, controller và callback về Forms đã hoạt động. |
| Thông báo “Đã mở bộ chọn Chèn tệp” | Hai mẫu thử lịch sử chuyển ảnh khoảng 1,7 giây | Không phải cam kết readiness công khai; production đã quay lại guard bảo thủ. |
| Có change listener trên input | Có thể quan sát bằng Chrome debugger | Input/controller ban đầu cũng có thể nhận bytes và upload HTTP 200 rồi bị thay; listener không chứng minh Forms nhận kết quả. |
| Thao tác nút Duyệt qua và chờ `Page.fileChooserOpened` | Đi theo đường chọn tệp của controller; Chrome trả frame/input cụ thể; không cần ép tuổi document đạt 5 giây | Sự kiện chứng minh có yêu cầu chọn tệp, chưa chứng minh callback upload về Forms đã sẵn sàng. Ca nút hoạt động sớm vẫn có thể thất bại. |
| Ảnh xuất hiện trên Forms với tên đúng, nút xóa tệp và Picker đóng | Bằng chứng hoàn tất trực tiếp trên form | Xảy ra sau upload, không dùng được làm tín hiệu trước khi đưa bytes vào. Phải tiếp tục giữ làm điều kiện cho Next. |

## Prototype so sánh đã chạy

Lệnh: `node scripts/run-node24.mjs scripts/picker-readiness-check.mjs`.

Tám browser context thử riêng; mọi request tới URL Google giả được fixture trả tại chỗ, không truy cập Google hay dùng profile người dùng. Nhánh fixed-guard gọi helper production hiện tại. Nhánh chooser-event sử dụng nút và sự kiện file chooser thật của Chromium, chuyển bytes của PNG giả lập, kiểm tra SHA-256 phía nhận và số lần chọn tệp.

| Controller sẵn sàng | Nút được bật sớm? | Guard hiện tại: đưa bytes | Chooser event: đưa bytes | Kết quả |
|---:|---|---:|---:|---|
| 600 ms | Không | 5.066 ms | 1.795 ms | Hai nhánh commit đúng một lần, hash đúng. |
| 1.800 ms | Không | 5.010 ms | 2.725 ms | Hai nhánh commit đúng một lần, hash đúng. |
| 6.500 ms | Không | 5.146 ms | 7.317 ms | Guard đưa sớm vào controller cũ và không commit; chooser-event chờ đúng đường chọn tệp và commit. |
| 6.500 ms | Bật tại 400 ms | 5.118 ms | 660 ms | **Cả hai không commit.** Đây là phản ví dụ: fileChooserOpened một mình cũng chưa đủ. |

Số trên đo trong fixture với tải máy không cố định, không phải số đo Google thật hoặc cam kết tiết kiệm tương ứng. Fixture cố ý mô phỏng controller thay input và thông báo popup xuất hiện sớm. Nó kiểm tra giả thuyết, không chứng minh Google luôn bật nút đúng thời điểm.

Chi tiết: `test-results/picker-readiness-comparison.json`. Tất cả nhánh chỉ chuyển file một lần; không tự upload lại để biến ca lỗi thành thành công.

## Phép thử Google thật trước khi bật quyền upload

- Xác nhận hai profile đều ở Test/chờ xác thực, không có lượt đang chạy.
- Dừng riêng Duyệt; trở lại trang ảnh của form mẫu được người dùng chỉ định. Không sửa hồ sơ/ảnh lưu trong ứng dụng.
- Xóa ảnh khỏi riêng bản nháp thử, mở Picker và quan sát nút Duyệt qua trong iframe đang hiển thị.
- Đã đi qua thao tác nút Duyệt qua và chờ file chooser, nhưng bước truyền PNG thử bằng công cụ bị chặn: ChatGPT extension chưa có “Allow access to file URLs”. Không đổi quyền và không thử đường vòng.
- Không có phép upload Google thành công hoặc số đo nhanh mới từ lần thử này. Không được tính thao tác popup/nút thành kết quả Google đã nhận ảnh.
- Đóng Picker/tab thử, chạy lại Test qua ứng dụng để khôi phục ảnh gốc theo hồ sơ đã lưu. Đã xác nhận lại: Duyệt chờ câu xác thực, 0 khóa gửi, hash hồ sơ không đổi và bằng snapshot. Google đã xác nhận ảnh trong lượt khôi phục; Huyền giữ nguyên runId và vẫn chờ xác thực. Nhật ký: `picker-research-restored-profile` trong `test-results/v150-production.json`; ảnh chụp `test-results/picker-research-restored.png`.

## Phép thử Google thật sau khi bật quyền upload

Chỉ thao tác bản nháp Test của Duyệt trên form mẫu do người dùng cung cấp; dừng ứng dụng trong lúc thử thủ công. Dùng PNG tổng hợp 68 byte, không bấm Gửi, không trả lời câu xác thực và không đổi hồ sơ/ảnh lưu trong ứng dụng.

| Lượt | Cách chạy | Kết quả quan sát |
|---|---|---|
| D1 | Picker đã mở đủ lâu; có các khoảng nghỉ giữa lượt công cụ | Forms hiện đúng tên `picker-probe-d1.png`, có nút Xóa tệp và Picker đóng. Chứng minh quyền upload hoạt động; **không phải benchmark tốc độ**. |
| D2 | Một chuỗi liên tục: mở Picker mới → nút Duyệt qua → file chooser → đặt tệp đúng một lần | Sự kiện tại 1.979 ms, bàn giao xong tại 2.010 ms. Forms không hiện tệp; lần quan sát cuối sau bàn giao 78.892 ms vẫn là Picker trống. **Thất bại**. |

Số thời gian D2 tính từ ngay trước thao tác mở Picker, gồm độ trễ công cụ trình duyệt; không phải độ trễ thuần của extension. Đây là hai lượt trên một tài khoản, không phải kiểm thử tải 5 profile hoặc một implementation đã tích hợp vào extension. Việc `setFiles` trả về thành công không chứng minh Forms nhận tệp.

Chi tiết: `test-results/picker-native-live-20261017.json`; ảnh lỗi: `test-results/picker-live-d2-unconfirmed.png`.

Khi khôi phục ảnh gốc qua Test, lượt `db721980-7bc4-46bf-924e-608ac74e7f9f` ghi nhận chip ảnh sau 8.036 ms (chuẩn bị Picker 5.242 ms), nhưng sau Next, Google báo **“Tệp này không còn có sẵn nữa”**. UI thực tế có tên `IMG_0775.jpeg`, nút Xóa tệp và lỗi này. Vì vậy không tính lượt đó là upload hợp lệ đầu cuối. Chưa xác định nguyên nhân lỗi token/tệp; không suy ra native chooser là nguyên nhân. Ứng dụng dừng chờ validation, không gửi form. Đã dừng lượt này và gỡ tệp lỗi trong bản nháp Test trước khi thử khôi phục một lần nữa.

Điều kiện xác nhận cần phân biệt: chip đúng tên + nút xóa + Picker đóng chứng minh Forms đã gắn tệp trên trang hiện tại; **chưa chứng minh Google chấp nhận tệp sau Next**. Bài kiểm thử phải kiểm tra cả lỗi validation và việc chuyển qua trang ảnh thành công.

Lượt khôi phục cuối `9a506afe-c591-4730-a4be-8f4636a58b3a` đã đưa lại `IMG_0775.jpeg`, đi qua trang ảnh và đến câu xác thực. Log xác nhận chip sau 8.636 ms (chuẩn bị Picker 5.292 ms); thời gian từ bắt đầu Test đến câu xác thực là 21.833 ms, có dữ liệu bản nháp cũ nên không dùng làm benchmark từ form trắng. Đã dừng Test sau khi ghi nhận. Hai hash hồ sơ lưu không đổi và bằng snapshot; 0 khóa gửi. Huyền giữ nguyên lượt và trạng thái idle. Bằng chứng: nhãn `picker-native-live-restored-final-20261017` trong `test-results/v150-production.json`, ảnh `test-results/picker-native-restored-20261017.png`. Không bấm Gửi.

## Hướng triển khai đáng thử tiếp

Tách state machine cho từng profile/document/request: mở Picker → quan sát khởi tạo của input/controller → yêu cầu chọn tệp từ đúng nút → đối chiếu frame/input của sự kiện chọn tệp → đưa đúng bytes một lần → quan sát upload được xử lý → xác nhận ảnh trên Forms.

Các sự kiện làm điều kiện đánh thức; timeout chỉ giới hạn thời gian chờ. Không coi “đã qua N giây” là bằng chứng readiness. Nếu không có bằng chứng đủ chắc chắn thì dừng và yêu cầu đối chiếu, không tự thử ảnh lần hai.

Nhưng bước “khởi tạo controller đã hoàn tất” vẫn cần đo/kiểm chứng trên Google thật: không suy nó từ mỗi sự kiện file chooser hay một thay đổi DOM. Chỉ sau khi chứng minh được trên cả hai tài khoản, nhiều lần mở Picker mới, tải chậm và đủ 5 profile đồng thời mới cân nhắc thay production. Prototype hiện chưa tích hợp vào extension.

Khi tích hợp cần giữ: RPC/session Picker chính xác; runId/content epoch; Stop/Pause/new-run cancellation; một lần bàn giao bytes; profile độc lập; không nhả khóa Gửi; chặn Next khi chưa có ảnh commit. Sự kiện thuộc input cũ hoặc iframe khác phải bị bỏ qua.

## Nguồn chính thức

- Google Picker Action: https://developers.google.com/workspace/drive/picker/reference/picker.action
- Tích hợp callback cho Picker do ứng dụng sở hữu: https://developers.google.com/workspace/drive/picker/guides/web-picker
- Chrome debugger, phân biệt tab/frame và session: https://developer.chrome.com/docs/extensions/reference/api/debugger
- Chrome DevTools Protocol: https://raw.githubusercontent.com/ChromeDevTools/devtools-protocol/master/json/browser_protocol.json — `Page.fileChooserOpened`, `Page.setInterceptFileChooserDialog`, `DOM.setFileInputFiles`.

Không thay source production, dist-cloud hoặc deploy trong lượt khảo sát này. Các tệp thêm/sửa là script thử và tài liệu.
