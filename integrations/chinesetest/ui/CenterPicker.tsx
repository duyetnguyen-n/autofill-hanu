import React, { useEffect, useState } from "react";
import { Combobox, Option, Button } from "@fluentui/react-components";
import type { Row } from "../protocol";
import { centerLabel } from "./planning";
import { BusyLine } from "./BusyLine";
const searchable = (value: string) => value.normalize("NFKD").replace(/[\u0300-\u036f]/g, "").replace(/đ/g, "d").replace(/Đ/g, "D").toLowerCase();
export function CenterPicker({ id, name, value, choices, available, format, change, loading=false, disabled=false }: {
  id: string; name: string; value: string; choices: Row[]; available: Row[]; format: string; loading?: boolean; disabled?: boolean;
  change(value: string, name?: string): void;
}) {
  const selected=choices.find(row=>String(row.kdId)===value), label=selected?centerLabel(selected):value;
  const [query,setQuery]=useState(label),[manual,setManual]=useState(false),[open,setOpen]=useState(false);
  useEffect(()=>{setQuery(label);},[value,label]);
  useEffect(()=>{setManual(false);setOpen(false);},[format]);
  const matching=choices.filter(row=>searchable([row.kdId,row.kdEName,row.kdName,row.cityName].join(" ")).includes(searchable(query.trim())));
  return <div className="ct-center-picker">
    <label htmlFor={`center-${id}`}>Điểm thi cho {name}</label>
    <Combobox id={`center-${id}`} className="ct-center-combobox" placeholder="Gõ tên trường, thành phố hoặc mã điểm thi" value={query} selectedOptions={value?[value]:[]} open={open} disabled={disabled} aria-busy={loading}
      onOpenChange={(_,data)=>{setOpen(data.open);setQuery(data.open?"":label);}}
      onChange={e=>{setQuery(e.target.value);setOpen(true);}}
      onOptionSelect={(_,data)=>{const row=choices.find(row=>String(row.kdId)===data.optionValue);if(row){change(String(row.kdId),row.kdEName || row.kdName);setQuery(centerLabel(row));setManual(false);}}}>
      {matching.map(row=><Option key={row.kdId} value={String(row.kdId)} text={centerLabel(row)}><span className="ct-center-option"><strong>{centerLabel(row)}</strong><small>{row.kdName}{row.cityName?` · ${row.cityName}`:""}</small><small>{available.some(site=>String(site.kdId)===String(row.kdId))?"Đã xuất hiện cho kỳ thi":"Chờ mở cho kỳ thi"}</small></span></Option>)}
      {!matching.length&&<Option value="__empty__" disabled>{loading?"Đang tải điểm thi…":"Không có điểm thi khớp từ khóa"}</Option>}
    </Combobox>
    {loading&&<BusyLine>Đang tải danh mục và điểm thi cho kỳ đã chọn…</BusyLine>}
    <Button appearance="transparent" size="small" disabled={disabled} onClick={()=>setManual(v=>!v)}>{manual?"Ẩn nhập mã thủ công":"Điểm thi chưa có trong danh mục?"}</Button>
    {manual&&<label>Tên hoặc mã điểm thi chưa có trong danh mục<input disabled={disabled} value={value} onChange={e=>change(e.target.value)} placeholder="Nhập mã hoặc tên đầy đủ"/><small>Runner sẽ chờ điểm thi khớp chính xác.</small></label>}
  </div>;
}
