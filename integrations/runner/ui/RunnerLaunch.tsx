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
  return <div className="runner-launch">
    <Button as="a" href={runnerLaunchUrl(provider, window.location.origin)} onClick={() => setRequested(true)}>
      Mở runner trên máy này
    </Button>
    <p>Nút mở {label} trên máy đang dùng để xem web. Máy đã chọn: <strong>{device?.name || "Chưa chọn"}</strong>{device ? ` · ${device.connected ? "đang kết nối" : "chưa kết nối"}` : ""}.</p>
    <p>Lịch thuộc máy đã chọn. Mở web ở máy khác không chuyển lịch hoặc phiên đăng nhập. Giữ máy thực hiện bật, có mạng và không ngủ.</p>
    {device && <label className="runner-preferred"><input type="checkbox" checked={preference === device.id} onChange={event => {
      const key = `runner.preferred.${provider}.${accountId}`;
      if (event.target.checked) { localStorage.setItem(key, device.id); onSelect(device.id); }
      else localStorage.removeItem(key);
      setPreference(event.target.checked ? device.id : null);
    }}/>Ưu tiên máy này khi mở lại trang trên trình duyệt này</label>}
    {requested && <div className="runner-launch-status" role="status">
      <p>Đã yêu cầu trình duyệt mở {label} Runner. Chọn Mở ứng dụng nếu được hỏi; trạng thái kết nối của máy phía trên mới xác nhận runner đã kết nối.</p>
      <p>Nếu chưa mở được: tải gói mới, giải nén vào thư mục cố định, chạy <strong>Enable web launch</strong> một lần rồi mở <strong>Start {label}</strong> và nhập website này một lần. <a href={`/${provider}-downloads/index.html`} target="_blank" rel="noreferrer">Xem hướng dẫn và tải runner</a>.</p>
      <p>Nếu đang chọn máy khác, kiểm tra và chọn lại đúng máy vừa mở. Nút này không bật runner trên máy ở xa và không tự bật lịch.</p>
    </div>}
  </div>;
}

export function preferredRunner(provider: Provider, accountId: string, devices: RunnerDevice[]) {
  const preferred = localStorage.getItem(`runner.preferred.${provider}.${accountId}`);
  return devices.find(device => device.id === preferred)?.id ?? (devices.length === 1 ? devices[0].id : "");
}
