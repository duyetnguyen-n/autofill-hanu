import React,{useEffect,useState} from 'react';
import {Button} from '@fluentui/react-components';

export interface Account {id:string;email:string;name:string}
export function CloudLogin({error,onLogin,pending}:{error:string;onLogin:()=>void;pending:boolean}){
  return <main className="login-page">
    <section className="login-story"><a className="brand" href="/"><span className="brand-mark">H</span><span>HANU<span className="brand-sub">Điều phối đăng ký</span></span></a>
      <div className="login-copy"><span className="login-eyebrow">KHÔNG GIAN RIÊNG CỦA BẠN</span><h1>Chuẩn bị một lần.<br/>Quản lý mọi profile.</h1><p>Giữ hồ sơ, ảnh và các Chrome profile trong cùng một màn hình. Sẵn sàng khi form mở.</p></div>
      <div className="login-footnote"><span>Hồ sơ riêng theo tài khoản</span><span>Extension trên máy của bạn</span></div>
    </section>
    <section className="login-panel"><div className="login-form"><span className="login-eyebrow">HSK AUTOFILL</span><h2>Đăng nhập để bắt đầu</h2><p>Dùng tài khoản Google của bạn để mở trang quản lý.</p>
      <Button className="google-login" size="large" disabled={pending} onClick={onLogin} icon={<svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true"><path fill="#4285F4" d="M21.6 12.23c0-.71-.06-1.39-.18-2.05H12v3.88h5.38a4.6 4.6 0 0 1-1.99 3.02v2.51h3.22c1.88-1.73 2.99-4.27 2.99-7.36Z"/><path fill="#34A853" d="M12 22c2.7 0 4.96-.9 6.61-2.41l-3.22-2.51c-.9.6-2.05.96-3.39.96-2.61 0-4.82-1.77-5.61-4.14H3.06v2.59A10 10 0 0 0 12 22Z"/><path fill="#FBBC05" d="M6.39 13.9a6 6 0 0 1 0-3.8V7.51H3.06a10 10 0 0 0 0 8.98l3.33-2.59Z"/><path fill="#EA4335" d="M12 5.96c1.47 0 2.79.51 3.82 1.51l2.86-2.86A9.6 9.6 0 0 0 12 2a10 10 0 0 0-8.94 5.51l3.33 2.59C7.18 7.73 9.39 5.96 12 5.96Z"/></svg>}>{pending?'Đang mở Google…':'Tiếp tục với Google'}</Button>
      {error&&<p className="login-error" role="alert">{error}</p>}
      <p className="login-helper">Sau khi đăng nhập, liên kết extension trong từng Chrome profile bằng mã từ trang quản lý.</p>
    </div></section>
  </main>;
}

export function CloudGate({children}:{children:(account:Account,logout:()=>Promise<void>)=>React.ReactNode}){
  const [account,setAccount]=useState<Account>(),[checking,setChecking]=useState(true),[pending,setPending]=useState(false);
  const [error,setError]=useState(new URLSearchParams(location.search).has('auth_error')?'Đăng nhập chưa hoàn tất. Bấm Tiếp tục với Google để thử lại.':'');
  useEffect(()=>{
    let stopped=false,generation=0;
    async function check(){const current=++generation;try{
      const response=await fetch('/api/auth/me',{cache:'no-store'});const result=await response.json();if(stopped||current!==generation)return;
      if(response.status===401)setAccount(undefined);else if(!response.ok)throw new Error(result.error??'Không kiểm tra được đăng nhập.');else setAccount(result);
    }catch(e){if(!stopped&&current===generation){setAccount(undefined);setError((e as Error).message);}}finally{if(!stopped&&current===generation)setChecking(false);}}
    const expired=()=>{setAccount(undefined);setChecking(false);void check();};
    const visible=()=>{if(document.visibilityState==='visible')void check();};
    window.addEventListener('hanu-auth-expired',expired);document.addEventListener('visibilitychange',visible);
    const timer=setInterval(()=>void check(),30000);void check();
    if(location.search)history.replaceState(null,'',location.pathname);
    return()=>{stopped=true;clearInterval(timer);window.removeEventListener('hanu-auth-expired',expired);document.removeEventListener('visibilitychange',visible);};
  },[]);
  async function login(){setPending(true);setError('');try{
    const response=await fetch('/api/auth/login',{method:'POST',headers:{'Content-Type':'application/json'},body:'{}'});const data=await response.json();
    if(!response.ok)throw new Error(data.error??'Không mở được đăng nhập.');location.assign(data.url);
  }catch(e){setError((e as Error).message);setPending(false);}}
  async function logout(){setPending(true);try{
    const response=await fetch('/api/auth/logout',{method:'POST',headers:{'Content-Type':'application/json'},body:'{}'});const result=await response.json();if(!response.ok)throw new Error(result.error??'Không đăng xuất được.');setAccount(undefined);setError('');
  }finally{setPending(false);}}
  if(checking)return <div className="login-loading" role="status"><div className="login-skeleton"/><span>Đang mở không gian của bạn…</span></div>;
  if(account)return <React.Fragment key={account.id}>{children(account,logout)}</React.Fragment>;
  return <CloudLogin error={error} pending={pending} onLogin={()=>void login()}/>;
}
