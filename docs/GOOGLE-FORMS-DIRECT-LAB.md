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
Chưa mở cho form đăng ký HANU thật, chưa triển khai website production.

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

## Kiểm tra và giới hạn nghiệm thu

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
