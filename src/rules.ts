import { FieldRule, Profile } from "./shared";

export const HSK_RULES: FieldRule[] = [
  { key: "recordGoogleEmail", label: "Ghi email tài khoản Google", kind: "checkbox", aliases: ["Record your email", "Ghi lại email của tôi", "Record nguyentheduyet.mtp@gmail.com as the email to be included with my response"] },
  { key: "fullName", label: "Họ và tên", kind: "text", aliases: ["HỌ VÀ TÊN | 姓名", "Họ và tên", "-. .- -- ."] },
  { key: "chineseName", label: "Tên tiếng Trung", kind: "text", aliases: ["TÊN TIẾNG TRUNG | 中文姓名", "Tên tiếng Trung", "-.-. .... -. .- -- ."] },
  {
    key: "identityType",
    label: "Loại giấy tờ tùy thân",
    kind: ["radio", "dropdown"],
    aliases: [
      "LOẠI GIẤY TỜ TÙY THÂN | 证件类型",
      "Loại giấy tờ tùy thân",
      "LOẠI GIẤY TỜ TÙY THÂN",
      "Loại GTTT",
      "LOẠI GTTT",
      "Giấy tờ tùy thân",
      "证件类型"
    ],
    optionAliases: {
      CCCD: ["CCCD", "CCCD | 身份证", "Căn cước công dân", "身份证"],
      "HỘ CHIẾU": ["HỘ CHIẾU", "HỘ CHIẾU | 护照", "Passport", "护照"]
    }
  },
  {
    key: "identityNumber",
    label: "Số CCCD",
    kind: "text",
    aliases: [
      "SỐ CCCD | 身份证号",
      "Số CCCD",
      "SỐ CCCD",
      ".. -.. -. ..- --",
      "SỐ CĂN CƯỚC CÔNG DÂN",
      "Số căn cước công dân",
      "SỐ CĂN CƯỚC CÔNG DÂN | 身份证号",
      "Số CMND / CCCD",
      "Số CMND/CCCD",
      "SỐ CMND/CCCD | 身份证号",
      "Số CMND",
      "SỐ CMND",
      "SỐ CCCD/HỘ CHIẾU",
      "Số CCCD/Hộ chiếu",
      "SỐ GIẤY TỜ TÙY THÂN",
      "Số giấy tờ tùy thân",
      "Số CCCD (12 số)",
      "身份证号",
      "证件号码"
    ]
  },
  { key: "passportNumber", label: "Số hộ chiếu", kind: "text", aliases: ["SỐ HỘ CHIẾU | 护照号", "Số hộ chiếu", ".--. .--. -. ..- --"] },
  {
    key: "gender",
    label: "Giới tính",
    kind: ["radio", "dropdown"],
    aliases: ["GIỚI TÍNH | 性别", "Giới tính"],
    optionAliases: { Nam: ["Nam", "Nam | 男"], Nữ: ["Nữ", "Nữ | 女"] }
  },
  { key: "birthDate", label: "Ngày sinh", kind: ["text", "date"], aliases: ["NGÀY SINH | 出生日期", "Ngày sinh", "-... .. .-. - .... -.. .- - ."] },
  {
    key: "nationality",
    label: "Quốc tịch",
    kind: ["radio", "dropdown"],
    aliases: ["QUỐC TỊCH | 国籍", "Quốc tịch"],
    optionAliases: { "Việt Nam": ["Việt Nam | 越南"], Vietnam: ["Việt Nam | 越南"], Khác: ["Khác", "Other"] }
  },
  {
    key: "motherTongue",
    label: "Tiếng mẹ đẻ",
    kind: ["radio", "dropdown"],
    aliases: ["TIẾNG MẸ ĐẺ | 母语", "Tiếng mẹ đẻ"],
    optionAliases: { "Tiếng Việt": ["Tiếng Việt | 越南语"], Vietnamese: ["Tiếng Việt | 越南语"], Khác: ["Khác", "Other"] }
  },
  { key: "email", label: "Email", kind: "text", aliases: ["EMAIL | 邮箱", "Email"] },
  { key: "phone", label: "Số điện thoại", kind: "text", aliases: ["SỐ ĐIỆN THOẠI | 电话号码", "Số điện thoại", ".--. .... --- -. . -. ..- --"] },
  {
    key: "chineseStudyDuration",
    label: "Thời gian học tiếng Trung",
    kind: ["radio", "dropdown"],
    aliases: ["THỜI GIAN HỌC TIẾNG TRUNG | 学习中文年限", "Thời gian học tiếng Trung"],
    optionAliases: {
      "Dưới 6 tháng": ["Dưới 6 tháng | 6个月以下"],
      "1 năm": ["1 năm | 1年"],
      "2 năm": ["2 năm | 2年"],
      "3 năm": ["3 năm | 3年"],
      "4 năm": ["4 năm | 4年"],
      "5 năm": ["5 năm | 5年"],
      "5-10 năm": ["5-10 năm | 5-10年"],
      "10 năm trở lên": ["10 năm trở lên | 10年以上"]
    }
  },
  { key: "identityDocument", label: "Ảnh giấy tờ tùy thân", kind: "file", attachmentKey: "identityDocument", aliases: ["ẢNH MẶT TRƯỚC GTTT CỦA THÍ SINH | 身份证件图", "Ảnh giấy tờ tùy thân"] },
  {
    key: "paymentMethod",
    label: "Phương thức chuyển khoản",
    kind: ["radio", "dropdown"],
    aliases: ["PHƯƠNG THỨC CHUYỂN KHOẢN | 缴费方式", "Phương thức chuyển khoản"],
    optionAliases: {
      "CHUYỂN KHOẢN TẠI NGÂN HÀNG": ["CHUYỂN KHOẢN TẠI NGÂN HÀNG | 银行柜台转账"],
      "E-BANKING": ["E-BANKING (ĐỀ XUẤT) | 电子银行转账（推荐）"],
      "CÁC NỀN TẢNG THANH TOÁN ONLINE KHÁC": ["CÁC NỀN TẢNG THANH TOÁN ONLINE KHÁC | 其他支付平台"]
    }
  },
  { key: "bankAccountNumber", label: "Số tài khoản", kind: "text", aliases: ["SỐ TÀI KHOẢN | 银行账号", "Số tài khoản"] },
  { key: "bankAccountHolder", label: "Chủ tài khoản", kind: "text", aliases: ["CHỦ TÀI KHOẢN | 开户人", "Chủ tài khoản"] },
  { key: "bankName", label: "Tên ngân hàng", kind: ["radio", "dropdown"], aliases: ["TÊN NGÂN HÀNG | 银行名称", "Tên ngân hàng"] },
  {
    key: "firstCommitment",
    label: "Cam kết tự đăng ký",
    kind: "checkbox",
    // The live form renders the Vietnamese and Chinese headings on separate
    // lines, which DOM text normalizes to a space rather than a vertical bar.
    aliases: ["TÔI CAM KẾT", "本人保证", "TÔI CAM KẾT本人保证", "TÔI CAM KẾT 本人保证", "TÔI CAM KẾT | 本人保证"],
    optionAliases: {
      true: [
        "本人保证未雇用他人代替报名本次考试。",
        "Tôi cam kết không thuê người đăng ký dự thi kỳ thi lần này."
      ]
    }
  },
  {
    key: "termsCommitment", label: "Đồng ý điều khoản", kind: "checkbox",
    aliases: ["TÔI CAM KẾT", "本人保证", "TÔI CAM KẾT本人保证", "TÔI CAM KẾT 本人保证", "TÔI CAM KẾT | 本人保证", "Tôi đã đọc và đồng ý với những điều khoản trên và sẽ chịu trách nhiệm với thông tin dự thi của mình."],
    optionAliases: {true:["本人已详细阅读并同意接受以上条款限制。", "Tôi đã đọc và đồng ý với những điều khoản trên và sẽ chịu trách nhiệm với thông tin dự thi của mình."]}
  }
];

export function emptyProfile(): Profile {
  return {
    values: Object.fromEntries(HSK_RULES.filter((rule) => rule.kind !== "file").map((rule) => [rule.key, ""])),
    customFields: [],
    attachments: {},
    mappings: {}
  };
}

export function getRule(key: string): FieldRule | undefined {
  return HSK_RULES.find((rule) => rule.key === key);
}
