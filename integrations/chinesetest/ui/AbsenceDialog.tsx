import React, { useEffect, useRef, useState } from "react";
import { Button, Dialog, DialogSurface, DialogBody, DialogTitle, DialogContent, DialogActions } from "@fluentui/react-components";
import type { Command, Row, RunnerState } from "../protocol";
import { useActivateModal } from "@fluentui/react-tabster";

export function AbsenceDialog({ id, request, close, verified }: {
  id: string; request(command: Command, args?: Row): Promise<any>; close(): void; verified(state: RunnerState): void;
}) {
  const [confirmed, setConfirmed] = useState(false), [working, setWorking] = useState(false), [error, setError] = useState("");
  const surface=useRef<HTMLDivElement>(null),activateModal=useActivateModal();
  useEffect(()=>{activateModal(surface.current || undefined);},[activateModal]);
  async function verify() {
    if (working || !confirmed) return;
    surface.current?.focus();
    setWorking(true); setError("");
    try {
      const result = await request("verify-absent", { id, confirm: true });
      if (!result?.schedules?.some((run: Row) => run.id === id && run.verifiedAbsent === true)) throw new Error("Runner chưa xác nhận mở khóa lượt này. Đọc lại trạng thái trước khi thử tiếp.");
      verified(result);
    } catch (e) {
      const message = (e as Error).message;
      setError(message.includes("Chỉ xác minh lượt chưa rõ kết quả sau")
        ? "Runner đang dùng bản cũ, chưa hỗ trợ mở khóa lượt đã đăng ký thành công. Cập nhật ChineseTest Runner rồi thử lại; khóa hiện vẫn được giữ."
        : message);
    } finally { setWorking(false); }
  }
  return <Dialog surfaceMotion={null} inertTrapFocus open onOpenChange={(_, data) => { if (!data.open && !working) close(); }}><DialogSurface ref={surface} className="ct-dialog ct-absence-dialog"><DialogBody>
    <DialogTitle>Đối chiếu trước khi mở khóa gửi</DialogTitle>
    <DialogContent>
      <p>Kiểm tra Test Records đúng tài khoản/ngày/cấp thi. Nếu đã đăng ký thành công, hãy hủy trên ChineseTest trước. Dừng lượt đang xử lý và chờ hoàn tất. Runner sẽ đọc lại Test Records; chỉ mở khóa khi không còn đăng ký cùng cấp/ngày. Lịch sử lượt cũ được giữ nguyên.</p>
      <label className="ct-check"><input type="checkbox" checked={confirmed} disabled={working} onChange={e => setConfirmed(e.target.checked)}/>Tôi đã xác minh đăng ký cũ đã hủy hoặc chưa tạo đăng ký, và không còn request chờ xử lý.</label>
      {working && <p role="status">Đang kiểm tra phiên đăng nhập và Test Records trên ChineseTest…</p>}
      {error && <div className="ct-error" role="alert">{error}</div>}
    </DialogContent>
    <DialogActions><Button disabled={working} onClick={close}>Đóng</Button><Button appearance="primary" disabled={!confirmed || working} onClick={() => void verify()}>{working ? "Đang xác minh…" : "Ghi nhận đã xác minh"}</Button></DialogActions>
  </DialogBody></DialogSurface></Dialog>;
}
