import React, { useState } from 'react';
import { Avatar, Button, Checkbox, Field, Input, Textarea } from '@fluentui/react-components';
import { ArrowLeftRegular, ArrowRightRegular, CheckmarkCircleRegular, ClockRegular, LockClosedRegular, ShieldCheckmarkRegular } from '@fluentui/react-icons';
import type { Account, AccountStatus } from '../../src/account';
import { cloudApi } from './cloud-api';

export const accessLabels: Record<AccountStatus, string> = { pending: 'Chờ duyệt', active: 'Đang hoạt động', blocked: 'Bị khóa', rejected: 'Chưa được chấp thuận', expired: 'Hết hạn' };
export function AccessBadge({ status }: { status: AccountStatus }) {
  return <span className={`access-badge access-${status}`}>{status === 'active' ? <CheckmarkCircleRegular/> : status === 'pending' ? <ClockRegular/> : <LockClosedRegular/>}{accessLabels[status]}</span>;
}
export function Brand() {
  return <a className="brand" href="/" aria-label="HANU"><span className="brand-mark">H</span><span>HANU<span className="brand-sub">Điều phối đăng ký</span></span></a>;
}
export function AccountPage({ account, logout, refresh }: { account: Account; logout: () => Promise<void>; refresh: () => Promise<void> }) {
  const [name, setName] = useState(account.contactName || account.name), [phone, setPhone] = useState(account.phone), [purpose, setPurpose] = useState(account.purpose);
  const [consent, setConsent] = useState(account.profileComplete), [editing, setEditing] = useState(!account.profileComplete && account.role !== 'admin');
  const [busy, setBusy] = useState(false), [error, setError] = useState(''), [notice, setNotice] = useState('');
  const active = account.status === 'active', usable = active && account.emailVerified && (account.profileComplete || account.role === 'admin');
  const titles = { pending: 'Yêu cầu của bạn đang chờ duyệt.', active: 'Không gian của bạn đã sẵn sàng.', blocked: 'Tài khoản đang bị khóa.', rejected: 'Yêu cầu chưa được chấp thuận.', expired: 'Quyền sử dụng đã hết hạn.' };
  const descriptions = { pending: 'Quản trị viên sẽ kiểm tra thông tin và cấp quyền sử dụng cho tài khoản này.', active: 'Quản lý các Chrome profile và bắt đầu lượt đăng ký trong phạm vi quyền được cấp.', blocked: 'Các kết nối và lượt chạy online đã được tạm dừng. Liên hệ quản trị viên để được hỗ trợ.', rejected: 'Liên hệ quản trị viên nếu bạn cần bổ sung thông tin để được xem xét lại.', expired: 'Liên hệ quản trị viên để gia hạn. Hồ sơ và lịch sử của bạn vẫn được giữ lại.' };
  async function save(event: React.FormEvent) {
    event.preventDefault(); setBusy(true); setError(''); setNotice('');
    try {
      await cloudApi<Account>('account', { contactName: name, phone, purpose, consent }, 'PATCH');
      await refresh(); setEditing(false); setNotice('Đã lưu thông tin liên hệ.');
    } catch (e) { setError((e as Error).message); } finally { setBusy(false); }
  }
  async function signOut() { setBusy(true); setError(''); try { await logout(); } catch (e) { setError((e as Error).message); } finally { setBusy(false); } }
  return <div className="account-page">
    <header className="access-topbar"><Brand/><div className="access-top-actions"><span>{account.email}</span><Button appearance="subtle" disabled={busy} onClick={() => void signOut()}>Đăng xuất</Button></div></header>
    <main className="account-layout">
      <section className="account-intro">
        <span className="access-section-label">Tài khoản HANU</span>
        <h1>{editing && !account.profileComplete ? 'Một vài thông tin trước khi bắt đầu.' : titles[account.status]}</h1>
        <p>{editing && !account.profileComplete ? 'Cho chúng tôi biết cách liên hệ và nhu cầu của bạn để xét duyệt quyền sử dụng.' : descriptions[account.status]}</p>
        <ol className="access-journey" aria-label="Tiến trình cấp quyền">
          <li className="done"><CheckmarkCircleRegular/><div><strong>Đăng nhập Google</strong><span>{account.email}</span></div></li>
          <li className={account.profileComplete || account.role === 'admin' ? 'done' : 'current'}>{account.profileComplete || account.role === 'admin' ? <CheckmarkCircleRegular/> : <span className="journey-number">2</span>}<div><strong>Thông tin liên hệ</strong><span>{account.profileComplete ? 'Đã hoàn tất hồ sơ tài khoản' : 'Tên, số điện thoại và nhu cầu sử dụng'}</span></div></li>
          <li className={usable ? 'done' : account.profileComplete ? 'current' : ''}>{usable ? <CheckmarkCircleRegular/> : <span className="journey-number">3</span>}<div><strong>Cấp quyền sử dụng</strong><span>{accessLabels[account.status]}</span></div></li>
        </ol>
        <div className="account-privacy"><ShieldCheckmarkRegular/><p>Thông tin liên hệ dùng để xét duyệt và hỗ trợ tài khoản. Hồ sơ thí sinh được quản lý riêng trong từng profile. <a href="/privacy.html">Chính sách quyền riêng tư</a></p></div>
        <a className="access-privacy-link" href="/privacy.html" target="_blank" rel="noopener noreferrer">Quyền riêng tư và liên hệ hỗ trợ</a>
      </section>
      <section className="account-surface" aria-label="Thông tin tài khoản">
        <div className="account-identity"><Avatar name={account.name} size={48}/><div><strong>{account.name}</strong><span>{account.email}</span></div></div>
        {editing ? <form className="account-form" onSubmit={event => void save(event)}>
          <h2>Thông tin liên hệ</h2>
          <Field label="Tên liên hệ" required><Input autoComplete="name" value={name} maxLength={120} onChange={(_, d) => setName(d.value)} required/></Field>
          <Field label="Số điện thoại / Zalo" required hint="Số bạn thường dùng để nhận hỗ trợ; chưa xác thực bằng OTP."><Input type="tel" autoComplete="tel" value={phone} maxLength={30} onChange={(_, d) => setPhone(d.value)} required/></Field>
          <Field label="Mục đích sử dụng" required hint="Ví dụ: Quản lý hồ sơ đăng ký HSK cho nhóm học viên."><Textarea value={purpose} maxLength={500} resize="vertical" rows={3} onChange={(_, d) => setPurpose(d.value)} required/></Field>
          <Checkbox checked={consent} onChange={(_, d) => setConsent(d.checked === true)} label="Tôi xác nhận thông tin trên và đồng ý dùng thông tin liên hệ để xét duyệt, hỗ trợ tài khoản."/>
          {error && <p className="access-error" role="alert">{error}</p>}
          <div className="access-form-actions"><Button type="submit" appearance="primary" disabled={busy || !consent} icon={<ArrowRightRegular/>}>{busy ? 'Đang lưu…' : 'Lưu thông tin'}</Button>{account.profileComplete && <Button disabled={busy} onClick={() => setEditing(false)}>Hủy</Button>}</div>
        </form> : <div className="account-status-content">
          <AccessBadge status={account.status}/><h2>{usable ? 'Quyền sử dụng của bạn' : 'Thông tin đã được ghi nhận'}</h2>
          {!account.emailVerified && <p className="access-error" role="alert">Email Google chưa được xác minh. Liên hệ quản trị viên để kiểm tra.</p>}
          <dl className="account-facts"><div><dt>Tên liên hệ</dt><dd>{account.contactName || account.name}</dd></div><div><dt>Điện thoại / Zalo</dt><dd>{account.phone || 'Chưa bổ sung'}</dd></div>{active && <><div><dt>Profile tối đa</dt><dd>{account.maxProfiles}</dd></div><div><dt>Chạy đồng thời</dt><dd>{account.maxConcurrent} profile</dd></div><div><dt>Chế độ Live</dt><dd>{account.liveEnabled ? 'Được phép' : 'Chưa cấp quyền'}</dd></div><div><dt>Hạn sử dụng</dt><dd>{account.expiresAt ? new Date(account.expiresAt).toLocaleString('vi-VN') : 'Không giới hạn'}</dd></div></>}</dl>
          {notice && <p className="access-notice" role="status">{notice}</p>}{error && <p className="access-error" role="alert">{error}</p>}
          <div className="access-form-actions">{usable ? <Button as="a" href="/" appearance="primary" icon={<ArrowRightRegular/>}>Vào quản lý profile</Button> : <Button disabled={busy} onClick={() => { setBusy(true); setError(''); void refresh().catch(e => setError(e.message)).finally(() => setBusy(false)); }}>Kiểm tra trạng thái</Button>}<Button appearance="subtle" onClick={() => setEditing(true)}>Sửa thông tin</Button></div>
          {account.role === 'admin' && <a className="access-text-link" href="/admin"><ArrowLeftRegular/> Trang quản trị</a>}
        </div>}
      </section>
    </main>
  </div>;
}
