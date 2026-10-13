# Triển khai HANU Cloud (Supabase + Node.js)

Bản local dùng SQLite/Native Messaging vẫn giữ nguyên. Bản online dùng Supabase
Auth, PostgreSQL, Storage và một Node.js server điều phối WebSocket. Extension
online vẫn Load unpacked, không cần Chrome Web Store hoặc cài native host.

Nếu chưa có VPS/tên miền, xem [phương án URL miễn phí trên Render](DEPLOY-FREE.md).
Website này cần Node backend thường trực, không chỉ hosting tĩnh.

## 1. Tạo project Supabase mới

Tạo **project riêng** cho HANU, chọn region gần người dùng. Không chạy migration
trong project ứng dụng khác. Lưu mật khẩu database bằng trình quản lý mật khẩu.

Trong SQL Editor chạy `supabase/migrations/202610130001_cloud.sql` một lần. Hoặc
liên kết Supabase CLI và dùng `supabase db push`. Migration tạo schema `hanu`,
RLS, khóa gửi, liên kết extension và bucket private `hanu-private` (10 MB/tệp).
Không bật public cho bucket; không thêm policy public cho ảnh. Không expose
schema `hanu` qua Data API: giao diện/extension chỉ gọi Node backend.

Từ Settings / API Keys lấy Project URL, publishable key (anon key cũ cũng được)
và secret key (service_role cũ cũng được). Secret key **chỉ ở server**.

Từ nút Connect chọn **Session pooler (5432)** để tương thích IPv4 và kết nối
Node thường trực. Đặt VPS gần region database để giảm thời gian giao dịch.
Copy PostgreSQL URI, điền mật khẩu đã URL-encode. Backend
dùng SQL transaction và kiểm tra `owner` ở mọi truy vấn. Kết nối PostgreSQL phải
xác minh chứng chỉ TLS; tải CA certificate trong Supabase nếu môi trường yêu
cầu và đặt `PGSSLROOTCERT`. Không dùng `rejectUnauthorized=false` ở production.

## 2. Bật đăng nhập Google

Trong Google Cloud tạo OAuth client loại Web application, cấu hình consent
screen External. Chỉ dùng `openid`, email, profile. Authorized redirect URI là
`https://PROJECT_REF.supabase.co/auth/v1/callback` (copy đúng từ Google provider
trong Supabase). Lưu Client ID / Client Secret **trong Google provider của
Supabase**, không điền vào extension.

Trong Supabase Authentication:

- Bật Google provider; cho phép người dùng mới đăng ký.
- Tắt Anonymous Sign-ins và các provider không dùng. Tắt email/password nếu
  project mới đang bật. Backend chỉ nhận người dùng có Google identity.
- Site URL: `https://TEN_MIEN_CUA_BAN`.
- Redirect URLs: `https://TEN_MIEN_CUA_BAN/auth/callback` (exact URL).
- Trước khi chia sẻ rộng, chuyển Google consent app khỏi Testing nếu cần cho
  mọi tài khoản đăng nhập; hoàn tất các yêu cầu branding của Google.

Website khởi tạo OAuth/PKCE ở backend, trao đổi code tại `/auth/callback` và lưu
session trong cookie HttpOnly/Secure/SameSite=Lax. Backend xác minh bằng
`supabase.auth.getUser()`; không lấy user ID từ request hoặc JWT chưa xác minh.
Không cần Google login trong từng extension. Google tài khoản đăng nhập website
có thể khác những tài khoản Google được dùng trên Forms.

Tài liệu chính thức:
- https://supabase.com/docs/guides/auth/social-login/auth-google
- https://supabase.com/docs/guides/auth/server-side/creating-a-client
- https://supabase.com/docs/guides/database/connecting-to-postgres

## 3. Cấu hình ứng dụng

Copy `.env.cloud.example` thành `.env.cloud`, thay toàn bộ giá trị `YOUR_...`:

```dotenv
PUBLIC_ORIGIN=https://TEN_MIEN_CUA_BAN
HOST=127.0.0.1
PORT=3000
SUPABASE_URL=https://PROJECT_REF.supabase.co
SUPABASE_PUBLISHABLE_KEY=...
SUPABASE_SECRET_KEY=...
DATABASE_URL=postgresql://postgres.PROJECT_REF:PASSWORD_ENCODED@POOLER_HOST:5432/postgres
HANU_CLOUD_DEV=0
```

Nếu dùng chứng chỉ trong Docker, đặt file ở `secrets/supabase-ca.cer` và
`PGSSLROOTCERT=/run/secrets/supabase-ca.cer`. Khi chạy trên máy trực tiếp, dùng
đường dẫn file trên máy tương ứng.

`.env.cloud` và `secrets/` đã được gitignore/dockerignore. Không đưa chúng vào
ZIP extension, commit, ảnh chụp màn hình hoặc gửi trong chat. Backend trả cấu
hình công khai tối thiểu; không nhúng secrets vào JavaScript website.

## 4. Build và chạy thử

```powershell
npm ci
npm run typecheck
npm test
npm run cloud:check
npm run build:cloud
npm run cloud
```

`build:cloud` đọc `.env.cloud` và tạo:
- `build/cloud-server/main.mjs`: Node server.
- `build/cloud-ui/`: website.
- `dist-cloud/`: extension gắn đúng PUBLIC_ORIGIN.

Nếu chỉ build server/website (chưa có tên miền để đóng gói extension), dùng
`npm run build:cloud-server`; cấu hình project được đọc khi khởi động server.

Không ghi đè `dist/` hoặc `build/manager-ui/` của bản local. Website/API/WSS dùng
cùng một origin. Nếu thử HTTP localhost, đặt `HANU_CLOUD_DEV=1` và thêm redirect
URL localhost tương ứng trong Supabase. Không phân phối build localhost cho
người khác. Chrome tối thiểu 116.

## 5. Đưa lên VPS Linux

Trỏ DNS domain về VPS, cho phép cổng 80/443, cài Docker + Compose. Copy source
và `.env.cloud` riêng lên máy. Chạy từ thư mục gốc repository:

```sh
docker compose -f deploy/cloud/compose.yaml up -d --build
docker compose -f deploy/cloud/compose.yaml ps
```

Caddy cấp HTTPS và chuyển tiếp WebSocket. Backend không publish cổng ra
Internet. Compose bật TRUST_PROXY chỉ vì app nằm sau Caddy trên network riêng;
khi chạy trực tiếp giữ TRUST_PROXY=0 để không tin header IP do client gửi.
Không bật access log chứa cookie hoặc payload; log backend không
in thông tin hồ sơ, token hay ảnh. Kiểm tra `/healthz`, đăng nhập Google thật,
thêm hai tài khoản để xác minh tách dữ liệu trước khi chia sẻ rộng.

**V1 chỉ chạy một backend replica.** Lease trong database ngăn hai coordinator
cùng cấp quyền chạy/gửi. Sau server crash phải chờ tối đa 65 giây cho lease hết
hạn. Khởi động lại sẽ đánh dấu disconnected/paused hoặc submit_uncertain;
không tự Resume. PostgreSQL bị lỗi hoặc mất lease sẽ ngừng cấp lệnh. Khi phục
hồi, restart backend và đối chiếu trước khi tiếp tục.

## 6. Phân phối extension

Build `dist-cloud/` với tên miền production, nén nguyên thư mục này và gửi ZIP.
Không nén repository hay `.env.cloud`. Người nhận giải nén, vào
`chrome://extensions`, bật Developer mode, Load unpacked thư mục đã giải nén.
Website: đăng nhập -> Thêm profile -> Tạo mã -> nhập mã trong extension.

ID unpacked có thể khác ở từng máy; mã một lần + token profile mới là credential.
Server bind token với ID extension khi liên kết. Cài lại/đổi thư mục: ngắt liên
kết profile cũ trên website, mở Chi tiết -> Liên kết lại. Cách này giữ profile
ID, ảnh, lịch sử và khóa gửi, cấp token mới cho extension mới. Không tạo profile
mới để bỏ qua khóa gửi. Nếu hồ sơ extension khác cloud, chọn bản cần giữ rồi
đồng bộ. Không chạy extension local và online cùng điều khiển một Chrome profile.

Đăng xuất website hủy web session và đóng kênh quản lý; không hủy các lượt đã
được bắt đầu hoặc thu hồi token extension. Ngắt liên kết profile sẽ dừng kết
nối extension và thu hồi token, giữ dữ liệu/historic locks.

## 7. Kiểm thử và dữ liệu hiện tại

```powershell
npm run test:cloud-ui
npm run test:cloud-flow
npm run test:manager-ui
```

Kiểm thử cloud dùng PostgreSQL WASM (PGlite), auth/object fixtures và WebSocket
thật. Không gọi tài khoản Google thật hoặc upload ảnh cá nhân. Nó kiểm tra SQL,
RLS, tách owner, token revocation, lock transactions, restart recovery, UI login
và đổi tài khoản. Không thay thế nghiệm thu với Supabase/Google thực sau khi
điền credentials và trên Chrome thật.

Dữ liệu local không tự upload. Dừng các lượt hiện tại, ở app local bấm **Xuất
dữ liệu**, giữ file JSON riêng (có thông tin cá nhân/ảnh), rồi đăng nhập website
bấm **Nhập từ bản local**. Bản xuất chứa hồ sơ, ảnh, lịch sử và khóa gửi, không
chứa token extension. Giới hạn file 64 MB, mỗi ảnh 10 MB. Nhập là một transaction:
không ghi đè dữ liệu đã có, không tự chạy hoặc bỏ khóa. Nếu lỗi, dữ liệu local
vẫn giữ nguyên; một số object chưa được tham chiếu có thể cần dọn trên Storage.
Mở Chi tiết của profile đã nhập -> Liên kết lại bằng extension online -> chọn
bản cloud khi có xung đột -> đồng bộ. Giữ profile ID để giữ khóa đã gửi. Đổi
folder/extension ID có thể tạo Chrome storage mới, nên dùng luồng xuất/nhập này
thay vì chỉ copy tên/thông tin. Ảnh đã đồng bộ được lưu vào extension mới khi Push.

Sao lưu PostgreSQL và Storage riêng: ảnh không nằm trong database backup. Giữ
các bản sao lưu có mã hóa ngoài VPS; kiểm tra restore database + objects vào
môi trường riêng trước khi dùng để phục hồi production. Đổi key/DB password
khi lộ credentials. Không xóa lock để xử lý sự cố kết nối.

Nếu app local đang mở và Windows khóa `native-host.exe`, build source/server/UI
cho việc kiểm thử bằng `npm run build:manager:assets` (không ghi đè EXE đang dùng).
Để dùng API Xuất dữ liệu mới, mở lại bộ điều phối local với mã vừa build khi
không có lượt đang chạy. Không cần Reload các extension local để dùng nút Xuất.
