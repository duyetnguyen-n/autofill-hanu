import React, { useEffect, useRef, useState } from "react";
import { Button } from "@fluentui/react-components";
import { feeKey, validDate, type Command, type FeeQuote, type Row, type Target } from "../protocol";
import { BusyLine } from "./BusyLine";
export const feeLabel=(t:Target)=>t.feeQuote?.key===feeKey(t)?`${t.feeQuote.amount} ${t.feeQuote.currency}`:"Chưa lấy được lệ phí";
export function FeeDisplay({accountId,target,request,change,disabled}:{accountId:string;target:Target;request(command:Command,args?:Row):Promise<any>;change(quote:FeeQuote):void;disabled:boolean}){
  const [busy,setBusy]=useState(false),[error,setError]=useState(""),[retry,setRetry]=useState(0),latest=useRef({target,change}),done=useRef("");latest.current={target,change};
  const key=feeKey(target),valid=/^\d+$/.test(target.kmId)&&["1","2","4"].includes(target.ksType)&&validDate(target.ksDate)&&Boolean(target.center),quoted=target.feeQuote?.key===key;
  useEffect(()=>{
    if(!valid||disabled){setBusy(false);return;}
    if(quoted && done.current===`${key}:${retry}`){setBusy(false);return;}
    let stopped=false;setBusy(true);setError("");
    const timer=setTimeout(()=>{void request("quote-fee",{accountId,reload:retry>0,target:{...latest.current.target,feeQuote:undefined,maxFee:undefined,currency:undefined}}).then((quote:FeeQuote)=>{
      if(!stopped&&quote.key===key){done.current=`${key}:${retry}`;if(JSON.stringify(latest.current.target.feeQuote)!==JSON.stringify(quote))latest.current.change(quote);}
    }).catch(e=>{if(!stopped)setError((e as Error).message);}).finally(()=>{if(!stopped)setBusy(false);});},300);
    return()=>{stopped=true;clearTimeout(timer);};
  },[key,valid,disabled,request,accountId,retry]);
  return <div className="ct-fee-panel" aria-busy={busy}><span className="ct-field-label">Lệ phí thi</span>
    {busy?<BusyLine>Đang lấy lệ phí từ ChineseTest…</BusyLine>:<output aria-label="Lệ phí thi" className="ct-fee-value">{quoted?feeLabel(target):valid?"Chưa lấy được lệ phí":"Chọn đủ cấp, hình thức, ngày và điểm thi"}</output>}
    {quoted&&Boolean(target.feeQuote?.linked.length)&&<small>Môn bắt buộc đi kèm: {target.feeQuote!.linked.join(", ")}. Mức phí hiển thị do ChineseTest trả về.</small>}
    {error&&<p className="ct-error" role="alert">{error}</p>}
    {valid&&!busy&&!disabled&&<Button size="small" appearance="transparent" onClick={()=>setRetry(v=>v+1)}>{error?"Thử lại lệ phí":"Cập nhật lệ phí"}</Button>}
  </div>;
}
