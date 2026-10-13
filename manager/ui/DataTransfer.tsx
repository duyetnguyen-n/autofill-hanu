import React,{useRef} from 'react';
import {Button} from '@fluentui/react-components';

export function DataTransfer({cloud,busy,act,request}:{cloud:boolean;busy:boolean;act:(fn:()=>Promise<unknown>,message?:string)=>Promise<void>;request:(path:string,body?:unknown)=>Promise<any>}){
  const file=useRef<HTMLInputElement>(null);
  async function upload(selected:File){
    await act(async()=>{
      if(selected.size>64*1024*1024)throw new Error('Bản xuất phải nhỏ hơn 64 MB.');
      let value;try{value=JSON.parse(await selected.text());}catch{throw new Error('Chọn file JSON xuất từ app quản lý local.');}
      return request('import',value);
    },'Đã nhập hồ sơ, ảnh và giữ các khóa gửi. Mở Chi tiết để liên kết lại các Chrome profile vừa nhập.');
    if(file.current)file.current.value='';
  }
  async function download(){await act(async()=>{
    const data=await request('export'),url=URL.createObjectURL(new Blob([JSON.stringify(data)],{type:'application/json'}));
    const link=document.createElement('a');link.href=url;link.download='hanu-local-backup.json';link.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
  },'Đã xuất hồ sơ, ảnh và khóa gửi. Giữ file riêng và nhập vào tài khoản online của bạn.');}
  return <>{cloud?<><input ref={file} type="file" accept="application/json,.json" className="sr-only" aria-label="Bản xuất dữ liệu local" onChange={event=>{const selected=event.target.files?.[0];if(selected)void upload(selected);}}/><Button disabled={busy} appearance="subtle" onClick={()=>file.current?.click()}>Nhập từ bản local</Button></>:<Button disabled={busy} appearance="subtle" onClick={()=>void download()}>Xuất dữ liệu</Button>}</>;
}
