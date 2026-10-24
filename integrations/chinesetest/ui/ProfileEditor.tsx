import React, { useEffect, useRef, useState } from "react";
import { Button, Dialog, DialogSurface, DialogBody, DialogTitle, DialogContent, DialogActions } from "@fluentui/react-components";
import { personalFrom, type Personal, type Command, type Row, type CloudProfile } from "../protocol";
import { profileFromWebsite } from "./planning";
import type { SessionView } from "../../../src/protocol";
import { BusyLine } from "./BusyLine";
import { profileApi, profilePath, saveDraft, savedPhoto, imageBase64 } from "./profile-api";
import { synchronizeProfile } from "./profile-sync";
type Request = (command: Command, args?: Row) => Promise<any>;
export function ProfileEditor({ accountId, deviceId, name, request, close }: { accountId: string; deviceId: string; name: string; request: Request; close(): void }) {
  const [draft,setDraft] = useState<Personal>(personalFrom({})), [cloud,setCloud] = useState<CloudProfile | null>(null), [countries,setCountries] = useState<Row[]>([]), [languages,setLanguages] = useState<Row[]>([]), [years,setYears] = useState<Row>({}), [professions,setProfessions] = useState<Row[][]>([[],[],[]]), [professionIds,setProfessionIds] = useState<string[]>(["","",""]), [profiles,setProfiles] = useState<SessionView[]>([]), [source,setSource] = useState(""), [busy,setBusy] = useState(true), [error,setError] = useState(""), [note,setNote] = useState(""), [progress,setProgress] = useState("Đang tải hồ sơ đã lưu…"), [loaded,setLoaded] = useState(false), [loadAttempt,setLoadAttempt]=useState(0);
  const [catalogLoading,setCatalogLoading]=useState<Record<string,boolean>>({countries:true,languages:true,config:true,professions:true}),[catalogErrors,setCatalogErrors]=useState<Record<string,string>>({}),[imageError,setImageError]=useState(false);
  const surface=useRef<HTMLDivElement>(null);
  const mounted = useRef(true), revision = useRef(0), acting=useRef(false), cloudRef=useRef<CloudProfile | null>(null);
  const path=profilePath(deviceId,accountId);
  const keepCloud=(p:CloudProfile)=>{cloudRef.current=p;if(mounted.current){setCloud(p);setImageError(false);}};
  const change = (key: keyof Personal, value: string) => setDraft(p => ({...p,[key]:value}));
  async function loadCatalog(kind:string) {
    setCatalogLoading(p=>({...p,[kind]:true}));setCatalogErrors(p=>({...p,[kind]:""}));
    try {const r=await request("catalog",{kind});if(!mounted.current)return;
      if(kind==="countries")setCountries(r.data || []);else if(kind==="languages")setLanguages(r.data || []);else if(kind==="config")setYears(r.studyYearList || {});else setProfessions([r.data || [],[],[]]);
    }catch(e){if(mounted.current)setCatalogErrors(p=>({...p,[kind]:(e as Error).message}));}
    finally{if(mounted.current)setCatalogLoading(p=>({...p,[kind]:false}));}
  }
  useEffect(() => { mounted.current = true; void (async()=>{
    try {
      const [saved,local]=await Promise.all([profileApi<CloudProfile | null>(path),request("read-profile",{accountId})]);
      if(!mounted.current)return;
      if(local.profileSyncJobsVersion!==1)throw new Error("Cập nhật ChineseTest Runner để nhận bản sửa timeout đồng bộ ảnh, rồi mở lại hồ sơ.");
      if(saved)keepCloud(saved);setDraft(saved?.personal || local.personal);setLoaded(true);
      if(saved?.status==="draft")setNote("Đã khôi phục bản nháp. Bấm Lưu hồ sơ để đồng bộ sang ChineseTest.");
    } catch(e){if(mounted.current)setError((e as Error).message);} finally{if(mounted.current){setBusy(false);setProgress("");}}
  })();
    for(const kind of ["countries","languages","config","professions"])void loadCatalog(kind);
    void fetch("/api/state",{cache:"no-store"}).then(r=>r.ok?r.json():undefined).then(data=>{if(mounted.current&&data)setProfiles((data.sessions || []).filter((s:SessionView)=>s.profile));}).catch(()=>{});
    return()=>{mounted.current=false;}; },[accountId,deviceId,request,loadAttempt]);
  const act = async (work:()=>Promise<void>) => {if(acting.current)return;surface.current?.focus();acting.current=true;setBusy(true);setError("");setNote("");try{await work();}catch(e){if(mounted.current)setError((e as Error).message);}finally{acting.current=false;if(mounted.current){setBusy(false);setProgress("");}}};
  async function profession(level:number,value:string){
    const id=++revision.current, ids=[...professionIds];ids[level]=value;for(let i=level+1;i<3;i++)ids[i]="";setProfessionIds(ids);change("pfId",value);
    const list=[...professions];for(let i=level+1;i<3;i++)list[i]=[];setProfessions(list);
    if(value&&level<2){setProgress("Đang tải nhóm nghề nghiệp…");const r=await request("catalog",{kind:"professions",parentId:value});if(mounted.current&&id===revision.current)setProfessions(prev=>prev.map((items,i)=>i===level+1?r.data || []:items));}
  }
  async function upload(file:File){
    if(!["image/jpeg","image/png"].includes(file.type)||file.size<=15*1024||file.size>=1024*1024)throw new Error("Chọn ảnh chân dung JPG/PNG lớn hơn 15 KB và nhỏ hơn 1 MB.");
    setProgress("Đang lưu ảnh và bản nháp lên Supabase…");
    const p=await profileApi<CloudProfile>(path+"/photo",{revision:cloudRef.current?.revision || 0,personal:draft,base64:await imageBase64(await file.arrayBuffer()),mimeType:file.type});
    keepCloud(p);
    setNote("Đã lưu ảnh và bản nháp trên hệ thống. Bấm Lưu hồ sơ để đồng bộ sang ChineseTest.");
    setProgress("Đang cập nhật trạng thái ảnh trên máy chạy…");
    try{await request("stage-profile",{accountId,photoVersion:p.photoVersion});}
    catch(e){throw new Error("Ảnh và bản nháp đã được lưu trên Supabase. Máy chạy chưa nhận trạng thái mới: "+(e as Error).message+" Bấm Lưu hồ sơ để thử lại.");}
  }
  async function save(){
    for(let i=1;i<3;i++)if(professions[i].length&&!professionIds[i])throw new Error("Chọn đủ nhóm nghề nghiệp.");
    setProgress("Đang lưu bản nháp hồ sơ…");
    let p=await saveDraft(path,cloudRef.current,draft);keepCloud(p);
    try{
      let base64:string | undefined;
      if(p.photoVersion){
        setProgress("Đang ghi nhận ảnh mới trên máy chạy…");
        await request("stage-profile",{accountId,photoVersion:p.photoVersion});
        setProgress("Đang đọc ảnh đã lưu…");base64=await savedPhoto(path,p.photoVersion);
      }
      setProgress(p.photoVersion!==p.syncedPhotoVersion?"Đang tải ảnh lên ChineseTest…":"Đang đồng bộ hồ sơ với máy chạy…");
      const result=await synchronizeProfile(request,{accountId,personal:draft,photoVersion:p.photoVersion,base64,mimeType:p.photoMime},message=>{if(mounted.current)setProgress(message);},()=>mounted.current);
      setProgress("Đang xác nhận hồ sơ đã đồng bộ…");
      p=await profileApi<CloudProfile>(path+"/synced",{revision:p.revision,photoVersion:p.photoVersion,chineseTestPhoto:result.personal.photo});
      keepCloud(p);setDraft(result.personal);setNote("Đã lưu hồ sơ và đồng bộ ảnh sang ChineseTest.");
    }catch(e){throw new Error("Đã lưu bản nháp, chưa xác nhận đồng bộ ChineseTest. Ảnh và thông tin vẫn được giữ. "+(e as Error).message);}
  }
  return <Dialog surfaceMotion={null} inertTrapFocus open modalType="modal"><DialogSurface ref={surface} className="ct-dialog"><DialogBody><DialogTitle>Hồ sơ ChineseTest · {name}</DialogTitle><DialogContent>
    {busy&&<BusyLine>{progress || "Đang xử lý hồ sơ…"}</BusyLine>}
    {error&&<p className="ct-error" role="alert">{error}</p>}{note&&<p role="status">{note}</p>}
    {!loaded&&!busy&&<Button onClick={()=>{setBusy(true);setError("");setProgress("Đang tải lại hồ sơ…");setLoadAttempt(n=>n+1);}}>Tải lại hồ sơ</Button>}
    <fieldset disabled={busy || !loaded} className="ct-fields">
      {profiles.length>0&&<div className="ct-import"><label>Hồ sơ đang có trên website<select value={source} onChange={e=>setSource(e.target.value)}><option value="">Chọn hồ sơ để sao chép thông tin</option>{profiles.map(p=><option key={p.id} value={p.id}>{p.name}</option>)}</select></label><Button disabled={!source} onClick={()=>{const p=profiles.find(p=>p.id===source)?.profile;if(p){setDraft(profileFromWebsite(p,draft,countries,languages));setNote("Đã sao chép thông tin phù hợp. Kiểm tra lại, chọn ảnh chân dung và bổ sung trường còn thiếu trước khi lưu.");}}}>Dùng thông tin hồ sơ</Button></div>}
      {Object.entries(catalogLoading).filter(([,loading])=>loading).map(([kind])=><BusyLine key={kind}>Đang tải {({countries:"quốc tịch",languages:"tiếng mẹ đẻ",config:"thời gian học",professions:"nghề nghiệp"} as Record<string,string>)[kind]}…</BusyLine>)}
      {Object.entries(catalogErrors).filter(([,message])=>message).map(([kind,message])=><div className="ct-warning" key={kind}>{message} <Button onClick={()=>void loadCatalog(kind)}>Thử lại danh mục</Button></div>)}
      <div className="ct-grid">
        <label>Họ tên trên giấy tờ<input value={draft.ksEName} onChange={e=>change("ksEName",e.target.value)}/></label>
        <label>Tên tiếng Trung<input value={draft.ksName} onChange={e=>change("ksName",e.target.value)}/></label>
        <label>Ngày sinh<input type="date" value={draft.birthday} onChange={e=>change("birthday",e.target.value)}/></label>
        <label>Giới tính<select value={draft.ksSex} onChange={e=>change("ksSex",e.target.value)}><option value="">Chọn</option><option value="男">Nam</option><option value="女">Nữ</option><option value="其他">Khác</option></select></label>
        <label>Quốc tịch<select disabled={catalogLoading.countries || Boolean(catalogErrors.countries)} value={draft.gjId} onChange={e=>{const row=countries.find(c=>String(c.gjid)===e.target.value);setDraft(p=>({...p,gjId:e.target.value,ksCountry:row?.gjename || row?.gjname || ""}));}}><option value="">Chọn</option>{countries.map(c=><option key={c.gjid} value={c.gjid}>{c.gjename || c.gjname}</option>)}</select></label>
        <label>Dân tộc (nếu yêu cầu)<input value={draft.ksNation} onChange={e=>change("ksNation",e.target.value)}/></label>
        <label>Loại giấy tờ<select value={draft.idType} onChange={e=>change("idType",e.target.value)}><option value="">Chọn</option>{[["身份证","Căn cước"],["护照","Hộ chiếu"],["永久居住证明","Giấy thường trú"],["香港永久性居民身份证","Căn cước thường trú Hồng Kông"],["澳门特别行政区永久性居民身份证","Căn cước thường trú Ma Cao"],["中国香港护照","Hộ chiếu Hồng Kông"],["中国澳门护照","Hộ chiếu Ma Cao"],["港澳居民居住证","Giấy cư trú Hồng Kông/Ma Cao"],["台湾居民居住证","Giấy cư trú Đài Loan"],["居民来往大陆通行证","Giấy thông hành đại lục"]].map(([v,l])=><option key={v} value={v}>{l}</option>)}</select></label>
        <label>Số giấy tờ<input value={draft.idNo} autoComplete="off" onChange={e=>change("idNo",e.target.value)}/></label>
        <label>Điện thoại<input type="tel" value={draft.phone} onChange={e=>change("phone",e.target.value)}/></label>
        <label>Tiếng mẹ đẻ<select disabled={catalogLoading.languages || Boolean(catalogErrors.languages)} value={draft.fid} onChange={e=>{const l=languages.find(l=>String(l.idksFirstlanguage)===e.target.value);setDraft(p=>({...p,fid:e.target.value,firstLanguage:l?.ename || l?.flname || ""}));}}><option value="">Chọn</option>{languages.map(l=><option key={l.idksFirstlanguage} value={l.idksFirstlanguage}>{l.ename || l.flname}</option>)}</select></label>
        <label>Thời gian học tiếng Trung<select disabled={catalogLoading.config || Boolean(catalogErrors.config)} value={draft.studyYear} onChange={e=>change("studyYear",e.target.value)}><option value="">Chọn</option>{Object.entries(years).map(([k,v])=><option key={k} value={k}>{String(v)}</option>)}</select></label>
        <label>Nghề nghiệp<select disabled={catalogLoading.professions || Boolean(catalogErrors.professions)} value={professionIds[0]} onChange={e=>void act(()=>profession(0,e.target.value))}><option value="">{draft.pfId?"Đã lưu nghề nghiệp; chọn để thay đổi":"Chọn"}</option>{professions[0].map(p=><option key={p.pfid} value={p.pfid}>{p.pfname}</option>)}</select></label>
        {[1,2].filter(i=>professions[i].length>0).map(i=><label key={i}>Nhóm nghề nghiệp {i+1}<select value={professionIds[i]} onChange={e=>void act(()=>profession(i,e.target.value))}><option value="">Chọn</option>{professions[i].map(p=><option key={p.pfid} value={p.pfid}>{p.pfname}</option>)}</select></label>)}
        <label className="ct-wide">Địa chỉ<input value={draft.address} onChange={e=>change("address",e.target.value)}/></label>
        <label>Đã từng thi HSK?<select value={draft.isExamHsk} onChange={e=>{setDraft(p=>({...p,isExamHsk:e.target.value as Personal["isExamHsk"],kmidHis:"",fenshuHis:""}));}}><option value="">Chưa khai báo</option><option value="0">Chưa từng thi</option><option value="1">Đã từng thi</option></select></label>
        {draft.isExamHsk==="1"&&<><label>Cấp HSK đã thi<select value={draft.kmidHis} onChange={e=>change("kmidHis",e.target.value)}><option value="">Chọn</option>{["826485","826486","828635","828636","828637","828638","828639"].map((id,i)=><option key={id} value={id}>HSK {i===6?"7–9":i+1}</option>)}</select></label><label>Điểm đã thi<input type="number" min="0" value={draft.fenshuHis} onChange={e=>change("fenshuHis",e.target.value)}/></label></>}
      </div>
      <div className="ct-photo-block">
        <div className="ct-photo-preview">{cloud?.photoKey&&!imageError?<img src={path+"/photo/"+cloud.photoVersion} alt="Ảnh chân dung đã lưu" onError={()=>setImageError(true)}/>:<span>{imageError?"Chưa tải được ảnh xem trước":draft.photo?"Ảnh cũ trên ChineseTest":"Chưa có ảnh chân dung"}</span>}</div>
        <div><label className="ct-photo">Ảnh chân dung (không dùng ảnh giấy tờ)<input type="file" accept="image/jpeg,image/png" onChange={e=>{const f=e.target.files?.[0];e.target.value="";if(f)void act(()=>upload(f));}}/></label>
        <p className="ct-muted">JPG/PNG, lớn hơn 15 KB và nhỏ hơn 1 MB. Ảnh được lưu trên Supabase; bấm Lưu hồ sơ mới đồng bộ sang ChineseTest.</p>
        <p className="ct-photo-status" role="status">{cloud?.photoKey?(cloud.photoVersion===cloud.syncedPhotoVersion?"Ảnh đã đồng bộ ChineseTest":"Đã lưu ảnh · Chưa đồng bộ ChineseTest"):draft.photo?"Đang dùng ảnh cũ trên ChineseTest. Chọn lại ảnh để lưu bản gốc trên hệ thống.":"Chưa có ảnh đã lưu."}</p>
        {imageError&&<Button onClick={()=>{setImageError(false);setCloud(p=>p?{...p}:p);}}>Tải lại ảnh xem trước</Button>}</div>
      </div>
    </fieldset>
  </DialogContent><DialogActions><Button disabled={busy} onClick={close}>Đóng</Button><Button appearance="primary" disabled={busy || !loaded} onClick={()=>void act(save)}>{busy?"Đang xử lý…":"Lưu hồ sơ"}</Button></DialogActions></DialogBody></DialogSurface></Dialog>;
}
