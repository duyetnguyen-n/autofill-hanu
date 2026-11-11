import { anchor as a, control as c, flow, step as s } from "./walkthrough-types";

const menu = s(a('[data-guide-target="account-menu"]'), "Mở Tài khoản và công cụ", "Mở menu ở đầu trang.", { advance: "visible", assist: true });
const users = s(c("Người dùng", ".admin-sidebar, .admin-mobile-nav"), "Mở Người dùng", "Mở danh sách người dùng để tìm đúng tài khoản.", { advance: "visible", assist: true });
const find = s(a('[aria-label="Tìm người dùng"]'), "Tìm theo tên hoặc email", "Dùng tìm kiếm và lọc trạng thái. Đối chiếu email đầy đủ trước khi mở chi tiết.");
const detail = s(c(/^(Chi tiết|Xét duyệt)$/, ".admin-list-surface", ".admin-list-surface"), "Mở chi tiết tài khoản", "Mở đúng dòng theo email đã kiểm tra.", { advance: "click" });
const access = s(c("Quyền sử dụng", ".admin-detail-tabs"), "Mở Quyền sử dụng", "Kiểm tra danh tính và tình trạng quyền của tài khoản.", { advance: "visible", assist: true });
const detailFallback = { anchor: a(".admin-list-toolbar, .admin-detail-identity"), detail: "Mở Người dùng và chọn Chi tiết đúng tài khoản. Kiểm tra email, vai trò và quyền hiện có trước khi thay đổi." };
const admin = { admin: true, fallback: detailFallback };
const role = a(".admin-role-section");
const save = s(c("Lưu quyền sử dụng", ".admin-drawer"), "Kiểm tra rồi lưu quyền", "Kiểm tra đúng email và thay đổi trước khi lưu. Đọc phản hồi và đối chiếu trạng thái mới.", { advance: "click" });
const saved = s(a(".admin-drawer .access-notice"), "Đọc kết quả lưu", "Kiểm tra thông báo và đối chiếu quyền, hạn và trạng thái được tải lại từ máy chủ.", { optional: true });
const tabs = ".kv-tabs";
const map = s(c("Bản đồ vector", tabs), "Mở Bản đồ vector", "Chọn tab Bản đồ vector.", { advance: "visible", assist: true });
const docs = s(c("Tài liệu", tabs), "Mở Tài liệu", "Chọn tab Tài liệu để xem danh mục và các thao tác được cấp quyền.", { advance: "visible", assist: true });
const notice = s(a(".kv-notice"), "Đọc kết quả kho tri thức", "Đối chiếu thông báo với đúng tài liệu và số đoạn đã lập chỉ mục.", { optional: true });

export const systemWalkthroughs = [
  flow("CH-01", "account", "Đăng nhập HANU lần đầu", ["đăng nhập hanu lần đầu", "cách đăng nhập hanu", "tài khoản chờ duyệt"], [
    s(a(".account-surface"), "Kiểm tra trạng thái tài khoản", "Đối chiếu email Google đã xác minh, trạng thái duyệt và quyền sử dụng. Nếu đang chờ duyệt, bấm Kiểm tra trạng thái sau khi quản trị viên duyệt."),
  ]),
  flow("CH-03", "common", "Chuyển sang ứng dụng khác", ["chuyển sang ứng dụng khác", "đổi ứng dụng", "chọn ứng dụng khác"], [
    menu, s(a(".wh-product-links, .guide-account-apps"), "Chọn ứng dụng muốn mở", "Chọn Google Forms, Direct, HCMUE hoặc ChineseTest trong các mục hiện có. Khung chat sẽ tiếp tục sau khi chuyển."),
  ]),
  flow("CH-04", "common", "Tìm hướng dẫn hoặc gói cài đúng máy", ["gói cài đúng máy", "hướng dẫn kết nối", "tìm gói cài"], [
    s(a(".wh-guide"), "Mở hướng dẫn của ứng dụng", "Tại trang tải, chọn đúng ứng dụng, hệ điều hành và kiến trúc của máy cần cài. Đọc các bước cài, kết nối và xác minh thiết bị.", { external: true }),
  ], { fallback: { anchor: a(".workspace-header, .guide-account-apps, .access-topbar"), detail: "Mở Google Forms, HCMUE hoặc ChineseTest rồi chọn Hướng dẫn trong thanh công cụ của ứng dụng." } }),
  flow("CH-05", "common", "Đổi giao diện sáng hoặc tối", ["đổi giao diện sáng tối", "đổi giao diện", "bật dark mode", "chế độ tối"], [
    s(a('.wh-icon-button[aria-label^="Đổi giao diện"]'), "Đổi giao diện sáng hoặc tối", "Bấm nút hình mặt trời hoặc mặt trăng trên thanh đầu trang. Đối chiếu màu nền sau khi đổi."),
  ]),
  flow("CH-06", "common", "Đăng xuất hoặc đổi tài khoản HANU", ["đăng xuất hanu", "đổi tài khoản hanu", "đăng xuất khỏi hanu"], [
    menu, s(c("Đăng xuất", ".workspace-tools-dialog, .access-topbar"), "Đăng xuất tài khoản hiện tại", "Kiểm tra email trong menu. Sau khi đăng xuất, chọn đúng tài khoản Google ở màn đăng nhập."),
  ]),
  flow("CH-07", "common", "Xử lý lỗi hoặc trạng thái đang thấy", ["lỗi đang thấy", "xử lý thông báo lỗi", "giải thích trạng thái", "tại sao nút bị khóa"], [
    s(a(".hc-alert-card, .hc-notice-trigger, .fui-MessageBar, .banner.error, .ct-error, .kv-error, .access-error", "main"), "Mở thông báo hoặc báo cáo đúng đối tượng", "Tìm mã lỗi, thời điểm và hướng xử lý. Đối chiếu profile, người thi hoặc lịch liên quan. Nếu lỗi phát sinh ngoài HANU, kiểm tra ở đúng extension, Runner hoặc website của trường."),
  ], { fallback: { anchor: a("main h1"), detail: "Hiện chưa thấy thông báo lỗi trên màn này. Mở chi tiết lượt, báo cáo API hoặc nhật ký của đối tượng bị lỗi." } }),
  flow("QT-02", "admin", "Tìm người dùng và xem chi tiết", ["tìm người dùng", "chi tiết tài khoản", "tìm người dùng quản trị"], [
    users, find, detail, s(a(".admin-detail-tabs"), "Chọn thông tin cần xem", "Mở Quyền sử dụng, Profile hoặc Nhật ký của đúng tài khoản."),
  ], admin),
  flow("QT-03", "admin", "Duyệt, khóa, từ chối hoặc gia hạn tài khoản", ["duyệt tài khoản", "khóa tài khoản", "từ chối tài khoản", "gia hạn tài khoản"], [
    users, find, detail, access, s(a(".admin-detail-body select"), "Chọn trạng thái và hạn", "Kiểm tra yêu cầu duyệt và email. Chọn trạng thái mong muốn. Khi gia hạn, nhập hạn mới."),
    save, s(c("Xác nhận", ".admin-confirm"), "Đọc xác nhận thay đổi", "Khóa hoặc từ chối có thể dừng lượt đang chạy. Chỉ xác nhận nếu đúng tài khoản và đúng phạm vi.", { optional: true, advance: "click" }), saved,
  ], admin),
  flow("QT-04", "admin", "Chỉnh hạn mức hoặc quyền Live", ["chỉnh hạn mức", "cấp quyền live", "đổi quyền live", "đổi hạn mức profile"], [
    users, find, detail, access,
    s(a('.admin-detail-body input[type=number], .admin-detail-body input[type=checkbox]', ".admin-detail-body"), "Kiểm tra hạn mức và Live", "Điền hạn mức profile và chạy đồng thời. Chỉ bật Live khi tài khoản được phép đăng ký thật. Xem hạn và ghi chú nội bộ."),
    save, saved,
  ], admin),
  flow("QT-05", "admin", "Cấp quyền quản trị", ["cấp quyền quản trị", "bổ nhiệm quản trị viên"], [
    users, find, detail, access,
    s(c("Cấp quyền quản trị", ".admin-role-section"), "Kiểm tra điều kiện cấp quyền", "Đối chiếu email đã xác minh và tài khoản hoạt động. Đọc lý do ngay cạnh nút nếu bị khóa.", { advance: "visible" }),
    s(c("Xác nhận cấp quyền quản trị", ".admin-confirm"), "Xác nhận đúng email", "Quản trị viên mới có thể sửa quyền và bổ nhiệm người khác. Kiểm tra đúng email trước khi tự xác nhận."),
  ], { admin: true, fallback: { anchor: role, detail: "Mở chi tiết tài khoản và tab Quyền sử dụng. Kiểm tra vai trò hiện tại, xác minh email và trạng thái hoạt động." } }),
  flow("QT-06", "admin", "Cấp trước hoặc gỡ quyền theo email", ["quyền cấp trước", "cấp trước theo email", "gỡ quyền cấp trước", "thu hồi quyền cấp trước"], [
    s(c(/^Cấp trước$|^Quyền cấp trước$/, ".admin-sidebar, .admin-mobile-nav"), "Mở danh sách cấp trước", "Tìm email đang chờ. Đối chiếu toàn bộ địa chỉ Google trước khi cấp hoặc gỡ.", { advance: "visible" }),
    s(c(/^Cấp quyền trước$|^Thêm email Google$|^Thu hồi$/, ".admin-heading, .admin-list-surface", ".admin-list-surface"), "Chọn cấp hoặc gỡ quyền", "Thêm email để cấp mới. Nếu gỡ, chọn đúng dòng đang chờ rồi bấm Thu hồi.", { advance: "click" }),
    s(a(".admin-grant-dialog, [data-walk=admin-revoke-grant]"), "Đối chiếu email trước khi xác nhận", "Kiểm tra email, hạn, hạn mức và Live. Nếu gỡ, kiểm tra hộp xác nhận hiển thị đúng email."),
  ], { admin: true }),
  flow("QT-07", "admin", "Thu hồi liên kết một profile", ["thu hồi liên kết profile", "thu hồi profile", "gỡ liên kết profile của người dùng"], [
    users, find, detail, s(c(/^Profile \(/, ".admin-detail-tabs"), "Mở Profile của tài khoản", "Kiểm tra tên, kết nối và mã extension để chọn đúng profile.", { advance: "visible" }),
    s(c("Thu hồi", ".admin-session-list", ".admin-session-list"), "Chọn đúng liên kết", "Chỉ mở Thu hồi trên profile cần xử lý.", { advance: "visible" }),
    s(a(".admin-confirm"), "Đọc xác nhận thu hồi", "Kiểm tra đúng profile. Chỉ tự xác nhận nếu đã kiểm tra các lượt đang chạy."),
  ], admin),
  flow("QT-08", "admin", "Xem nhật ký thay đổi", ["nhật ký quản trị", "xem thay đổi quyền", "nhật ký thay đổi"], [
    s(c(/^Nhật ký(?: quản trị)?$/, ".admin-sidebar, .admin-mobile-nav, .admin-detail-tabs"), "Mở Nhật ký", "Chọn Nhật ký quản trị để xem toàn hệ thống. Để xem một tài khoản, mở Chi tiết rồi chọn Nhật ký.", { advance: "visible" }),
    s(a('.admin-list-surface[aria-label="Nhật ký quản trị"], .admin-drawer:has([aria-selected=true][data-walk-tab=history]) .admin-detail-body'), "Đối chiếu thay đổi", "Kiểm tra thời điểm, người thực hiện và thao tác được ghi lại."),
  ], { admin: true }),
  flow("KT-01", "knowledge", "Mở kho và tìm tài liệu", ["tìm tài liệu", "tìm trong kho tri thức", "mở kho và tìm tài liệu"], [
    map, s(a('[aria-label="Tìm tài liệu"]'), "Tìm tài liệu theo tiêu đề", "Nhập tiêu đề và dùng bộ lọc Phạm vi để chọn ứng dụng."),
    s(a(".kv-library-list button, .kv-library button", ".kv-library"), "Chọn nguồn tài liệu", "Chọn tài liệu khớp nội dung, rồi đọc đoạn và mở tài liệu gốc khi cần."),
  ]),
  flow("KT-02", "knowledge", "Khám phá bản đồ 3D và 2D", ["khám phá bản đồ vector", "dùng bản đồ 3d", "xoay bản đồ vector", "khám phá bản đồ 2d"], [
    map, s(c(/^3D$|^2D$/, ".kv-explorer", ".kv-explorer"), "Chọn 3D hoặc 2D", "Dùng 3D để xoay và thu phóng, hoặc chọn 2D. Có thể đặt lại góc nhìn."),
    s(a(".kv-explorer canvas, .kv-node, .kv-map-empty, .kv-explorer h3", ".kv-explorer"), "Chọn điểm trên bản đồ", "Chọn một điểm để đọc đoạn gốc. Nếu bản đồ trống, cần có tài liệu đã lập chỉ mục."),
    s(a('[aria-label="Đoạn đang xem"]'), "Đọc đoạn đã chọn", "Đọc nội dung và phạm vi của đoạn. Mở nguồn gốc để kiểm tra ngữ cảnh.", { optional: true }),
  ]),
  flow("KT-03", "knowledge", "Thêm và xuất bản tài liệu", ["thêm tài liệu", "xuất bản tài liệu", "tải tài liệu vào kho"], [
    docs, s(a(".kv-editor form textarea"), "Nhập tài liệu và phạm vi", "Chọn ứng dụng, nhập nội dung hoặc tải tệp Markdown/TXT. Chỉ dùng tài liệu có thể chia sẻ cho người dùng HANU."),
    s(a(".kv-preview > summary"), "Kiểm tra các đoạn xem trước", "Mở xem trước và kiểm tra mỗi đoạn đủ ngữ cảnh. Tách bớt nếu quá giới hạn."),
    s(c("Xuất bản", ".kv-editor"), "Xác nhận xuất bản", "Kiểm tra tiêu đề, nội dung và phạm vi, rồi tự bấm Xuất bản."), notice,
  ], { admin: true }),
  flow("KT-04", "knowledge", "Lập chỉ mục bài hướng dẫn có sẵn", ["lập chỉ mục bài có sẵn", "lập chỉ mục hướng dẫn", "index hướng dẫn"], [
    docs, s(c("Lập chỉ mục bài có sẵn", ".kv-register"), "Lập chỉ mục hướng dẫn", "Bấm để tạo vector cho các bài tích hợp. Nếu khóa, kiểm tra OpenRouter hoặc chờ thao tác đang chạy.", { advance: "click" }), notice,
  ], { admin: true }),
  flow("KT-05", "knowledge", "Tạo vector cho tài liệu đã đăng", ["tạo vector cho tài liệu", "lập chỉ mục tài liệu", "tài liệu thiếu vector"], [
    docs, s(c("Tạo vector", ".kv-register-list", ".kv-register-list"), "Chọn đúng tài liệu thiếu vector", "Đối chiếu tiêu đề, phạm vi và số đoạn. Bấm Tạo vector trên đúng dòng rồi kiểm tra số đoạn đã tạo."), notice,
  ], { admin: true, fallback: { anchor: a(".kv-register"), detail: "Nút Tạo vector chỉ xuất hiện với tài liệu đang xuất bản và còn đoạn thiếu vector. Kiểm tra số đoạn và cấu hình OpenRouter." } }),
  flow("KT-06", "knowledge", "Ẩn tài liệu khỏi truy xuất", ["ẩn tài liệu", "gỡ tài liệu khỏi truy xuất"], [
    docs, s(c("Ẩn", ".kv-register-list", ".kv-register-list"), "Đối chiếu đúng tài liệu", "Kiểm tra tiêu đề và phạm vi trước khi tự bấm Ẩn. Đọc trạng thái Đã ẩn khỏi truy xuất trên đúng dòng."), notice,
  ], { admin: true }),
  flow("KT-07", "knowledge", "Thử và so sánh truy xuất", ["thử truy xuất", "so sánh truy xuất", "kiểm tra truy xuất vector"], [
    s(c("Thử truy xuất", tabs), "Mở Thử truy xuất", "Chọn Thử truy xuất trong kho tri thức.", { advance: "visible", assist: true }),
    s(a(".kv-lab form input:not([type=checkbox])"), "Nhập câu hỏi thử", "Chọn xếp hạng lại nếu muốn và đã cấu hình OpenRouter."),
    s(c("So sánh kết quả", ".kv-lab"), "Chạy so sánh", "Bấm để đọc kết quả của cùng một câu hỏi qua từ khóa, vector và kết hợp.", { advance: "click" }),
    s(a(".kv-results"), "Đối chiếu nguồn", "So sánh các kết quả và mở đoạn gốc để kiểm tra. Xem thông báo nếu chưa dùng được embedding hoặc xếp hạng lại."),
  ], { admin: true }),
];
