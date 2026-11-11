import { useEffect, useRef, useState } from "react";
import { ArrowsInSimple, ArrowsOutSimple, ArrowUp, Books, ChatTeardropText, X } from "@phosphor-icons/react";
import { AssistantBoundary } from "./AssistantBoundary";
import { readReply, type SystemReply } from "./reply";
import "./assistant.css";

type Turn = { role: "user" | "assistant"; text: string; reply?: SystemReply };
const workspace = () => location.pathname.startsWith("/chinesetest") ? "chinesetest"
  : location.pathname.startsWith("/hcmue") ? "hcmue"
  : ["/", "/google-direct"].includes(location.pathname) ? "forms" : "system";
const workspaceName = () => ({ chinesetest: "ChineseTest", hcmue: "HCMUE", forms: "Google Forms", system: "Toàn hệ thống" })[workspace()];

function Conversation({ onClose }: { onClose(): void }) {
  const [turns, setTurns] = useState<Turn[]>([]);
  const [text, setText] = useState("");
  const [error, setError] = useState("");
  const [expanded, setExpanded] = useState(false);
  const [pending, setPending] = useState(false);
  const request = useRef<AbortController | undefined>(undefined);
  const input = useRef<HTMLTextAreaElement>(null);
  const log = useRef<HTMLDivElement>(null);
  useEffect(() => {
    input.current?.focus();
    const keyboard = (event: KeyboardEvent) => { if (event.key === "Escape") { event.preventDefault(); onClose(); } };
    document.addEventListener("keydown", keyboard);
    return () => { document.removeEventListener("keydown", keyboard); request.current?.abort(); request.current = undefined; };
  }, [onClose]);
  useEffect(() => { if (log.current) log.current.scrollTop = log.current.scrollHeight; }, [turns, pending, error]);
  async function send(question: string) {
    if (!question.trim() || request.current) return;
    const controller = new AbortController();
    request.current = controller;
    const timeout = setTimeout(() => controller.abort(), 22_000);
    setPending(true); setError(""); setText("");
    setTurns(old => [...old, { role: "user", text: question.trim() }]);
    try {
      const response = await fetch("/api/assistant/chat", {
        method: "POST", headers: { "Content-Type": "application/json" }, signal: controller.signal,
        body: JSON.stringify({ message: question.trim(), workspace: workspace(), history: turns.slice(-4).map(({ role, text }) => ({ role, text })) }),
      });
      let raw;
      try { raw = await response.json(); } catch { throw new Error("Máy chủ chưa trả câu trả lời hợp lệ. Thử gửi lại sau ít phút."); }
      if (!response.ok) throw new Error(raw.error || "Chưa nhận được câu trả lời. Thử lại sau ít phút.");
      const reply = readReply(raw);
      if (request.current === controller) setTurns(old => [...old, { role: "assistant", text: reply.answer, reply }]);
    } catch (error) {
      if (request.current === controller) {
        setError(controller.signal.aborted ? "Trợ lý phản hồi chậm. Gửi lại câu hỏi để thử lại; bạn vẫn có thể dùng các màn khác." : (error as Error).message);
        setText(question);
      }
    } finally {
      clearTimeout(timeout);
      if (request.current === controller) { request.current = undefined; setPending(false); input.current?.focus(); }
    }
  }
  return <aside className="ai-panel" data-expanded={expanded} role="dialog" aria-modal="false" aria-labelledby="system-ai-title">
    <header className="ai-header">
      <span className="ai-mark"><ChatTeardropText size={23} weight="duotone" /></span>
      <div><h2 id="system-ai-title">Trợ lý HANU</h2><span>{workspaceName()} · Tra cứu có nguồn</span></div>
      <button aria-label={expanded ? "Thu gọn trợ lý" : "Mở rộng trợ lý"} onClick={() => setExpanded(!expanded)}>
        {expanded ? <ArrowsInSimple size={18} /> : <ArrowsOutSimple size={18} />}</button>
      <button aria-label="Đóng trợ lý" onClick={onClose}><X size={19} /></button>
    </header>
    <div className="ai-log" ref={log} role="log" aria-label="Cuộc trò chuyện">
      {!turns.length && <div className="ai-welcome">
        <span className="ai-welcome-mark"><ChatTeardropText size={32} weight="duotone" /></span>
        <h3>Mình có thể giúp gì?</h3><p>Hỏi cách dùng, giải thích lỗi hoặc tìm hướng dẫn cho từng ứng dụng.</p>
        <div className="ai-suggestions">{["Tôi nên bắt đầu từ đâu?", "Xem bản đồ vector ở đâu?", `Hướng dẫn dùng ${workspaceName()}`].map(question =>
          <button key={question} onClick={() => void send(question)}>{question}<ArrowUp size={14} /></button>)}</div>
      </div>}
      {turns.map((turn, index) => <article key={index} className={`ai-message ai-message-${turn.role}`}>
        {turn.role === "assistant" && <strong>HANU <small>{turn.reply?.source === "guide" ? "Từ tài liệu" : "AI"}</small></strong>}
        <p>{turn.text}</p>
        {!!turn.reply?.references.length && <nav aria-label="Nguồn tham khảo">{turn.reply.references.map(ref =>
          <a key={ref.id} href={ref.href} target="_blank" rel="noreferrer"><Books size={13} />{ref.title}</a>)}</nav>}
      </article>)}
      {pending && <div className="ai-thinking" role="status"><span /><span /><span />Đang tra cứu hướng dẫn</div>}
      {error && <div className="ai-error" role="alert"><strong>Chưa có câu trả lời</strong><p>{error}</p></div>}
    </div>
    <form className="ai-composer" onSubmit={event => { event.preventDefault(); void send(text); }}>
      <textarea ref={input} aria-label="Câu hỏi của bạn" placeholder="Hỏi trợ lý HANU…" rows={1} maxLength={1200} value={text}
        onChange={event => setText(event.target.value)} onKeyDown={event => {
          if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) { event.preventDefault(); void send(text); }
        }} />
      <button type="submit" aria-label="Gửi câu hỏi" disabled={!text.trim() || pending}><ArrowUp size={21} /></button>
    </form>
    <footer className="ai-footer"><span>Kiểm tra hướng dẫn trước khi thao tác.</span><a href="/knowledge">Kho tri thức</a></footer>
  </aside>;
}

export function SystemAssistant() {
  const [open, setOpen] = useState(false);
  const trigger = useRef<HTMLButtonElement>(null);
  const close = useRef(() => { setOpen(false); requestAnimationFrame(() => trigger.current?.focus()); }).current;
  // HCMUE supplies the same dock with its encrypted runner context and action confirmations.
  if (location.pathname === "/hcmue") return null;
  return <>
    <button ref={trigger} type="button" className="ai-launcher" aria-label="Trợ lý AI" title="Hỏi trợ lý HANU"
      aria-expanded={open} aria-haspopup="dialog" onClick={() => setOpen(!open)}>
      {open ? <X size={24} /> : <ChatTeardropText size={27} weight="duotone" />}<span>Hỏi AI</span>
    </button>
    {open && <AssistantBoundary onClose={close}><Conversation onClose={close} /></AssistantBoundary>}
  </>;
}
