# Cập nhật website HANU sau này

**v1.7.3 — sửa thoát đăng nhập giả khi mạng lỗi, bàn giao render và chạy ngay khi có link:**

- Reload extension 1.7.3 trong từng Chrome profile để nhận sửa bàn giao trang.
- Lịch mới mặc định chạy ngay khi nhận link đúng HSK; bỏ chọn nếu cần chờ đúng giờ.
- Không có migration mới.

**v1.7.2 — đọc bài Facebook tới khi sẵn sàng và diễn tập trọn luồng:**
deploy backend/UI và Reload extension trong các profile. Thêm chọn profile
đọc Facebook, dùng lại cửa sổ cùng phiên, hiển thị link bị chặn do sai ngày
và chế độ diễn tập chỉ dùng form thử ghi trong bài. Không có migration mới.

**v1.7.1 — sửa tương thích săn link và cửa sổ Facebook nhỏ (20/10/2026):**
backend kiểm tra khả năng của đúng kết nối trước khi gửi lệnh Facebook, tránh
extension cũ hiểu nhầm là lệnh điều khiển form. Thử hết profile lỗi thì chờ
10 giây trước vòng mới. Cần Reload extension 1.7.1 để có cửa sổ popup riêng
và nút Xem cửa sổ Facebook trên màn quản lý. Không cần migration mới.

**v1.7.0 — đặt lịch săn link theo HSK (20/10/2026):** chạy migration bổ sung
`supabase/migrations/202610200001_registration_schedule.sql` trước khi deploy,
rồi build/Reload extension 1.7.0 vào đúng thư mục cũ. Cấp quyền Facebook tùy chọn
ở một profile theo dõi. Xem [hướng dẫn lịch và kiểm tra link](SCHEDULED-HSK.md).

**v1.5.1 — chuẩn bị ảnh song song và chọn đúng document Picker (18/10/2026):**
build `npm run build:cloud-extension`, giữ đúng origin production, chép vào đúng
thư mục extension đang nạp rồi Reload từng profile. Giữ nguyên ID, liên kết,
hồ sơ và ảnh. Có thêm sửa lịch phục hồi khi timer thức sớm hơn hạn thử lại.
Đợt này chỉ đổi extension, không cần migration hoặc deploy/restart backend.
Xem [kết quả kiểm thử và giới hạn tốc độ](UPLOAD-PIPELINE-20261018.md).

**Bản quản lý người dùng ngày 15/10/2026:** đọc [USER-ACCESS.md](USER-ACCESS.md)
trước khi cập nhật. Bản này cần migration mới, cấu hình email admin đầu tiên
và build/Reload extension cloud; các bước cập nhật thông thường bên dưới
chưa bao gồm ba thay đổi này.

**Bản bỏ bước bổ sung thông tin và thêm Hủy liên kết:** nếu đã cài bản quản lý
người dùng, chỉ chạy thêm `supabase/migrations/202610150002_google_approval_only.sql`
rồi deploy backend/UI theo các bước dưới. Không cần build hoặc Reload extension
cho đợt sửa này. Migration này đã được áp dụng vào Supabase đang cấu hình trong
workspace ngày 15/10/2026; không cần chạy lại ở project đó.

**v1.3.2 — điều khiển extension và tự tiếp tục (16/10/2026):** deploy backend
rồi build `npm run build:cloud-extension`, chép đè đúng thư mục extension đang
nạp và Reload trong từng Chrome profile. Không Remove extension hoặc xóa dữ liệu.
Bản này cần cập nhật extension vì sửa cả background, content và nút điều khiển.

**v1.4.0 — điều khiển và phục hồi có giới hạn (16/10/2026):** xem
[RELIABILITY.md](RELIABILITY.md). Deploy backend rồi build/Reload extension trong
mỗi profile; giữ nguyên ID và dữ liệu. Không cần migration mới. Sau cập nhật,
lượt bị gián đoạn cần Tiếp tục để đối chiếu; không tự gửi lại.

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

## 2. Deploy trực tiếp, không cần đóng website hoặc extension

1. Mở Render của **dịch vụ hiện tại** → **Manual Deploy → Deploy latest commit**.
2. Giữ website và extension mở bình thường. Không cần Suspend/Resume, không cần
   yêu cầu mọi người tắt kết nối hoặc liên kết lại profile.
3. Chờ **Deploy succeeded / Live**, rồi kiểm tra `/readyz` như mục 3.

Backend tự nhận biết môi trường Render qua `RENDER=true`. Nếu server cũ đang
còn giữ khóa, server mới mở HTTP ở trạng thái chờ, chưa nhận lệnh điều khiển.
Sau khi Render chuyển lưu lượng và dừng tiến trình cũ, server mới tự thử lấy
khóa mỗi 2 giây, khôi phục trạng thái rồi nhận kết nối. Khóa vẫn bảo đảm chỉ
một coordinator hoạt động; không xóa khóa hoặc giành quyền của server đang sống.

Trong khoảng chuyển phiên, website có thể hiện “Website đang cập nhật” và tự
thử lại; extension cũng tự nối lại bằng token cũ. Thông thường phải chờ thêm
khoảng một phút sau khi Render chuyển lưu lượng vì Render giữ tiến trình cũ
60 giây trước SIGTERM. Nếu tiến trình cũ bị crash, có thể phải chờ khóa hết hạn
(tối đa 65 giây kể từ lần gia hạn cuối). **Live trên Render chưa có nghĩa là
coordinator đã sẵn sàng; `/readyz` mới xác nhận việc này.**

Lượt điền đang hoạt động có thể bị tạm dừng hoặc cần xác minh kết quả gửi khi
mất kết nối. Hệ thống không tự gửi lại form. Nếu có thể, chọn lúc ít lượt đang
chạy để cập nhật, nhưng không cần yêu cầu mọi người đóng website hay Chrome.

Nếu `/readyz` vẫn trả 503 nhiều phút và log ghi đang chờ coordinator, kiểm tra
có máy khác chạy `npm run cloud` hoặc một backend thứ hai dùng chung Supabase
không; dừng **backend đó**. Các máy chỉ mở website/extension không giữ khóa
coordinator. Không xóa `hanu.server_lease` thủ công, không tạo thêm dịch vụ Render
cho cùng database. Giữ một replica.

`Restart service` dùng lại commit và cấu hình đang chạy; để đưa code hoặc biến
môi trường mới lên, dùng deploy. Không cần Clear build cache cho mỗi lần cập nhật.

## 3. Kiểm tra website

Sau khi Render báo Live, mở:

- https://hanu-autofill.onrender.com/readyz — phải trả `{"ok":true}` (HTTP 200).
- `/healthz` là kiểm tra HTTP cho Render, có thể trả HTTP 200 với
  `{"ok":true,"coordinator":"waiting"}` trong lúc chờ bàn giao; chưa thể nhận lệnh.
- https://hanu-autofill.onrender.com — thử đăng nhập Google và kết nối extension.

Trong Supabase → Authentication → URL Configuration, giữ:

| Cấu hình | Giá trị |
| --- | --- |
| Site URL | `https://hanu-autofill.onrender.com` |
| Redirect URL | `https://hanu-autofill.onrender.com/auth/callback` |

Trong Google OAuth client, callback vẫn là
`https://fdqpldiyorkqykmwdybh.supabase.co/auth/v1/callback`.
Không phải sửa Supabase/Google mỗi lần deploy nếu URL website không đổi.
Kiểm tra Google Auth Platform → Audience hiển thị **In production** trước khi
chia sẻ bản chính thức. Google có ngoại lệ với Testing khi ứng dụng chỉ yêu cầu
quyền định danh cơ bản (email/profile/openid); không áp dụng mô tả “chỉ Test users”
cho mọi loại OAuth. Nếu thêm quyền nhạy cảm hoặc hạn chế, kiểm tra lại yêu cầu
verification và giới hạn của Google trước khi triển khai.

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
`RENDER_EXTERNAL_URL`. Sau sửa biến, chọn Save only rồi Manual Deploy như mục 2. Không tắt xác minh TLS để xử lý lỗi kết nối.

Render Free có thể ngủ và restart, nên URL miễn phí phù hợp để thử/chia sẻ;
nó không bảo đảm backend luôn sẵn sàng đúng giờ đăng ký.

Nguồn chính thức:
[Render manual deploy và rolling deploy](https://render.com/docs/deploys),
[Render Free spin down](https://render.com/docs/free),
[Supabase redirect URLs](https://supabase.com/docs/guides/auth/redirect-urls).
[Google OAuth: trạng thái và ngoại lệ quyền định danh cơ bản](https://developers.google.com/identity/protocols/oauth2/production-readiness/overview).
