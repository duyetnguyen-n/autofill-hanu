import React, { useEffect, useRef, useState } from "react";
import { Button, Dialog, DialogSurface, DialogBody, DialogTitle, DialogContent, DialogActions } from "@fluentui/react-components";
import { personalFrom, type Personal, type Command, type Row } from "../protocol";
import { profileFromWebsite } from "./planning";
import type { SessionView } from "../../../src/protocol";
type Request = (command: Command, args?: Row) => Promise<any>;
export function ProfileEditor({ accountId, name, request, close }: { accountId: string; name: string; request: Request; close(): void }) {
  const [draft,setDraft] = useState<Personal>(personalFrom({})), [countries,setCountries] = useState<Row[]>([]), [languages,setLanguages] = useState<Row[]>([]), [years,setYears] = useState<Row>({}), [professions,setProfessions] = useState<Row[][]>([[],[],[]]), [professionIds,setProfessionIds] = useState<string[]>(["","",""]), [profiles,setProfiles] = useState<SessionView[]>([]), [source,setSource] = useState(""), [busy,setBusy] = useState(true), [error,setError] = useState(""), [note,setNote] = useState("");
  const mounted = useRef(true), revision = useRef(0);
  const change = (key: keyof Personal, value: string) => setDraft(p => ({...p,[key]:value}));
  useEffect(() => { mounted.current = true; void (async()=>{
    try {
      const [profile,country,language,config,profession] = await Promise.all([request("inspect",{accountId}),request("catalog",{kind:"countries"}),request("catalog",{kind:"languages"}),request("catalog",{kind:"config"}),request("catalog",{kind:"professions"})]);
      if (!mounted.current) return;
      setDraft(profile.personal); setCountries(country.data || []); setLanguages(language.data || []); setYears(config.studyYearList || {}); setProfessions([profession.data || [],[],[]]);
      const response = await fetch("/api/state", {cache:"no-store"}); if(response.ok){const data=await response.json();if(mounted.current)setProfiles((data.sessions || []).filter((s:SessionView)=>s.profile));}
    } catch(e){if(mounted.current)setError((e as Error).message);} finally{if(mounted.current)setBusy(false);}
  })(); return()=>{mounted.current=false;}; },[accountId,request]);
  const act = async (work:()=>Promise<void>) => {setBusy(true);setError("");try{await work();}catch(e){if(mounted.current)setError((e as Error).message);}finally{if(mounted.current)setBusy(false);}};
  async function profession(level:number,value:string){
    const id=++revision.current, ids=[...professionIds];ids[level]=value;for(let i=level+1;i<3;i++)ids[i]="";setProfessionIds(ids);change("pfId",value);
    const list=[...professions];for(let i=level+1;i<3;i++)list[i]=[];setProfessions(list);
    if(value&&level<2){const r=await request("catalog",{kind:"professions",parentId:value});if(mounted.current&&id===revision.current)setProfessions(prev=>prev.map((items,i)=>i===level+1?r.data || []:items));}
  }
  async function upload(file:File){
    if(!["image/jpeg","image/png"].includes(file.type)||file.size<=15*1024||file.size>=1024*1024)throw new Error("Chọn ảnh chân dung JPG/PNG lớn hơn 15 KB và nhỏ hơn 1 MB.");
    const bytes=new Uint8Array(await file.arrayBuffer());let binary="";for(let i=0;i<bytes.length;i+=8192)binary+=String.fromCharCode(...bytes.subarray(i,i+8192));
    const r=await request("upload-photo",{accountId,base64:btoa(binary),mimeType:file.type});change("photo",r.personal.photo);setNote("Đã upload ảnh chân dung lên ChineseTest. Lưu hồ sơ để giữ các trường vừa sửa.");
  }
  return <Dialog surfaceMotion={null} inertTrapFocus open modalType="modal"><DialogSurface className="ct-dialog"><DialogBody><DialogTitle>Hồ sơ ChineseTest · {name}</DialogTitle><DialogContent>
    {busy&&<div className="ct-skeleton" role="status">Đang xử lý hồ sơ…</div>}
    {error&&<p className="ct-error" role="alert">{error}</p>}{note&&<p role="status">{note}</p>}
    <fieldset disabled={busy} className="ct-fields">
      {profiles.length>0&&<div className="ct-import"><label>Hồ sơ đang có trên website<select value={source} onChange={e=>setSource(e.target.value)}><option value="">Chọn hồ sơ để sao chép thông tin</option>{profiles.map(p=><option key={p.id} value={p.id}>{p.name}</option>)}</select></label><Button disabled={!source} onClick={()=>{const p=profiles.find(p=>p.id===source)?.profile;if(p){setDraft(profileFromWebsite(p,draft,countries,languages));setNote("Đã sao chép thông tin phù hợp. Kiểm tra lại, chọn ảnh chân dung và bổ sung trường còn thiếu trước khi lưu.");}}}>Dùng thông tin hồ sơ</Button></div>}
      <div className="ct-grid">
        <label>Họ tên trên giấy tờ<input value={draft.ksEName} onChange={e=>change("ksEName",e.target.value)}/></label>
        <label>Tên tiếng Trung<input value={draft.ksName} onChange={e=>change("ksName",e.target.value)}/></label>
        <label>Ngày sinh<input type="date" value={draft.birthday} onChange={e=>change("birthday",e.target.value)}/></label>
        <label>Giới tính<select value={draft.ksSex} onChange={e=>change("ksSex",e.target.value)}><option value="">Chọn</option><option value="男">Nam</option><option value="女">Nữ</option><option value="其他">Khác</option></select></label>
        <label>Quốc tịch<select value={draft.gjId} onChange={e=>{const row=countries.find(c=>String(c.gjid)===e.target.value);setDraft(p=>({...p,gjId:e.target.value,ksCountry:row?.gjename || row?.gjname || ""}));}}><option value="">Chọn</option>{countries.map(c=><option key={c.gjid} value={c.gjid}>{c.gjename || c.gjname}</option>)}</select></label>
        <label>Dân tộc (nếu yêu cầu)<input value={draft.ksNation} onChange={e=>change("ksNation",e.target.value)}/></label>
        <label>Loại giấy tờ<select value={draft.idType} onChange={e=>change("idType",e.target.value)}><option value="">Chọn</option>{[["身份证","Căn cước"],["护照","Hộ chiếu"],["永久居住证明","Giấy thường trú"],["香港永久性居民身份证","Căn cước thường trú Hồng Kông"],["澳门特别行政区永久性居民身份证","Căn cước thường trú Ma Cao"],["中国香港护照","Hộ chiếu Hồng Kông"],["中国澳门护照","Hộ chiếu Ma Cao"],["港澳居民居住证","Giấy cư trú Hồng Kông/Ma Cao"],["台湾居民居住证","Giấy cư trú Đài Loan"],["居民来往大陆通行证","Giấy thông hành đại lục"]].map(([v,l])=><option key={v} value={v}>{l}</option>)}</select></label>
        <label>Số giấy tờ<input value={draft.idNo} autoComplete="off" onChange={e=>change("idNo",e.target.value)}/></label>
        <label>Điện thoại<input type="tel" value={draft.phone} onChange={e=>change("phone",e.target.value)}/></label>
        <label>Tiếng mẹ đẻ<select value={draft.fid} onChange={e=>{const l=languages.find(l=>String(l.idksFirstlanguage)===e.target.value);setDraft(p=>({...p,fid:e.target.value,firstLanguage:l?.ename || l?.flname || ""}));}}><option value="">Chọn</option>{languages.map(l=><option key={l.idksFirstlanguage} value={l.idksFirstlanguage}>{l.ename || l.flname}</option>)}</select></label>
        <label>Thời gian học tiếng Trung<select value={draft.studyYear} onChange={e=>change("studyYear",e.target.value)}><option value="">Chọn</option>{Object.entries(years).map(([k,v])=><option key={k} value={k}>{String(v)}</option>)}</select></label>
        <label>Nghề nghiệp<select value={professionIds[0]} onChange={e=>void act(()=>profession(0,e.target.value))}><option value="">{draft.pfId?"Đã lưu nghề nghiệp; chọn để thay đổi":"Chọn"}</option>{professions[0].map(p=><option key={p.pfid} value={p.pfid}>{p.pfname}</option>)}</select></label>
        {[1,2].filter(i=>professions[i].length>0).map(i=><label key={i}>Nhóm nghề nghiệp {i+1}<select value={professionIds[i]} onChange={e=>void act(()=>profession(i,e.target.value))}><option value="">Chọn</option>{professions[i].map(p=><option key={p.pfid} value={p.pfid}>{p.pfname}</option>)}</select></label>)}
        <label className="ct-wide">Địa chỉ<input value={draft.address} onChange={e=>change("address",e.target.value)}/></label>
        <label>Đã từng thi HSK?<select value={draft.isExamHsk} onChange={e=>{setDraft(p=>({...p,isExamHsk:e.target.value as Personal["isExamHsk"],kmidHis:"",fenshuHis:""}));}}><option value="">Chưa khai báo</option><option value="0">Chưa từng thi</option><option value="1">Đã từng thi</option></select></label>
        {draft.isExamHsk==="1"&&<><label>Cấp HSK đã thi<select value={draft.kmidHis} onChange={e=>change("kmidHis",e.target.value)}><option value="">Chọn</option>{["826485","826486","828635","828636","828637","828638","828639"].map((id,i)=><option key={id} value={id}>HSK {i===6?"7–9":i+1}</option>)}</select></label><label>Điểm đã thi<input type="number" min="0" value={draft.fenshuHis} onChange={e=>change("fenshuHis",e.target.value)}/></label></>}
      </div>
      <label className="ct-photo">Ảnh chân dung (không dùng ảnh giấy tờ)<input type="file" accept="image/jpeg,image/png" onChange={e=>{const f=e.target.files?.[0];if(f)void act(()=>upload(f));}}/></label>
      <p className="ct-muted">{draft.photo?"Đã có ảnh trên ChineseTest.":"Chưa có ảnh trên ChineseTest."} Upload đưa ảnh lên ChineseTest ngay; chưa tạo đăng ký.</p>
    </fieldset>
  </DialogContent><DialogActions><Button onClick={close}>Đóng</Button><Button appearance="primary" disabled={busy} onClick={()=>void act(async()=>{for(let i=1;i<3;i++)if(professions[i].length&&!professionIds[i])throw new Error("Chọn đủ nhóm nghề nghiệp.");await request("save-profile",{accountId,personal:draft});close();})}>Lưu hồ sơ</Button></DialogActions></DialogBody></DialogSurface></Dialog>;
}


