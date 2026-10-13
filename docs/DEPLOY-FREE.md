# Có website để chia sẻ, không cần mua tên miền

Dự án này chạy **website + API + WebSocket trên một Node.js backend**. Supabase
cung cấp đăng nhập Google, PostgreSQL và kho ảnh; Supabase không chạy server
Node của ứng dụng. Chỉ upload `build/cloud-ui` lên hosting tĩnh sẽ thiếu API và
kênh kết nối extension.

Phương án thử miễn phí: **Render Web Service + Supabase Free**, dùng URL HTTPS
do Render cấp, ví dụ `https://ten-app.onrender.com`. Đây là subdomain miễn phí,
đủ để gửi cho người khác truy cập; không cần mua domain hoặc tự cấu hình DNS.
Website/API/WSS phải dùng cùng URL này. Extension được build với URL cố định.

Website của dự án: **https://hanu-autofill.onrender.com**.
Sau lần thiết lập đầu, xem [cách cập nhật và deploy lại](DEPLOY-AGAIN.md).

## 1. Chuẩn bị Supabase

1. Tạo project riêng cho HANU, ưu tiên region Singapore nếu người dùng ở Việt Nam.
2. Mở SQL Editor, chạy toàn bộ `supabase/migrations/202610130001_cloud.sql`
   **một lần**. Nếu báo bảng đã tồn tại, kiểm tra lần chạy trước thay vì xóa bảng
   hoặc chạy lại trên project đang có dữ liệu. Giữ bucket `hanu-private` private.
3. Lấy Project URL, publishable/anon key, secret/service_role key trong phần API
   của project. Secret key chỉ điền ở backend, không gửi trong ZIP extension.
4. Bấm **Connect → Session pooler**, copy PostgreSQL URI cổng **5432**.
   Thay password placeholder bằng mật khẩu database đã URL-encode. Không dùng
   mật khẩu tài khoản đăng nhập Supabase. Xem [hướng dẫn đầy đủ](CLOUD.md) về TLS.
5. Trong Google Cloud tạo OAuth client **Web application**. Redirect URI của
   Google là `https://PROJECT_REF.supabase.co/auth/v1/callback` (copy từ Google
   provider trong Supabase). Điền Google Client ID/Secret vào Supabase
   Authentication → Providers → Google và bật provider.
6. Trong Supabase Authentication → URL Configuration, sau khi có URL Render:
   - Site URL: `https://URL_THAT.onrender.com`
   - Redirect URLs: `https://URL_THAT.onrender.com/auth/callback`
   Hai callback trên khác nhau: Google trả về Supabase; Supabase trả về website.
   Khi Google OAuth app còn Testing, kiểm tra yêu cầu Test users theo scopes:
   quyền định danh cơ bản email/profile/openid có ngoại lệ. Hoàn tất cấu hình
   và chuyển sang Production cho bản chính thức theo yêu cầu của Google.

## 2. Deploy Render Web Service

Đưa mã nguồn trong **thư mục chứa `package.json`** lên repository GitHub riêng.
Workspace hiện có một thư mục `autofill-hanu` lồng bên trong; không đưa
`__MACOSX`, `node_modules`, runtime, dữ liệu cá nhân hoặc `.env.cloud` lên repo.

Trong Render chọn **New → Web Service**, nối repo, chọn:

| Trường | Giá trị |
| --- | --- |
| Language / Runtime | Docker |
| Dockerfile Path | `deploy/cloud/Dockerfile` |
| Docker Build Context | `.` |
| Region | Singapore (gần region Supabase) |
| Instance Type | Free để thử |
| Auto Deploy | Off |
| Health Check Path | `/healthz` |

Dockerfile đã build website/backend, dùng Node 24 và chạy server. Không cần
Caddy hoặc Compose trên Render vì Render cung cấp HTTPS và chuyển tiếp WSS.
Nếu dùng Blueprint thì `render.yaml` chứa các thiết lập tương ứng.

Điền các Environment Variables dưới đây. Khi chạy trên Render, có thể **không
đặt `PUBLIC_ORIGIN`**: backend tự lấy URL HTTPS thật từ `RENDER_EXTERNAL_URL`
do Render cấp. Không cần đoán URL trước deploy. Nếu có domain riêng thì đặt
`PUBLIC_ORIGIN` rõ ràng; nếu đã đặt placeholder `YOUR_DOMAIN`, phải xóa nó.

```dotenv
HOST=0.0.0.0
PORT=3000
HANU_CLOUD_DEV=0
TRUST_PROXY=1
SUPABASE_URL=https://PROJECT_REF.supabase.co
SUPABASE_PUBLISHABLE_KEY=...
SUPABASE_SECRET_KEY=...
DATABASE_URL=postgresql://postgres.PROJECT_REF:PASSWORD_ENCODED@POOLER_HOST:5432/postgres
```

`TRUST_PROXY=1` ở đây chỉ dành cho backend sau proxy của Render. Nếu PostgreSQL
báo lỗi chứng chỉ, thêm CA certificate tải từ Supabase bằng Render Secret File
và đặt `PGSSLROOTCERT` tới đúng đường dẫn secret file đó. Không tắt xác minh TLS.

Sau deploy, copy URL thật Render cấp vào Site URL/Redirect URLs trong Supabase
và `.env.cloud` trên máy trước khi build extension. Bản extension vẫn cần
`PUBLIC_ORIGIN` rõ ràng; chỉ backend trên Render tự lấy URL của platform.

## 3. Kiểm tra và gửi extension

Trên máy phát triển, copy `.env.cloud.example` thành `.env.cloud`, điền cùng
cấu hình Supabase và URL Render; để HOST/PORT theo cách chạy trên máy. Chạy:

Nếu không muốn tự URL-encode mật khẩu database, sau khi điền URI Session pooler
vào `.env.cloud`, chạy `npm run cloud:configure-password`, mở URL localhost được
in ra và nhập mật khẩu hiện có. Công cụ tự encode và lưu `.env.cloud` với quyền
600; không đổi mật khẩu trên Supabase. Ô nhập hết hạn sau 15 phút.

```sh
npm run cloud:check
npm run build:cloud-extension
```

`cloud:check` chỉ đọc: kiểm tra kết nối PostgreSQL/TLS, các bảng/RLS, bucket
private, public key/Google provider và quyền secret key đọc cấu hình Storage.
Lệnh không lấy lease, không khôi phục/dừng lượt, không đọc hồ sơ hoặc ảnh.
Nó chưa xác nhận Google OAuth callback hoặc quyền upload hoạt động thực tế.

`build:cloud-extension` chỉ tạo `dist-cloud`, không cần build lại website.
Kiểm tra `dist-cloud/build-info.json`: `origin` phải đúng URL website, `development`
phải là `false`. Nén **chỉ thư mục `dist-cloud`** để gửi, không nén toàn repo.
Không gửi bản extension localhost sinh ra từ kiểm thử cloud-flow.

Mở website → đăng nhập Google → Thêm profile → Tạo mã liên kết. Người nhận
giải nén extension, vào `chrome://extensions`, bật Developer mode, Load
unpacked rồi nhập mã trong đúng Chrome profile. Bản online không cần app local.

Trước khi gửi rộng: `/healthz` trả `{"ok":true}`, Google login/callback thật
hoạt động, hai tài khoản không thấy dữ liệu của nhau, upload **ảnh giả** và lưu/
đồng bộ thành công, extension kết nối lại sau khi Chrome đóng/mở. Không bấm Live
trên form thật để kiểm thử hosting.

## 4. Giới hạn cần hiểu trước khi dùng

- Render Free ngủ sau 15 phút không có lưu lượng vào (HTTP hoặc WebSocket),
  lần mở tiếp theo có thể mất khoảng một phút. Render có thể restart dịch vụ;
  đây là lựa chọn thử/demo, không bảo đảm sẵn sàng vào đúng giờ đăng ký.
- Supabase Free hiện có 500 MB database, 1 GB Storage, và có thể pause sau một
  tuần không hoạt động. Dữ liệu/ảnh của mọi người dùng chung quota project.
- Backend **chỉ có một coordinator hoạt động**, không bật autoscale/multiple
  replicas. Khóa database vẫn bảo vệ chống hai backend cùng cấp quyền gửi.
- **Redeploy trên Render có thể thất bại khi bản cũ đang chạy**: Render khởi
  động bản mới trước khi tắt bản cũ, còn bản mới không được lấy lease của bản cũ.
  Giữ Auto Deploy Off. Xem [quy trình Suspend → Resume → Manual Deploy đã thử
  trên dịch vụ này](DEPLOY-AGAIN.md#2-dừng-sử-dụng-trước-khi-deploy).
  Hoặc khi thử bản miễn phí, dừng mọi lượt, đóng trang quản lý và
  các Chrome profile đã liên kết, đợi bản cũ thực sự spin down (ít nhất 15 phút
  không có traffic), rồi manual deploy; sau server crash lease cần tối đa thêm
  65 giây để hết hạn. Đừng xóa lease thủ công khi server cũ còn sống.
  Nếu cần cập nhật ổn định/chạy chính thức, dùng một host cho phép dừng tiến
  trình cũ trước khi khởi động bản mới (ví dụ VPS + Compose trong `CLOUD.md`),
  hoặc bổ sung cơ chế chuyển giao coordinator trước khi dùng rolling deploy.

Không cần mua domain kể cả khi chuyển sang hosting trả phí có subdomain. Chi
phí domain và chi phí giữ backend luôn chạy là hai việc riêng.

Nguồn chính thức (kiểm tra ngày 13/10/2026):

- [Render Web Services: URL, HTTPS và Docker](https://render.com/docs/web-services)
- [Render WebSocket](https://render.com/docs/websocket)
- [Render Free: sleep và giới hạn](https://render.com/docs/free)
- [Render rolling deploy](https://render.com/docs/deploys#zero-downtime-deploys)
- [Supabase Free quota](https://supabase.com/pricing)
- [Supabase PostgreSQL/session pooler](https://supabase.com/docs/guides/database/connecting-to-postgres)
- [Supabase Google OAuth](https://supabase.com/docs/guides/auth/social-login/auth-google)
