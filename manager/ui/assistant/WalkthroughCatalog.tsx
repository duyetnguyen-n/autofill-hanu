import { useState } from "react";
import { normalizeWalkText, legacyWalkthroughs, walkArea, walkAreaLabels, walkthroughs } from "./walkthroughs";
import type { WalkArea } from "./walkthrough-types";

const entries = [
  ...walkthroughs.map(flow => ({ id: flow.id, area: flow.area, title: flow.title })),
  ...legacyWalkthroughs,
].sort((left, right) => left.id.localeCompare(right.id));

export function WalkthroughCatalog({ onStart, allowed, initiallyOpen = false }: {
  onStart(id: string): void;
  allowed(area: WalkArea, id: string): boolean;
  initiallyOpen?: boolean;
}) {
  const [query, setQuery] = useState("");
  const [area, setArea] = useState("");
  const term = normalizeWalkText(query);
  const current = walkArea(location.pathname);
  const filtered = entries.filter(flow => allowed(flow.area, flow.id) && (!area || area === flow.area) &&
    normalizeWalkText(`${flow.id} ${flow.title}`).includes(term));
  const ordered = [...filtered].sort((left, right) => Number(right.area === current) - Number(left.area === current));
  return <details className="walk-catalog" open={initiallyOpen || undefined}>
    <summary>Danh mục hướng dẫn</summary>
    <div className="walk-catalog-controls">
      <input type="search" aria-label="Tìm hướng dẫn" placeholder="Tìm hướng dẫn…" value={query} onChange={event => setQuery(event.target.value)}/>
      <select aria-label="Lọc hướng dẫn theo ứng dụng" value={area} onChange={event => setArea(event.target.value)}>
        <option value="">Tất cả ứng dụng</option>
        {Object.entries(walkAreaLabels).filter(([value]) => entries.some(flow => flow.area === value && allowed(flow.area, flow.id)))
          .map(([value, label]) => <option key={value} value={value}>{label}</option>)}
      </select>
    </div>
    <ul>{ordered.map(flow => <li key={flow.id}><button type="button" onClick={() => onStart(flow.id)}>
      {flow.title}<small>{walkAreaLabels[flow.area]}</small>
    </button></li>)}</ul>
    {!filtered.length && <p>Không tìm thấy hướng dẫn phù hợp.</p>}
  </details>;
}
