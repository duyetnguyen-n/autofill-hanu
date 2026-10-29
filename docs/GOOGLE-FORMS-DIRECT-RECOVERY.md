# Tiếp tục đăng ký khi Google Forms Direct cần xử lý

Áp dụng từ bản Online 1.9.16. Engine Direct vẫn tách riêng và đã bỏ giới hạn
hai form LAB. Không thay engine Google Forms cũ. Test dừng trước Gửi; Live
gửi trên form được chọn. Form ngoài LAB giữ khóa sau khi gửi thành công.

## Luồng dự phòng

Trong Chi tiết profile → Nhật ký lượt chạy → Lịch sử, mở một lượt có snapshot
và chọn **Xem hồ sơ của lượt này** để nạp bản xem trước. Kiểm tra dữ liệu rồi
bấm **Lưu và đồng bộ** nếu muốn dùng lại; chỉ xem snapshot không tự lưu đè.
Nút Quay lại gốc ở trang cuối được giữ như điều hướng, không xin khóa Gửi.

Trang upload dùng Google Picker và nút Tiếp gốc để ghi nhận ảnh cùng các ô
cùng trang. Ở Live, nếu toàn bộ câu còn lại đã có đáp án hợp lệ, các trang
sau upload dùng request tuần tự lấy trạng thái thật Google cấp. Request cuối
gửi đáp án bằng POST chuyển trang thật, không đợi điền điều khiển lệ phí.
Không nhảy qua trạng thái trang hoặc tự dựng pageHistory/partialResponse.
Test, câu chưa biết và luồng dự phòng vẫn dùng trang Google thật; trang cuối
được điền và kiểm tra bằng Google trước Gửi. Request chuyển nhanh bị từ chối
sẽ khôi phục trang Google từ trạng thái đã nhận và tiếp tục theo luồng cũ
một lần, trước khi có request Gửi. Request Gửi chưa rõ kết quả không tự lặp.

Khi cần nhập tay:

1. Bấm **Tiếp quản trên form** ở thông báo trên trang Google.
2. Tool tạm dừng trên đúng lượt. Giữ lại dữ liệu/ảnh đã được Google nhận;
   đáp án theo HSK không tự ghi đè hoặc tự tiếp tục trong lúc tiếp quản.
3. Sửa thông tin, bấm Tiếp như Google Forms bình thường. Ở chế độ Live,
   điền đáp án rồi bấm Gửi. Google kiểm tra dữ liệu trước; đáp án sai vẫn
   hiện lỗi tại ô nhập, chưa xin khóa gửi.
4. Khi Google chấp nhận dữ liệu, extension giữ nguyên body POST Google vừa
   chuẩn bị, xin quyền Gửi từ bộ điều phối rồi mới gửi đúng một lần. Không
   dùng lại đáp án cấu hình để ghi đè đáp án vừa nhập trên form.
5. Muốn dùng tự động lại, bấm **Tiếp tục tự động** hoặc Tiếp tục trên trang
   quản lý. Đây là thao tác chủ động, không có tự chuyển ngược giữa hai chế độ.

Test giữ nguyên dữ liệu để kiểm tra nhưng chặn Gửi, kể cả bấm tay. Dừng
hoàn toàn kết thúc quyền điều khiển của tool và trả lại hàm submit gốc của
Google; không để một tab đã Dừng mắc kẹt sau bộ chặn của extension.

## Các tình huống cần phân biệt

| Tình huống | Trạng thái được giữ và cách xử lý |
| --- | --- |
| Thiếu đáp án/câu hỏi mới | Chờ tại trang Google thật. Nhập đáp án trên quản lý hoặc tiếp quản để tự điền. Không suy đoán lệ phí từ regex. |
| Đáp án sai | Sửa tại ô Google báo lỗi, bấm Gửi lại. Validation trước request cuối không tạo khóa gửi. |
| Tool chưa hỗ trợ quy tắc kiểm tra | Tiếp quản và để chính Google kiểm tra câu trả lời; không phụ thuộc bộ kiểm tra cục bộ cho thao tác Gửi tay đã được Google chấp nhận. |
| Kẹt ở điều khiển upload/lựa chọn | Tiếp quản giữ nguyên trang và tệp hiện tại, dùng điều khiển Google để hoàn tất. Không khởi tạo lượt mới chỉ để nhập lại một ô. |
| Tab cũ 1.9.7 vẫn ở trang 7 nhưng dữ liệu ẩn đã tới cuối | Tiếp quản gửi Back không phải Gửi, dùng chính hidden fields và revision/file reference Google đã cấp. Google dựng lại trang thật, sau đó bấm Tiếp bình thường. |
| Mất kết nối/reload extension trước Gửi | Lượt chuyển sang tạm dừng; dữ liệu trên trang và snapshot hồ sơ giữ lại. Nối lại, đối chiếu tài khoản/trang, rồi chủ động tiếp quản hoặc Tiếp tục. |
| Mạng lỗi sau khi đã bắt đầu Gửi, chưa có xác nhận | Giữ khóa và trạng thái chưa rõ kết quả. Kiểm tra phản hồi phía chủ form/xác nhận của Google trước khi gửi lại. Không tự retry request cuối. |
| CAPTCHA, đăng nhập hết hạn, form đóng/hết chỉ tiêu | Giữ dữ liệu, xử lý trên Google. Tool không tự vượt xác thực hoặc đảm bảo suất đăng ký. |

Lưu ý: đường Gửi dự phòng có theo dõi vẫn cần extension và kết nối bộ
điều phối để lấy quyền Gửi. Nó không phải đường gửi offline vượt qua khóa.
Sau khi Dừng hoàn toàn, thao tác trực tiếp trên Google do người dùng tự
thực hiện và không còn thuộc lượt tự động đã kết thúc.

## Rào chắn

- Chỉ tài khoản, tab, document và run hiện tại mới được tiếp quản/Gửi.
- Không tiếp quản qua một engine khác đang giữ cùng profile.
- Cả tự động lẫn tiếp quản đều kiểm tra dữ liệu POST trước khi xin quyền Gửi.
- Body Google đã kiểm tra chỉ ở trong document Google, không ghi token,
  partialResponse hoặc file reference vào log/extension storage.
- Không chèn response HTML, tạo Trusted Types policy, sửa CSP hoặc bỏ xác
  thực. Không bịa pageHistory, revision hay Drive file ID.

## Bằng chứng kiểm tra 28/10/2026

- Chrome test `ntduyet260602`, dữ liệu giả và ảnh PNG tổng hợp 1.229.883 byte.
- Lượt thiếu đáp án tới trang xác thực thật, có thể nhập; Test chặn Gửi.
- Live tiếp quản: `123456` bị Google báo lỗi, sửa `1350000` rồi Gửi ngay
  trên cùng lượt thành công. Run `62d7eab1-4868-41dc-82f2-cbee887ef564`.
- Live tự động dùng đáp án nhập trước: Google xác nhận trên trang thành
  công thật, khoảng 36 giây cả lượt.
- Cả hai phản hồi được kiểm tra phía chủ form: đúng tên giả
  `NGHIEN CUU DU PHONG`, ảnh lớn và đáp án. Đã xóa đúng phản hồi thử sau
  mỗi lượt, số phản hồi trở lại 0.
- Tab cũ có hidden state cuối form đã được khôi phục và đi tới trang xác
  thực thật bằng nút Tiếp; không cần nhập lại thông tin ngân hàng.

Bằng chứng nằm trong `test-results/google-direct-chrome-20261028/`, được
Git bỏ qua: `recovery-test-editable.png`, `recovery-live-wrong-answer.png`,
`recovery-manual-live-log.txt`, `recovery-manual-owner.json`,
`recovery-auto-google-confirmation.png`, `recovery-auto-owner.json`.

Đây là kiểm tra chức năng trên LAB, một profile; chưa đo tải nhiều profile,
không thể suy ra tỉ lệ thành công thực tế hoặc bảo đảm Google không hết suất.

## Bổ sung 1.9.10

- Phân biệt challenge CAPTCHA đang hiển thị với badge invisible/iframe ẩn;
  kiểm tra nhiều iframe, phản hồi đã hoàn tất và challenge xuất hiện lại.
- Direct nhận diện CAPTCHA ngay khi kiểm tra Gửi và khi Google chuyển sang
  `/sorry`; giữ tab, dữ liệu và khóa gửi nếu đã bắt đầu Gửi. Đăng nhập và
  form đóng có thông báo riêng. Không giải hoặc bỏ qua CAPTCHA.
- Callback Google đến sau khi chờ CAPTCHA vẫn đi qua quyền Gửi thủ công.
  Trạng thái Test/Dừng và khóa chống gửi lặp vẫn được kiểm tra.
- Classic đưa tab CAPTCHA ra trước sau khi nhường quyền cửa sổ xong; không
  tiếp tục giành focus khi nhận lại cùng lỗi, không kéo tab lên sau Dừng.
- Lỗi validation rõ ràng trên bước chuyển trang được báo ngay. Không tự
  gửi lại request cuối hoặc hủy một request còn đang chờ chỉ để chạy nhanh.

Đo LAB và giới hạn kiểm chứng: [QA 1.9.10](GOOGLE-FORMS-RECOVERY-QA-1.9.10.md).
