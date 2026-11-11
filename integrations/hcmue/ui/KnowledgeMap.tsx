import { useMemo, useState } from "react";
import { PCA } from "ml-pca";
import type { KnowledgeMapPoint } from "../knowledge/documents";

export function KnowledgeMap({ points }: { points: KnowledgeMapPoint[] }) {
  const [selectedId, setSelectedId] = useState("");
  const layout = useMemo(() => {
    if (points.length < 2) return points.map(point => ({ ...point, x: 50, y: 50 }));
    const vectors = points.map(point => point.embedding);
    const coordinates = new PCA(vectors).predict(vectors, { nComponents: 2 }).to2DArray();
    const xs = coordinates.map(point => point[0] ?? 0);
    const ys = coordinates.map(point => point[1] ?? 0);
    const xMin = Math.min(...xs), xMax = Math.max(...xs);
    const yMin = Math.min(...ys), yMax = Math.max(...ys);
    const scale = Math.max(xMax - xMin, yMax - yMin, 1e-8);
    return points.map((point, index) => ({
      ...point, x: 50 + 82 * (xs[index] - (xMin + xMax) / 2) / scale,
      y: 50 - 82 * (ys[index] - (yMin + yMax) / 2) / scale,
    }));
  }, [points]);
  const selected = points.find(point => point.id === selectedId) ?? points[0];
  if (!selected) return <p>Chưa có đoạn nào được lập chỉ mục cho model hiện tại.</p>;
  return <>
    <p className="hck-muted">{points.length} đoạn · Chiếu 2D bằng PCA</p>
    <div className="hck-map" role="group" aria-label="Bản đồ vector tài liệu">
      {layout.map(point => <button key={point.id} type="button" title={point.heading || point.title}
        aria-label={`${point.title}${point.heading ? ` · ${point.heading}` : ""}`} aria-pressed={point.id === selected.id}
        style={{ left: `${point.x}%`, top: `${point.y}%` }} onClick={() => setSelectedId(point.id)} />)}
    </div>
    <label className="hck-map-picker">Đoạn đang xem
      <select value={selected.id} onChange={event => setSelectedId(event.target.value)}>
        {points.map(point => <option key={point.id} value={point.id}>{point.title}{point.heading && ` · ${point.heading}`}</option>)}
      </select>
    </label>
    <p className="hck-excerpt">{selected.content}</p>
  </>;
}
