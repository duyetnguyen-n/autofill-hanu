import React from 'react';
import { ArrowUpRight, Browsers, Exam, ShieldCheck, SignOut } from '@phosphor-icons/react';

export type WorkspaceNavItem = {
  label: string;
  icon: React.ReactNode;
  href?: string;
  onClick?: () => void;
  count?: number;
  active?: boolean;
};

export function WorkspaceSidebar({page, chinesetestEnabled=false, hcmueEnabled=false, items, email, logout, connected, local=false}: {
  page: 'forms' | 'chinesetest' | 'hcmue';
  chinesetestEnabled?: boolean;
  hcmueEnabled?: boolean;
  items: WorkspaceNavItem[];
  email?: string;
  logout?: () => void;
  connected: boolean;
  local?: boolean;
}) {
  const products = [
    {id:'forms', label:'Google Forms', href:'/', icon:<Browsers size={20}/>},
    ...(chinesetestEnabled ? [{id:'chinesetest', label:'ChineseTest', href:'/chinesetest', icon:<Exam size={20}/>}] : []),
    ...(hcmueEnabled ? [{id:'hcmue', label:'HSK HCMUE', href:'/hcmue', icon:<Exam size={20}/>}] : []),
  ];
  return <aside className="workspace-sidebar">
    <a className="ws-brand" href="/" aria-label="HANU điều phối">
      <span className="ws-brand-mark">h<span>.</span></span>
      <span className="ws-brand-name">HANU<span>Không gian đăng ký</span></span>
    </a>
    <div className="ws-workspace-label"><span className="ws-workspace-monogram">H</span><span>Không gian cá nhân<small>Điều phối đăng ký HSK</small></span></div>
    <div className="ws-nav-label">ỨNG DỤNG</div>
    <nav className="ws-products" aria-label="Ứng dụng đăng ký">{products.map(product =>
      <a key={product.id} href={product.href} className={`ws-nav-item ${page===product.id?'is-active':''}`} aria-current={page===product.id?'page':undefined}>
        {product.icon}<span>{product.label}</span>{page===product.id&&<span className="ws-active-dot"/>}
      </a>
    )}</nav>
    <div className="ws-nav-label ws-manage-label">QUẢN LÝ</div>
    <nav className="ws-secondary" aria-label="Điều hướng">{items.map(item => {
      const content=<>{item.icon}<span>{item.label}</span>{item.count!==undefined&&<span className="ws-count">{item.count}</span>}</>;
      return item.href ? <a key={item.label} href={item.href} className={`ws-nav-item ${item.active?'is-selected':''}`}>{content}</a> :
        <button key={item.label} type="button" onClick={item.onClick} className={`ws-nav-item ${item.active?'is-selected':''}`} aria-pressed={item.active}>{content}</button>;
    })}</nav>
    <div className="ws-sidebar-bottom">
      {page==='forms'&&!local&&<a className="ws-runner-link" href="/extension-downloads/index.html"><span>Tải extension<small>Cài đặt, kết nối và mở lại</small></span><ArrowUpRight size={17}/></a>}
      {page!=='forms'&&<a className="ws-runner-link" href={`/${page==='chinesetest'?'chinesetest':'hcmue'}-downloads/index.html`} target="_blank" rel="noreferrer"><span>Tải {page==='chinesetest'?'ChineseTest':'HCMUE'} Runner<small>{page==='chinesetest'?'Tải runner và hướng dẫn kết nối':'Cài đặt trên máy chạy của bạn'}</small></span><ArrowUpRight size={17}/></a>}
      <div className="ws-privacy"><ShieldCheck size={19}/><p><strong>{local?'Dữ liệu trên máy bạn':'Không gian riêng của bạn'}</strong><span>{page==='forms'?(local?'Hồ sơ và ảnh được lưu cục bộ.':'Hồ sơ được lưu theo tài khoản.'):'Phiên đăng nhập mã hóa trên máy.'}</span></p></div>
      <div className="ws-server-status"><span className={`ws-status-dot ${connected?'is-connected':''}`}/>{connected?(page==='forms'?'Bộ điều phối hoạt động':'Máy chạy đã kết nối'):(page==='forms'?'Đang kết nối quản lý':'Chưa kết nối máy chạy')}</div>
      {email&&<div className="ws-user"><span className="ws-user-initial">{email.slice(0,1).toUpperCase()}</span><span title={email}><strong>Tài khoản của bạn</strong><small>{email}</small></span>{logout&&<button type="button" onClick={logout} aria-label="Đăng xuất" title="Đăng xuất"><SignOut size={18}/></button>}</div>}
    </div>
  </aside>;
}
