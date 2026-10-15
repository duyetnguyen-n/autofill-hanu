# Quản lý người dùng và quyền truy cập

Bản cloud có đăng nhập Google, bổ sung thông tin liên hệ, xét duyệt tài khoản
và trang `/admin`. Bản local tiếp tục dùng dữ liệu và cơ chế kết nối cũ.

## Cập nhật hệ thống đang chạy

1. Trong Supabase SQL Editor, chạy **một lần** migration
   `supabase/migrations/202610150001_user_access.sql`, sau migration cloud cũ.
   Migration giữ nguyên hồ sơ, ảnh, lượt chạy và khóa gửi. Tài khoản hiện có
   được đưa vào danh sách chờ duyệt; không tự động cấp quyền cho người dùng cũ.
2. Trong biến môi trường backend/Render, đặt
   `HANU_BOOTSTRAP_ADMIN_EMAIL` bằng **đúng email Google của chủ sản phẩm**.
   Không đưa email admin hoặc secret key vào mã frontend/extension.
3. Build và triển khai backend/UI mới theo `DEPLOY-AGAIN.md`. Backend mới từ
   chối khởi động nếu thiếu migration. Chọn thời điểm ít lượt đang chạy.
4. Đăng nhập đúng Google email vừa cấu hình. Backend chỉ cấp admin đầu tiên khi
   Google identity xác nhận email, và database chưa có admin nào. Không có cơ
   chế “người đăng nhập đầu tiên trở thành admin”. Nếu đã có admin, biến này
   không tạo thêm admin. Sau khi vào `/admin` thành công, bỏ biến bootstrap.
5. Build lại extension bằng `npm run build:cloud-extension` với `.env.cloud`
   chứa production origin. Phân phối nội dung `dist-cloud` và yêu cầu người dùng
   chép đè **trong thư mục Chrome đang nạp**, rồi Reload. Không Remove extension
   hoặc xóa dữ liệu. Backend mới từ chối client cũ chưa hỗ trợ `accessPolicy:1`.
6. Trong `/admin`, duyệt từng người, đặt giới hạn, hạn dùng và quyền Live.
   Tài khoản phải có email Google đã xác minh và đủ thông tin liên hệ mới dùng
   được sản phẩm. Admin được miễn bước bổ sung liên hệ.

Đây là thay đổi cần migration **và** cập nhật extension; hướng dẫn cập nhật
website không đổi giao thức trước đây không đủ cho bản này. Việc chạy migration
không tự triển khai backend mới; cơ chế chặn tại HTTP/WS có hiệu lực khi backend
mới đã hoạt động. Không rollback về backend cũ nếu cần duy trì kiểm soát truy cập.

## Cách vận hành

- **Chờ duyệt:** người dùng đăng nhập, hoàn tất tên liên hệ, điện thoại/Zalo,
  mục đích và xác nhận dùng thông tin cho xét duyệt/hỗ trợ. Họ không được đọc
  hồ sơ cloud, tạo mã liên kết, nhập dữ liệu hoặc chạy profile.
- **Hoạt động:** chỉ dùng theo quyền và hạn được cấp. `/account` hiển thị quyền
  của chính tài khoản; người dùng có thể sửa thông tin liên hệ tại đó.
- **Khóa / từ chối / hết hạn:** chặn các thao tác sản phẩm. Đăng nhập, đăng xuất
  và xem/sửa thông tin tài khoản vẫn được phép. Khóa không xóa dữ liệu.
- **Cấp quyền trước:** dành cho email chưa có tài khoản, không gửi email mời.
  Người dùng vẫn đăng nhập Google và bổ sung thông tin. Quyền được nhận một lần
  khi email xác minh khớp; đăng nhập lại không mở khóa tài khoản bị khóa/từ chối.
- **Thay đổi quyền:** xóa mã liên kết chưa dùng. Khóa, từ chối, hết hạn, tắt
  Live hoặc giảm số chạy đồng thời sẽ hủy vé WebSocket chưa dùng, ngắt kênh
  website/extension đang hoạt động và tạm dừng lượt để đối chiếu. Gia hạn, tăng
  quyền hoặc sửa ghi chú không làm gián đoạn lượt đang chạy. Không tự chạy lại
  sau khi mở khóa/gia hạn. Hạn dùng được kiểm tra ở API/lệnh mới và kênh đang mở
  được kiểm tra định kỳ tối đa khoảng 5 giây; quyền gửi được kiểm tra trong
  transaction ngay trước khi cấp. Một thao tác đã được Google nhận không thể
  bị thu hồi; trạng thái gửi chưa rõ và khóa chống gửi lại được giữ.
- **Thu hồi extension:** hủy token của đúng profile. Hồ sơ và lịch sử vẫn giữ;
  người dùng phải liên kết lại bằng mã mới. Không ảnh hưởng profile khác.
- **Giới hạn profile:** tính cả profile đã nhập hoặc đã thu hồi. Hạ giới hạn
  không xóa profile cũ; người dùng không thêm được khi đã đạt/vượt giới hạn.
- **Chạy đồng thời:** áp dụng cho Start và Resume, cộng cả các lượt Test/Live
  đang chạy hoặc đang xác nhận gửi. Lượt tạm dừng phải được tiếp tục hoặc dừng
  chủ động. Quota được kiểm tra dưới khóa tài khoản để tránh hai yêu cầu đồng
  thời cùng vượt giới hạn.
- **Live:** quyền riêng, kiểm tra khi Start, Resume và cấp quyền Gửi. Chỉ có
  quyền Test thì không thể vượt qua bằng cách gọi API trực tiếp.
- **Nhật ký:** ghi người thực hiện, tài khoản đích, thời điểm, quyền trước/sau
  và thu hồi liên kết. Ghi chú nội bộ và nhật ký chỉ có trong API quản trị.

Trang quản trị chỉ quản lý tài khoản, mức sử dụng và liên kết; không hiển thị
toàn bộ hồ sơ thí sinh hay ảnh giấy tờ. Danh sách tài khoản có tìm kiếm, bộ lọc
và phân trang 25 tài khoản/trang. Nhật ký và danh sách cấp trước hiển thị lần
lượt 100 và 200 mục mới nhất.

## Thông tin được lưu

Google identity cung cấp mã định danh, email xác minh, tên và ảnh đại diện nếu
có. Backend kiểm tra trạng thái xác minh từ identity trả bởi Supabase Auth,
không dùng `user_metadata` có thể sửa để cấp quyền. Điện thoại/Zalo là tự khai,
**chưa xác minh OTP**. Hệ thống lưu ngày đăng ký, lần đăng nhập và hoạt động gần
nhất, số profile, số lượt Test/Live, giới hạn và nhật ký quản trị. Không thêm
quyền Gmail/Drive, không thu mật khẩu hoặc cookie Google.

Role/status/quota nằm trong bảng backend riêng, không cho `anon` hoặc
`authenticated` đọc/ghi trực tiếp. Các policy đọc dữ liệu theo owner cũng yêu
cầu tài khoản hợp lệ. Admin không được đổi quyền admin khác hoặc tự khóa mình
qua màn hình này; việc quản lý thêm role admin nằm ngoài phiên bản đầu.

Extension cloud chuẩn không chạy độc lập, kể cả Resume/Submit từ lượt local cũ.
File Load unpacked có thể bị người giữ mã nguồn sửa; cơ chế này kiểm soát dịch vụ
cloud và client chuẩn, không phải DRM cho bản local hoặc mã nguồn đã phân phối.

## Kiểm thử

```sh
npm run typecheck
npm test
npm run build:cloud-server
npm run test:cloud-ui
npm run test:access-ui
```

Các bài dùng tài khoản, database và form giả. `test:access-ui` chụp ảnh sáng/tối,
mobile, onboarding và trang quản trị trong `test-results/access-*.png`. Không
thay thế nghiệm thu OAuth/migration/deploy thật. Không chạy fixture hoặc dùng
tài khoản giả trong project Supabase production.
