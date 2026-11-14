import { useEffect, useId, useState, useCallback } from "react";
import { ArrowLeft, CaretRight, Crosshair, SlidersHorizontal } from "@phosphor-icons/react";
import { GuideSpotlight } from "./GuideSpotlight";
import { useCompanionMemory, type Companion } from "./companion";

export function CompanionCard({ companion, onAsk, pending }: { companion: Companion; onAsk(question: string): void; pending: boolean }) {
  const { context, tracking, feed } = useCompanionMemory(companion);
  const [goal, setGoal] = useState(context.goal);
  const [expanded, setExpanded] = useState(false);
  const [focus, setFocus] = useState<string>();
  const bodyId = useId();
  const { page } = context;
  const focused = page.controls.find(item => item.id === page.focusedControl);
  const blocked = focused?.disabled && focused.reason ? focused : undefined;
  const hint = blocked ? `“${blocked.label}”: ${blocked.reason}` : page.notices.at(-1) || page.facts.find(fact => fact.label === "Bước tiếp theo")?.value;
  const watch = tracking.watch;
  const resolveFocus = useCallback(() => focus ? companion.resolve(focus) : undefined, [companion, focus]);
  useEffect(() => { if (tracking.choices) setExpanded(true); }, [tracking.choices]);
  return <section className="ai-companion" data-expanded={expanded} aria-label="Đồng hành trên trang">
    {focus && <GuideSpotlight companion label="Vị trí bạn đang hỏi" resolve={resolveFocus}/>}
    <div className="ai-companion-bar">
      <span className="ai-companion-location"><span className="ai-live-dot" aria-hidden="true"/>{watch?.active ? "Đang theo dõi lịch" : page.title}</span>
      <div className="ai-companion-tools">
        {!watch?.active && <button type="button" className="ai-companion-follow" aria-label="Theo dõi đăng ký" onClick={() => { setExpanded(false); onAsk("Theo dõi đăng ký giúp mình"); }}>Theo dõi</button>}
        <button type="button" className="ai-companion-help" disabled={pending} aria-label="Mình nên làm gì tiếp?" title="Mình nên làm gì tiếp?" onClick={() => { setExpanded(false); onAsk("Mình đang vướng gì, làm tiếp thế nào?"); }}>Gợi ý</button>
        <button type="button" className="ai-companion-toggle" aria-label="Ngữ cảnh đang theo" aria-expanded={expanded} aria-controls={bodyId} onClick={() => setExpanded(value => !value)}><SlidersHorizontal size={15}/>Ngữ cảnh</button>
      </div>
    </div>
    {expanded && <div className="ai-context-view" id={bodyId}>
      <button type="button" className="ai-context-back" onClick={() => setExpanded(false)}><ArrowLeft size={15}/>Về cuộc trò chuyện</button>
      <header><h3>Cùng bạn làm việc</h3><p>Chọn việc cần theo dõi và xem những gì mình đang nắm được.</p></header>
      <section className="ai-context-section"><h4>Theo dõi đăng ký</h4>
        {watch?.active ? <><p>{context.tracking?.summary || "Đang theo dõi lịch đã chọn"}</p><button type="button" onClick={() => companion.stopTracking()}>Dừng theo dõi của AI</button><small>Thao tác này chỉ dừng tin cập nhật; lịch trên Runner vẫn giữ nguyên.</small></>
          : <p>Nhắn “theo dõi giúp mình” để mình báo các bước mới và kết quả ngay trong chat.</p>}
        {tracking.choices && feed && <div className="ai-tracking-choices">{feed.runs.filter(run => !["confirmed", "simulated", "failed", "stopped"].includes(run.phase)).map(run => <button key={run.id} type="button" onClick={() => { companion.startTracking([run.id]); setExpanded(false); }}>Theo dõi {run.label}<CaretRight size={14}/></button>)}</div>}
      </section>
      <form className="ai-context-goal" onSubmit={event => { event.preventDefault(); companion.setGoal(goal); }}>
        <label>Mục tiêu đang làm<input value={goal} maxLength={400} placeholder="Ví dụ: chuẩn bị đăng ký HSK 5" onChange={event => setGoal(event.target.value)}/></label>
        <button type="submit">Lưu mục tiêu</button>
      </form>
      {hint && <section className="ai-context-section"><h4>Việc cần chú ý</h4><p>{hint}</p>{blocked && <button type="button" onClick={() => { setFocus(blocked.id); setExpanded(false); }}><Crosshair size={14}/>Chỉ vị trí</button>}</section>}
      <section className="ai-context-section"><h4>Trạng thái hiện tại</h4>
        {!!page.dialogs.length && <p>Đang mở: {page.dialogs.join(" · ")}</p>}
        <dl>{page.facts.map(fact => <div key={fact.label}><dt>{fact.label}</dt><dd>{fact.value}</dd></div>)}</dl>
      </section>
      {!!context.events.length && <section className="ai-context-section"><h4>Thao tác gần đây</h4><ul>{context.events.slice(-3).map((event, index) => <li key={index}>{event.label}</li>)}</ul></section>}
      <p className="ai-context-note">Chỉ theo dõi trong tab này. Mình không đọc giá trị bạn nhập vào biểu mẫu.</p>
    </div>}
  </section>;
}
