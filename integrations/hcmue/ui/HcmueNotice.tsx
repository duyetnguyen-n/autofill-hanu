import { createContext, useContext, useState, type ReactNode } from "react";
import { CheckCircle, Info, Warning, X } from "@phosphor-icons/react";
import type { AssistantScope } from "./HcmueAssistant";

export const NoticeAssistant = createContext<((scope: AssistantScope) => void) | undefined>(undefined);

export interface HcmueProblem {
  code: string;
  title: string;
  steps: string[];
  category?: string;
  detail?: string;
}

export function hcmueError(message: string, operation: string): HcmueProblem {
  const detail = message;
  if (/phiên đăng nhập đã hết hạn|đăng nhập trên thiết bị khác|token không hợp lệ/i.test(message)) {
    return {
      code: "HC-PHIEN", title: "HCMUE không chấp nhận phiên đăng nhập", category: "Tài khoản",
      steps: ["Đăng nhập lại cùng tài khoản trong mục Thêm tài khoản.", "Chạy Kiểm tra hồ sơ/API trước khi chuẩn bị lịch."], detail,
    };
  }
  if (/hết thời gian chờ|mất kết nối khi đọc|kết nối HCMUE bị ngắt|không đọc được trạng thái kỳ thi|HTTP 5\d\d|ECONNREFUSED/i.test(message)) {
    return {
      code: "HC-KET-NOI", title: `HCMUE chưa phản hồi khi ${operation.toLowerCase()}`, category: "Kết nối",
      steps: operation === "đăng nhập"
        ? ["Chờ HCMUE phản hồi trở lại.", "Nhập lại mật khẩu trong hộp này, rồi bấm Đăng nhập."]
        : ["Nếu đã gửi yêu cầu đăng ký, bấm Kiểm tra kết quả trước.", "Khi HCMUE phản hồi, thử lại bước đang thực hiện."], detail,
    };
  }
  if (/máy chạy chưa kết nối|mất kết nối runner|chưa kết nối được website/i.test(message)) {
    return {
      code: "HC-RUNNER-OFFLINE", title: "Website mất kết nối với Runner", category: "Kết nối",
      steps: ["Kiểm tra Runner còn mở và máy có mạng.", "Bấm Đọc lại trạng thái để xem lịch đã lưu trên máy."], detail,
    };
  }
  if (/CCCD hoặc mật khẩu|CCCD không tồn tại|CCCD và mật khẩu hợp lệ/i.test(message)) {
    return {
      code: "HC-THONG-TIN-DANG-NHAP", title: "HCMUE từ chối thông tin đăng nhập", category: "Tài khoản",
      steps: ["Kiểm tra số CCCD và mật khẩu HCMUE rồi nhập lại."], detail,
    };
  }
  if (/xung đột lịch|trùng lịch/i.test(message) && !/không có xung đột/i.test(message)) {
    return {
      code: "HC-TRUNG-LICH", title: "HCMUE báo xung đột lịch thi", category: "Kỳ thi",
      steps: ["Mở lịch sử HCMUE để xem kỳ thi đã đăng ký.", "Chọn kỳ thi khác hoặc xử lý lịch đang trùng trên cổng trường."], detail,
    };
  }
  if (/chưa rõ|chưa đủ bằng chứng|cần đối chiếu kết quả|chưa có xác nhận/i.test(message)) {
    return {
      code: "HC-DOI-CHIEU", title: "Chưa xác nhận được kết quả", category: "Kết quả",
      steps: ["Bấm Kiểm tra kết quả để đối chiếu với HCMUE.", "Kiểm tra mã đơn trong lịch sử HCMUE trước khi gửi lại."], detail,
    };
  }
  if (/hết chỗ|số chỗ đã đủ/i.test(message)) {
    return {
      code: "HC-HET-CHO", title: "HCMUE báo kỳ thi đã hết chỗ", category: "Kỳ thi",
      steps: ["Bấm Tải kỳ thi để cập nhật số chỗ.", "Chọn đợt còn chỗ nếu muốn chuẩn bị một lịch khác."], detail,
    };
  }
  if (/ảnh thẻ|xác thực email/i.test(message)) {
    return {
      code: "HC-HO-SO", title: "Hồ sơ HCMUE cần hoàn thiện", category: "Tài khoản",
      steps: ["Mở hồ sơ trên cổng HCMUE để bổ sung mục trường yêu cầu.", "Quay lại và chạy Kiểm tra hồ sơ/API."], detail,
    };
  }
  return {
    code: "HC-THAO-TAC", title: message, detail: operation,
    steps: ["Xem chi tiết của thao tác đang lỗi.", "Đọc lại trạng thái máy hoặc chạy Kiểm tra hồ sơ/API để xác định bước cần làm lại."],
  };
}

export function HcmueNotice({ problem, kind = "warning", event = false, onDismiss, action, id, assistantScope }: {
  problem: HcmueProblem;
  kind?: "warning" | "error" | "success";
  event?: boolean;
  onDismiss?: () => void;
  action?: ReactNode;
  id?: string;
  assistantScope?: AssistantScope;
}) {
  const [timestamp] = useState(() => new Date());
  const ask = useContext(NoticeAssistant);
  const Icon = kind === "success" ? CheckCircle : kind === "error" ? Warning : Info;
  return (
    <div id={id} className={`hc-alert-card hc-alert-${kind}`} role={kind === "error" ? "alert" : "status"}>
      <div className="hc-alert-heading">
        <span className="hc-alert-symbol"><Icon size={17} weight="bold" aria-hidden="true" /></span>
        <div>
          <div className="hc-alert-category">{problem.category ?? "Nghiệp vụ"} · {kind === "success" ? "Hoàn tất" : "Cần xử lý"}</div>
          <strong>{problem.title}</strong>
        </div>
        {onDismiss && <button type="button" className="hc-alert-dismiss" aria-label="Đóng thông báo" onClick={onDismiss}><X size={15} /></button>}
      </div>
      {!!problem.steps.length && <div className="hc-alert-steps">
        <strong>Cách xử lý</strong>
        <ol>{problem.steps.map(step => <li key={step}>{step}</li>)}</ol>
        {action}
      </div>}
      <div className="hc-alert-meta">
        <code>{problem.code}</code>
        {event && <time dateTime={timestamp.toISOString()}>{timestamp.toLocaleTimeString("vi-VN", { hour: "2-digit", minute: "2-digit", timeZone: "Asia/Ho_Chi_Minh" })}</time>}
        {ask && kind !== "success" && <button className="hc-alert-ask" type="button" onClick={() => ask({ noticeCode: problem.code, ...assistantScope })}>Hỏi AI</button>}
        {problem.detail && <details><summary>Chi tiết</summary><div>{problem.detail}</div></details>}
      </div>
    </div>
  );
}
