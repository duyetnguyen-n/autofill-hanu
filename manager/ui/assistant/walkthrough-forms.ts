import { anchor as a, control as c, flow, step as s, type WalkStep } from "./walkthrough-types";

const list = a("#profile-list .list-toolbar");
const choose = s(c("Chi tiết", "#profile-list", "#profile-list"), "Chọn đúng profile", "Tìm theo tên hoặc email, rồi bấm Chi tiết ở đúng dòng.", { advance: "click" });
const schedule = a(".schedule-panel");
const source = s(c("Nguồn link và thời gian chờ", ".schedule-panel"), "Mở nguồn link", "Mở phần thiết lập nguồn link và thời gian chờ.", { advance: "visible" });
const mode = a('#registration-controls select');
const wait = c(/^Chuẩn bị (Test|Live) & chờ link$/, ".schedule-footer");
const verify = s(a(".hsk-answer-line", ".schedule-levels"), "Kiểm tra câu xác thực của đúng HSK", "Chọn hàng của cấp thi cần sửa. Nếu chưa có câu, bấm Lấy câu xác thực sau khi form đã chặn lượt.");
const selected = s(a("#profile-list input[type=checkbox]", "#profile-list"), "Chọn các profile cần chạy", "Kiểm tra tên, email và trạng thái từng dòng. Chỉ tích những profile thuộc lượt này.");
const formsFallback = { anchor: list, detail: "Tìm đúng profile trong danh sách. Nếu chưa có, liên kết Chrome profile trước. Nếu đã lọc danh sách, hãy xóa bộ lọc." };
const scheduleFallback = { anchor: list, detail: "Chọn profile đã chuẩn bị và gán cấp HSK trước. Kiểm tra tab và trạng thái lượt hiện tại nếu phần thiết lập chưa xuất hiện." };
const draftLink = a('input[aria-label^="Link HSK"]', ".schedule-levels");
const scheduleResult = s(a("#run-monitor, .schedule-panel .status"), "Đọc trạng thái từng lượt", "Kiểm tra lượt đang chờ link, đang điền, dừng trước Gửi hoặc đã có kết quả. Nếu chưa rõ đã gửi, đối chiếu trước khi chạy lại.", { optional: true });
const download = s(a('a.wh-guide[href*="extension-downloads"]'), "Mở hướng dẫn cài extension", "Tải và giải nén gói phù hợp. Mở chrome://extensions trong đúng Chrome profile, bật Chế độ nhà phát triển, chọn Tải tiện ích đã giải nén, rồi mở HSK Autofill Online.", { external: true });

export const formsWalkthroughs = [
  flow("GF-01", "forms", "Cài extension lần đầu", ["cài extension", "tải extension", "cài tiện ích chrome"], [
    download, s(a('[data-guide-target="pair-open"]'), "Liên kết sau khi cài", "Khi HSK Autofill Online mở được trong Chrome, quay lại và dùng Thêm profile để lấy mã liên kết.", { optional: true }),
  ]),
  flow("GF-03", "forms", "Kết nối lại profile cũ", ["kết nối lại profile", "liên kết lại profile", "profile bị mất kết nối"], [
    choose, s(c("Kiểm tra kết nối", ".drawer"), "Kiểm tra kết nối", "Nếu nút dùng được, bấm kiểm tra phản hồi. Nếu mất kết nối, mở extension trong đúng Chrome profile và kiểm tra tài khoản HANU.", { optional: true }),
    s(c("Thao tác khác", ".drawer"), "Mở thao tác của profile", "Trên điện thoại, mở Thao tác khác để thấy nút Liên kết lại.", { optional: true, advance: "visible" }),
    s(c("Liên kết lại", ".drawer, .profile-action-popover"), "Liên kết lại khi cần", "Chỉ dùng nếu extension chưa kết nối với phiên cũ. Mở hộp liên kết ở đúng profile.", { optional: true, advance: "visible" }),
    s(a('[data-guide-target="pair-create"]'), "Tạo mã cho phiên hiện có", "Tạo mã, dán vào HSK Autofill Online trên đúng Chrome profile và chờ website nhận kết nối.", { optional: true, advance: "visible" }),
    s(a(".pair-feedback.connected"), "Kiểm tra kết nối đã khôi phục", "Xem HANU báo đã liên kết và đối chiếu tên profile. Sau đó kiểm tra hồ sơ đồng bộ.", { optional: true }),
  ], { fallback: formsFallback }),
  flow("GF-05", "forms", "Sửa xung đột đồng bộ", ["xung đột đồng bộ", "hai bản hồ sơ khác nhau", "xung đột hồ sơ"], [
    choose, s(c(/^Dùng bản extension$|^Dùng bản app đã lưu$/, ".drawer .conflict", ".drawer .conflict"), "Chọn bản hồ sơ cần giữ", "Dùng bản extension lấy dữ liệu từ Chrome. Dùng bản app đã lưu ghi đè bản Chrome. Xem lại hai bản trước khi tự chọn.", { advance: "click" }),
    s(a(".drawer .sync-row"), "Kiểm tra trạng thái đồng bộ", "Kiểm tra dòng trạng thái và thông báo. Nếu lỗi vẫn còn, đọc lại hồ sơ từ extension và đối chiếu trước khi thử lại.", { optional: true }),
  ], { fallback: { anchor: a(".drawer .sync-row, #profile-list .list-toolbar"), detail: "Mở Chi tiết và tab Hồ sơ và ảnh của đúng profile. Hai lựa chọn chỉ xuất hiện khi có xung đột." } }),
  flow("GF-06", "forms", "Nhập dữ liệu từ bản local", ["nhập từ bản local", "chuyển hồ sơ từ bản local", "nhập dữ liệu local"], [
    s(a('[data-guide-target="account-menu"]'), "Mở Tài khoản và công cụ", "Xuất JSON trên bản local trước, rồi mở Tài khoản và công cụ trên web.", { advance: "visible" }),
    s(c(/^Nhập từ bản local/, ".workspace-tools-dialog"), "Chọn bản xuất JSON", "Chọn đúng tệp. Kiểm tra kết quả nhập, ảnh và các khóa gửi đã có. Liên kết lại từng Chrome profile trước khi dùng."),
    s(list, "Đối chiếu hồ sơ đã nhập", "Tìm theo tên hoặc email. Kiểm tra hồ sơ, ảnh và lịch sử trước khi tạo lượt mới.", { optional: true }),
  ]),
  flow("GF-07", "forms", "Chọn profile và cấp HSK", ["gán cấp hsk", "chọn profile và cấp hsk", "đổi cấp hsk"], [
    s(list, "Tìm profile", "Dùng bộ lọc hoặc tìm theo tên, email và thí sinh."),
    s(a('select[aria-label^="HSK của"]', "#profile-list"), "Gán cấp HSK", "Chọn cấp ở đúng dòng. Profile đang chạy hoặc thuộc lịch hoạt động có thể bị khóa."),
    selected, s(schedule, "Kiểm tra nhóm theo cấp", "Đối chiếu số profile và các mục cần xử lý trước khi chuẩn bị."),
  ], { fallback: formsFallback }),
  flow("GF-08", "forms", "Săn link từ Facebook", ["săn link facebook", "tự lấy từ facebook", "theo dõi bài facebook"], [
    source, s(c("Tự lấy từ Facebook"), "Chọn nguồn Facebook", "Chuyển nguồn sang Facebook để nhập bài thông báo.", { advance: "visible" }),
    s(a(".schedule-fields"), "Nhập bài và giờ mở", "Dán link trực tiếp bài thông báo và kiểm tra giờ Việt Nam."),
    s(a(".schedule-source select"), "Chọn profile đọc Facebook", "Mở extension của profile này, cấp quyền Facebook rồi quay lại kiểm tra quyền."),
    s(wait, "Kiểm tra rồi bật chờ", "Đối chiếu bài, cấp HSK và chế độ. Bật chờ có thể chạy khi tìm thấy link hợp lệ."),
    scheduleResult,
  ], { fallback: scheduleFallback }),
  flow("GF-09", "forms", "Dán link thủ công theo cấp HSK", ["dán link thủ công", "dán link hsk", "link google forms thủ công"], [
    source, s(c("Dán link thủ công"), "Chọn nguồn thủ công", "Kiểm tra các cấp đã gán và chọn nguồn Dán link thủ công."),
    s(wait, "Bật lượt chờ", "Rà lại nhóm và chế độ trước khi bấm. Với Live, link hợp lệ có thể kích hoạt lượt ngay.", { optional: true }),
    s(draftLink, "Dán link vào đúng cấp", "Đối chiếu tên form và cấp HSK. Có thể mở phần dán nội dung bài có nhãn HSK để áp dụng nhiều link."),
    scheduleResult,
  ], { fallback: scheduleFallback }),
  flow("GF-10", "forms", "Diễn tập bằng form thử", ["diễn tập bằng form thử", "test form thử", "chạy test google forms"], [
    s(mode, "Chọn Test", "Chọn Test · dừng trước Gửi và rà đúng profile."),
    s(a(".schedule-test-option"), "Dùng form thử", "Bật Diễn tập bằng form thử và nhập link form được phép dùng.", { advance: "visible" }),
    s(a(".schedule-rehearsal"), "Kiểm tra link thử", "Nếu form sai, dùng Đổi form thử sau khi kiểm tra trạng thái của lượt cũ."),
    s(wait, "Chuẩn bị diễn tập", "Đọc cấu hình rồi tự bấm. Theo dõi bước dừng trước Gửi."),
    scheduleResult,
  ], { fallback: scheduleFallback }),
  flow("GF-11", "forms", "Chạy Live theo cấp HSK", ["chạy live theo cấp hsk", "bật live google forms", "live theo hsk"], [
    selected, s(mode, "Kiểm tra quyền Live", "Chọn Live nếu tài khoản đã được cấp quyền. Kiểm tra profile, cấp HSK, đáp án và nguồn link."),
    s(wait, "Xác nhận bật Live", "Kiểm tra kỹ vì Live sẽ tự gửi khi đáp ứng điều kiện. Chỉ tự bấm khi đã chọn đúng nhóm."),
    scheduleResult,
  ], { fallback: scheduleFallback }),
  flow("GF-12", "forms", "Cài hoặc sửa đáp án xác thực", ["đáp án xác thực", "lấy câu xác thực", "câu xác thực hsk"], [
    verify, s(c(/^Lưu đáp án trước$|^Lưu & tự tiếp tục$/, ".schedule-panel, #run-monitor", ".schedule-levels"), "Xác nhận đáp án", "Đối chiếu câu hỏi và form. Lưu & tự tiếp tục sẽ cho lượt đang chặn chạy tiếp. Nếu đang sửa lịch nháp, đáp án được gửi cùng cấu hình khi chuẩn bị.", { optional: true }),
  ], { fallback: scheduleFallback }),
  flow("GF-13", "forms", "Đổi link sai hoặc dừng một cấp", ["đổi link sai", "loại link", "dừng một cấp", "đổi link và chạy lại"], [
    s(c("Loại link / dừng HSK", ".schedule-panel", ".schedule-levels"), "Chọn đúng cấp và dừng", "Kiểm tra cấp và form. Chờ trạng thái dừng trước khi thay link.", { advance: "click" }),
    s(c(/Đổi link.*chạy lại/, ".schedule-panel", ".schedule-levels"), "Đổi link nếu được phép", "Xem khóa gửi và câu xác thực. Với kết quả chưa rõ, hãy đối chiếu trước. Kiểm tra lại link mới trước khi chạy.", { optional: true }),
  ], { fallback: scheduleFallback }),
  flow("GF-14", "forms", "Theo dõi hoặc điều khiển lượt", ["theo dõi lượt", "tạm dừng lượt", "hủy chờ link", "tiếp tục lượt"], [
    s(a("#run-monitor .live-bar-heading, .schedule-footer"), "Xác định đúng lượt", "Kiểm tra nhóm, chế độ, cấp HSK và trạng thái. Mở bảng theo dõi nếu đang ẩn."),
    s(a("#run-monitor .live-bar-actions, .schedule-footer"), "Chọn thao tác đúng phạm vi", "Tạm dừng, tiếp tục hoặc hủy chờ theo nhóm. Với một profile, dùng Chi tiết của đúng dòng. Đọc phản hồi trước khi thao tác tiếp."),
  ], { fallback: scheduleFallback }),
  flow("GF-15", "direct", "Dùng Direct và tiếp quản form", ["tiếp quản form", "tiếp quản thủ công", "điền trực tiếp trên form"], [
    selected, s(mode, "Kiểm tra chế độ và lượt Direct", "Chọn Test hoặc Live rồi thiết lập lượt. Đối chiếu email trên form."),
    s(c("Xem form", "#profile-list", "#profile-list"), "Mở form của đúng profile", "Khi cần, tiếp quản và thao tác trên form đang mở. Quay lại HANU sau khi kiểm tra trạng thái gửi."),
    s(c("Tiếp tục", ".drawer", "#profile-list"), "Trả lại lượt cho tự động", "Chỉ bấm Tiếp tục ở đúng profile khi chưa gửi và app cho phép. Nếu chưa rõ kết quả, xác minh trước.", { optional: true }),
  ], { fallback: formsFallback }),
  flow("GF-16", "forms", "Xem lỗi, lịch sử hoặc hồ sơ đã dùng", ["nhật ký lượt chạy", "hồ sơ của lượt này", "lịch sử google forms"], [
    choose, s(c("Nhật ký lượt chạy", ".drawer"), "Mở Nhật ký lượt chạy", "Đọc lỗi, thời điểm và trạng thái của lượt cần đối chiếu.", { advance: "visible" }),
    s(a(".drawer .run-summary, .drawer .event-log"), "Đọc trạng thái và lỗi", "Tìm lỗi đầu tiên và đọc hướng xử lý trong nhật ký."),
    s(c("Xem hồ sơ của lượt này", ".drawer", ".drawer-content"), "Xem bản hồ sơ đã dùng", "Mở đúng lượt. Bản này dùng để đối chiếu. Nếu muốn dùng lại, hãy xem kỹ rồi mới lưu.", { optional: true }),
  ], { fallback: formsFallback }),
  flow("GF-17", "forms", "Đối chiếu đã gửi hay chưa và chạy lại", ["xác minh kết quả gửi", "đối chiếu đã gửi", "đã gửi hay chưa", "xác minh chưa gửi"], [
    s(c("Xác minh kết quả", "#profile-list", "#profile-list"), "Mở lượt cần xác minh", "Chọn đúng profile đang có kết quả chưa rõ.", { advance: "click" }),
    s(c("Xem form để đối chiếu", ".drawer"), "Đối chiếu trên Google Forms", "Kiểm tra thông báo đã gửi hoặc dấu hiệu chưa gửi, rồi quay lại đúng profile.", { external: true }),
    s(a(".submission-review"), "Ghi nhận kết quả thực tế", "Chọn đúng Đã xác minh đã gửi hoặc Đã xác minh chưa gửi. Chỉ dùng Chạy lại khi app cho phép và bạn đã xác minh."),
  ], { fallback: formsFallback }),
  flow("GF-18", "forms", "Hủy liên kết và xóa profile", ["hủy liên kết profile", "xóa profile"], [
    s(c(/^Hủy liên kết/, "#profile-list", "#profile-list"), "Chọn profile cần xóa", "Kiểm tra đúng tên, email và lượt đang chạy, rồi mở Hủy liên kết ở dòng tương ứng.", { advance: "click" }),
    s(c("Xóa vĩnh viễn", '[role="dialog"]'), "Kiểm tra trước khi xóa", "Xóa dữ liệu website, lịch sử và khóa gửi của profile. Đọc tên trong hộp xác nhận và tự quyết định xóa hoặc giữ liên kết."),
  ], { fallback: formsFallback }),
];

export const installationSteps: Record<string, WalkStep> = {
  forms: download,
  hcmue: s(a('a.wh-guide[href*="hcmue-downloads"]'), "Mở gói HCMUE Runner", "Chọn gói đúng Windows hoặc macOS và đúng kiến trúc trên trang tải. Mở Start HCMUE trên máy đã chọn.", { external: true }),
  chinesetest: s(a('a.wh-guide[href*="chinesetest-downloads"]'), "Mở gói ChineseTest Runner", "Chọn gói đúng Windows hoặc macOS và đúng kiến trúc. Mở Start ChineseTest trên máy sẽ giữ lịch.", { external: true }),
};
