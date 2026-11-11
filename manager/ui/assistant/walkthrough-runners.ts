import { anchor as a, control as c, flow, step as s } from "./walkthrough-types";
import { installationSteps } from "./walkthrough-forms";

const dialog = '[role="dialog"]';
const pairInput = a(`${dialog} input:not([type=checkbox])`);
const pair = s(c("Liên kết máy", ".workspace-header"), "Mở liên kết máy", "Mở Runner trên máy cần dùng. Lấy mã đang hiển thị rồi mở Liên kết máy trên website.", { advance: "visible", assist: true });
const hcDevice = a("#hc-device .hc-device-info");
const ctDevice = a("#device .ct-device-intro");
const hcOffline = { anchor: hcDevice, detail: "Kiểm tra đúng máy, kết nối Runner và đối chiếu dấu vân tay. Nếu đang tải, đợi hoặc bấm Đọc lại trạng thái. Lịch vẫn thuộc máy đã nhận." };
const ctOffline = { anchor: ctDevice, detail: "Mở Runner trên máy thực thi, chọn máy và đối chiếu dấu vân tay. Nếu mất mạng, xử lý trên máy đó. Đổi máy đang xem không chuyển lịch." };
const hcAccounts = "#hc-accounts";
const hcRow = `${hcAccounts} tbody tr`;
const hcRuns = "#hc-results";
const ctAccounts = "#accounts";
const ctRow = ".ct-account";
const ctRuns = "#runs";
const hcPick = s(a(`${hcRow} input[type=checkbox]`, hcAccounts), "Chọn tài khoản HCMUE", "Tích đúng tài khoản. Kiểm tra tên và kỳ thi. Với một tài khoản, chỉ chọn dòng đó.");
const hcExam = s(a(`${hcAccounts} select[aria-label^="Kỳ thi cho"]`, hcAccounts), "Chọn đợt thi", "Đối chiếu cấp thi, ngày thi và ngày mở. Nếu danh sách trống, tải kỳ thi từ trường trước.");
const hcWhen = s(a(`${hcAccounts} input[type=datetime-local]`, hcAccounts), "Kiểm tra giờ Việt Nam", "Nhập ngày và giờ gửi cho đúng tài khoản. Kiểm tra chế độ Diễn tập hoặc Đăng ký thật ở cùng dòng.");
const hcRun = s(a(".hc-run-info h3", hcRuns), "Xác định đúng lịch", "Đối chiếu người thi, kỳ thi, giờ và chế độ trên dòng lịch. Chọn thao tác ở đúng dòng.");
const hcReport = s(a(".hc-inspection > summary", hcAccounts), "Đọc báo cáo API", "Mở báo cáo của đúng người để đọc hồ sơ, ảnh, email, câu hỏi và kết quả đối chiếu. Mở lỗi để xem cách xử lý. Sửa hồ sơ tại HCMUE rồi kiểm tra lại.");
const hcArm = (live: boolean) => [
  s(c("Bật lịch", `.hc-run[data-walk-mode="${live ? "live" : "test"}"]`, hcRuns), "Mở xác nhận ở đúng lịch", live ? "Chọn dòng Đăng ký thật. Kiểm tra quyền Live, phiên, ảnh, email, thời gian mở và giờ gửi trước khi bật." : "Chọn dòng Diễn tập. Nếu chưa có, chuẩn bị lịch nháp với chế độ Diễn tập trước.", { advance: "visible" }),
  s(c("Xác nhận bật lịch", dialog), "Xác nhận lịch trên máy", "Đọc tài khoản, giờ và chế độ trong hộp xác nhận. Chỉ tự bấm khi tất cả đúng.", { advance: "gone" }),
  hcRun,
];
const ctConfig = s(c("Cấu hình kỳ thi và giờ mở", ctAccounts, ctAccounts), "Mở cấu hình đúng tài khoản", "Mở phần cấu hình ở dòng người thi cần chỉnh.", { advance: "visible" });
const ctSettings = a(`${ctRow} details[open] label select`, ctRow);
const ctMode = (live: boolean) => s(a(`${ctRow} details[open] label:has(select option[value=live]) select`, ctRow), live ? "Chọn Live" : "Chọn Test", live ? "Kiểm tra quyền Live, điểm thi, lệ phí và môn đi kèm. Chọn Live khi chuẩn bị đăng ký thật." : "Chọn Diễn tập · không gửi đơn và kiểm tra lại cấu hình.");
const ctProfile = s(c("Hồ sơ / ảnh", ctAccounts, ctAccounts), "Mở hồ sơ đúng tài khoản", "Bấm Hồ sơ / ảnh ở dòng của người thi. Nếu Runner báo bản cũ, cập nhật trước.", { advance: "click" });
const ctRun = s(a(".ct-run-label", ctRuns), "Đọc trạng thái lượt", "Đối chiếu tên, chế độ và giờ. Kiểm tra trạng thái dò, gửi, mã đơn và hạn nộp phí trên đúng dòng.");

export const runnerWalkthroughs = [
  flow("HC-01", "hcmue", "Cài, mở hoặc cập nhật HCMUE Runner", ["cài runner hcmue", "cập nhật runner hcmue", "mở hcmue runner", "cài runner"], [
    installationSteps.hcmue, s(c("Mở runner trên máy này", "#hc-device"), "Mở Runner trên máy", "Mở từ website nếu máy hỗ trợ, hoặc chạy Start HCMUE trong thư mục đã giải nén. Trước khi thay bản đang chạy, kiểm tra các lịch hoạt động.", { optional: true }),
    s(hcDevice, "Xem kết nối Runner", "Đọc trạng thái kết nối và đối chiếu đúng máy. Nếu chưa liên kết, lấy mã đang hiển thị trên Runner."),
  ]),
  flow("HC-02", "hcmue", "Liên kết và xác minh máy HCMUE", ["liên kết máy hcmue", "xác minh máy hcmue", "đối chiếu dấu vân tay hcmue", "liên kết máy"], [
    pair, s(pairInput, "Nhập mã từ HCMUE Runner", "Dán mã vào ô Mã liên kết rồi tự bấm Liên kết. Chờ hộp đối chiếu xuất hiện.", { advance: "visible" }),
    s(a(".hc-fingerprint"), "Đối chiếu toàn bộ dấu vân tay", "So sánh với Runner trên đúng máy. Chỉ xác nhận khi trùng hoàn toàn.", { advance: "click", action: c("Đã đối chiếu, đúng máy", dialog) }),
    s(a('#hc-device[data-walk-trusted="true"] .hc-device-info'), "Kiểm tra máy đã xác minh", "Đọc trạng thái Đã đối chiếu thiết bị và kết nối trước khi lập lịch."),
  ]),
  flow("HC-03", "hcmue", "Chọn máy hoặc xử lý HCMUE offline", ["chọn máy hcmue", "hcmue runner offline", "runner hcmue mất kết nối", "kiểm tra kết nối runner"], [
    s(a('#hc-device [aria-label="Chọn máy chạy"]'), "Chọn đúng máy chạy", "Lịch nằm trên Runner nhận lịch. Nếu chỉ thấy một máy, kiểm tra tên máy trong thẻ trạng thái.", { optional: true }),
    s(c("Đọc lại trạng thái", "#hc-device"), "Đọc lại trạng thái Runner", "Mở Runner, kiểm tra mạng và tránh để máy ngủ. Bấm Đọc lại trạng thái sau khi kết nối."),
    s(hcDevice, "Xem trạng thái thật", "Đọc tình trạng kết nối, xác minh và số lịch trên máy. Nếu máy vẫn offline, thao tác tại Runner."),
  ], { fallback: hcOffline }),
  flow("HC-04", "hcmue", "Đăng nhập hoặc đăng xuất tài khoản HCMUE", ["thêm tài khoản hcmue", "đăng nhập lại hcmue", "đăng xuất hcmue"], [
    s(c(/^Thêm tài khoản$|^Đăng nhập lại HCMUE$|^Đăng xuất$/, `.wh-actions, ${hcAccounts}`, hcAccounts), "Chọn thao tác tài khoản", "Thêm tài khoản ở đầu trang. Đăng nhập lại hoặc đăng xuất trên dòng cần xử lý. Kiểm tra lịch đang hoạt động trước khi đăng xuất."),
    s(a(`${dialog} input[type=password]`), "Nhập thông tin trong hộp đăng nhập", "Nhập CCCD và mật khẩu trong hộp HCMUE của ứng dụng. Bấm Đăng nhập rồi chờ phiên được kiểm tra trên Runner.", { optional: true }),
    s(a(`${hcAccounts} .hc-status`, hcAccounts), "Kiểm tra phiên HCMUE", "Đọc trạng thái, lỗi tài khoản và tình trạng ảnh/email của đúng người thi."),
  ], { fallback: hcOffline }),
  flow("HC-05", "hcmue", "Xem kỳ thi và tình trạng mở HCMUE", ["tải kỳ thi hcmue", "hcmue đã mở chưa", "xem kỳ thi hcmue", "tình trạng mở hcmue", "tải kỳ thi"], [
    s(c("Tải kỳ thi", ".hc-compose"), "Tải kỳ thi từ trường", "Chọn tài khoản có phiên hoạt động, rồi tải danh sách kỳ thi."),
    s(a('[aria-label="Kỳ thi HCMUE"]'), "Chọn đúng đợt thi", "Xem ngày mở, ngày đóng, số chỗ hoặc thông tin mà trường trả về. Danh sách có thể thay đổi."),
    s(c("Xem toàn bộ dữ liệu kỳ thi", ".hc-compose"), "Mở dữ liệu gốc", "Xem các trường trường trả về. Dấu hiệu trên web cần đối chiếu với dữ liệu của đúng đợt.", { advance: "visible" }),
    s(a(".hc-api-data"), "Đọc phản hồi HCMUE", "Phân biệt giá trị do HCMUE trả về với nhận xét của HANU."),
  ], { fallback: hcOffline }),
  flow("HC-06", "hcmue", "Kiểm tra hồ sơ và API HCMUE", ["kiểm tra hồ sơ/api", "kiểm tra api hcmue", "kiểm tra hồ sơ hcmue", "kiểm tra api"], [
    hcPick, hcExam, s(c("Kiểm tra hồ sơ/API", hcAccounts), "Chạy kiểm tra hồ sơ/API", "Chỉ đọc dữ liệu. Nếu nút bị khóa, xem lý do cạnh nút và xử lý tài khoản hoặc kỳ thi trước.", { advance: "click" }), hcReport,
  ], { fallback: hcOffline }),
  flow("HC-07", "hcmue", "Chọn kỳ thi, giờ gửi và chế độ HCMUE", ["chọn kỳ thi hcmue", "đặt giờ gửi hcmue", "áp dụng mẫu hcmue"], [
    hcPick, hcExam, hcWhen,
    s(c("Áp dụng mẫu cho tài khoản đã chọn", ".hc-compose"), "Áp dụng mẫu nếu cần", "Xem kỳ thi, giờ và chế độ mẫu rồi áp dụng cho những dòng đã chọn. Kiểm tra lại các dòng sau khi áp dụng.", { optional: true }),
  ], { fallback: hcOffline }),
  flow("HC-08", "hcmue", "Tạo hoặc sửa lịch nháp HCMUE", ["lịch nháp hcmue", "chuẩn bị lịch hcmue", "sửa lịch hcmue"], [
    hcPick, hcExam, hcWhen,
    s(c(/^Chuẩn bị\s*(\d+\s*)?tài khoản$/, hcAccounts), "Chuẩn bị lịch nháp", "Kiểm tra kỳ thi, thời gian và chế độ. Với nháp cũ, chọn lại đúng tài khoản hoặc dùng Hỏi AI về lịch ở đúng dòng."),
    s(a('[data-walk="hcmue-exam-questions"]'), "Trả lời câu hỏi bổ sung nếu có", "Đọc câu hỏi của đúng đợt và tự lưu câu trả lời.", { optional: true }),
    s(a(".hc-status-prepared", hcRuns), "Tìm lịch Sẵn sàng", "Đối chiếu tài khoản, giờ và chế độ. Chỉ bật khi bạn đã kiểm tra lại."),
  ], { fallback: hcOffline }),
  flow("HC-09", "hcmue", "Bật lịch diễn tập HCMUE", ["bật lịch diễn tập hcmue", "bật lịch test hcmue", "bật diễn tập"], hcArm(false), { fallback: { anchor: a(hcRuns), detail: "Chỉ dòng Diễn tập đã chuẩn bị có nút Bật lịch. Nếu chưa có lịch, chuẩn bị tài khoản với chế độ Diễn tập trước." } }),
  flow("HC-10", "hcmue", "Bật lịch đăng ký thật HCMUE", ["bật lịch đăng ký thật hcmue", "bật lịch live hcmue", "bật lịch đăng ký thật"], hcArm(true), { fallback: { anchor: a(hcRuns), detail: "Tìm lịch Đăng ký thật đã chuẩn bị. Kiểm tra quyền Live và các lý do bị chặn trên dòng lịch." } }),
  flow("HC-11", "hcmue", "Xem trạng thái, lỗi và nhật ký HCMUE", ["trạng thái lịch hcmue", "nhật ký hcmue", "xem lỗi hcmue"], [
    hcRun, s(c(/^Xem lỗi$|^Hỏi AI về lịch$/, hcRuns, hcRuns), "Mở lỗi hoặc báo cáo đúng lịch", "Đọc thời điểm gửi, phản hồi, hàng đợi hoặc chờ thanh toán. Nếu có lỗi, mở hướng xử lý rồi đối chiếu dữ liệu trước khi chạy lại."),
  ], { fallback: hcOffline }),
  flow("HC-12", "hcmue", "Đối chiếu kết quả và mở thanh toán HCMUE", ["kiểm tra kết quả hcmue", "đối chiếu kết quả hcmue", "thanh toán hcmue"], [
    hcRun, s(c("Kiểm tra kết quả", hcRuns, hcRuns), "Đọc lại kết quả từ trường", "Tự bấm ở đúng lịch chưa rõ, đang chờ thanh toán hoặc có lỗi. Kiểm tra mã đơn và trạng thái mà trường trả về.", { optional: true }),
    s(a('a[href="https://hsk.hcmue.edu.vn/registered-exams"]'), "Đối chiếu lịch sử tại HCMUE", "Kiểm tra đúng tài khoản và mã đơn trong lịch sử của trường. Dùng hạn thanh toán hiển thị trên đơn.", { external: true }),
  ], { fallback: hcOffline }),
  flow("HC-13", "hcmue", "Dừng hoặc khôi phục sau sự cố HCMUE", ["dừng lịch hcmue", "dừng tất cả hcmue", "khôi phục runner hcmue"], [
    hcRun, s(c(/^Dừng$|^Dừng tất cả/, hcRuns, hcRuns), "Kiểm tra phạm vi dừng", "Dừng đúng lịch hoặc tất cả lịch trên máy đã chọn. Nếu web mất kết nối, kiểm tra tại Runner và chờ xác nhận."),
    s(c("Kiểm tra kết quả", hcRuns, hcRuns), "Đối chiếu sau khi mở lại", "Nếu lượt có thể đã gửi, kiểm tra kết quả từ trường trước khi chuẩn bị lượt mới.", { optional: true }),
  ], { fallback: hcOffline }),
  flow("HC-14", "hcmue", "Bỏ một lịch nháp HCMUE", ["bỏ lịch hcmue", "bỏ lịch nháp", "xóa lịch nháp"], [
    hcRun, s(c("Bỏ lịch", '.hc-run[data-walk-status="prepared"]', hcRuns), "Bỏ đúng lịch Sẵn sàng", "Kiểm tra tài khoản, kỳ thi và giờ rồi tự bấm Bỏ lịch. Kiểm tra dòng đã biến mất. Nếu lịch đã bật, dùng luồng Dừng.", { blocked: "Chỉ bỏ được nháp chưa bật. Xem lý do trên dòng lịch nếu nút bị khóa." }),
  ], { fallback: { anchor: a(hcRuns), detail: "Tìm lịch Sẵn sàng chưa bật. Nếu lịch đã bật, chọn Dừng ở đúng dòng." } }),

  flow("CT-01", "chinesetest", "Cài, mở hoặc cập nhật ChineseTest Runner", ["cài runner chinesetest", "cập nhật runner chinesetest", "mở chinesetest runner", "cài runner"], [
    installationSteps.chinesetest, s(c("Mở runner trên máy này", "#device"), "Mở Runner", "Mở từ website nếu có hỗ trợ hoặc chạy Start ChineseTest trong thư mục cài.", { optional: true }),
    s(ctDevice, "Xem kết nối máy", "Đọc trạng thái Runner. Nếu chưa có máy, lấy mã trên máy để liên kết và đối chiếu."),
  ]),
  flow("CT-02", "chinesetest", "Liên kết và xác minh máy ChineseTest", ["liên kết máy chinesetest", "xác minh máy chinesetest", "đối chiếu dấu vân tay chinesetest", "liên kết máy"], [
    pair, s(pairInput, "Nhập mã liên kết", "Sao chép mã trong Runner và dán vào đúng hộp. Tự bấm Liên kết và chờ hộp xác minh.", { advance: "visible" }),
    s(a(".ct-fingerprint"), "Đối chiếu dấu vân tay", "So sánh toàn bộ với Runner. Chỉ xác nhận đúng máy khi trùng.", { advance: "click", action: c("Đã đối chiếu, đúng máy", dialog) }),
    s(a("#device .ct-device-intro:has(.ct-dot.connected)"), "Kiểm tra Runner đã kết nối", "Đọc trạng thái máy và xem danh sách tài khoản đã tải."),
  ]),
  flow("CT-03", "chinesetest", "Chọn máy hoặc xử lý ChineseTest offline", ["chọn máy chinesetest", "chinesetest runner offline", "runner chinesetest mất kết nối"], [
    s(a("#device select"), "Chọn đúng máy thực thi", "Chọn máy giữ hồ sơ và lịch. Thay máy đang xem không chuyển lịch."),
    s(c("Đọc lại trạng thái", "#device"), "Đọc lại trạng thái", "Mở Runner và kiểm tra kết nối. Nếu cần dừng khi offline, dùng Runner tại máy."),
    s(ctDevice, "Xem trạng thái máy", "Đọc kết nối và yêu cầu xác minh của đúng thiết bị."),
  ], { fallback: ctOffline }),
  flow("CT-04", "chinesetest", "Thêm tài khoản hoặc đăng nhập lại ChineseTest", ["thêm tài khoản chinesetest", "đăng nhập lại chinesetest", "đăng nhập chinesetest"], [
    s(c(/^Thêm tài khoản$|^Đăng nhập lại$/, ctAccounts, ctAccounts), "Mở đăng nhập cho đúng tài khoản", "Thêm mới ở đầu danh sách hoặc đăng nhập lại ở đúng dòng. Thao tác sẽ mở Chrome trên máy Runner.", { advance: "visible" }),
    s(c("Hoàn tất đăng nhập", ".ct-login-notice"), "Xác minh trong Chrome", "Nhập mật khẩu và xử lý CAPTCHA/OTP trực tiếp trong Chrome. Quay lại bấm Hoàn tất đăng nhập hoặc Hủy đăng nhập.", { external: true }),
  ], { fallback: ctOffline }),
  flow("CT-05", "chinesetest", "Điền hồ sơ hoặc lấy dữ liệu từ HANU", ["hồ sơ chinesetest", "lấy dữ liệu từ hanu", "điền hồ sơ chinesetest"], [
    ctProfile, s(a(".ct-dialog .ct-import"), "Dùng hồ sơ có sẵn nếu cần", "Chọn đúng hồ sơ HANU và kiểm tra lại từng trường trước khi lưu.", { optional: true }),
    s(a(".ct-dialog label:has(input[type=date])"), "Rà giấy tờ và lịch sử thi", "Điền họ tên, giấy tờ, ngày sinh và lịch sử thi theo yêu cầu. Xem lỗi danh mục hoặc dữ liệu thiếu trong hộp."),
    s(c("Lưu hồ sơ", ".ct-dialog"), "Kiểm tra rồi lưu hồ sơ", "Tự lưu và kiểm tra phản hồi từ ChineseTest. Nếu báo lỗi, đọc lại hồ sơ trước khi thử lại."),
  ], { fallback: ctOffline }),
  flow("CT-06", "chinesetest", "Tải ảnh hoặc đọc lại ảnh ChineseTest", ["tải ảnh chinesetest", "đọc lại ảnh chinesetest", "ảnh chân dung chinesetest"], [
    ctProfile, s(a(".ct-dialog .ct-photo"), "Chọn ảnh chân dung", "Đọc yêu cầu định dạng và dung lượng trong hộp. Chọn đúng JPG hoặc PNG. Ảnh được tải trực tiếp lên ChineseTest."),
    s(c(/^Đọc lại ảnh$|^Thử tải ảnh lại$/, ".ct-dialog"), "Kiểm tra ảnh đã hiện", "Chờ phản hồi và kiểm tra ảnh. Nếu chưa rõ kết quả, bấm Đọc lại ảnh trước khi tải lại."),
  ], { fallback: ctOffline }),
  flow("CT-07", "chinesetest", "Tìm cấp thi, hình thức, ngày và điểm thi ChineseTest", ["điểm thi chinesetest", "cấu hình kỳ thi chinesetest", "tải danh mục chinesetest"], [
    ctConfig, s(c("Tải lại danh mục / điểm thi", ctAccounts, ctRow), "Tải danh mục", "Nếu chưa có điểm, tải danh mục bằng phiên đang dùng."),
    s(ctSettings, "Chọn cấp, hình thức, ngày và điểm thi", "Kiểm tra ngày và giờ Việt Nam, lệ phí và môn đi kèm."),
    s(c("Lưu cấu hình", ctAccounts, ctRow), "Lưu cấu hình đã kiểm tra", "Chọn đúng tài khoản. Sau khi lưu, đọc thông báo Runner đã nhận cấu hình."),
  ], { fallback: ctOffline }),
  flow("CT-08", "chinesetest", "Áp dụng mẫu cho nhiều tài khoản ChineseTest", ["áp dụng mẫu dong a", "mẫu đông á", "mẫu nhiều tài khoản chinesetest"], [
    s(a(".ct-account-head input[type=checkbox]", ctAccounts), "Chọn đúng các tài khoản", "Tích riêng từng dòng cần đổi hoặc chọn tất cả nếu cả nhóm dùng chung cấu hình."),
    s(c("Áp dụng mẫu Dong A", ".ct-batch"), "Áp dụng mẫu Dong A", "Mẫu cập nhật cấu hình đã chọn và dùng chế độ Test. Kiểm tra lại điểm thi, lệ phí, ngày và giờ trên từng dòng."),
  ], { fallback: ctOffline }),
  flow("CT-09", "chinesetest", "Kiểm tra API ChineseTest", ["kiểm tra api chinesetest", "kiểm tra phiên chinesetest", "kiểm tra api"], [
    s(c("Kiểm tra API", ctAccounts, ctAccounts), "Kiểm tra đúng tài khoản", "Chọn dòng cần kiểm tra. Kiểm tra phiên và cấu hình thi trước khi đọc API.", { advance: "click" }),
    s(a(".ct-account .ct-success, .ct-account .ct-warning, .ct-account .ct-error", ctRow), "Đọc kết quả kiểm tra", "Đọc lý do chưa sẵn sàng. Lỗi phiên cần đăng nhập lại. Lỗi mạng cần kiểm tra Runner và thử đọc lại."),
  ], { fallback: ctOffline }),
  flow("CT-10", "chinesetest", "Chuẩn bị và bật lịch Test ChineseTest", ["bật lịch test chinesetest", "diễn tập chinesetest", "chuẩn bị test chinesetest"], [
    ctConfig, ctMode(false), s(c("Chuẩn bị", ctAccounts, ctRow), "Chuẩn bị lịch Test", "Kiểm tra ngày, giờ, điểm thi và tài khoản trước khi chuẩn bị."),
    s(c("Bật lịch Test", ctAccounts, ctRow), "Kiểm tra rồi bật Test", "Bấm khi nút được mở và cấu hình khớp lịch đã chuẩn bị. Giữ Runner và máy hoạt động."), ctRun,
  ], { fallback: ctOffline }),
  flow("CT-11", "chinesetest", "Chuẩn bị và bật lịch Live ChineseTest", ["bật lịch live chinesetest", "đăng ký thật chinesetest", "chuẩn bị live chinesetest"], [
    ctConfig, ctMode(true), s(c("Chuẩn bị", ctAccounts, ctRow), "Mở xác nhận chuẩn bị Live", "Đối chiếu thông tin của đúng người và mở bước xác nhận.", { advance: "visible" }),
    s(a('[data-walk="ct-live-confirm"]'), "Đọc và xác nhận quy định", "Đọc điều lệ, quyền riêng tư và lệ phí. Chỉ tự xác nhận để chuẩn bị nếu đồng ý."),
    s(c("Bật lịch Live", ctAccounts, ctRow), "Kiểm tra trước khi bật Live", "Đối chiếu tài khoản và lịch đã chuẩn bị. Tự bấm khi các điều kiện đã đạt. Xem trạng thái trên Runner."),
  ], { fallback: ctOffline }),
  flow("CT-12", "chinesetest", "Theo dõi và đối chiếu kết quả ChineseTest", ["đối chiếu kết quả chinesetest", "kết quả chinesetest", "test records"], [
    ctRun, s(c("Đối chiếu kết quả", ctRuns, ctRuns), "Đọc lại kết quả đúng lượt", "Nếu đã gửi yêu cầu, bấm Đối chiếu kết quả ở đúng lịch. Kiểm tra mã đơn, mã đăng ký và trạng thái.", { optional: true }),
    s(c(/^Mở Test Records/, ".ct-footer"), "Đối chiếu Test Records", "Mở lịch sử trên ChineseTest và kiểm tra đúng người thi, mã đơn và trạng thái.", { external: true }),
  ], { fallback: ctOffline }),
  flow("CT-13", "chinesetest", "Xác minh đã hủy hoặc chưa đăng ký ChineseTest", ["xác minh đã hủy", "xác minh chưa đăng ký", "mở khóa gửi chinesetest"], [
    ctRun, s(c(/^Xác minh đã hủy|^Xác minh chưa đăng ký$/, ctRuns, ctRuns), "Mở đối chiếu đúng lịch", "Kiểm tra tài khoản, thời điểm và trạng thái rồi mở đối chiếu.", { advance: "visible" }),
    s(a(".ct-absence-dialog .ct-check"), "Đối chiếu trước khi mở khóa", "Kiểm tra Test Records và xác nhận không còn yêu cầu chờ xử lý. Chỉ ghi nhận khi chắc chắn đúng kết quả."),
  ], { fallback: ctOffline }),
  flow("CT-14", "chinesetest", "Dừng hoặc khôi phục lượt ChineseTest", ["dừng lượt chinesetest", "dừng tất cả chinesetest", "khôi phục runner chinesetest"], [
    ctRun, s(c(/^Dừng lượt$|^Dừng tất cả trên máy$/, ctRuns, ctRuns), "Dừng theo đúng phạm vi", "Kiểm tra tên máy, tài khoản và lịch. Chờ Runner xác nhận dừng. Nếu offline, xử lý trực tiếp tại máy."),
    s(c("Đối chiếu kết quả", ctRuns, ctRuns), "Đối chiếu khi Runner chạy lại", "Nếu lượt có khả năng đã gửi, đọc lại kết quả và kiểm tra Test Records trước khi chuẩn bị lượt mới.", { optional: true }),
  ], { fallback: ctOffline }),
];
