# Khảo sát tín hiệu upload và phần có thể chạy song song — 17/10/2026

Phạm vi: khảo sát, không thay source ứng dụng/extension, không build, không deploy. Đối chiếu code đang có tại `9119db2`, bằng chứng thử trước đó, tài liệu chính thức hiện tại, DOM của Picker Google thật và bundle JavaScript công khai của Google. Kết luận là kết quả nghiên cứu, không phải bản tối ưu đã kiểm thử.

## Kết quả

**Chưa tìm được tín hiệu trước upload đủ căn cứ thay guard 5 giây. Có hai cơ hội cụ thể để giảm phần tuần tự mà vẫn giữ guard: chuẩn bị bytes của ảnh trong lúc Picker tải, và định tuyến upload vào đúng document Picker.** Còn một cơ hội ở đầu lượt: đọc/kiểm tra ảnh song song với tải tab, nhưng cần thiết kế lại ranh giới trước khi cho phép điền.

Không có số đo chứng minh các đề xuất này tiết kiệm bao nhiêu giây. Log hiện tại gộp thời gian chờ Picker, RPC, đọc/mã hóa ảnh và injection vào một chỉ số “chuẩn bị Picker”; không thể lấy toàn bộ khoảng đó làm phần tối ưu được.

## Tín hiệu đã đối chiếu

| Ứng viên | Bằng chứng | Đánh giá |
|---|---|---|
| `readyState`, document load, input tồn tại/enabled | Helper production đã kiểm tra; phép thử lịch sử có input nhận file và HTTP 200 nhưng Forms không gắn ảnh. | Chỉ chứng minh một phần document đã tải; không chứng minh chuỗi upload/callback sẵn sàng. |
| Announcement “Đã mở bộ chọn”, input ổn định | Hai ca nhanh lịch sử từng thành công; không có hợp đồng readiness từ Google. | Chưa đủ để thay guard. Input không đổi trong một khoảng vẫn là heuristic thời gian. |
| Nút Duyệt qua, native file chooser | D2 thực tế: bàn giao tại 2.010 ms; 78.892 ms sau vẫn không có ảnh trên Forms. | Đã có phản ví dụ, loại điều kiện dùng một mình. |
| `jscontroller`, `jsaction`, sự kiện `rcuQ6b` | DOM thật có controller `UoH53d`, ancestor `gmr4De` và change action `NwEMS`. Trong bundle được khảo sát, phương thức render của controller upload là hàm rỗng; action được khai báo trên HTML còn việc khởi tạo đối tượng được framework thực hiện riêng. | Thuộc tính DOM/sự kiện render không chứng minh uploader và callback cuối đã sẵn sàng. Không dùng tên minify của Google làm hợp đồng ổn định. |
| `aria-busy` chuyển sang false | Snapshot Picker đang hoạt động không có phần tử mang `aria-busy`. | Không có tín hiệu dùng được ở mẫu này; không kết luận mọi tài khoản đều giống nhau. |
| Google Picker Action / web component events | Enum công khai gồm CANCEL, PICKED, ERROR; component công khai có picked/canceled/error. Đây là API cho app sở hữu Picker. | Không thấy API công khai “uploader ready” cho extension đứng ngoài Forms trong các tài liệu đã đọc. Không khẳng định Google không có tín hiệu nội bộ khác. |
| Network idle / script tải xong / listener đã gắn | Chứng minh tiến độ tải, không chứng minh đúng controller còn tồn tại đến lúc callback hoàn tất. HTTP 200 upload đã có trong ca lỗi lịch sử. | Chỉ nên là dữ liệu chẩn đoán; không làm điều kiện nhận ảnh duy nhất. |
| Tên tệp đúng + nút xóa + Picker đóng, sau đó Next qua trang ảnh | Lượt trước từng có chip nhưng Next báo “Tệp này không còn có sẵn nữa”. Lượt khôi phục sau đã qua trang ảnh. | Xác nhận kết quả theo hai giai đoạn; đây là tín hiệu sau upload, không giúp quyết định lúc bắt đầu upload. Không đồng nghĩa form đã gửi thành công. |

Quan sát mới chỉ mở Picker và đọc DOM, không đặt file thử mới. Lần lấy mẫu liên tục 4 giây vượt giới hạn evaluation khoảng 3 giây của công cụ; **không thu được timeline startup**, nên không suy ra thời điểm controller sẵn sàng từ lần đó. Snapshot sau khởi tạo được lưu tại `test-results/picker-signal-dom-20261017.json`.

Đọc source công khai chỉ cho biết cấu trúc của một phiên bản Google. Nó không chứng minh cùng đường code đã được chạy trên một tài khoản, cũng không xác định nguyên nhân chính xác của D2. Không gọi hàm nội bộ hoặc thay listener của trang.

## Phần đã chạy song song trong code hiện tại

| Phần | Vị trí | Ý nghĩa |
|---|---|---|
| Khởi động từng profile riêng | `manager/server/coordinator.ts:279` | Chuẩn bị và dispatch từng member trong Promise.all; không chờ profile chậm nhất mới gửi START cho các profile khác. Vẫn có chi phí hạ tầng/DB chung. |
| Quyền render theo profile | `manager/server/attention.ts:17` | Background lease riêng từng session; chỉ fallback foreground phải xếp hàng. Không nên biến upload thành thao tác tranh một hộp chọn file của OS. |
| Kiểm tra Google account và quyền chạy form | `src/background.ts:846` | Hai phép quan sát đã chạy đồng thời, cùng hoàn tất trước khi điền. |
| Upload và các ô văn bản trên cùng trang | `src/content.ts:1169` | Nếu có đúng một ảnh có dữ liệu và có textTail phù hợp, mở Picker rồi điền text/date/textarea trong lúc chờ upload. Sau đó join upload, kiểm tra lại lỗi và dữ liệu rồi mới Next. |
| Báo trạng thái lên panel | `src/background.ts:175` | Panel notification không giữ hàng đợi storage chờ phản hồi. Ghi trạng thái cục bộ vẫn phải hoàn tất theo thứ tự. |

Radio/checkbox/dropdown/custom/unknown được xử lý trước Picker để tránh đụng modal hoặc thay bố cục khi đang upload. Trên trang không có textTail phù hợp, code điền các trường trước rồi mới upload. Không có lợi ích hiển nhiên từ việc mở Picker sớm trong nhánh đó nếu không có việc độc lập khác để che thời gian.

## Cơ hội mới, theo mức ưu tiên

### 1. Chuẩn bị bytes ảnh trong lúc chờ Picker

Hiện tại `src/background.ts:425–432`: chờ prepareOnly trả ready → assertActive → IndexedDB read → blobToDataUrl → assertActive → injection. Phần đọc và mã hóa diễn ra sau điều kiện chờ, chưa được che bởi thời gian khởi tạo Picker.

Có thể bắt đầu đọc/mã hóa ảnh của snapshot khi mở Picker, đồng thời quan sát readiness. Đến khi cả hai xong mới đối chiếu lượt/document và bàn giao đúng một lần. Với một lần handoff, phần này đổi từ `T_chờ + T_đọc/mã_hóa` sang gần `max(T_chờ, T_đọc/mã_hóa)`, cộng chi phí điều phối. Lợi ích tối đa là phần nhỏ hơn trong hai khoảng; chưa đo riêng trên trình duyệt thật nên không dự báo số giây.

Ràng buộc: một promise chuẩn bị cho mỗi run/revision/attachment/hash, không đọc lại ở mỗi poll; hủy/bỏ kết quả khi Stop, reload, đổi hồ sơ hoặc lượt mới; giới hạn cache trong RAM; không nén/chuyển định dạng hay đổi bytes ảnh. Chuẩn bị sớm không có nghĩa upload sớm, cũng không bảo đảm CPU thực thi song song: mã hóa vẫn có thể dùng main thread của service worker.

### 2. Định tuyến vào đúng document Picker

`src/background.ts:414` đang executeScript với allFrames cho cả metadata và payload ảnh; sau đó giữ lại result, bỏ frameId/documentId. Hàm trong mỗi frame lọc RPC trước khi dùng file nên tránh gắn nhầm, nhưng payload lớn vẫn được cung cấp cho các frame được injection.

Có thể dùng lượt dò metadata để xác định duy nhất document Picker khớp origin/RPC/request, sau đó chỉ gửi ảnh/status vào document đó. Chrome hỗ trợ documentId và target documentIds từ Chrome 106; cần kiểm tra manifest thực tế của bản cloud khi triển khai. Đây là giảm fan-out/copy và giảm việc chờ frame không liên quan, **không phải tín hiệu uploader ready**.

Ràng buộc: không chỉ giữ frameId vì frame có thể điều hướng sang document khác; kiểm tra lại URL/RPC/runId/content epoch ngay tại đích; từ chối trường hợp nhiều đích; iframe bị thay thì bỏ đích cũ. Không tự upload lại nếu đã có khả năng bàn giao.

Ngoài ra executeScript mặc định đợi document_idle. Có tùy chọn injectImmediately để dò metadata sớm hơn; điều này không làm controller Google sẵn sàng sớm hơn. Nếu thử, vẫn phải giữ kiểm tra document/input và guard. Việc frame khác chậm có đang gây trễ trong mẫu thực tế hay không **chưa đo được**.

### 3. Kiểm tra ảnh song song với mở/tải tab ở đầu lượt

`src/background.ts:813` đọc ảnh và SHA-256 tuần tự trước khi tạo tab. Có thể tải form và kiểm tra ảnh cùng lúc sau khi đã giữ đúng lease/snapshot; join mọi kiểm tra trước bất kỳ thao tác điền/upload nào. Ảnh lỗi thì dừng lượt dù tab đã được mở.

Đây là cơ hội dịch công việc khỏi đường tuần tự, nhưng rủi ro triển khai cao hơn mục 1: phải xử lý Stop đến giữa lúc mở tab, tránh tab mồ côi, và tuyệt đối không chạy content tự động trước khi checksum/account/access checks hoàn tất. Chưa cần đụng trong đợt đầu nếu lợi ích chưa đo được.

### 4. Hàng đợi RPC và log — cần đo trước, chưa đề nghị bỏ thứ tự

Upload RPC và FORM_EVENT cùng qua messageQueue (`src/background.ts:668`); mỗi ô đợi emit, emit đợi ghi trạng thái. Một injection đang chậm có thể làm text/log chờ dù content đã tạo hai promise. Đây là điểm tuần tự có thật trong code; mức ảnh hưởng thực tế chưa có số đo riêng.

Cần trace thời gian queue/injection/storage trước khi tách. Có thể cân nhắc quan sát metadata/chuẩn bị bytes ngoài hàng đợi ghi, nhưng cập nhật trạng thái và quyết định handoff vẫn phải có kiểm tra scope/đơn nhất. Không fire-and-forget các sự kiện block, Stop, submit lock, page transition hoặc xác nhận upload; không song song hóa mọi emit để đổi lấy thứ tự không xác định.

## Những phần cần giữ phụ thuộc

- Không Next khi đang tải ảnh; không Next song song với kiểm tra lại dữ liệu/lỗi Google.
- Không mở nhiều Picker cùng lúc trong một profile hoặc upload nhiều lần để chữa ca chưa xác nhận.
- Không dùng token/file ID cũ từ bản nháp hay tự upload thẳng Drive để bỏ qua luồng sở hữu tệp của Forms.
- Không mở dropdown/click radio dưới modal với giả định nó hoạt động như ô text. Muốn thêm loại điều khiển vào nhóm overlap phải kiểm chứng riêng.

## Số đo và giới hạn

Hai lượt Google thật từ form trắng trước đó: 25.735 / 27.335 ms từ durable Start tới câu xác thực; upload đến chip 8.223 / 8.330 ms, phần chuẩn bị 5.392 / 5.537 ms. Nguồn: `test-results/v150-google-timing.json`. Tổng upload đó không đồng nghĩa toàn bộ là thời gian đợi cố định có thể loại bỏ.

Lượt khôi phục trong khảo sát này dùng code production cũ: `8b3847c4-38bd-46bc-b994-b1d5a6a94b4c`, ảnh gốc đến chip 7.736 ms, chuẩn bị 5.197 ms; đã đi qua trang ảnh đến câu xác thực, sau đó Dừng. Đây là bản nháp có dữ liệu cũ, không dùng làm benchmark cải thiện. Hai hash hồ sơ không đổi và bằng snapshot, 0 khóa gửi; Huyền không đổi runId. Đối chiếu read-only DB: nhãn `picker-signal-audit-restored-20261017` trong `test-results/v150-production.json`; screenshot `test-results/picker-signal-audit-restored.png`. Không trả lời câu xác thực, không Gửi.

## Nguồn kiểm chứng

- [Google Picker Action](https://developers.google.com/workspace/drive/picker/reference/picker.action), [ResponseObject](https://developers.google.com/workspace/drive/picker/reference/picker.responseobject).
- [Picker web component: các sự kiện công khai](https://developers.google.com/workspace/drive/picker/guides/web-component).
- [Chrome scripting: target documentIds, InjectionResult, injectImmediately](https://developer.chrome.com/docs/extensions/reference/api/scripting).
- [Chrome content scripts: document_idle](https://developer.chrome.com/docs/extensions/develop/concepts/content-scripts), [webNavigation: phân biệt frame/document](https://developer.chrome.com/docs/extensions/reference/api/webNavigation).
- Bundle opnc công khai lấy từ script src quan sát trong iframe: `https://www.gstatic.com/_/picker/_/js/k=picker.opms.vi.IA384cR-h5g.O/am=AAAAQA/d=1/rs=AGshSGOHNa_e1l4TPwPt9tTpZnq9UoN0ig/m=opnc`. Bản lưu `.runtime/picker-public-opnc-20261017.js`, SHA-256 `12a84bd82954ed1d7b5d1ac11a872ac702ea9bf3e774ab455a3c7dc61e575fdd`.
- Từ controller ID quan sát trên DOM và dependency map của bundle, đọc gói công khai cùng phiên bản với module `UoH53d,gmr4De`: `.runtime/picker-public-upload-controllers-20261017.js`, SHA-256 `d6779f92434b4eba60420ff7b1df1073c5ce9deebbe95fb4e09d627aa914939f`. Đây là source nghiên cứu chưa thực thi, không phải API được Google cam kết.

Khuyến nghị nghiên cứu tiếp theo nếu triển khai: đo riêng read/encode, frame lookup/injection, queue và handoff trước; ưu tiên mục 1–2, giữ nguyên bytes ảnh và guard. Chỉ bàn việc bỏ guard khi có tín hiệu trước upload được kiểm chứng bằng cả ca thành công và ca phản ví dụ. Chưa có bằng chứng đủ cho thay đổi đó ở lượt khảo sát này.
