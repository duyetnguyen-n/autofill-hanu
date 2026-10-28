# Google Forms thử nghiệm — 27/10/2026

## Cách dùng và phạm vi

Mở **Google Forms thử nghiệm** trong thanh điều hướng trang quản lý, đường dẫn
`/google-direct`. Màn hình dùng chính component quản lý Google Forms hiện có:
profile, ảnh, cấp HSK, lịch/link theo HSK, đáp án xác thực, theo dõi, Tạm dừng,
Tiếp tục, Dừng từng profile, Dừng lượt và Dừng tất cả. Không cần thực hiện quy
trình đọc schema/xem payload/chạy thủ công ở trang Lab cũ.

`/` tiếp tục chọn engine cũ mặc định. `/google-direct` đặt `engine: direct` khi
bật lịch hoặc bắt đầu. Lựa chọn được giữ trong lịch, nhóm, lượt chạy và Chạy lại.
Extension cũ thiếu capability `googleDirect` bị từ chối, không tự chuyển về
engine cũ. `google-direct.html` còn được build để chẩn đoán kỹ thuật, không còn
được giới thiệu trong Side Panel như luồng sử dụng chính.

Hiện executor thử nghiệm chỉ chấp nhận hai form LAB do người dùng sở hữu:

- [LAB chuẩn](https://docs.google.com/forms/d/e/1FAIpQLScRrul5GFZkLQD21oVlarFeb1AbomeKoqOJGVsnW3k3XbMtIA/viewform).
- [LAB câu lệ phí](https://docs.google.com/forms/d/e/1FAIpQLSevBk_8863gvlRtkeaKONg6H7y4teYgGU11SBQgg3LSAJNhlw/viewform).

Đáp án lệ phí `1234567` chỉ là dữ liệu giả của LAB. Không suy ra đáp án từ biểu
thức validation. Test dừng trước request Gửi; Live gửi phản hồi thật lên LAB.
Chưa mở cho form đăng ký HANU thật. Sau khi người dùng triển khai tính năng lên
website, lượt kiểm tra production và bản sửa tiếp theo được ghi ở cuối báo cáo.

## Tách phần thử nghiệm

Executor và trạng thái extension nằm riêng trong `src/google-direct/`:
`ManagedDirect`, `DirectExecutor`, `googleDirectManagedRun`, `googleDirectLease`
và `googleDirectSubmit:<form>:<account>`. Không ghi đè các bản ghi `run:*`,
`managedRun` hay khóa gửi của engine cũ. `src/content.ts` không đổi.

Background chỉ thêm bộ chọn engine và kiểm tra không chạy chồng trên cùng
Chrome profile. Hai engine cùng kiểm tra lease khi bắt đầu; lệnh quản lý được
gắn đúng run ID. Hồ sơ và ảnh vẫn dùng chung bản đồng bộ có sẵn, mỗi lượt lấy
snapshot. Backend vẫn dùng bộ điều phối, giới hạn tài khoản/Live và khóa gửi
hiện có. Đây không phải hai kho profile hay hai bộ điều phối song song: tài
khoản vẫn có một lịch hoạt động tại một thời điểm như trước.

## Những lỗi tìm được và sửa

1. **So sánh schema theo thứ tự lựa chọn.** Google xáo trộn đáp án cam kết giữa
   các lần tải, làm bản cũ báo schema thay đổi ngay trước request đầu. Fingerprint
   mới bỏ qua thứ tự lựa chọn, vẫn so nội dung, ID, validation và đích phân nhánh.
2. **Không nhận nút `Gửi`.** Google dùng Unicode tách dấu, khác chuỗi `Gửi` trong
   regex. Nhãn điều khiển được chuẩn hóa NFC trước khi nhận diện.
3. **Sửa `partialResponse` rồi nhảy từ upload tới cuối.** Bỏ thao tác tự ghép
   bản nháp và giả lập toàn bộ `pageHistory`. Mỗi request giữ nguyên trạng thái
   Google trả về và chỉ thêm đáp án của trang hiện tại.
4. **Bản nháp thay đổi sau upload.** Google tự commit upload bằng nút Tiếp của
   chính trang. Chỉ riêng phần upload chuẩn bị các điều khiển liên quan và dùng
   thao tác native. Sau đó các trang còn lại dùng fetch cùng origin, tránh
   điều hướng/beforeunload làm phát sinh autosave cạnh tranh. `dlut` lấy đúng từ
   packet do Google tạo, không dựng bằng thời gian hiện tại; `fuIds` được giữ.
5. **Metadata tạm bị Trusted Types chặn.** Lưu metadata dưới dạng văn bản trong
   phần tử trơ, không gán HTML/script thực thi, không tạo policy hay nới CSP.
   Trạng thái HTTP và token chỉ ở trong document Google, không gửi về server.
6. **Dừng và kết quả chưa rõ.** Abort chặn request tiếp theo, hủy fetch/Picker,
   đợi tác vụ dừng rồi mới xác nhận. Nếu đã được backend cấp quyền Gửi hoặc
   request cuối có thể đã đi, giữ trạng thái chưa rõ và khóa gửi; không tự retry.
   Stop đến sau xác nhận thành công không hạ kết quả thành chưa rõ.
7. **Ảnh cũ trong draft.** Lượt mới thay attachment trong câu upload bằng đúng
   Blob của snapshot, không dùng tên tệp giống nhau để suy ra nội dung giống.
8. **Trang form sau khi gửi HTTP.** Khi Google xác nhận, ẩn form cũ, xóa trạng
   thái HTTP tạm và hiển thị xác nhận ngay trong trang; không để các nút cũ dẫn
   người dùng tiếp tục gửi. Không tạo popup cố định ở góc màn hình.

## Bằng chứng Google thật

Thực hiện trong Chrome đã đăng nhập của người dùng, chỉ dữ liệu và ảnh giả,
không gửi form HANU gốc. Phản hồi đã được xem lại ở phía chủ form:

| Lượt | Phạm vi thời gian | Kết quả đối chiếu |
|---|---|---|
| LAB chuẩn, CCCD, `NGHIEN CUU LAB` | 3.847 ms chỉ riêng chạy lại từ trang cuối; không phải toàn lượt | Phản hồi số 1: CCCD, email giả, ngân hàng, `2026`; mở được PNG đã lưu trên Drive |
| LAB chuẩn, hộ chiếu, `NGHIEN CUU HO CHIEU` | 14.273 ms từ khi gọi executor đến nhận xác nhận, gồm mở tab/upload/chuyển trang/gửi | Phản hồi số 2: `AB0000000`, CCCD trống, tên/chủ tài khoản đúng, ảnh và `2026` |
| LAB lệ phí, CCCD, `NGHIEN CUU LE PHI` | 24.926 ms toàn lượt | Phản hồi số 4 của form này: CCCD `000000000000`, tên/chủ tài khoản đúng, có tệp và đáp án giả `1234567` |

Ảnh fixture là PNG 1×1 rất nhỏ, không phải ảnh giấy tờ thực tế. Các con số trên
là từng mẫu đo, không phải trung bình/p95, không bảo đảm nhanh hơn trên mọi lượt.
Một số lượt khảo sát trước bản sửa dừng ở schema, nhận diện Gửi, xung đột draft
hoặc lỗi injection; không có request Gửi cuối trong các lượt thất bại đó. Có
một lượt LAB lệ phí không nhận được kết quả injection sau upload; lượt mới
được bắt đầu riêng rồi thành công. Chưa đủ mẫu để khẳng định hết lỗi mạng/phiên.

Bằng chứng được lưu cục bộ trong `test-results/google-direct-fix/`:
`owner-response-1.txt`, `owner-response-2.txt`, `owner-fee-response-4.txt`, ảnh
chụp trang chủ form/Drive và giao diện. Không xuất cookie, token hay HAR.

## Kiểm tra trước khi người dùng triển khai website

- 94 file test, **857 test qua** với `npm test -- --maxWorkers=2`.
- `npm run typecheck`, build extension local/Online, manager và cloud server/UI
  qua; `git diff --check` qua. Build UI vẫn có cảnh báo chunk lớn vốn có.
- Kiểm tra UI trong Chrome với server cục bộ và 3 profile giả: chọn nhiều
  profile, link theo HSK, bật lịch Direct, Tạm dừng cả lượt, Dừng tất cả; backend
  lưu cả 3 về idle. Kiểm tra reload giữ kết quả đã dừng. Đây là fixture, không
  phải ba Chrome profile thực chạy Google đồng thời.
- Đã xem bố cục desktop và viewport mobile 390×844. Dùng lại Fluent UI, CSS và
  Notice của màn cũ, không dựng một giao diện nghiên cứu khác cho người dùng.
- Gửi Google thật đã kiểm tra executor trong extension. Chưa có nghiệm thu
  trọn chuỗi web production → extension → nhiều tài khoản Google thật; cần
  cập nhật đồng bộ web/extension và kiểm tra phần này trước khi sử dụng thực tế.
- Chưa benchmark ảnh giấy tờ dung lượng thực, tải đồng thời nhiều profile,
  quota/chặn lưu lượng, phiên hết hạn hay schema form thật chưa mở.

Các nghiên cứu trước vẫn ở [báo cáo giao thức ban đầu](GOOGLE-FORMS-DIRECT-SUBMIT-20261027.md),
[so sánh LAB](GOOGLE-FORMS-LAB-20261027.md) và
[các thử POST ban đầu](GOOGLE-FORMS-LIVE-POST-20261027.md). Kết luận âm ở các
báo cáo đó chỉ áp dụng cho những cách gửi cũ đã thử, không phủ định các lượt
thành công có session/upload hợp lệ ở trên.

## Kiểm tra bản đã triển khai — 28/10/2026

Kiểm tra trên `https://hanu-autofill.onrender.com/google-direct`, Chrome đang
liên kết với website và extension Online build từ source của bản vá. Server
production giữ bản người dùng đã deploy trong lúc kiểm tra; không thay bằng
server fixture. Chỉ một Chrome profile đang kết nối. Hồ sơ và ảnh gốc được
giữ trong phiên chẩn đoán, tạm thay bằng dữ liệu giả, rồi khôi phục và đồng bộ
lại đầy đủ sau khi kết thúc. Không gửi form HANU gốc.

### Lỗi tái hiện và bản sửa

1. **Lịch không chuẩn bị được sau một lượt Direct.** `PREPARE_FORM` không có
   run ID bị chuyển nhầm vào `ManagedDirect.control`, trả lỗi “Điều khiển thử
   nghiệm chưa hỗ trợ lệnh này”. Lệnh chuẩn bị nay đi qua bộ chuẩn bị tab dùng
   chung; vẫn chặn khi một lượt Direct hoặc classic đang giữ profile.
2. **Kẹt ở giới tính/thời gian học tại trang ảnh.** Google đặt giá trị dropdown
   đã commit trong input ẩn bên ngoài card. `aria-selected` khi menu mở chỉ có
   thể là dòng đang được trỏ tới. Bản sửa mở menu, chọn đúng dòng bằng phím
   Home/ArrowDown/Enter của Google và chỉ công nhận khi input ẩn có đúng giá
   trị. Không cuộn popup rồi bấm bằng tọa độ cũ.
3. **Báo lỗi ngay sau thao tác cuối.** Vòng lặp sáu lần có thể kết thúc ngay
   sau khi Google vừa nhận lựa chọn, chưa đọc lại giá trị. Thay bằng thời hạn
   chờ xác nhận 5 giây, thoát ngay khi đúng; không thêm chờ cố định cho cả lượt.
4. **Trùng số thứ tự trạng thái đầu lượt.** Executor nhận bản run trước lần
   lưu đầu tiên, khiến hai cập nhật cùng `eventSeq=1`. Nay dùng run đã lưu để
   giữ số thứ tự tăng liên tục khi website nhận tiến độ.
5. **Sự kiện nhập và Dừng.** Gửi đủ trạng thái chuột; nếu Dừng đến giữa thao
   tác thì nhả chuột ngoài mục tiêu. Chuỗi phím kiểm tra hủy trước từng phím,
   nhả phím đang giữ và không tiếp tục tới Enter sau khi bị hủy.

Không sửa `src/content.ts` hay logic điền/gửi của engine classic. Phần dùng
chung chỉ đổi cách định tuyến lệnh chuẩn bị và kiểm tra profile đang bị giữ.

### Kết quả quan sát được

| Luồng | Bằng chứng |
|---|---|
| Chuẩn bị lịch HSK sau Direct | Tab chờ được mở, profile báo đã chuẩn bị; nhận link LAB rồi phát START qua extension |
| Test và đáp án bổ sung | Đến câu lệ phí thì chờ khi thiếu đáp án; nhập đáp án và Tiếp tục đưa run về `ready_to_submit`, `submitAttempted=false` |
| Tạm dừng nhóm | API production trả thành công; extension báo `paused`, `active=false`, chưa cấp quyền gửi |
| Tiếp tục rồi Dừng nhóm | Cả hai lệnh được xác nhận; kết quả `idle`, `execution=null`, `submitAttempted=false` |
| Live từ giao diện lịch HSK | Chuẩn bị → chờ/cấp link → upload → ghép đáp án HSK → cấp quyền Gửi → Google xác nhận; run `fc216aae-6adc-4956-af6c-8c5400ccde10` về `completed`, `execution=null` |
| Đối chiếu chủ LAB lệ phí | Số phản hồi tăng từ 4 lên 5; phản hồi 5 có tên/chủ tài khoản `NGHIEN CUU QUAN LY`, CCCD giả `000000000000`, email `fixture@gmail.com`, giới tính Nam, thời gian học 1 năm, đáp án `1234567`; mở được ảnh fixture trên Drive |
| Khôi phục | So sánh toàn bộ profile với bản trước khi thử: trùng khớp; đã đồng bộ, không còn execution; lịch LAB đã hủy, giao diện về Test và bỏ chọn profile |

Lượt Live trên mất **30,236 giây**, đo từ `startedAt` đến trạng thái hoàn tất
của run trên website. Bao gồm mở trang, tải ảnh, điều hướng, tự ghép đáp án HSK
và xác nhận gửi; không gồm thời gian lịch chờ được cấp link. Đây là một mẫu với
PNG 1×1, không phải benchmark ảnh giấy tờ thực hoặc cam kết tốc độ.

Các nhãn tên, giấy tờ, ngày sinh và điện thoại trong LAB hiện dùng Morse.
Hồ sơ giả được ánh xạ rõ theo entry của LAB; không suy đoán tên trường hoặc
mức lệ phí. Các lượt thiếu ánh xạ/giá trị không qua validation đã dừng trước
Gửi. Điều này không chứng minh form thật có cấu trúc bất kỳ đều được hỗ trợ.

Kiểm tra bản vá: **95 file / 864 test qua**, `npm run typecheck` qua, build
extension local, extension Online và cloud server/UI qua. Có regression test
cho định tuyến PREPARE_FORM, giá trị dropdown nằm ngoài card, dòng highlight
chưa commit, xác nhận trễ, hủy chuột/phím và số thứ tự trạng thái.

Bằng chứng cục bộ ở `test-results/google-direct-deployed-20261028/` gồm xác
nhận Live, phản hồi 5 phía chủ form, giá trị dropdown, ảnh fixture trên Drive,
kết quả run và xác nhận khôi phục. Không xuất cookie, token hay HAR.

Chưa kiểm tra nhiều tài khoản Google chạy đồng thời, Windows, phiên hết hạn,
CAPTCHA hoặc ảnh dung lượng thực. Bản vá nằm chủ yếu trong extension: deploy
website xong vẫn cần cập nhật/reload extension ở từng Chrome profile sử dụng.
