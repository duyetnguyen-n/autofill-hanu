# Cập nhật website HANU sau này

Website: https://hanu-autofill.onrender.com

[Render của dịch vụ](https://dashboard.render.com/web/srv-db74o9qd0e5s73b25jng/deploys)
đang lấy code từ nhánh `main` của
[repository](https://github.com/duyetnguyen-n/autofill-hanu).
Giữ dịch vụ hiện tại để giữ nguyên URL và cấu hình đã lưu.

## 1. Kiểm tra và đưa code mới lên GitHub

Mở Terminal trong thư mục chứa `package.json`:

```sh
cd /Users/macbook/Downloads/autofill-hanu/autofill-hanu
npm run typecheck
npm test
npm run build:cloud-server
git status --short
```

Sau khi các lệnh kiểm tra thành công, thêm **những file code bạn đã sửa**, rồi
commit và push. Ví dụ nếu bạn sửa `manager/cloud/main.ts`:

```sh
git add manager/cloud/main.ts
git commit -m "Update cloud manager"
git push origin main
```

Không đưa `.env.cloud`, `secrets/`, dữ liệu hồ sơ hay file ZIP riêng tư lên GitHub.
Repo dùng Public Git Repository trên Render nên push chưa tự deploy.

## 2. Dừng sử dụng trước khi deploy

Backend hiện có khóa trong database để chỉ **một server điều phối** hoạt động.
Render khởi động bản mới trước khi tắt bản cũ, vì vậy bấm deploy khi bản cũ
đang chạy có thể báo server khác đang giữ khóa.

Với gói Free đang dùng:

1. Dừng mọi lượt trong trang quản lý; báo người dùng tạm ngừng sử dụng.
2. Đóng các trang quản lý và Chrome profile có extension đang kết nối. Tắt
   công cụ tự ping website nếu có.
3. Chờ Render thực sự spin down: ít nhất 15 phút không có HTTP hoặc WebSocket
   traffic. Kiểm tra trạng thái/log trong dashboard; **không mở URL website
   hoặc `/healthz` trong lúc chờ**, vì thao tác đó có thể đánh thức backend.
4. Chờ thêm 65 giây nếu tiến trình cũ bị dừng đột ngột để khóa database hết hạn.
5. Mở **Manual Deploy → Deploy latest commit** trong Render. Chờ trạng thái
   **Live**, kiểm tra Logs nếu Failed.

Nếu người khác vẫn gửi traffic thì bản cũ chưa ngủ và quy trình trên chưa đủ.
Không xóa khóa `hanu.server_lease` khi server cũ còn sống. Cần host có thể dừng
bản cũ trước khi chạy bản mới, hoặc triển khai chuyển giao coordinator, nếu
muốn cập nhật thường xuyên khi có nhiều người đang dùng.

`Restart service` dùng lại commit và cấu hình đang chạy; để đưa code hoặc biến
môi trường mới lên, dùng deploy. Không cần Clear build cache cho mỗi lần cập nhật.

## 3. Kiểm tra website

Sau khi Render báo Live, mở:

- https://hanu-autofill.onrender.com/healthz — phải trả `{"ok":true}`.
- https://hanu-autofill.onrender.com — thử đăng nhập Google và kết nối extension.

Trong Supabase → Authentication → URL Configuration, giữ:

| Cấu hình | Giá trị |
| --- | --- |
| Site URL | `https://hanu-autofill.onrender.com` |
| Redirect URL | `https://hanu-autofill.onrender.com/auth/callback` |

Trong Google OAuth client, callback vẫn là
`https://fdqpldiyorkqykmwdybh.supabase.co/auth/v1/callback`.
Không phải sửa Supabase/Google mỗi lần deploy nếu URL website không đổi.
Google OAuth đang Testing: chỉ tài khoản trong Test users đăng nhập được;
cần hoàn tất cấu hình và chuyển Production trước khi mời người dùng rộng rãi.

## 4. Khi nào phải gửi lại extension?

Chỉ sửa website/backend mà giao thức extension không đổi thì không cần gửi lại.
Nếu sửa extension hoặc đổi URL website, sửa `PUBLIC_ORIGIN` trong `.env.cloud`,
giữ `HANU_CLOUD_DEV=0`, rồi chạy:

```sh
npm run build:cloud-extension
cat dist-cloud/build-info.json
mkdir -p releases
zip -r releases/hanu-autofill-online.zip dist-cloud
```

Kiểm tra `origin` đúng URL website và `development` là `false`. Trước khi tạo
bản ZIP mới cùng tên, chuyển bản cũ sang tên khác hoặc bỏ bản cũ để tránh ZIP
giữ những file đã bị xóa khỏi extension. Chỉ gửi ZIP chứa `dist-cloud`.
Người nhận giải nén → `chrome://extensions` → Developer mode → Load unpacked
→ chọn thư mục `dist-cloud`, rồi liên kết bằng mã từ website.

## 5. Khi báo thiếu cấu hình

Mở Render → **Environment → Edit**. Các secrets đã lưu ở dịch vụ được giữ qua
các lần deploy, không cần nhập lại mỗi lần. Những biến bắt buộc:

`SUPABASE_URL`, `SUPABASE_PUBLISHABLE_KEY`, `SUPABASE_SECRET_KEY`, `DATABASE_URL`.

Các thiết lập hiện dùng: `HOST=0.0.0.0`, `PORT=3000`, `HANU_CLOUD_DEV=0`,
`TRUST_PROXY=1`, `PGSSLROOTCERT=/etc/secrets/supabase-ca.crt`.
Secret File `supabase-ca.crt` chứa CA công khai tải từ Supabase.
Không đặt `PUBLIC_ORIGIN` trên Render khi dùng URL Render cấp; backend tự đọc
`RENDER_EXTERNAL_URL`. Sau sửa biến, chọn Save only và deploy sau khi bản cũ
đã dừng như mục 2. Không tắt xác minh TLS để xử lý lỗi kết nối.

Render Free có thể ngủ và restart, nên URL miễn phí phù hợp để thử/chia sẻ;
nó không bảo đảm backend luôn sẵn sàng đúng giờ đăng ký.

Nguồn chính thức:
[Render manual deploy và rolling deploy](https://render.com/docs/deploys),
[Render Free spin down](https://render.com/docs/free),
[Supabase redirect URLs](https://supabase.com/docs/guides/auth/redirect-urls).
