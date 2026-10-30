# Google Forms 1.9.18 — xử lý cảnh báo lưu lượng và CAPTCHA lỗi tải

Ngày kiểm tra: 30/10/2026. Trạng thái: sửa và build cục bộ; chưa Reload
extension hay triển khai server của bản này, chưa tái hiện CAPTCHA thật.

Người dùng xác nhận lỗi lặp lại ở engine Google Forms cũ khi chạy hai
profile. Ảnh cảnh báo được cung cấp là từ máy khác, nên kiểm tra mạng
trên máy hiện tại không xác định được nguyên nhân của lượt trong ảnh.
Không kết luận rằng Google đặt giới hạn hai profile hoặc chung IP là
nguyên nhân duy nhất. Bản này cải thiện phục hồi; không ngăn/vượt CAPTCHA.

## Thay đổi

- Classic nhận diện cảnh báo unusual traffic và lỗi không liên lạc được
  reCAPTCHA ngay cả khi không có khung xác minh hoạt động. Nội dung câu
  hỏi có nhắc những từ này không bị coi là trang cảnh báo.
- Nhận diện các URL Google `/sorry` trên host google.com, www, ipv4 và
  ipv6; giữ lượt thay vì coi tab đã chuyển sang form khác. Tiếp tục từ
  trang cảnh báo có thông báo xác minh thay vì lỗi tài khoản chung chung.
- Cảnh báo xác minh và giới hạn HTTP 429 không lên lịch GET phục hồi tự
  động. Lỗi máy chủ 5xx thông thường vẫn giữ backoff có giới hạn.
- Sau khi đã cấp quyền Gửi, gặp CAPTCHA sẽ tắt autoContinue cho lượt đó,
  giữ trạng thái submit_uncertain và khóa gửi. Một lỗi chung đến muộn
  không bật lại tự gửi. Cần đối chiếu kết quả trước khi thử gửi lại.
- Chặn nhánh gửi lại trên form khôi phục nếu blockingIssue vẫn là CAPTCHA,
  kể cả lượt cũ có autoContinue/retryOnReturn bật. Các nhánh phục hồi đã
  được cho phép khác tiếp tục giữ kiểm tra document, khóa và số lần thử.
- Khi CAPTCHA xuất hiện ngay trong trang sau click Gửi, Classic báo lỗi
  ngay ở vòng kiểm tra kế tiếp thay vì chờ hết 20 giây và báo lỗi chung.
- Lỗi được giữ theo từng lượt/profile; không dừng cả nhóm khi một profile
  bị chặn. Không thay thuật toán điền, chọn nhánh hoặc upload của Classic.
  Direct vẫn là engine riêng và giữ các sửa phục hồi của 1.9.17.

## Bằng chứng kiểm thử

- Fixture cảnh báo nguyên văn như ảnh, không có iframe CAPTCHA hoạt động,
  cả trước và sau cấp quyền Gửi: không phát sinh điều hướng GET hay chạy
  lại, giữ trạng thái và dữ liệu lượt.
- CAPTCHA sau Gửi, sau đó lỗi chung đến muộn rồi form trở lại: không xin
  quyền Gửi lần hai, khóa uncertain và snapshot hồ sơ không đổi.
- Content script hiển thị cảnh báo/khung hỏng ngay sau click Gửi: chỉ một
  click, một lần xin quyền; không tự Resume sau 25 giây.
- Store với hai profile: thành viên CAPTCHA không được cấp quyền gửi lại,
  thành viên kia hoàn tất và giữ khóa received; nhóm không bị pause.
- URL giả mạo Google, đường dẫn gần giống và từ khóa trong câu hỏi không
  bị nhận nhầm thành URL/trang kiểm tra lưu lượng.
- Các sửa Direct 1.9.17 có kiểm thử response HTTP cảnh báo, HTTP 429, lỗi
  fetch/body, giữ trạng thái cuối và không đổi sang native POST dự phòng.

Các kiểm thử trên là mô phỏng DOM/Chrome API/coordinator. Chưa đo tỉ lệ
CAPTCHA hoặc độ thành công trên Google thật với nhiều profile. Hồ sơ/ảnh
thật và phản hồi Google của người dùng không bị thay đổi trong lượt này.

Typecheck và build Online/server đều đạt. Bộ kiểm thử toàn dự án chạy với
hai worker: 1010 đạt, 4 thất bại, 1 bỏ qua (100 file). Ba lỗi là timeout
5 giây ở cloud/postgres và cloud/transport; một lỗi là thiếu openssl trên
PATH của tiến trình HCMUE. Đã chạy lại riêng ba file bằng một worker, giữ
nguyên timeout và thêm Git OpenSSL có sẵn vào PATH riêng của tiến trình:
32/32 đạt, bao gồm cả bốn ca trước đó. Không sửa kiểm thử để bỏ qua lỗi.
Lượt chạy mặc định song song trước đó đã dừng do nhiều timeout và tải máy
cao; không coi lượt bị dừng là một lần kiểm thử đầy đủ thành công.

## Áp dụng và phục hồi

Extension Online build ở `dist-cloud`, phiên bản 1.9.18. Reload đúng bản
trên mỗi Chrome profile mới có hiệu lực. Server build cục bộ cũng chứa
guard ngăn retry với trạng thái CAPTCHA; cần triển khai để áp dụng guard
đó phía server. Extension mới đã tự chặn và báo autoContinue=false khi
gặp CAPTCHA sau Gửi, sử dụng trường trạng thái hiện có.

Khi Google chặn: giữ nguyên tab. Không reload/Gửi liên tục, không xóa
cookie hay xóa hồ sơ/ảnh để thử lại. Nếu CAPTCHA tải được, người dùng xử
lý trên Google; trước Gửi có thể tiếp tục khi đúng form/tài khoản đã sẵn
sàng. Sau cấp quyền Gửi phải đối chiếu xác nhận trước, rồi dùng xác minh
kết quả của lượt. Tool không tự giải CAPTCHA hoặc thay đổi IP/proxy.
