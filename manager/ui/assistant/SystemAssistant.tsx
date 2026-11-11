import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { ArrowsInSimple, ArrowsOutSimple, ArrowUp, ArrowUpRight, Books, ChatTeardropText, CheckCircle, Compass, X } from "@phosphor-icons/react";
import type { Account } from "../../../src/account";
import { AssistantBoundary } from "./AssistantBoundary";
import { AdminSpotlight, visibleGuideTarget, type GuideStep } from "./AdminSpotlight";
import { adminGuideIntent, adminPath, GuideContext } from "./guide";
import { readReply, type SystemReply } from "./reply";
import "./assistant.css";

type Turn = { role: "user" | "assistant"; text: string; reply?: SystemReply };
const handoffKey = "hanu-admin-guide";

function restoreTurns(owner: string): Turn[] | undefined {
  try {
    const data = JSON.parse(sessionStorage.getItem(handoffKey) ?? "null");
    if (location.pathname !== adminPath || data?.owner !== owner || data.expires < Date.now() || !Array.isArray(data.turns)) return;
    return data.turns.slice(-12).flatMap((turn: Turn) =>
      turn && ["user", "assistant"].includes(turn.role) && typeof turn.text === "string"
        ? [{ role: turn.role, text: turn.text.slice(0, 4000) }] : []);
  } catch { return; }
}

function saveHandoff(owner: string, turns: Turn[]) {
  try {
    sessionStorage.setItem(handoffKey, JSON.stringify({
      owner, expires: Date.now() + 60_000,
      turns: turns.slice(-12).map(({ role, text }) => ({ role, text })),
    }));
  } catch { /* The browser can still follow the link when tab storage is unavailable. */ }
}
const workspace = () => location.pathname.startsWith("/chinesetest") ? "chinesetest"
  : location.pathname.startsWith("/hcmue") ? "hcmue"
  : ["/", "/google-direct"].includes(location.pathname) ? "forms" : "system";
const workspaceName = () => ({ chinesetest: "ChineseTest", hcmue: "HCMUE", forms: "Google Forms", system: "Toàn hệ thống" })[workspace()];

function Conversation({ account, restored, initialQuestion, active, setActive, onClose }: {
  account: Account; restored?: Turn[]; initialQuestion?: string; active: boolean;
  setActive(active: boolean): void; onClose(): void;
}) {
  const [turns, setTurns] = useState<Turn[]>(() => restored ? [
    ...restored, { role: "assistant", text: "Bạn đã vào trang Quản trị. Bạn có thể hỏi tiếp ngay tại đây." },
  ] : []);
  const [step, setStep] = useState<GuideStep | "done" | undefined>(restored ? "done" : undefined);
  const [text, setText] = useState("");
  const [error, setError] = useState("");
  const [expanded, setExpanded] = useState(false);
  const [pending, setPending] = useState(false);
  const request = useRef<AbortController | undefined>(undefined);
  const input = useRef<HTMLTextAreaElement>(null);
  const log = useRef<HTMLDivElement>(null);
  useEffect(() => {
    input.current?.focus();
    const keyboard = (event: KeyboardEvent) => {
      if (event.key === "Escape" && (event.target instanceof Node && input.current?.closest(".ai-panel")?.contains(event.target))) {
        event.preventDefault();
        onClose();
      }
    };
    document.addEventListener("keydown", keyboard);
    return () => { document.removeEventListener("keydown", keyboard); request.current?.abort(); request.current = undefined; };
  }, [onClose]);
  useEffect(() => { if (log.current) log.current.scrollTop = log.current.scrollHeight; }, [turns, pending, error]);
  useEffect(() => {
    if (!active || account.role !== "admin") return;
    const remember = (event: MouseEvent) => {
      if (event.button !== 0 || event.ctrlKey || event.metaKey || event.shiftKey || event.altKey) return;
      const link = event.target instanceof Element ? event.target.closest<HTMLAnchorElement>('[data-guide-target="open-admin"]') : null;
      if (link?.getAttribute("href") === adminPath) saveHandoff(account.id, turns);
    };
    document.addEventListener("click", remember, true);
    return () => document.removeEventListener("click", remember, true);
  }, [account.id, account.role, active, turns]);
  useEffect(() => { if (account.role !== "admin") setStep(undefined); }, [account.role]);

  function openAdmin(history: Turn[]) {
    if (account.role !== "admin" || location.pathname === adminPath) return;
    saveHandoff(account.id, history);
    location.assign(adminPath);
  }

  function guideAction() {
    if (account.role !== "admin") return;
    if (step === "menu") visibleGuideTarget("menu")?.click();
    if (step === "admin") openAdmin(turns);
  }

  async function send(question: string) {
    if (!question.trim() || request.current) return;
    const intent = adminGuideIntent(question, active);
    if (intent) {
      setError("");
      setText("");
      const history: Turn[] = [...turns, { role: "user", text: question.trim() }];
      if (account.role !== "admin") {
        setActive(false);
        setStep(undefined);
        setTurns([...history, { role: "assistant", text: "Tài khoản của bạn chưa có quyền Quản trị. Liên hệ quản trị viên để được cấp quyền phù hợp." }]);
      } else if (location.pathname === adminPath) {
        setStep("done");
        setTurns([...history, { role: "assistant", text: "Bạn đang ở trang Quản trị. Bạn muốn tìm mục nào?" }]);
      } else if (intent === "open") {
        setTurns(history);
        if (active && step === "menu" && !/quan tri|quản trị|admin/i.test(question)) visibleGuideTarget("menu")?.click();
        else openAdmin(history);
      } else {
        setExpanded(false);
        setActive(true);
        setStep(visibleGuideTarget("admin") ? "admin" : "menu");
        setTurns([...history, { role: "assistant", text: "Mình sẽ đánh dấu từng nút để bạn vào trang Quản trị. Bạn có thể bấm theo hoặc nhờ mình mở giúp." }]);
      }
      return;
    }
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
  const initial = useRef(initialQuestion);
  useEffect(() => {
    if (!initial.current) return;
    const question = initial.current;
    initial.current = undefined;
    void send(question);
  }, []);
  const onAccountPage = location.pathname === "/account";
  return <aside className="ai-panel" data-expanded={expanded} data-guiding={active} data-has-step={Boolean(step)}
    role="dialog" aria-modal="false" aria-labelledby="system-ai-title">
    {active && <AdminSpotlight onStep={setStep}/>}
    <header className="ai-header">
      <span className="ai-mark"><ChatTeardropText size={23} weight="duotone" /></span>
      <div><h2 id="system-ai-title">Trợ lý HANU</h2><span>{workspaceName()} · Tra cứu có nguồn</span></div>
      <button disabled={active} aria-label={expanded ? "Thu gọn trợ lý" : "Mở rộng trợ lý"} onClick={() => setExpanded(!expanded)}>
        {expanded ? <ArrowsInSimple size={18} /> : <ArrowsOutSimple size={18} />}</button>
      <button aria-label="Đóng trợ lý" onClick={onClose}><X size={19} /></button>
    </header>
    {step && <section className="guide-card" aria-label="Hướng dẫn vào Quản trị">
      <span className="guide-card-icon">{step === "done" ? <CheckCircle size={20} weight="fill"/> : <Compass size={21} weight="duotone"/>}</span>
      <div className="guide-card-copy" role="status">
        <span>{step === "done" ? "Hoàn tất" : onAccountPage ? "Bước 1 / 1" : step === "menu" ? "Bước 1 / 2" : "Bước 2 / 2"}</span>
        <strong>{step === "done" ? "Đã vào trang Quản trị" : step === "menu" ? "Mở Tài khoản và công cụ" : "Chọn Quản trị"}</strong>
      </div>
      <button className="guide-dismiss" type="button" aria-label="Kết thúc hướng dẫn" onClick={() => { setActive(false); setStep(undefined); }}><X size={15}/></button>
      {step !== "done" && <>
        <div className="guide-progress" aria-hidden="true"><i/>{!onAccountPage && <i data-current={step === "admin"}/>}</div>
        <button type="button" className="guide-action" onClick={guideAction}>
          {step === "menu" ? "Mở menu giúp tôi" : "Mở Quản trị giúp tôi"} <ArrowUpRight size={14}/>
        </button>
      </>}
    </section>}
    <div className="ai-log" ref={log} role="log" aria-label="Cuộc trò chuyện">
      {!turns.length && <div className="ai-welcome">
        <span className="ai-welcome-mark"><ChatTeardropText size={32} weight="duotone" /></span>
        <h3>Mình có thể giúp gì?</h3><p>Hỏi cách dùng, giải thích lỗi hoặc tìm hướng dẫn cho từng ứng dụng.</p>
        <div className="ai-suggestions">{["Làm sao vào trang Quản trị?", "Xem bản đồ vector ở đâu?", `Hướng dẫn dùng ${workspaceName()}`].map(question =>
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

export function SystemAssistant({ account, children }: { account: Account; children: ReactNode }) {
  const [restored, setRestored] = useState(() => account.role === "admin" ? restoreTurns(account.id) : undefined);
  const [open, setOpen] = useState(Boolean(restored));
  const [active, setActive] = useState(false);
  const [initialQuestion, setInitialQuestion] = useState<string>();
  const trigger = useRef<HTMLButtonElement>(null);
  const close = useCallback(() => {
    setOpen(false);
    setActive(false);
    setRestored(undefined);
    setInitialQuestion(undefined);
    requestAnimationFrame(() => trigger.current?.focus());
  }, []);
  useEffect(() => {
    try { sessionStorage.removeItem(handoffKey); } catch { /* Tab storage is optional. */ }
  }, []);
  useEffect(() => { if (account.role !== "admin") setActive(false); }, [account.role]);
  const handoff = (question: string) => {
    setInitialQuestion(question);
    setOpen(true);
    return true;
  };
  const dedicatedHcmue = location.pathname === "/hcmue";
  return <GuideContext.Provider value={{ active, handoff }}>
    {children}
    {(!dedicatedHcmue || open) && <button ref={trigger} type="button" className="ai-launcher" aria-label="Trợ lý AI" title="Hỏi trợ lý HANU"
      aria-expanded={open} aria-haspopup="dialog" onClick={() => open ? close() : setOpen(true)}>
      {open ? <X size={24} /> : <ChatTeardropText size={27} weight="duotone" />}<span>Hỏi AI</span>
    </button>}
    {open && <AssistantBoundary onClose={close}><Conversation account={account} restored={restored}
      initialQuestion={initialQuestion} active={active} setActive={setActive} onClose={close}/></AssistantBoundary>}
  </GuideContext.Provider>;
}
