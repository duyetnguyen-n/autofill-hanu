import { useState } from "react";
import { GuideSpotlight } from "./GuideSpotlight";
import { useCompanionMemory, type Companion } from "./companion";

export function CompanionCard({ companion, onAsk, pending }: { companion: Companion; onAsk(question: string): void; pending: boolean }) {
  const { context } = useCompanionMemory(companion);
  const [goal, setGoal] = useState(context.goal);
  const [dismissed, setDismissed] = useState<string[]>([]);
  const [focus, setFocus] = useState<string>();
  const { page } = context;
  const focused = page.controls.find(item => item.id === page.focusedControl);
  const blocked = focused?.disabled && focused.reason ? focused : page.controls.find(item => item.disabled && item.reason);
  const nextStep = page.facts.find(fact => fact.label === "Bước tiếp theo")?.value;
  const hintControl = focused?.disabled && focused.reason ? focused : !page.notices.length && !nextStep ? blocked : undefined;
  const hint = hintControl ? `“${hintControl.label}”: ${hintControl.reason}` : page.notices.at(-1) || nextStep;
  const signature = `${page.path}:${hint}`;
  return <section className="ai-companion" aria-label="Đồng hành trên trang">
    {focus && <GuideSpotlight companion label="Vị trí bạn đang hỏi" resolve={() => companion.resolve(focus)}/>}
    <div className="ai-companion-heading"><span className="ai-live-dot" aria-hidden="true"/><strong>Đang cùng bạn ở {page.title}</strong></div>
    {hint && !dismissed.includes(signature) && <div className="ai-companion-hint">
      <p>{hint}</p>
      <div>{hintControl && <button type="button" onClick={() => setFocus(focus === hintControl.id ? undefined : hintControl.id)}>{focus === hintControl.id ? "Ẩn đánh dấu" : "Chỉ vị trí"}</button>}
        <button type="button" onClick={() => { setDismissed(old => [...old.slice(-7), signature]); setFocus(undefined); }}>Bỏ qua gợi ý</button></div>
    </div>}
    <button type="button" className="ai-companion-ask" disabled={pending} onClick={() => onAsk("Mình đang vướng gì, làm tiếp thế nào?")}>Mình nên làm gì tiếp?</button>
    <details><summary>Ngữ cảnh đang theo</summary>
      {!!page.dialogs.length && <p>Đang mở: {page.dialogs.join(" · ")}</p>}
      {!!page.facts.length && <dl>{page.facts.map(fact => <div key={fact.label}><dt>{fact.label}</dt><dd>{fact.value}</dd></div>)}</dl>}
      {!!context.events.length && <ul aria-label="Thao tác gần đây">{context.events.slice(-3).map((event, index) => <li key={index}>{event.label}</li>)}</ul>}
      <form onSubmit={event => { event.preventDefault(); companion.setGoal(goal); }}>
        <label>Mục tiêu đang làm<input value={goal} maxLength={400} placeholder="Ví dụ: chuẩn bị đăng ký HSK 5" onChange={event => setGoal(event.target.value)}/></label>
        <button type="submit">Lưu mục tiêu</button>
      </form>
      <small>Ghi nhớ trong tab này trong 2 giờ. Không đọc nội dung bạn nhập vào biểu mẫu.</small>
    </details>
  </section>;
}
