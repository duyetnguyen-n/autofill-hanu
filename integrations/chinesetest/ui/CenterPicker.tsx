import React, { useEffect, useState } from "react";
import type { Row } from "../protocol";
import { centerLabel } from "./planning";

const searchable = (value: string) => value.normalize("NFKD").replace(/[\u0300-\u036f]/g, "").replace(/đ/g, "d").replace(/Đ/g, "D").toLowerCase();
export function CenterPicker({ id, name, value, choices, available, format, change }: {
  id: string; name: string; value: string; choices: Row[]; available: Row[]; format: string;
  change(value: string, name?: string): void;
}) {
  const [query, setQuery] = useState(""), [manual, setManual] = useState(false);
  useEffect(() => { setQuery(""); setManual(false); }, [format]);
  const selected = choices.find(row => String(row.kdId) === value);
  const matching = choices.filter(row => searchable([row.kdId, row.kdEName, row.kdName, row.cityName].join(" ")).includes(searchable(query.trim())));
  const options = selected && !matching.includes(selected) ? [selected, ...matching] : matching;
  return <div className="ct-center-picker">
    <label htmlFor={`center-search-${id}`}>Tìm điểm thi cho {name}</label>
    <input id={`center-search-${id}`} type="search" value={query} placeholder="Tìm tên trường, thành phố hoặc mã; để trống để xem tất cả" onChange={e => setQuery(e.target.value)}/>
    <label htmlFor={`center-select-${id}`}>Điểm thi cho {name}</label>
    <select id={`center-select-${id}`} value={manual ? "__manual__" : value} onChange={e => {
      if (e.target.value === "__manual__") { setManual(true); return; }
      const row = choices.find(row => String(row.kdId) === e.target.value);
      change(e.target.value, row ? row.kdEName || row.kdName : undefined);
    }}>
      <option value="">Chọn điểm thi trong danh mục Việt Nam</option>
      {!manual && value && !selected && <option value={value}>Đã nhập: {value}</option>}
      {options.map(row => <option key={row.kdId} value={row.kdId}>{centerLabel(row)} · {row.kdName} · {available.some(site => String(site.kdId) === String(row.kdId)) ? "Đã xuất hiện cho kỳ thi" : "Chờ mở cho kỳ thi"}</option>)}
      <option value="__manual__">Nhập tên / mã chưa có trong danh mục…</option>
    </select>
    {query && !matching.length && <small role="status">Không có điểm thi khớp từ khóa. Xóa từ khóa để xem toàn bộ danh sách.</small>}
    {manual && <label>Tên hoặc mã điểm thi chưa có trong danh mục<input value={value} onChange={e => change(e.target.value)} placeholder="Nhập mã hoặc tên đầy đủ; runner sẽ chờ điểm thi khớp chính xác"/></label>}
  </div>;
}
