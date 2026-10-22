import React, { useCallback, useEffect, useState } from 'react';
import { Avatar, Button, Checkbox, Dialog, DialogActions, DialogBody, DialogContent, DialogSurface, DialogTitle, Field, Input, Select, Textarea } from '@fluentui/react-components';
import { AddRegular, ArrowLeftRegular, ArrowRightRegular, ArrowSyncRegular, ChevronRightRegular, DismissRegular, HistoryRegular, MailAddRegular, PeopleRegular, SearchRegular, ShieldCheckmarkRegular, WeatherMoonRegular, WeatherSunnyRegular } from '@fluentui/react-icons';
import type { Account, AccessGrant, AdminEvent, ManagedAccount } from '../../src/account';
import { AccessBadge, accessLabels, Brand } from './AccountPage';
import { cloudApi } from './cloud-api';

type Summary = { total: number; pending: number; active: number; blocked: number; expired: number };
type UserList = { accounts: ManagedAccount[]; total: number; page: number; pageSize: number; summary: Summary };
interface Session { id: string; name: string; extensionId: string; connected: boolean; revoked: boolean; lastSeenAt: string | null; runStatus: string | null }
type Detail = { account: ManagedAccount; sessions: Session[]; events: AdminEvent[] };
type Limits = { maxProfiles: number; maxConcurrent: number; liveEnabled: boolean; expiresAt: string | null };
const defaultLimits: Limits = { maxProfiles: 5, maxConcurrent: 3, liveEnabled: false, expiresAt: null };
const date = (value?: string | null) => value ? new Date(value).toLocaleString('vi-VN', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : 'Chưa có';
function localDate(value: string | null) {
  if (!value) return '';
  const time = new Date(value); return new Date(time.getTime() - time.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
}
const actionLabels: Record<string, string> = { update_access: 'Thay đổi quyền sử dụng', create_grant: 'Cấp quyền trước theo email', delete_grant: 'Thu hồi quyền cấp trước', claim_grant: 'Kích hoạt quyền cấp trước', bootstrap_admin: 'Thiết lập quản trị viên', promote_admin: 'Cấp quyền quản trị', revoke_extension: 'Thu hồi liên kết extension' };

function LimitsFields({ value, onChange, disabled }: { value: Limits; onChange: (value: Limits) => void; disabled?: boolean }) {
  return <div className="access-limits-fields">
    <Field label="Profile tối đa" required><Input type="number" min={1} max={100} value={String(value.maxProfiles)} disabled={disabled} onChange={(_, d) => onChange({ ...value, maxProfiles: Number(d.value) })}/></Field>
    <Field label="Chạy đồng thời" required><Input type="number" min={1} max={value.maxProfiles} value={String(value.maxConcurrent)} disabled={disabled} onChange={(_, d) => onChange({ ...value, maxConcurrent: Number(d.value) })}/></Field>
    <Field className="access-full-width" label="Hết hạn" hint="Giờ trên thiết bị của bạn. Để trống nếu không giới hạn."><Input type="datetime-local" value={localDate(value.expiresAt)} disabled={disabled} onChange={(_, d) => onChange({ ...value, expiresAt: d.value && Number.isFinite(Date.parse(d.value)) ? new Date(d.value).toISOString() : null })}/></Field>
    <Checkbox className="access-full-width" checked={value.liveEnabled} disabled={disabled} onChange={(_, d) => onChange({ ...value, liveEnabled: d.checked === true })} label="Cho phép chạy Live và tự gửi form"/>
  </div>;
}
function EventList({ events }: { events: AdminEvent[] }) {
  if (!events.length) return <div className="access-empty compact"><HistoryRegular/><h3>Chưa có thay đổi</h3><p>Các thao tác quản trị sẽ xuất hiện tại đây.</p></div>;
  return <ol className="admin-event-list">{events.map(event => <li key={event.id}>
    <span className="admin-event-icon"><HistoryRegular/></span><div><strong>{actionLabels[event.action] ?? event.action}</strong><p>{event.targetEmail}</p><span>{event.actorEmail === 'system' ? 'Hệ thống' : event.actorEmail} <span aria-hidden="true">·</span> {date(event.at)}</span>
      {event.action === 'update_access' && <details><summary>Xem thay đổi</summary>{(['before', 'after'] as const).map(key => {
        const change = event.details[key] as Record<string, unknown> | undefined;
        return change && <p key={key}>{key === 'before' ? 'Trước' : 'Sau'}: {accessLabels[change.status as keyof typeof accessLabels] ?? String(change.status)}, {String(change.maxProfiles)} profile, {String(change.maxConcurrent)} đồng thời, Live {change.liveEnabled ? 'bật' : 'tắt'}, hết hạn {change.expiresAt ? date(String(change.expiresAt)) : 'không giới hạn'}{change.adminNote ? `, ghi chú: ${String(change.adminNote)}` : ''}</p>;
      })}</details>}
    </div></li>)}</ol>;
}
function UserDrawer({ id, close, changed }: { id: string | undefined; close: () => void; changed: () => void }) {
  const [detail, setDetail] = useState<Detail>(), [draft, setDraft] = useState<ManagedAccount>(), [tab, setTab] = useState('access');
  const [busy, setBusy] = useState(false), [error, setError] = useState(''), [notice, setNotice] = useState('');
  const [confirm, setConfirm] = useState<{ status?: string; session?: Session; promote?: boolean }>();
  const load = useCallback(async () => { if(!id)return; const result = await cloudApi<Detail>(`admin/accounts/${id}`); setDetail(result); setDraft(result.account); }, [id]);
  useEffect(() => { if(!id)return; setDetail(undefined);setDraft(undefined);setTab('access');setError('');setNotice('');setConfirm(undefined);let stopped = false; void cloudApi<Detail>(`admin/accounts/${id}`).then(result => { if (!stopped) { setDetail(result); setDraft(result.account); } }).catch(e => { if (!stopped) setError(e.message); }); return () => { stopped = true; }; }, [id]);
  async function save(status?: string) {
    if (!draft) return;
    const finalStatus = status ?? (draft.status === 'expired' ? 'active' : draft.status);
    if (!status && ['blocked', 'rejected'].includes(finalStatus) && finalStatus !== detail?.account.status) { setConfirm({ status: finalStatus }); return; }
    setBusy(true); setError(''); setNotice('');
    try {
      const result = await cloudApi<{interrupted:boolean}>(`admin/accounts/${id}`, { status: finalStatus, maxProfiles: draft.maxProfiles, maxConcurrent: draft.maxConcurrent, liveEnabled: draft.liveEnabled, expiresAt: draft.expiresAt, adminNote: draft.adminNote, version: draft.version }, 'PATCH');
      await load(); changed(); setNotice(`Đã lưu quyền sử dụng.${result.interrupted ? ' Các kết nối cũ đã được ngắt để áp dụng quyền mới.' : ''}`); setConfirm(undefined);
    } catch (e) { setError((e as Error).message); setConfirm(undefined); } finally { setBusy(false); }
  }
  async function promote() {
    if (!detail) return;
    setBusy(true); setError(''); setNotice('');
    try {
      await cloudApi(`admin/accounts/${id}/promote-admin`, { version: detail.account.version });
      await load(); changed(); setNotice('Đã cấp quyền quản trị. Tài khoản có thể mở trang Quản trị ngay.');
    } catch (e) { setError((e as Error).message); }
    finally { setBusy(false); setConfirm(undefined); }
  }
  async function revoke(session: Session) {
    setBusy(true); setError(''); setNotice('');
    try { await cloudApi(`admin/accounts/${id}/sessions/${session.id}/revoke`, {}); await load(); changed(); setNotice(`Đã thu hồi liên kết ${session.name}.`); }
    catch (e) { setError((e as Error).message); } finally { setBusy(false); setConfirm(undefined); }
  }
  return <Dialog surfaceMotion={null} inertTrapFocus open={!!id} onOpenChange={(_, d) => { if (!d.open && !busy) close(); }}><DialogSurface className="admin-drawer"><DialogBody>
    <DialogTitle action={<Button appearance="subtle" icon={<DismissRegular/>} aria-label="Đóng chi tiết tài khoản" disabled={busy} onClick={close}/>}>Chi tiết tài khoản</DialogTitle>
    <DialogContent>
      {error && <p className="access-error" role="alert">{error}<Button size="small" appearance="subtle" disabled={busy} onClick={() => { setError(''); void load().catch(e => setError(e.message)); }}>Tải lại</Button></p>}
      {!detail || !draft ? <div className="access-skeleton-block" role="status" aria-label="Đang tải tài khoản"/> : <>
        <div className="admin-detail-identity"><Avatar name={draft.name} size={56}/><div><h2>{draft.name}</h2><span>{draft.email}</span><AccessBadge status={detail.account.status}/></div></div>
        {notice && <p className="access-notice" role="status">{notice}</p>}
        <div className="admin-detail-tabs" role="tablist" aria-label="Chi tiết người dùng">{[['access', 'Quyền sử dụng'], ['profiles', `Profile (${detail.sessions.length})`], ['history', 'Nhật ký']].map(([key, label]) => <button key={key} role="tab" aria-selected={tab === key} onClick={() => setTab(key)}>{label}</button>)}</div>
        <section role="tabpanel" className="admin-detail-body">
          {tab === 'access' && <>
            <section className="admin-role-section" aria-label="Vai trò tài khoản">
              <div className="admin-role-heading"><span className="admin-role-icon"><ShieldCheckmarkRegular/></span><div><h3>Vai trò tài khoản</h3><span className={`admin-role-badge ${draft.role === 'admin' ? 'is-admin' : ''}`}>{draft.role === 'admin' ? 'Quản trị viên' : 'Thành viên'}</span></div></div>
              <p>{draft.role === 'admin' ? 'Có quyền quản lý người dùng, cấp quyền sử dụng và bổ nhiệm quản trị viên.' : 'Quản trị viên được duyệt tài khoản, quản lý quyền sử dụng và cấp quyền quản trị cho người khác.'}</p>
              {draft.role !== 'admin' && <><Button icon={<ShieldCheckmarkRegular/>} disabled={busy || !!confirm || !detail.account.emailVerified || detail.account.status !== 'active'} onClick={() => setConfirm({ promote: true })}>Cấp quyền quản trị</Button><small>{!detail.account.emailVerified ? 'Cần xác minh email Google trước khi cấp quyền.' : detail.account.status !== 'active' ? 'Duyệt tài khoản và lưu trạng thái Hoạt động trước khi cấp quyền quản trị.' : 'Quyền quản trị không hết hạn. Giữ nguyên hạn mức profile và quyền Live.'}</small></>}
            </section>
            <dl className="account-facts"><div><dt>Email Google</dt><dd>{draft.emailVerified ? 'Đã xác minh' : 'Chưa xác minh'}</dd></div><div><dt>Đăng ký</dt><dd>{date(draft.createdAt)}</dd></div><div><dt>Đăng nhập gần nhất</dt><dd>{date(draft.lastLoginAt)}</dd></div><div><dt>Hoạt động gần nhất</dt><dd>{date(draft.lastSeenAt)}</dd></div><div><dt>Lượt Test / Live</dt><dd>{draft.testRuns} / {draft.liveRuns}</dd></div></dl>
            <h3>Quyền sử dụng</h3>
            <Field label="Trạng thái"><Select value={draft.status === 'expired' ? 'active' : draft.status} disabled={busy || draft.role === 'admin'} onChange={e => setDraft({ ...draft, status: e.target.value as ManagedAccount['status'] })}><option value="pending">Chờ duyệt</option><option value="active">Đang hoạt động</option><option value="blocked">Bị khóa</option><option value="rejected">Chưa được chấp thuận</option></Select></Field>
            <LimitsFields value={draft} disabled={busy || draft.role === 'admin'} onChange={value => setDraft({ ...draft, ...value })}/>
            <Field label="Ghi chú nội bộ" hint="Chỉ quản trị viên nhìn thấy."><Textarea rows={3} resize="vertical" maxLength={2000} value={draft.adminNote} disabled={busy || draft.role === 'admin'} onChange={(_, d) => setDraft({ ...draft, adminNote: d.value })}/></Field>
          </>}
          {tab === 'profiles' && (detail.sessions.length ? <div className="admin-session-list">{detail.sessions.map(session => <article key={session.id}><div><strong>{session.name}</strong><span>{session.revoked ? 'Đã thu hồi' : session.connected ? 'Đang kết nối' : 'Mất kết nối'}</span><code>{session.extensionId || 'Chưa liên kết extension'}</code><small>Gần nhất: {date(session.lastSeenAt)}</small></div><Button size="small" disabled={busy || session.revoked} onClick={() => setConfirm({ session })}>Thu hồi</Button></article>)}</div> : <div className="access-empty compact"><h3>Chưa có profile</h3><p>Người dùng chưa liên kết Chrome profile nào.</p></div>)}
          {tab === 'history' && <EventList events={detail.events}/>}
        </section>
        {confirm && <div className="admin-confirm" role="alert"><strong>{confirm.promote ? `Cấp quyền quản trị cho ${detail?.account.email}?` : confirm.session ? `Thu hồi liên kết ${confirm.session.name}?` : confirm.status === 'blocked' ? 'Khóa tài khoản này?' : 'Từ chối yêu cầu sử dụng?'}</strong><p>{confirm.promote ? 'Người này sẽ được quản lý tài khoản, thay đổi quyền sử dụng và cấp quyền quản trị cho người khác. Tài khoản sẽ không còn ngày hết hạn; giữ nguyên hạn mức profile và quyền Live. Kiểm tra đúng email trước khi xác nhận.' : 'Các lượt đang chạy sẽ được dừng an toàn và giữ khóa gửi để đối chiếu.'}</p><div><Button disabled={busy} appearance="primary" onClick={() => confirm.promote ? void promote() : confirm.session ? void revoke(confirm.session) : void save(confirm.status)}>{busy ? 'Đang xử lý…' : confirm.promote ? 'Xác nhận cấp quyền quản trị' : 'Xác nhận'}</Button><Button disabled={busy} onClick={() => setConfirm(undefined)}>Hủy</Button></div></div>}
      </>}
    </DialogContent>
    <DialogActions>{draft && tab === 'access' && draft.role !== 'admin' && <Button appearance="primary" disabled={busy || !!confirm} onClick={() => void save()}>{busy ? 'Đang lưu…' : 'Lưu quyền sử dụng'}</Button>}<Button disabled={busy} onClick={close}>Đóng</Button></DialogActions>
  </DialogBody></DialogSurface></Dialog>;
}
function GrantDialog({ open, close, changed }: { open: boolean; close: () => void; changed: () => void }) {
  const [email, setEmail] = useState(''), [limits, setLimits] = useState(defaultLimits), [error, setError] = useState(''), [busy, setBusy] = useState(false);
  useEffect(()=>{if(open){setEmail('');setLimits(defaultLimits);setError('');}},[open]);
  async function save(event: React.FormEvent) { event.preventDefault(); setBusy(true); setError(''); try { await cloudApi('admin/grants', { email, ...limits }); changed(); close(); } catch (e) { setError((e as Error).message); } finally { setBusy(false); } }
  return <Dialog surfaceMotion={null} inertTrapFocus open={open} onOpenChange={(_, d) => { if (!d.open && !busy) close(); }}><DialogSurface className="admin-grant-dialog"><form onSubmit={event => void save(event)}><DialogBody><DialogTitle>Cấp quyền trước theo email</DialogTitle><DialogContent><p className="access-help">Dành cho người chưa đăng nhập. Quyền có hiệu lực ngay khi họ đăng nhập đúng email Google đã xác minh.</p><Field label="Email Google" required><Input autoFocus type="email" value={email} maxLength={254} required onChange={(_, d) => setEmail(d.value)} disabled={busy}/></Field><LimitsFields value={limits} onChange={setLimits} disabled={busy}/>{error && <p className="access-error" role="alert">{error}</p>}</DialogContent><DialogActions><Button disabled={busy} onClick={close}>Hủy</Button><Button type="submit" appearance="primary" disabled={busy}>{busy ? 'Đang lưu…' : 'Cấp quyền'}</Button></DialogActions></DialogBody></form></DialogSurface></Dialog>;
}

export function AdminPage({ account, logout, dark, toggleTheme }: { account: Account; logout: () => Promise<void>; dark: boolean; toggleTheme: () => void }) {
  const [section, setSection] = useState('users'), [filter, setFilter] = useState('all'), [query, setQuery] = useState(''), [search, setSearch] = useState(''), [page, setPage] = useState(1);
  const [data, setData] = useState<UserList>(), [grants, setGrants] = useState<AccessGrant[]>([]), [events, setEvents] = useState<AdminEvent[]>([]);
  const [loading, setLoading] = useState(true), [error, setError] = useState(''), [revision, setRevision] = useState(0), [selected, setSelected] = useState<string>(), [grantOpen, setGrantOpen] = useState(false), [deleting, setDeleting] = useState<string>();
  const [confirmDelete, setConfirmDelete] = useState<string>();
  useEffect(() => { const timer = setTimeout(() => { setSearch(query); setPage(1); }, 250); return () => clearTimeout(timer); }, [query]);
  const reload = () => setRevision(old => old + 1);
  useEffect(() => {
    let stopped = false; setLoading(true); setError('');
    const params = new URLSearchParams({ q: search, status: filter, page: String(page) });
    const work = section === 'users' ? cloudApi<UserList>(`admin/accounts?${params}`).then(result => { if (!stopped) setData(result); }) : section === 'grants' ? cloudApi<AccessGrant[]>('admin/grants').then(result => { if (!stopped) setGrants(result); }) : cloudApi<AdminEvent[]>('admin/events').then(result => { if (!stopped) setEvents(result); });
    void work.catch(e => { if (!stopped) setError(e.message); }).finally(() => { if (!stopped) setLoading(false); });
    return () => { stopped = true; };
  }, [section, filter, search, page, revision]);
  useEffect(() => { const timer = setInterval(() => setRevision(old => old + 1), 60000); return () => clearInterval(timer); }, []);
  async function removeGrant(email: string) { setDeleting(email); setError(''); try { await cloudApi('admin/grants', { email }, 'DELETE'); setConfirmDelete(undefined); reload(); } catch (e) { setError((e as Error).message); } finally { setDeleting(undefined); } }
  const titles: Record<string, [string, string]> = { users: ['Người dùng', 'Duyệt tài khoản và quản lý quyền sử dụng HANU.'], grants: ['Quyền cấp trước', 'Chuẩn bị quyền sử dụng cho đúng người, trước lần đăng nhập đầu tiên.'], history: ['Nhật ký quản trị', 'Theo dõi các thay đổi quyền và liên kết extension.'] };
  return <div className={`application admin-application ${dark ? 'dark' : ''}`}>
    <aside className="sidebar admin-sidebar"><Brand/><div className="sidebar-section-label">QUẢN TRỊ</div><nav aria-label="Điều hướng quản trị">{[['users', 'Người dùng', <PeopleRegular/>], ['grants', 'Quyền cấp trước', <MailAddRegular/>], ['history', 'Nhật ký quản trị', <HistoryRegular/>]].map(([key, label, icon]) => <button key={String(key)} className={`nav-item ${section === key ? 'active' : ''}`} onClick={() => setSection(String(key))}>{icon}<span>{label}</span>{key === 'users' && !!data?.summary.pending && <span className="nav-count">{data.summary.pending}</span>}</button>)}</nav><div className="sidebar-bottom"><a className="admin-workspace-link" href="/"><ArrowLeftRegular/> Quản lý profile</a><div className="admin-current-user"><Avatar name={account.name} size={32}/><div><strong>{account.name}</strong><span>Quản trị viên</span></div></div></div></aside>
    <div className="app-main"><header className="topbar"><div className="breadcrumb"><span>HANU</span><ChevronRightRegular/><strong>Quản trị</strong></div><div className="top-actions"><Button as="a" href="/" appearance="subtle" className="admin-mobile-back" icon={<ArrowLeftRegular/>}>Profile</Button><Button appearance="subtle" icon={dark ? <WeatherSunnyRegular/> : <WeatherMoonRegular/>} aria-label="Đổi giao diện sáng tối" onClick={toggleTheme}/><Button appearance="subtle" onClick={() => void logout().catch(e => setError(e.message))}>Đăng xuất</Button></div></header>
      <main className="workspace admin-workspace"><div className="admin-heading"><div><span className="access-section-label">Quản lý truy cập</span><h1>{titles[section][0]}</h1><p>{titles[section][1]}</p></div><Button appearance="primary" icon={<AddRegular/>} onClick={() => setGrantOpen(true)}>Cấp quyền trước</Button></div>
        <nav className="admin-mobile-nav" aria-label="Các mục quản trị">{[['users', 'Người dùng'], ['grants', 'Cấp trước'], ['history', 'Nhật ký']].map(([key, label]) => <button key={key} aria-current={section === key ? 'page' : undefined} onClick={() => setSection(key)}>{label}</button>)}</nav>
        {section === 'users' && <div className="admin-metrics" aria-label="Tổng quan tài khoản">{[['total', 'Tổng tài khoản'], ['pending', 'Chờ duyệt'], ['active', 'Đang hoạt động'], ['expired', 'Đã hết hạn']].map(([key, label]) => <button key={key} onClick={() => { setFilter(key === 'total' ? 'all' : key); setPage(1); }}><span>{label}</span><strong>{data ? data.summary[key as keyof Summary] : '⋯'}</strong>{key === 'pending' && !!data?.summary.pending && <small>Cần xét duyệt</small>}</button>)}</div>}
        {error && <div className="access-error admin-page-error" role="alert">{error}<Button appearance="subtle" size="small" onClick={reload}>Thử lại</Button></div>}
        <section className="admin-list-surface" aria-label={titles[section][0]}>
          {section === 'users' && <><div className="admin-list-toolbar"><div className="admin-filters" role="tablist" aria-label="Lọc trạng thái">{[['all', 'Tất cả'], ['pending', 'Chờ duyệt'], ['active', 'Hoạt động'], ['blocked', 'Bị khóa'], ['expired', 'Hết hạn'], ['rejected', 'Từ chối']].map(([key, label]) => <button key={key} role="tab" aria-selected={filter === key} onClick={() => { setFilter(key); setPage(1); }}>{label}</button>)}</div><Input contentBefore={<SearchRegular/>} placeholder="Tên hoặc email…" aria-label="Tìm người dùng" value={query} onChange={(_, d) => setQuery(d.value)}/><Button appearance="subtle" icon={<ArrowSyncRegular/>} aria-label="Làm mới danh sách" disabled={loading} onClick={reload}/></div>
            {loading ? <div className="admin-table-loading" role="status" aria-label="Đang tải người dùng">{[0, 1, 2, 3, 4].map(n => <div key={n}><span/><span/><span/></div>)}</div> : !data?.accounts.length ? <div className="access-empty"><PeopleRegular/><h2>{search || filter !== 'all' ? 'Không có tài khoản phù hợp' : 'Chưa có người dùng'}</h2><p>{search || filter !== 'all' ? 'Thử đổi từ khóa hoặc bộ lọc trạng thái.' : 'Tài khoản mới sẽ xuất hiện khi người dùng đăng nhập Google.'}</p>{(search || filter !== 'all') && <Button onClick={() => { setQuery(''); setSearch(''); setFilter('all'); setPage(1); }}>Xóa bộ lọc</Button>}</div> : <div className="admin-table-scroll"><table className="admin-users-table"><caption className="sr-only">Danh sách tài khoản HANU</caption><thead><tr><th>Người dùng</th><th>Trạng thái</th><th>Profile</th><th>Quyền sử dụng</th><th>Hoạt động gần nhất</th><th><span className="sr-only">Thao tác</span></th></tr></thead><tbody>{data.accounts.map(user => <tr key={user.id} className={user.status === 'pending' ? 'admin-pending-row' : ''}><td><button className="admin-user-button" onClick={() => setSelected(user.id)}><Avatar name={user.name} size={36}/><span><strong>{user.name || user.email}{user.role === 'admin' && <span className="admin-role-badge is-admin"><ShieldCheckmarkRegular/>Quản trị</span>}</strong><small>{user.email}</small></span></button></td><td><AccessBadge status={user.status}/></td><td><span className="admin-numeric">{user.profileCount}<span> / {user.maxProfiles}</span></span><small className="admin-cell-note">{user.connectedCount} kết nối</small></td><td><span>{user.maxConcurrent} chạy đồng thời</span><small className="admin-cell-note">{user.liveEnabled ? 'Test và Live' : 'Chỉ Test'}</small></td><td><span>{date(user.lastSeenAt)}</span><small className="admin-cell-note">{user.expiresAt ? `Hạn: ${date(user.expiresAt)}` : 'Không giới hạn thời gian'}</small></td><td><Button size="small" appearance={user.status === 'pending' ? 'secondary' : 'subtle'} iconPosition="after" icon={<ChevronRightRegular/>} onClick={() => setSelected(user.id)}>{user.status === 'pending' ? 'Xét duyệt' : 'Chi tiết'}</Button></td></tr>)}</tbody></table></div>}
            <footer className="admin-list-footer"><span>{data ? `${data.total} tài khoản${search ? ' phù hợp' : ''}` : 'Đang tải tài khoản'}</span><div><Button size="small" appearance="subtle" disabled={loading || page <= 1} icon={<ArrowLeftRegular/>} aria-label="Trang trước" onClick={() => setPage(page - 1)}/><span>Trang {page} / {Math.max(1, Math.ceil((data?.total ?? 0) / 25))}</span><Button size="small" appearance="subtle" disabled={loading || page * 25 >= (data?.total ?? 0)} icon={<ArrowRightRegular/>} aria-label="Trang sau" onClick={() => setPage(page + 1)}/></div></footer>
          </>}
          {section === 'grants' && <><div className="admin-section-heading"><h2>Chờ người dùng đăng nhập</h2><p>Quyền cấp trước được dùng một lần, gắn với email Google đã xác minh.</p></div>{loading ? <div className="access-skeleton-block" role="status" aria-label="Đang tải quyền cấp trước"/> : !grants.length ? <div className="access-empty"><MailAddRegular/><h2>Chưa có quyền cấp trước</h2><p>Thêm email để người dùng đủ điều kiện có thể bắt đầu ngay.</p><Button onClick={() => setGrantOpen(true)}>Thêm email Google</Button></div> : <div className="admin-grants-list">{grants.map(grant => <article key={grant.email}><div><strong>{grant.email}</strong><p>{grant.maxProfiles} profile, {grant.maxConcurrent} chạy đồng thời, {grant.liveEnabled ? 'Test và Live' : 'chỉ Test'}</p><span>{grant.expiresAt ? `Hết hạn ${date(grant.expiresAt)}` : 'Không giới hạn thời gian'}</span></div><Button disabled={!!deleting} onClick={() => setConfirmDelete(grant.email)}>Thu hồi</Button></article>)}</div>}</>}
          {section === 'history' && <><div className="admin-section-heading"><h2>Thay đổi gần đây</h2><p>Tối đa 100 sự kiện gần nhất, gồm người thực hiện và thời điểm thay đổi.</p></div>{loading ? <div className="access-skeleton-block" role="status" aria-label="Đang tải nhật ký"/> : <EventList events={events}/>}</>}
        </section><p className="admin-bottom-note"><ShieldCheckmarkRegular/>Quyền được kiểm tra trên website và extension cloud. Tài khoản mới mặc định chờ duyệt.</p>
      </main>
    </div>
    <UserDrawer id={selected} close={() => setSelected(undefined)} changed={reload}/>
    <GrantDialog open={grantOpen} close={() => setGrantOpen(false)} changed={() => { setSection('grants'); reload(); }}/>
    <Dialog surfaceMotion={null} inertTrapFocus open={!!confirmDelete} onOpenChange={(_, d) => { if (!d.open && !deleting) setConfirmDelete(undefined); }}><DialogSurface><DialogBody><DialogTitle>Thu hồi quyền cấp trước?</DialogTitle><DialogContent><p>{confirmDelete} sẽ cần được xét duyệt sau khi đăng nhập.</p></DialogContent><DialogActions><Button disabled={!!deleting} onClick={() => setConfirmDelete(undefined)}>Hủy</Button><Button disabled={!!deleting} appearance="primary" onClick={() => void removeGrant(confirmDelete!)}>Thu hồi</Button></DialogActions></DialogBody></DialogSurface></Dialog>
  </div>;
}
