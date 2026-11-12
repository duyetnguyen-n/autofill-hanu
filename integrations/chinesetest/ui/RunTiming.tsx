import React from "react";
import type { Run, TimingStage } from "../protocol";

const clock = new Intl.DateTimeFormat("vi-VN", {
  timeZone: "Asia/Ho_Chi_Minh", hour: "2-digit", minute: "2-digit", second: "2-digit", fractionalSecondDigits: 3, hourCycle: "h23",
});
const seconds = new Intl.NumberFormat("vi-VN", { maximumFractionDigits: 3 });
const duration = (ms: number) => `${seconds.format(ms / 1000)} giây`;
const stages: [TimingStage, string][] = [
  ["sites", "Đọc danh sách điểm thi"],
  ["pollWait", "Nghỉ giữa các lượt dò"],
  ["retryWait", "Chờ thử lại sau lỗi"],
  ["inspect", "Kiểm tra điều kiện đăng ký"],
  ["capacity", "Kiểm tra điểm thi có nhận đăng ký"],
  ["region", "Kiểm tra hệ thống đăng ký của điểm thi"],
  ["linked", "Đọc môn thi đi kèm"],
  ["validateLinked", "Xác minh môn thi đi kèm"],
  ["fee", "Đối chiếu lệ phí"],
  ["identity", "Xác minh phiên trước khi gửi"],
  ["records", "Đối chiếu đăng ký trùng"],
  ["reserve", "Lưu khóa gửi"],
  ["submit", "Gọi API gửi đơn"],
];

export function RunTiming({ run }: { run: Pick<Run, "target" | "timing" | "attempt" | "agreedFeeAtOpening"> }) {
  const { timing, attempt, target } = run;
  if (!timing && attempt.sentAt === undefined) return null;
  const milestones: [string, number | undefined][] = [
    ["Giờ đặt", target.targetAt],
    ["Runner bắt đầu dò", timing?.startedAt],
    ["Lần đầu thấy đúng điểm thi", timing?.centerSeenAt],
    ["Kiểm tra điều kiện tại điểm thi đạt", timing?.eligibleAt],
    ["Runner bắt đầu gửi", attempt.sentAt],
    ["Nhận phản hồi gửi", attempt.receivedAt],
  ];
  return <details className="ct-run-timing">
    <summary>Chi tiết thời gian</summary>
    <dl>
      {milestones.map(([label, at]) => at !== undefined && <React.Fragment key={label}>
        <dt>{label}</dt><dd><time dateTime={new Date(at).toISOString()}>{clock.format(at)}</time></dd>
      </React.Fragment>)}
    </dl>
    {attempt.lateMs !== undefined && <p>Từ giờ đặt đến lúc bắt đầu gửi {duration(attempt.lateMs)}.</p>}
    {timing ? <>
      <p>Số lượt dò chưa thấy điểm thi {timing.missingCenter}. Số lượt đã thấy điểm thi nhưng chưa đủ điều kiện {timing.notReady}.</p>
      {run.agreedFeeAtOpening && <p>Lượt Live này bỏ qua API đối chiếu lệ phí.</p>}
      <ul>
        {stages.map(([key, label]) => {
          const stats = timing.stages[key];
          if (!stats?.count) return null;
          return <li key={key}><strong>{label}</strong><span>
            {stats.count === 1 ? duration(stats.totalMs) : `${stats.count} lượt, tổng ${duration(stats.totalMs)}, lâu nhất ${duration(stats.maxMs)}`}
            {stats.errors > 0 && ` · ${stats.errors} lỗi`}
            {stats.lastErrorCode !== undefined && ` · mã lỗi gần nhất ${stats.lastErrorCode}`}
          </span></li>;
        })}
      </ul>
      <p>Một số API được gọi song song và đã nằm trong thời gian kiểm tra điều kiện.</p>
    </> : <p>Lượt này hiển thị các mốc gửi và nhận phản hồi đã lưu. Runner ghi thêm từng bước cho các lượt mới sau khi cập nhật.</p>}
  </details>;
}
