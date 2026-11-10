interface Guide {
  id: string;
  title: string;
  codes: string[];
  aliases: string[];
  steps: string[];
}

// Reviewed HCMUE help derived from docs/hcmue/HUONG-DAN.md and HcmueNotice.
const guides: Guide[] = [
  { id: "runner", title: "Kết nối và đối chiếu Runner", codes: ["HC-RUNNER-OFFLINE", "HC-DOI-CHIEU-MAY", "HC-DOC-TRANG-THAI", "HC-CHUA-LIEN-KET", "HC-MA-LIEN-KET", "HC-BAN-CU"], aliases: ["runner mất kết nối", "mất mạng", "liên kết máy", "đọc trạng thái", "dấu vân tay", "mở runner"], steps: ["Mở Runner HCMUE và kiểm tra máy còn mạng.", "Nếu chưa liên kết, nhập mã từ Runner rồi đối chiếu dấu vân tay.", "Bấm Đọc lại trạng thái để xem dữ liệu trên máy."] },
  { id: "login", title: "Đăng nhập và khôi phục phiên", codes: ["HC-PHIEN", "HC-THONG-TIN-DANG-NHAP", "HC-THIEU-DANG-NHAP", "HC-CHUA-TK"], aliases: ["bị đăng xuất", "hết phiên", "đăng nhập lại", "sai mật khẩu", "không đăng nhập được", "cccd"], steps: ["Mở Thêm tài khoản và đăng nhập lại trên Runner.", "Nếu HCMUE đang mất kết nối, chờ dịch vụ phản hồi rồi thử lại.", "Bấm Kiểm tra hồ sơ/API trước khi chuẩn bị lịch."] },
  { id: "network", title: "Khi HCMUE phản hồi chậm hoặc lỗi", codes: ["HC-KET-NOI"], aliases: ["timeout", "web sập", "http 500", "không có phản hồi", "hcmue không trả dữ liệu", "lỗi mạng", "lỗi máy chủ"], steps: ["Xem báo cáo để xác định bước gặp lỗi và mã HTTP nếu có.", "Nếu Runner đã thử gửi, dùng Kiểm tra kết quả trước khi gửi lại.", "Khi HCMUE phản hồi, chạy lại bước kiểm tra bị lỗi."] },
  { id: "result", title: "Đối chiếu kết quả đăng ký", codes: ["HC-DOI-CHIEU"], aliases: ["đăng ký được chưa", "sao chưa thấy", "chưa có kết quả", "bấm rồi", "đã gửi", "mã đơn", "thanh toán", "lịch 15h", "đăng kí thành công"], steps: ["Mở Lịch gửi và kết quả, chọn đúng lịch rồi bấm Kiểm tra kết quả nếu cần.", "HCMUE xác nhận đăng ký khi đối chiếu được mã đơn. Xem mã và hạn thanh toán trên cổng trường.", "Nếu lần gửi chưa rõ kết quả, kiểm tra lịch sử HCMUE trước khi gửi lại."] },
  { id: "profile", title: "Kiểm tra hồ sơ HCMUE", codes: ["HC-HO-SO"], aliases: ["hồ sơ", "ảnh thẻ", "xác thực email", "kiểm tra api"], steps: ["Hoàn thiện ảnh thẻ và xác thực email trên cổng HCMUE.", "Quay lại chọn tài khoản và kỳ thi rồi bấm Kiểm tra hồ sơ/API."] },
  { id: "catalog", title: "Chọn kỳ thi còn chỗ", codes: ["HC-HET-CHO", "HC-TRUNG-LICH", "HC-TAI-KY-THI", "HC-CHON-MAU"], aliases: ["hết chỗ", "trùng lịch thi", "còn chỗ", "tải kỳ thi", "đợt thi", "chưa mở"], steps: ["Bấm Tải kỳ thi để đọc lại danh sách từ HCMUE.", "Nếu trường báo trùng lịch, kiểm tra lịch sử và chọn một đợt phù hợp.", "Chọn đúng đợt và giờ gửi trong khung đăng ký."] },
  { id: "prepare", title: "Tạo hoặc sửa lịch nháp", codes: ["HC-CHON-TK", "HC-GIO-GUI", "HC-LICH-DA-DOI", "HC-CHUA-CHUAN-BI"], aliases: ["tạo lịch", "đặt lịch", "đổi giờ", "sửa lịch", "lịch nháp", "chuẩn bị lịch", "câu hỏi bổ sung"], steps: ["Chọn một tài khoản, kỳ thi, giờ Việt Nam và chế độ chạy.", "Bấm Chuẩn bị và trả lời câu hỏi bổ sung nếu HCMUE yêu cầu.", "Nếu sửa giờ hoặc kỳ thi, chuẩn bị lại để lưu lịch mới."] },
  { id: "arm", title: "Bật lịch và kiểm tra quyền đăng ký thật", codes: ["HC-QUYEN-LIVE", "HC-LICH-CHUA-HOP-LE", "HC-XAC-NHAN-LICH", "HC-LICH-DANG-CHAY", "HC-DANG-CHAY", "HC-KHONG-CO-LICH-CHAY"], aliases: ["bật lịch", "diễn tập", "quyền live", "đăng ký thật", "dừng lịch", "không bật được"], steps: ["Chuẩn bị lịch rồi kiểm tra ngày giờ, kỳ thi và chế độ trước khi xác nhận bật.", "Đăng ký thật cần quyền Live. Diễn tập không gửi đơn đến trường.", "Giữ Runner mở, máy có mạng và tránh để máy ngủ trong thời gian chạy."] },
];

export const normalize = (value: string) => value.toLowerCase().normalize("NFD")
  .replace(/\p{M}/gu, "").replace(/đ/g, "d").replace(/\bdki\b|\bdk\b|dang ki/g, "dang ky")
  .replace(/[^a-z0-9]+/g, " ").trim();

export function retrieveGuides(question: string, noticeCode?: string) {
  const normalized = ` ${normalize(question)} `;
  const words = new Set(normalized.trim().split(" "));
  const ignored = new Set(["toi", "em", "co", "cho", "va", "da", "duoc", "khong", "the", "nao", "bi", "sao", "gi"]);
  return guides.map(guide => {
    const exact = guide.codes.some(code => code === noticeCode || normalized.includes(` ${normalize(code)} `));
    const phrases = guide.aliases.map(normalize);
    const tokens = new Set(phrases.join(" ").split(" ").filter(word => !ignored.has(word)));
    const overlap = [...tokens].filter(word => words.has(word)).length;
    const matches = phrases.filter(phrase => normalized.includes(` ${phrase} `));
    const leading = matches.some(phrase => normalized.startsWith(` ${phrase} `));
    const score = exact ? 100 : matches.length * 6 + (leading ? 3 : 0) + (overlap >= 2 ? overlap : 0);
    return { guide, score };
  }).filter(item => item.score > 0).sort((a, b) => b.score - a.score).slice(0, 3).map(item => item.guide);
}
