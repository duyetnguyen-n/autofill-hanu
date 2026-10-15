import React, { useState } from 'react';
import { Avatar, Button } from '@fluentui/react-components';
import { ArrowLeftRegular, ArrowRightRegular, CheckmarkCircleRegular, ClockRegular, LockClosedRegular, ShieldCheckmarkRegular } from '@fluentui/react-icons';
import type { Account, AccountStatus } from '../../src/account';

export const accessLabels: Record<AccountStatus, string> = { pending: 'Chờ duyệt', active: 'Đang hoạt động', blocked: 'Bị khóa', rejected: 'Chưa được chấp thuận', expired: 'Hết hạn' };
export function AccessBadge({ status }: { status: AccountStatus }) {
  return <span className={`access-badge access-${status}`}>{status === 'active' ? <CheckmarkCircleRegular/> : status === 'pending' ? <ClockRegular/> : <LockClosedRegular/>}{accessLabels[status]}</span>;
}
export function Brand() {
  return <a className="brand" href="/" aria-label="HANU"><span className="brand-mark">H</span><span>HANU<span className="brand-sub">Điều phối đăng ký</span></span></a>;
}
export function AccountPage({ account, logout, refresh }: { account: Account; logout: () => Promise<void>; refresh: () => Promise<void> }) {
  const [busy, setBusy] = useState(false), [error, setError] = useState('');
  const usable = account.status === 'active' && account.emailVerified;
  const titles = { pending: 'Yêu cầu của bạn đang chờ duyệt.', active: 'Không gian của bạn đã sẵn sàng.', blocked: 'Tài khoản đang bị khóa.', rejected: 'Yêu cầu chưa được chấp thuận.', expired: 'Quyền sử dụng đã hết hạn.' };
  const descriptions = { pending: 'Bạn đã đăng nhập thành công. Quản trị viên sẽ duyệt tài khoản Google này và cấp quyền sử dụng.', active: 'Quản lý các Chrome profile và bắt đầu lượt đăng ký trong phạm vi quyền được cấp.', blocked: 'Các kết nối và lượt chạy online đã được tạm dừng. Liên hệ quản trị viên để được hỗ trợ.', rejected: 'Liên hệ quản trị viên nếu bạn muốn được xem xét lại quyền sử dụng.', expired: 'Liên hệ quản trị viên để gia hạn. Hồ sơ và lịch sử của bạn vẫn được giữ lại.' };
  async function perform(action: () => Promise<void>) { setBusy(true); setError(''); try { await action(); } catch (e) { setError((e as Error).message); } finally { setBusy(false); } }
  return <div className="account-page">
    <header className="access-topbar"><Brand/><div className="access-top-actions"><span>{account.email}</span><Button appearance="subtle" disabled={busy} onClick={() => void perform(logout)}>Đăng xuất</Button></div></header>
    <main className="account-layout">
      <section className="account-intro">
        <span className="access-section-label">Tài khoản HANU</span>
        <h1>{titles[account.status]}</h1>
        <p>{descriptions[account.status]}</p>
        <ol className="access-journey" aria-label="Tiến trình cấp quyền">
          <li className="done"><CheckmarkCircleRegular/><div><strong>Đăng nhập Google</strong><span>{account.email}</span></div></li>
          <li className={usable ? 'done' : 'current'}>{usable ? <CheckmarkCircleRegular/> : <span className="journey-number">2</span>}<div><strong>Cấp quyền sử dụng</strong><span>{accessLabels[account.status]}</span></div></li>
        </ol>
        <div className="account-privacy"><ShieldCheckmarkRegular/><p>Tên và email từ Google giúp nhận diện tài khoản để xét duyệt. Bạn không cần điền thêm thông tin. <a href="/privacy.html">Chính sách quyền riêng tư</a></p></div>
        <a className="access-privacy-link" href="/privacy.html" target="_blank" rel="noopener noreferrer">Quyền riêng tư và liên hệ hỗ trợ</a>
      </section>
      <section className="account-surface" aria-label="Thông tin tài khoản">
        <div className="account-identity"><Avatar name={account.name} size={48}/><div><strong>{account.name}</strong><span>{account.email}</span></div></div>
        <div className="account-status-content">
          <AccessBadge status={account.status}/><h2>{usable ? 'Quyền sử dụng của bạn' : 'Tài khoản của bạn'}</h2>
          {!account.emailVerified && <p className="access-error" role="alert">Email Google chưa được xác minh. Liên hệ quản trị viên để kiểm tra.</p>}
          <dl className="account-facts"><div><dt>Tên Google</dt><dd>{account.name || 'Chưa có tên'}</dd></div><div><dt>Ngày đăng ký</dt><dd>{new Date(account.createdAt).toLocaleDateString('vi-VN')}</dd></div>{usable && <><div><dt>Profile tối đa</dt><dd>{account.maxProfiles}</dd></div><div><dt>Chạy đồng thời</dt><dd>{account.maxConcurrent} profile</dd></div><div><dt>Chế độ Live</dt><dd>{account.liveEnabled ? 'Được phép' : 'Chưa cấp quyền'}</dd></div><div><dt>Hạn sử dụng</dt><dd>{account.expiresAt ? new Date(account.expiresAt).toLocaleString('vi-VN') : 'Không giới hạn'}</dd></div></>}</dl>
          {error && <p className="access-error" role="alert">{error}</p>}
          <div className="access-form-actions">{usable ? <Button as="a" href="/" appearance="primary" icon={<ArrowRightRegular/>}>Vào quản lý profile</Button> : <Button disabled={busy} onClick={() => void perform(refresh)}>{busy ? 'Đang kiểm tra…' : 'Kiểm tra trạng thái'}</Button>}</div>
          {account.role === 'admin' && <a className="access-text-link" href="/admin"><ArrowLeftRegular/> Trang quản trị</a>}
        </div>
      </section>
    </main>
  </div>;
}
