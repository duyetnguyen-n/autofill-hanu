import React, { useState } from 'react';
import { Button, Dialog, DialogTrigger, DialogSurface, DialogBody, DialogTitle, DialogContent, DialogActions } from '@fluentui/react-components';
import { BookOpen, Moon, Sun, UserCircle, Clock, ArrowUpRight, ShieldCheck } from '@phosphor-icons/react';
import type { Account } from '../../src/account';
import './workspace-header.css';

export function WorkspaceHeader({ title, icon, context='Không gian làm việc', dark, toggleTheme, themeLabel='Đổi giao diện sáng tối', guideHref, guideLabel='Hướng dẫn', primaryAction, tools, account, logout, products=[] }: {
  title: string; icon: React.ReactNode; context?: string; dark: boolean; toggleTheme(): void;
  themeLabel?: string; guideHref?: string; guideLabel?: string; primaryAction?: React.ReactNode;
  tools?: React.ReactNode; account?: Account; logout?: ()=>Promise<void>;
  products?: {label:string;href:string}[];
}) {
  const [error,setError]=useState('');
  return <header className="workspace-header">
    <div className="wh-location"><span className="wh-product-icon">{icon}</span><div><span className="wh-context">{context}</span><strong>{title}</strong></div></div>
    <div className="wh-actions">
      <span className="wh-timezone"><Clock size={14}/>Giờ Việt Nam · UTC+7</span>
      {guideHref&&<Button as="a" href={guideHref} className="wh-guide" appearance="subtle" icon={<BookOpen size={18}/>} aria-label={guideLabel}><span>Hướng dẫn</span></Button>}
      <Button className="wh-icon-button" appearance="subtle" icon={dark?<Sun size={18}/>:<Moon size={18}/>} aria-label={themeLabel} onClick={toggleTheme}/>
      {(tools||account)&&<Dialog surfaceMotion={null} inertTrapFocus><DialogTrigger disableButtonEnhancement><Button className="wh-icon-button wh-account-button" appearance="subtle" icon={<UserCircle size={20}/>} aria-label="Tài khoản và công cụ"><span className="wh-account-email">{account?.email??'Công cụ'}</span></Button></DialogTrigger><DialogSurface className="workspace-tools-dialog"><DialogBody><DialogTitle>Tài khoản và công cụ</DialogTitle><DialogContent>
        {account&&<div className="wh-account-identity"><span>{account.name}</span><strong>{account.email}</strong></div>}
        {products.length>0&&<nav className="wh-product-links" aria-label="Ứng dụng">{products.map(p=><Button key={p.href} as="a" href={p.href} appearance="subtle" icon={<ArrowUpRight size={16}/>}>{p.label}</Button>)}</nav>}
        <div className="wh-tools">{tools??<>{account?.role==='admin'&&<Button as="a" href="/admin" appearance="subtle" icon={<ShieldCheck size={17}/>}>Quản trị</Button>}<Button as="a" href="/account" appearance="subtle">Tài khoản</Button>{logout&&<Button appearance="subtle" onClick={()=>void logout().catch(e=>setError((e as Error).message))}>Đăng xuất</Button>}</>}</div>
        {error&&<p role="alert">{error}</p>}
      </DialogContent><DialogActions><DialogTrigger disableButtonEnhancement><Button>Đóng</Button></DialogTrigger></DialogActions></DialogBody></DialogSurface></Dialog>}
      {primaryAction&&<div className="wh-primary">{primaryAction}</div>}
    </div>
  </header>;
}
