# Đối chứng gửi LAB bằng hai Chrome — 30/10/2026

## Phạm vi

Người dùng báo lỗi Google unusual traffic khi dùng Google Forms cũ đăng ký
hai người; LAB thường không bị. Lượt này là đối chứng thao tác trên trang
Google thật bằng công cụ Chrome, không phải lượt chạy engine Classic hoặc
Direct. Không suy ra hiệu quả bản 1.9.18 hay tỷ lệ CAPTCHA lúc đăng ký thật.

LAB responder: `1FAIpQLScRrul5GFZkLQD21oVlarFeb1AbomeKoqOJGVsnW3k3XbMtIA`.
LAB editor: `1FqHl_uWtJStIkPgsQ73L6WJhjGvPlBPSJLrvKw_R33k`.
Số phản hồi gốc xác nhận trước lượt: **4**. Không xóa bốn phản hồi này.

## Dữ liệu và kết nối

- Hai tài khoản ND và DN được đối chiếu bằng checkbox email Google trước
  khi điền. Ban đầu DN chưa có quyền; người dùng đã cấp quyền trả lời.
- Dùng hai tên giả `LAB NETWORK ND OCT THIRTY` và
  `LAB NETWORK DN OCT THIRTY`; số giấy tờ/điện thoại và ngân hàng mô phỏng.
  Không thay hồ sơ/ảnh gốc trong tool.
- Mỗi tài khoản upload `large-synthetic.png`, ảnh nhiễu tổng hợp 1.229.883
  byte. Google hiển thị tệp ở cả hai tài khoản và cho chuyển qua upload.
- Đáp án cuối LAB `1350000`; không thấy lỗi validation trước Gửi.
- Hai Chrome có cùng IP công cộng quan sát qua Cloudflare trace, WARP off.
  Không lưu IP thật trong báo cáo; không chứng minh Google dùng cùng đường
  xử lý hoặc IP là nguyên nhân của các lượt lỗi trước.

## Lượt gửi cuối và trạng thái chưa hoàn tất

- ND bắt đầu click Gửi lúc **13:53:38.920 UTC+7**.
- DN bắt đầu click Gửi lúc **13:53:39.362 UTC+7**.
- Khoảng cách hai lần bắt đầu click khoảng **0,42 giây**; mỗi tài khoản
  click một lần. Chưa thực hiện click Gửi lần hai.
- ND: đã đọc DOM trang Google “Câu trả lời của bạn đã được ghi lại.”
- DN: lần đọc ngay sau Gửi bị timeout của công cụ. Sau đó người dùng trực
  tiếp đọc tab DN và xác nhận “Câu trả lời của bạn đã được ghi lại”. Đây
  là xác nhận do người dùng cung cấp; agent chưa đọc lại được trang DN.
  Timeout công cụ không phải bằng chứng CAPTCHA hay phản hồi bị từ chối.
- Khi tiếp tục, công cụ báo `Local browser use is disabled in Work settings`.
  Đã yêu cầu bật lại để kiểm tra; không chuyển sang cách điều khiển khác.

Việc còn lại: đối chiếu hai tên giả ở trang phản hồi chủ LAB, lưu bằng
chứng rồi xóa đúng phản hồi của lượt này theo chỉ định trước đó của người
dùng. Chưa xác minh số phản hồi sau gửi, chưa xóa phản hồi thử. Không tạo
lượt gửi mới trước khi đối chiếu. Công cụ vẫn báo local browser disabled
sau reset phiên công cụ và sau khi người dùng mở lại ứng dụng; ảnh cài
đặt người dùng cung cấp cho thấy Browsing mặc định Always allow.

Kết luận giới hạn: hai tài khoản cùng IP vẫn có thể nhận xác nhận Google
khi click Gửi cách nhau khoảng 0,42 giây trên LAB ở thời điểm kiểm tra.
Không chứng minh nguyên nhân CAPTCHA ở form thật, không chứng minh mạng
không liên quan, không kiểm chứng engine Classic/Direct hoặc bản 1.9.18.

Tab cuối đã quan sát: ND browser 10 tab 592588780, DN browser 8 tab
592588783, owner browser 10 tab 592588786; phải đối chiếu inventory mới
trước thao tác vì tiện ích đã đổi kết nối/tab sau cấp quyền upload.

Bằng chứng trước Gửi ở thư mục Git-ignored
`test-results/google-forms-two-profile-20261030/`:
`nd-before-paired-submit.png`, `dn-before-paired-submit.png`.
