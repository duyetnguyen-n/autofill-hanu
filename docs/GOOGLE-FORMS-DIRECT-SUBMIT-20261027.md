# Nghiên cứu chuẩn bị dữ liệu và gửi trực tiếp Google Forms

Ngày khảo sát: 27/10/2026. Đối tượng: form thử HANU đã được người dùng cung cấp.

## Kết luận

Cập nhật sau thử sống: [Kết quả ba POST và lượt đối chứng](GOOGLE-FORMS-LIVE-POST-20261027.md).
Đối chứng qua giao diện lưu thành công; ba POST độc lập chưa tạo phản hồi hoàn
tất. POST thêm ID ảnh vẫn để trống câu upload. Chưa thử đầy đủ trong origin Google
với trạng thái phiên thật, nên chưa kết luận hướng gửi trực tiếp bất khả thi.

**Chuẩn bị sẵn dữ liệu và ánh xạ sang mã câu hỏi là khả thi. Gửi toàn bộ form HANU
bằng một request từ trang đầu vẫn chưa được chứng minh.** Nút thắt là tệp tải lên,
phiên Google, email được ghi nhận và trạng thái của form nhiều phần.

Hướng này đáng làm thử nghiệm riêng vì có thể bỏ nhiều thao tác giao diện. Chưa
đủ bằng chứng để thay luồng đăng ký hiện tại hoặc hứa thời gian hoàn tất cụ thể.

## Hiện tại và phương án nghiên cứu

| Giai đoạn | Luồng hiện tại | Nếu thử nghiệm gửi trực tiếp thành công |
| --- | --- | --- |
| Trước khi có link | Chuẩn bị tab, đồng bộ hồ sơ; lưu snapshot hồ sơ khi phát lượt | Chuẩn bị thêm dữ liệu đã chuẩn hóa và đọc sẵn ảnh ở local |
| Nhận link | Mở form và xử lý từng trang | Mở đúng form bằng đúng Chrome profile, đọc schema và trạng thái phiên |
| Điền thông tin | Tìm câu hỏi đang hiển thị, điền, đối chiếu giá trị rồi bấm Tiếp | Ánh xạ toàn bộ câu hỏi, chọn nhánh, kiểm tra dữ liệu và dựng tập đáp án trong bộ nhớ |
| Ảnh GTTT | Mở Google Picker, cấp tệp đã lưu, chờ ảnh hiện trên form | Vẫn phải tạo được tham chiếu tệp mà chính form chấp nhận; cơ chế không đi qua từng trang chưa được xác minh |
| Gửi | Xin khóa gửi, bấm Gửi và chờ xác nhận | Xin cùng khóa gửi, gửi request trong đúng phiên, kiểm tra xác nhận và dữ liệu lưu thực tế |
| Mất phản hồi sau gửi | Giữ trạng thái chưa chắc chắn và khóa gửi | Giữ cùng nguyên tắc; không chuyển sang luồng khác rồi gửi thêm một lần |

Trong source hiện tại, `src/content.ts` xử lý từng trang, kiểm tra lỗi, đối chiếu
giá trị, xử lý upload, gọi `REQUEST_SUBMIT` rồi mới bấm Gửi. Vì vậy chỉ đổi
`submit.click()` thành `fetch()` ở cuối **không loại bỏ chi phí điền và chuyển
trang trước đó**. Muốn giảm đáng kể phải nghiên cứu cả luồng thu thập và gửi dữ liệu.

## Những gì đã kiểm tra trực tiếp

### Form thử đang mở

URL: https://docs.google.com/forms/d/e/1FAIpQLSdwGr_cZjiXs_AapAIHmP1cdHp5q4_tLWI3fNytLWHtUJW5JQ/viewform

- GET từ client không có phiên đăng nhập trả **401**, không có schema; một lần
  quan sát mất 745 ms. Đây là thời gian của request bị từ chối, **không phải**
  số đo tải form thành công và không dùng để suy ra tốc độ submit.
- Chrome đang đăng nhập mở được trang đầu. Không điền, xóa bản nháp, tải tệp hay gửi.
- Đọc nội dung script metadata có sẵn trong DOM thấy **20 câu hỏi và 8 điểm chia phần**,
  gồm cả câu ở các trang sau. Không đọc cookie hoặc xuất giá trị token phiên.
- Form HTML khai báo `method="post"`, action kết thúc bằng `/formResponse`.
- Các trường ẩn hiện có: `fvv`, `partialResponse`, `pageHistory`, `token`, `tag`,
  `fbzx`, `submissionTimestamp`. Việc thấy các trường này **chưa xác định trường nào
  là bắt buộc**, giá trị nào có thể dựng, hay có thể dùng một POST từ trang đầu.
- Metadata có nhánh CCCD và hộ chiếu, hai cam kết có tiêu đề gần giống nhau,
  nhiều quy tắc validation và một câu bắt buộc tải tệp.
- Câu file có mã đáp án `entry.717838050`; mô tả chấp nhận ảnh/PDF dưới 10 MB.
  Không có bằng chứng rằng gửi đường dẫn file local hoặc một URL ảnh vào mã này
  sẽ thay thế được quy trình upload của Google.

Khảo sát ngày 25/10 trước đó đã xác nhận schema đọc được khi bản nháp trống,
13 giá trị prefill được giữ xuyên trang và ảnh giả tải qua Picker thành công.
Khảo sát đó dừng trước Gửi, nên cũng chưa chứng minh gửi trực tiếp.

### Bản thử chạy offline

Artifact: `test-results/direct-submit-research-20261027/schema-audit.ts`.

- Dùng bản chép metadata công khai từ lượt đọc DOM và các alias `HSK_RULES` hiện có.
- Ánh xạ được **19 câu hồ sơ**, bao gồm câu file và hai cam kết được phân biệt
  bằng nội dung lựa chọn; câu xác thực được ràng buộc riêng theo form, mã và nhãn.
- Với dữ liệu hoàn toàn giả và nhánh CCCD, tạo được **17 cặp tên/giá trị** dạng
  `entry.<id>`. Không đưa hộ chiếu, tên tiếng Trung trống hay câu file vào tập này.
- Kiểm tra mã trường không trùng, lựa chọn tồn tại, câu mới không bị ánh xạ bừa,
  đáp án xác thực của form khác hoặc nhãn đã đổi không được dùng lại.
- Kết quả cố ý là `requestSendable: false`; không có network call hoặc submit.

Đây là bằng chứng cho khả năng chuẩn bị phần dữ liệu, **không phải một payload đã
được Google xác nhận hợp lệ**. Bản thử chưa mô phỏng đầy đủ nhánh, mọi validation,
email tài khoản hoặc trạng thái gửi. Nó không được import vào ứng dụng.

## API chính thức có giải quyết được không?

- Google Forms REST API có `forms.responses.get` và `list`; không công bố phương
  thức tạo/gửi phản hồi trong resource này.
  [Tài liệu Google](https://developers.google.com/workspace/forms/api/reference/rest/v1/forms.responses).
- Apps Script **có** `FormResponse.submit()`, nhưng dùng Form service với quyền
  OAuth tương ứng và quyền mở form. Tài liệu `openByUrl` dùng URL form chỉnh sửa
  và nêu lỗi khi thiếu quyền. Không thể suy từ việc có link dành cho thí sinh
  rằng dùng được cơ chế này cho form của HANU.
  [FormResponse.submit](https://developers.google.com/apps-script/reference/forms/form-response#submit()),
  [FormApp.openByUrl](https://developers.google.com/apps-script/reference/forms/form-app#openbyurlurl).
- Google hỗ trợ prefill, nhưng prefill chỉ điền sẵn câu trả lời, không đồng nghĩa
  gửi form. Giới hạn một phản hồi cũng có thể yêu cầu đăng nhập.
  [Hướng dẫn Google](https://support.google.com/docs/answer/2839588?hl=en).

Do đó đối tượng nghiên cứu thực tế là giao thức web `formResponse` trong phiên
Google hợp lệ, không phải một API submit công khai dành cho thí sinh.

## Có thể chuẩn bị trước đến đâu?

**Trước khi form thật được mở:** chuẩn hóa hồ sơ, kiểm tra thông tin thiếu, chuẩn
bị bytes ảnh và giữ dữ liệu trong bộ nhớ local. Cần tránh nhầm đây là ảnh đã được
Google upload thành công; dữ liệu sẵn trong máy và tham chiếu tệp Google là hai bước.

**Sau khi đọc được đúng form:** mới xác nhận mã câu hỏi, loại điều khiển, lựa chọn,
nhánh, điều kiện nhập liệu và câu xác thực hiện tại; ghép dữ liệu đã chuẩn bị với
trạng thái phiên. Không dùng nguyên mã entry, token hoặc file reference của form
thử cho form thật. Nếu form đóng/chưa công bố thì phần chuẩn bị local vẫn làm
được, nhưng không giả định có thể đọc schema hoặc gửi sớm.

## Hiệu năng: hiện chưa thể chốt số giây

Mốc **34–40 giây/lượt** là quan sát người dùng cung cấp. Chưa có phép đo phân rã
một lượt gửi hoàn tất trong khảo sát này.

```text
Hiện tại = tải form + điền/đối chiếu từng trang + chuyển trang
           + upload + khóa gửi + gửi và xác nhận

Nếu gửi trực tiếp được = tải form/phiên + ánh xạ/kiểm tra dữ liệu
                        + upload hợp lệ + khóa gửi + gửi và xác nhận
```

Phần có thể giảm là thao tác điều khiển và chờ chuyển trang. Thời gian upload,
Google xử lý và trả xác nhận vẫn tồn tại. Chưa có cơ sở báo “còn 3 giây”, “còn
10 giây” hay tỷ lệ giảm cụ thể. Độ trễ dựng dữ liệu local không đại diện cho
thời gian Google ghi nhận phản hồi.

Nếu giữ nguyên luồng đi qua các trang tới Picker rồi chỉ POST trực tiếp ở cuối,
phần tiết kiệm sẽ nhỏ hơn phương án bỏ được các trang. Hai phương án phải đo riêng.

## Thử nghiệm tiếp theo để ra quyết định

Đã tạo một form thử **do người dùng sở hữu**, có quyền xem phản hồi và cho phép
gửi nhiều lần; thông tin ở phần bổ sung bên dưới. Có thể kiểm tra trường hợp đơn
giản trước rồi trường hợp nhiều phần có rẽ nhánh, email tài khoản, file,
validation và câu xác thực. Form đơn giản chạy được chưa đủ chứng minh trường
hợp thứ hai.

1. Quan sát một lần submit bình thường trên form đó để biết request cuối thực sự
   mang dữ liệu gì. Giữ token trong đúng phiên, không ghi credentials vào báo cáo.
2. Thử dữ liệu chuẩn bị sẵn và gửi từ trang đầu; xác minh phản hồi đã lưu bên phía
   chủ form có đủ từng trường, đúng nhánh, đúng email và tệp mở được.
3. Thử riêng token cũ, đổi form/câu hỏi, ảnh bị từ chối, mất mạng sau khi gửi,
   bấm Dừng và khởi chạy lại. Phản hồi HTTP 200 không tự coi là thành công.
4. Đo từ lúc có link tới lúc Google xác nhận, gồm upload, dùng cùng dung lượng ảnh
   và profile; so sánh median, p95, tỷ lệ lỗi và phản hồi trùng với luồng hiện tại.
5. Chỉ cân nhắc tích hợp khi dữ liệu lưu đúng và có lợi rõ ràng về thời gian lẫn
   độ ổn định. Mọi nhánh gửi vẫn dùng khóa gửi hiện có. Chỉ được quay lại luồng
   giao diện khi biết chưa gửi; sau request có kết quả không chắc chắn phải giữ khóa.

Trong lượt nghiên cứu này chưa gửi form HANU: quyền khảo sát trước đó dừng trước
Gửi và tài khoản có thể bị giới hạn một phản hồi. Không thay đổi source vận hành,
build đang dùng hoặc phiên bản triển khai.

## Bổ sung: hai form kiểm thử đã hoàn thiện

Cập nhật ngày 27/10/2026. Chi tiết, bộ dữ liệu giả và tiêu chí kiểm thử nằm trong
[GOOGLE-FORMS-LAB-20261027.md](GOOGLE-FORMS-LAB-20261027.md).

- [Bản chuẩn — trả lời](https://docs.google.com/forms/d/e/1FAIpQLScRrul5GFZkLQD21oVlarFeb1AbomeKoqOJGVsnW3k3XbMtIA/viewform),
  [chỉnh sửa/phản hồi](https://docs.google.com/forms/d/1FqHl_uWtJStIkPgsQ73L6WJhjGvPlBPSJLrvKw_R33k/edit).
- [Bản lệ phí — trả lời](https://docs.google.com/forms/d/e/1FAIpQLSevBk_8863gvlRtkeaKONg6H7y4teYgGU11SBQgg3LSAJNhlw/viewform),
  [chỉnh sửa/phản hồi](https://docs.google.com/forms/d/19SwlZsmR72R7nL6q6VIdYr7hqiT5V5iR1NhGApkf3mc/edit).
- Đều có 20 câu hỏi, 9 phần; chủ sở hữu là tài khoản người dùng. Đã xuất bản,
  quyền chỉnh sửa/trả lời Hạn chế; xác minh email, cho phép thử nhiều lần.
- Bản chuẩn đã bổ sung đầy đủ thứ tự, loại điều khiển, lựa chọn Other thật,
  xáo trộn đáp án cam kết, validation, nhánh, mô tả, hướng dẫn và ảnh của form gốc.
  So sánh 32 mục metadata theo các trường ghi trong báo cáo: không còn khác biệt.
- Bản lệ phí giữ nguyên 31 mục, thay nhãn/mô tả/regex của câu cuối bằng câu hỏi
  lệ phí HSK4. Đáp án **1234567 là dữ liệu giả**, không phải lệ phí chính thức.
- File bắt buộc: một ảnh/PDF, tối đa 10 MB; thư mục upload của bản sao đã phục hồi.
- Ở lượt tạo form chưa gửi phản hồi. Sau đó đã có **1 phản hồi đối chứng** trên
  bản lệ phí qua giao diện, kiểm tra dữ liệu và ảnh đã lưu. Ba POST nghiên cứu
  chưa tạo phản hồi hoàn tất; xem báo cáo thử sống ở đầu tài liệu. Không gửi HANU.

Các hạn chế cũ về thiếu validation, hướng dẫn và giới tính radio đã được khắc phục.
Bản này vẫn dựa trên **form thử gốc**, không khẳng định giống toàn bộ form đăng ký
thật chưa được cung cấp. Chính sách Workspace, tải đồng thời và thay đổi ở ngày
đăng ký thật chưa được tái hiện.
