import { Component, lazy, Suspense, useMemo, useState, type ReactNode } from "react";
import { ArrowsClockwise, Cube, CursorClick, Graph } from "@phosphor-icons/react";
import type { KnowledgeMapPoint } from "../knowledge/documents";
import { projectVectors, vectorEdges } from "./vector-layout";
const VectorScene = lazy(() => import("./VectorScene"));
class SceneBoundary extends Component<{ children: ReactNode; onUnavailable(): void }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() { return { failed: true }; }
  componentDidCatch() { this.props.onUnavailable(); }
  render() { return this.state.failed ? null : this.props.children; }
}

export function KnowledgeMap({ points, selectedId, onSelect }: {
  points: KnowledgeMapPoint[]; selectedId: string; onSelect(id: string): void;
}) {
  const [mode, setMode] = useState<"3d" | "2d">("3d");
  const [failed, setFailed] = useState(false), [reset, setReset] = useState(0);
  const [paused, setPaused] = useState(() => matchMedia("(prefers-reduced-motion: reduce)").matches);
  const layout = useMemo(() => projectVectors(points), [points]);
  const edges = useMemo(() => vectorEdges(layout), [layout]);
  const is3d = mode === "3d" && !failed;
  return <div className="kv-stage">
    <div className="kv-stage-toolbar">
      <span className="kv-live-dot" /><span>Không gian ngữ nghĩa</span>
      <div className="kv-mode" role="group" aria-label="Chế độ bản đồ">
        <button aria-pressed={is3d} onClick={() => { setMode("3d"); setFailed(false); }}><Cube size={14}/>3D</button>
        <button aria-pressed={!is3d} onClick={() => { setMode("2d"); setFailed(false); }}><Graph size={14}/>2D</button>
      </div>
      <button className="kv-reset" aria-label="Đặt lại góc nhìn" title="Đặt lại góc nhìn" onClick={() => setReset(value => value + 1)}><ArrowsClockwise size={16}/></button>
    </div>
    <div className="kv-viewport" role="group" aria-label="Bản đồ vector tài liệu">
      {points.length > 0 ? <>
        {is3d ? <SceneBoundary onUnavailable={() => setFailed(true)}><Suspense fallback={<div className="kv-map-loading">Đang dựng không gian 3D…</div>}>
          <VectorScene points={layout} edges={edges} selectedId={selectedId} onSelect={onSelect} onUnavailable={() => setFailed(true)} reset={reset} paused={paused}/>
        </Suspense></SceneBoundary> : <div className="kv-map-2d">
          <svg viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true">{edges.map(([i, j]) =>
            <line key={`${i}-${j}`} x1={50 + layout[i].position[0] * 12} y1={50 - layout[i].position[1] * 12}
              x2={50 + layout[j].position[0] * 12} y2={50 - layout[j].position[1] * 12}/>)}</svg>
          {layout.map(point => <button key={point.id} className="kv-node" title={point.heading || point.title}
            aria-label={`${point.title}${point.heading ? ` · ${point.heading}` : ""}`} aria-pressed={point.id === selectedId}
            style={{ left: `${50 + point.position[0] * 12}%`, top: `${50 - point.position[1] * 12}%` }} onClick={() => onSelect(point.id)}/>)}
        </div>}
        {is3d && <div className="kv-accessible-nodes" aria-label="Chọn đoạn trên bản đồ">{layout.map(point =>
          <button key={point.id} onClick={() => onSelect(point.id)} aria-pressed={point.id === selectedId}>{point.title}{point.heading ? ` · ${point.heading}` : ""}</button>)}</div>}
      </> : <div className="kv-map-empty"><div className="kv-orbit"><Graph size={42} weight="thin"/></div>
        <h3>Chờ những điểm tri thức đầu tiên</h3><p>Tạo vector cho tài liệu để khám phá các đoạn và mối liên hệ trong kho.</p></div>}
      <span className="kv-axis kv-axis-y">Y</span><span className="kv-axis kv-axis-x">X</span>
      <div className="kv-map-caption"><span>PCA {is3d ? "3D" : "2D"}</span><span>{points.length} điểm thực</span></div>
    </div>
    <footer className="kv-stage-footer"><span><CursorClick size={14}/>{is3d ? "Kéo để xoay · Cuộn để thu phóng · Chọn điểm để đọc" : "Chọn một điểm để đọc đoạn gốc"}</span>
      {is3d && points.length > 0 && <button onClick={() => setPaused(!paused)}>{paused ? "Tự xoay" : "Dừng xoay"}</button>}
    </footer>
    {failed && <p className="kv-fallback-note" role="status">Thiết bị không hỗ trợ WebGL. Đang hiển thị bản đồ 2D với cùng dữ liệu.</p>}
  </div>;
}
