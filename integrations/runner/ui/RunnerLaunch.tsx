import React, { useState, useEffect } from "react";
import { Button } from "@fluentui/react-components";
import { runnerLaunchUrl, type Provider } from "../launch";
import "./runner-launch.css";

type RunnerDevice = { id: string; name: string; connected: boolean };
export function RunnerLaunch({ provider, device, accountId, onSelect }: {
  provider: Provider; device?: RunnerDevice; accountId: string; onSelect(id: string): void;
}) {
  const [requested, setRequested] = useState(false);
  const preferenceKey = `runner.preferred.${provider}.${accountId}`;
  const [preference, setPreference] = useState(() => localStorage.getItem(preferenceKey));
  useEffect(() => { setPreference(localStorage.getItem(preferenceKey)); setRequested(false); }, [preferenceKey]);
  const label = provider === "hcmue" ? "HCMUE" : "ChineseTest";
  const guideUrl = `/${provider}-downloads/index.html`;
  return <div className="runner-launch">
    <div className="runner-launch-actions">
      <Button as="a" href={runnerLaunchUrl(provider, window.location.origin)} onClick={() => setRequested(true)}>
        Mở runner trên máy này
      </Button>
      <a href={guideUrl} target="_blank" rel="noreferrer">Cài runner lần đầu / mở không được</a>
    </div>
    <p>Lần đầu: <a href={`${guideUrl}#tai-runner`} target="_blank" rel="noreferrer">tải runner</a> → giải nén vào thư mục cố định → mở <strong>Start {label}</strong> → nhập địa chỉ <strong>{window.location.origin}</strong>. Runner tự thiết lập nút mở từ web và nhớ địa chỉ cho lần sau.</p>
    <p>Nút mở {label} trên máy đang dùng để xem web. Máy đã chọn: <strong>{device?.name || "Chưa chọn"}</strong>{device ? ` · ${device.connected ? "đang kết nối" : "chưa kết nối"}` : ""}.</p>
    <p>Lịch thuộc máy đã chọn. Mở web ở máy khác không chuyển lịch hoặc phiên đăng nhập. Giữ máy thực hiện bật, có mạng và không ngủ.</p>
    {device && <label className="runner-preferred"><input type="checkbox" checked={preference === device.id} onChange={event => {
      const key = `runner.preferred.${provider}.${accountId}`;
      if (event.target.checked) { localStorage.setItem(key, device.id); onSelect(device.id); }
      else localStorage.removeItem(key);
      setPreference(event.target.checked ? device.id : null);
    }}/>Ưu tiên máy này khi mở lại trang trên trình duyệt này</label>}
    {requested && <div className="runner-launch-status" role="status">
      <p>Chọn <strong>Mở ứng dụng</strong> trong thông báo của trình duyệt để mở {label} Runner. Chờ máy phía trên hiện <strong>đang kết nối</strong> để xác nhận.</p>
      <p>Nếu không có thông báo hoặc chưa mở được: mở <strong>Start {label}</strong> trong thư mục đã giải nén để thiết lập lại nút. Với gói cũ có thể chạy <strong>Enable web launch</strong>, hoặc <a href={guideUrl} target="_blank" rel="noreferrer">tải gói mới và xem hướng dẫn</a>.</p>
      <p>Nếu đang chọn máy khác, kiểm tra và chọn lại đúng máy vừa mở. Nút này không bật runner trên máy ở xa và không tự bật lịch.</p>
    </div>}
  </div>;
}

export function preferredRunner(provider: Provider, accountId: string, devices: RunnerDevice[]) {
  const preferred = localStorage.getItem(`runner.preferred.${provider}.${accountId}`);
  return devices.find(device => device.id === preferred)?.id ?? (devices.length === 1 ? devices[0].id : "");
}
