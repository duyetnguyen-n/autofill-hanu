import { useCompanionMemory, type Companion } from "./companion";

export function CompanionProgress({ companion }: { companion: Companion }) {
  const { tracking } = useCompanionMemory(companion);
  if (!tracking.updates.length) return null;
  return <section className="ai-progress" aria-label="Cập nhật đăng ký" aria-live="polite" aria-relevant="additions">
    <div className="ai-progress-label">Cùng theo dõi</div>
    {tracking.updates.map(update => <article className="ai-message ai-message-assistant ai-progress-message" data-kind={update.kind} key={update.id}>
      <strong>HANU <time dateTime={update.at}>{new Date(update.at).toLocaleTimeString("vi-VN", { timeZone: "Asia/Ho_Chi_Minh", hour: "2-digit", minute: "2-digit", hour12: false })}</time></strong>
      <p>{update.text}</p>
    </article>)}
  </section>;
}
