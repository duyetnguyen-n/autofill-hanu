import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { ArrowsInSimple, ArrowsOutSimple, ArrowUp, ArrowUpRight, Books, ChatTeardropText, CheckCircle, Compass, X } from "@phosphor-icons/react";
import type { Account } from "../../../src/account";
import { AssistantBoundary } from "./AssistantBoundary";
import { GuideSpotlight, visibleGuideTarget } from "./GuideSpotlight";
import { guideIntent, GuideContext, isFormsGuide, onGuidePage, pathForGuide, productForGuide, targetMarker, type FormsGuideStep, type Guide, type GuideTarget, type Product } from "./guide";
import { readReply, type SystemReply } from "./reply";
import { WalkthroughPanel } from "./WalkthroughPanel";
import { WalkthroughCatalog } from "./WalkthroughCatalog";
import { walkAreaLabels, walkthroughFor } from "./walkthroughs";
import { asksAboutCurrentPage, readCompanionHistory } from "../../assistant/context";
import { CompanionContextProvider, createCompanion, type Companion } from "./companion";
import { CompanionCard } from "./CompanionCard";
import "./assistant.css";

type Turn = { role: "user" | "assistant"; text: string; reply?: SystemReply };
type Handoff = { guide: Guide; turns: Turn[] };
const handoffKey = "hanu-guide";

function canOpenGuide(guide: Guide, account: Account, availableProducts: readonly Product[]) {
  const walk = walkthroughFor(guide);
  if (walk) {
    if (walk.admin && account.role !== "admin") return false;
    const product = availableProducts.find(item => item.id === walk.area);
    return !["forms", "direct", "hcmue", "chinesetest"].includes(walk.area) || Boolean(product);
  }
  if (guide === "admin") return account.role === "admin";
  if (isFormsGuide(guide)) return availableProducts.some(product => product.id === "forms");
  const product = productForGuide(guide);
  return !product || availableProducts.includes(product);
}

function restoreGuide(account: Account, availableProducts: readonly Product[]): Handoff | undefined {
  try {
    const data = JSON.parse(sessionStorage.getItem(handoffKey) ?? "null");
    if (data?.owner !== account.id || typeof data.expires !== "number" || data.expires < Date.now() || !Array.isArray(data.turns)) return;
    const guide = data.guide as Guide;
    if (!onGuidePage(guide) || !canOpenGuide(guide, account, availableProducts)) return;
    const turns = data.turns.slice(-12).flatMap((turn: Turn) =>
      turn && ["user", "assistant"].includes(turn.role) && typeof turn.text === "string"
        ? [{ role: turn.role, text: turn.text.slice(0, 4000) }] : []);
    return { guide, turns };
  } catch { return; }
}

function saveHandoff(owner: string, guide: Guide, turns: Turn[]) {
  try {
    sessionStorage.setItem(handoffKey, JSON.stringify({
      owner, guide, expires: Date.now() + 60_000,
      turns: turns.slice(-12).map(({ role, text }) => ({ role, text })),
    }));
  } catch { /* The browser can still follow the link when tab storage is unavailable. */ }
}
const workspace = () => location.pathname.startsWith("/chinesetest") ? "chinesetest"
  : location.pathname.startsWith("/hcmue") ? "hcmue"
  : ["/", "/google-direct"].includes(location.pathname) ? "forms" : "system";
const workspaceName = () => ({ chinesetest: "ChineseTest", hcmue: "HCMUE", forms: "Google Forms", system: "Toàn hệ thống" })[workspace()];

function guideName(guide: Guide) {
  const walk = walkthroughFor(guide);
  if (walk) return walk.title;
  if (guide === "pair-profile") return "Liên kết Chrome profile";
  if (guide === "prepare-profile") return "Chuẩn bị hồ sơ";
  if (guide === "admin") return "Quản trị";
  if (guide === "live") return "Quyền Live";
  if (guide === "access") return "Quyền sử dụng";
  return productForGuide(guide)!.label;
}

function arrivalMessage(guide: Guide, account: Account) {
  const walk = walkthroughFor(guide);
  if (walk) return `Mình sẽ chỉ từng bước cho “${walk.title}”. Bạn có thể hỏi tiếp trong lúc thao tác.`;
  if (isFormsGuide(guide)) return `Mình sẽ hướng dẫn bạn ${guideName(guide).toLowerCase()} ngay trên Google Forms. Bạn có thể hỏi tiếp trong lúc thao tác.`;
  if (guide === "live") return account.liveEnabled
    ? "Tài khoản của bạn đã được cấp quyền Live. Bạn có thể kiểm tra ở dòng Chế độ Live."
    : "Tài khoản của bạn chưa được cấp quyền Live. Liên hệ quản trị viên nếu cần đăng ký thật.";
  if (guide === "access") {
    const expiry = account.expiresAt ? new Date(account.expiresAt).toLocaleString("vi-VN") : "Không giới hạn";
    return `Tài khoản đang hoạt động. Hạn sử dụng: ${expiry}. Tối đa ${account.maxProfiles} profile và ${account.maxConcurrent} lượt đồng thời.`;
  }
  return `Bạn đã vào ${guide === "admin" ? "trang " : ""}${guideName(guide)}. Bạn có thể hỏi tiếp ngay tại đây.`;
}

function Conversation({ account, availableProducts, restored, initialQuestion, guide, setGuide, formsStep, active, onClose, companion }: {
  account: Account; availableProducts: readonly Product[]; restored?: Handoff; initialQuestion?: string;
  guide?: Guide; setGuide(guide?: Guide): void; formsStep?: FormsGuideStep; active: boolean; onClose(): void;
  companion: Companion;
}) {
  const [turns, setTurns] = useState<Turn[]>(() => restored ? [
    ...restored.turns, { role: "assistant", text: arrivalMessage(restored.guide, account) },
  ] : companion.getSnapshot().turns);
  useEffect(() => { companion.remember(turns); }, [companion, turns]);
  const [focus, setFocus] = useState<{ id: string; label: string }>();
  const resolveFocus = useCallback(() => focus ? companion.resolve(focus.id) : undefined, [companion, focus]);
  const [step, setStep] = useState<GuideTarget>();
  const arrived = Boolean(guide && onGuidePage(guide));
  const walk = walkthroughFor(guide);
  const formsWorkflow = isFormsGuide(guide) && arrived;
  const inspectingAccess = arrived && (guide === "live" || guide === "access");
  const destination: GuideTarget | undefined = walk ? undefined : isFormsGuide(guide) ? arrived ? formsStep?.target : "forms"
    : guide === "live" || guide === "access" ? arrived ? guide : "account" : guide as GuideTarget | undefined;
  const destinationName = guide ? guideName(guide) : "";
  const navigationName = destination === "account" ? "Tài khoản" : isFormsGuide(guide) ? "Google Forms" : destinationName;
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
    if (guide !== "CH-03" && (!guide || arrived || !destination)) return;
    const remember = (event: MouseEvent) => {
      if (event.button !== 0 || event.ctrlKey || event.metaKey || event.shiftKey || event.altKey) return;
      if (!(event.target instanceof Element)) return;
      if (guide === "CH-03") {
        const link = event.target.closest<HTMLAnchorElement>("a[data-guide-target]");
        const product = availableProducts.find(item => item.href === link?.getAttribute("href"));
        if (product) saveHandoff(account.id, product.id, turns);
      } else if (guide && destination) {
        const link = event.target.closest<HTMLAnchorElement>(`a[data-guide-target="${targetMarker(destination)}"]`);
        if (link?.getAttribute("href") === pathForGuide(guide)) saveHandoff(account.id, guide, turns);
      }
    };
    document.addEventListener("click", remember, true);
    return () => document.removeEventListener("click", remember, true);
  }, [account.id, availableProducts, guide, destination, arrived, turns]);

  function openDestination(next: Guide, history: Turn[]) {
    if (!canOpenGuide(next, account, availableProducts)) return;
    const path = pathForGuide(next);
    if (onGuidePage(next)) return;
    saveHandoff(account.id, next, history);
    location.assign(path);
  }

  function guideAction(history = turns) {
    if (walk && arrived) {
      document.querySelector<HTMLButtonElement>(".ai-panel [data-walk-open]")?.click();
      return;
    }
    if (formsWorkflow && formsStep?.action) { formsStep.action.run(); return; }
    if (!guide || arrived) return;
    if (step === "menu" && visibleGuideTarget("menu")) visibleGuideTarget("menu")?.click();
    else openDestination(guide, history);
  }

  async function send(question: string) {
    if (!question.trim() || request.current) return;
    setFocus(undefined);
    const intent = asksAboutCurrentPage(question) ? undefined : guideIntent(question, active && (!arrived || Boolean(formsStep?.action) ||
      Boolean(walk && document.querySelector(".ai-panel [data-walk-open]"))));
    if (intent) {
      setError("");
      setText("");
      const history: Turn[] = [...turns, { role: "user", text: question.trim() }];
      if (intent === "continue") {
        setTurns(history);
        guideAction(history);
        return;
      }
      const next = intent.guide;
      if (!canOpenGuide(next, account, availableProducts)) {
        setGuide(undefined);
        setTurns([...history, { role: "assistant", text: next === "admin" || walkthroughFor(next)?.admin
          ? "Tài khoản của bạn chưa có quyền Quản trị. Liên hệ quản trị viên để được cấp quyền phù hợp."
          : `${guideName(next)} hiện chưa được bật trên website này.` }]);
      } else if (onGuidePage(next)) {
        setExpanded(false);
        setGuide(next);
        setTurns([...history, { role: "assistant", text: arrivalMessage(next, account) }]);
      } else if (intent.open) {
        openDestination(next, history);
      } else {
        setExpanded(false);
        setStep(undefined);
        setGuide(next);
        const nextWalk = walkthroughFor(next);
        setTurns([...history, { role: "assistant", text: nextWalk
          ? `Mở ${walkAreaLabels[nextWalk.area]} để mình chỉ từng bước cho “${nextWalk.title}”.`
          : `Mình sẽ đánh dấu từng nút để bạn mở ${guideName(next)}. Bạn có thể bấm theo hoặc nhờ mình mở giúp.` }]);
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
        body: JSON.stringify({ message: question.trim(), workspace: workspace(), history: readCompanionHistory(turns), companion: companion.read() }),
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
  const handledHandoff = useRef<string>(undefined);
  useEffect(() => {
    if (!initialQuestion) { handledHandoff.current = undefined; return; }
    if (initialQuestion === handledHandoff.current) return;
    handledHandoff.current = initialQuestion;
    void send(initialQuestion);
  }, [initialQuestion]);
  const oneStep = location.pathname === "/account" || Boolean(visibleGuideTarget(destination ?? "menu")?.closest(".ws-products"));
  const targetLabel = formsWorkflow ? formsStep?.title ?? "" : inspectingAccess ? destinationName : `Bấm để mở ${navigationName}`;
  return <aside className="ai-panel" data-expanded={expanded} data-guiding={active} data-has-step={Boolean(guide)} data-forms-guide={formsWorkflow} data-walk-active={Boolean(walk && arrived)}
    role="dialog" aria-modal="false" aria-labelledby="system-ai-title">
    {active && destination && <GuideSpotlight destination={destination} fallback={!arrived} label={targetLabel} onStep={setStep}/>}
    <header className="ai-header">
      <span className="ai-mark"><ChatTeardropText size={23} weight="duotone" /></span>
      <div><h2 id="system-ai-title">Trợ lý HANU</h2><span>{workspaceName()} · Đồng hành trên trang</span></div>
      <button disabled={active} aria-label={expanded ? "Thu gọn trợ lý" : "Mở rộng trợ lý"} onClick={() => setExpanded(!expanded)}>
        {expanded ? <ArrowsInSimple size={18} /> : <ArrowsOutSimple size={18} />}</button>
      <button aria-label="Đóng trợ lý" onClick={onClose}><X size={19} /></button>
    </header>
    {walk ? arrived ? <WalkthroughPanel key={walk.id} flow={walk} onClose={() => setGuide(undefined)}/>
      : <section className="guide-card" aria-label={`Hướng dẫn ${walk.title}`}>
        <span className="guide-card-icon"><Compass size={20} weight="duotone"/></span>
        <div className="guide-card-copy" role="status"><strong>{walk.title}</strong></div>
        <button className="guide-dismiss" type="button" aria-label="Kết thúc hướng dẫn" onClick={() => setGuide(undefined)}><X size={15}/></button>
        <button className="guide-action" type="button" onClick={() => openDestination(walk.id, turns)}>Mở {walkAreaLabels[walk.area]} <ArrowUpRight size={14}/></button>
      </section>
    : formsWorkflow ? <section className="guide-card guide-card-workflow" aria-label={`Hướng dẫn ${destinationName}`}>
      <span className="guide-card-icon">{formsStep?.done ? <CheckCircle size={20} weight="fill"/> : <Compass size={21} weight="duotone"/>}</span>
      <div className="guide-card-copy" role="status">
        <span>{formsStep?.done ? "Hoàn tất" : formsStep ? `Bước ${formsStep.stage} / ${formsStep.total}` : "Google Forms"}</span>
        <strong>{formsStep?.title ?? "Đang đọc trạng thái màn hình…"}</strong>
        {formsStep?.detail && <p>{formsStep.detail}</p>}
      </div>
      <button className="guide-dismiss" type="button" aria-label="Kết thúc hướng dẫn" onClick={() => setGuide(undefined)}><X size={15}/></button>
      {formsStep && <div className="guide-progress" aria-hidden="true">
        {Array.from({ length: formsStep.total }, (_, index) => <i key={index} data-current={index < formsStep.stage}/>)}
      </div>}
      {formsStep?.action && <button type="button" className="guide-action" onClick={() => guideAction()}>{formsStep.action.label} <ArrowUpRight size={14}/></button>}
      {formsStep?.nextGuide && <button type="button" className="guide-action" onClick={() => setGuide(formsStep.nextGuide)}>Hướng dẫn liên kết profile <ArrowUpRight size={14}/></button>}
    </section> : guide && <section className="guide-card" aria-label={`Hướng dẫn ${destinationName}`}>
      <span className="guide-card-icon">{arrived ? <CheckCircle size={20} weight="fill"/> : <Compass size={21} weight="duotone"/>}</span>
      <div className="guide-card-copy" role="status">
        <span>{arrived ? "Hoàn tất" : oneStep ? "Bước 1 / 1" : !step || step === "menu" ? "Bước 1 / 2" : "Bước 2 / 2"}</span>
        <strong>{arrived
          ? inspectingAccess ? destinationName : `Đã vào ${guide === "admin" ? "trang " : ""}${destinationName}`
          : !step || step === "menu" ? "Mở Tài khoản và công cụ" : `Chọn ${navigationName}`}</strong>
      </div>
      <button className="guide-dismiss" type="button" aria-label="Kết thúc hướng dẫn" onClick={() => { setGuide(undefined); setStep(undefined); }}><X size={15}/></button>
      {!arrived && <>
        <div className="guide-progress" aria-hidden="true"><i/>{!oneStep && <i data-current={Boolean(step && step !== "menu")}/>}</div>
        <button type="button" className="guide-action" disabled={!step} onClick={() => guideAction()}>
          {step === "menu" ? "Mở menu giúp tôi" : `Mở ${navigationName} giúp tôi`} <ArrowUpRight size={14}/>
        </button>
      </>}
    </section>}
    <div className="ai-log" ref={log} role="log" aria-label="Cuộc trò chuyện">
      <CompanionCard companion={companion} pending={pending} onAsk={question => void send(question)}/>
      {focus && !active && <GuideSpotlight companion label={focus.label} resolve={resolveFocus}/>}
      {!guide && <WalkthroughCatalog initiallyOpen={initialQuestion === ""} onStart={id => void send(id)} allowed={(area, id) => {
        if (area === "admin" && account.role !== "admin") return false;
        const item = walkthroughFor(id);
        return item ? canOpenGuide(item.id, account, availableProducts) : true;
      }}/>}
      {!turns.length && <div className="ai-welcome">
        <span className="ai-welcome-mark"><ChatTeardropText size={32} weight="duotone" /></span>
        <h3>Mình có thể giúp gì?</h3><p>Mình theo trạng thái trang và thao tác gần đây để cùng bạn xử lý bước tiếp theo.</p>
        <div className="ai-suggestions">{["Làm sao vào trang Quản trị?", "Tôi có quyền Live không?", "Xem bản đồ vector ở đâu?", ...(workspace() === "forms" ? ["Cách liên kết Chrome profile?", "Cách chuẩn bị hồ sơ?"] : [])].map(question =>
          <button key={question} onClick={() => void send(question)}>{question}<ArrowUp size={14} /></button>)}</div>
      </div>}
      {turns.map((turn, index) => <article key={index} className={`ai-message ai-message-${turn.role}`}>
        {turn.role === "assistant" && <strong>HANU <small>{turn.reply?.source === "guide" ? "Từ tài liệu" : turn.reply?.source === "context" ? "Từ màn hình" : "AI"}</small></strong>}
        <p>{turn.text}</p>
        {turn.reply?.focus && <button className="ai-focus-action" type="button" onClick={() => {
          const target = turn.reply!.focus!;
          if (companion.resolve(target.id)) { setGuide(undefined); setFocus(target); }
        }}>Chỉ vị trí “{turn.reply.focus.label}”</button>}
        {!!turn.reply?.references.length && <nav aria-label="Nguồn tham khảo">{turn.reply.references.map(ref =>
          <a key={ref.id} href={ref.href} target="_blank" rel="noreferrer"><Books size={13} />{ref.title}</a>)}</nav>}
      </article>)}
      {pending && <div className="ai-thinking" role="status"><span /><span /><span />Đang xem ngữ cảnh và hướng dẫn</div>}
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

export function SystemAssistant({ account, availableProducts, children }: {
  account: Account; availableProducts: readonly Product[]; children: ReactNode;
}) {
  const [companion] = useState(() => createCompanion(account.id));
  const [restored, setRestored] = useState(() => restoreGuide(account, availableProducts));
  const [open, setOpen] = useState(Boolean(restored) || companion.shouldResume());
  const [guide, setGuide] = useState(restored?.guide);
  const [initialQuestion, setInitialQuestion] = useState<string>();
  const [formsStep, setFormsStep] = useState<FormsGuideStep>();
  const trigger = useRef<HTMLButtonElement>(null);
  useEffect(() => companion.start(), [companion]);
  useEffect(() => { companion.setOpen(open); }, [companion, open]);
  useEffect(() => companion.report("account", [
    { label: "Quyền Live", value: account.liveEnabled ? "Đã được cấp" : "Chưa được cấp" },
    { label: "Vai trò HANU", value: account.role === "admin" ? "Quản trị viên" : "Người dùng" },
  ]), [companion, account.liveEnabled, account.role]);
  useEffect(() => { companion.read(); }, [companion, formsStep, guide]);
  const close = useCallback(() => {
    setOpen(false);
    setGuide(undefined);
    setRestored(undefined);
    setInitialQuestion(undefined);
    requestAnimationFrame(() => trigger.current?.focus());
  }, []);
  useEffect(() => {
    try { sessionStorage.removeItem(handoffKey); } catch { /* Tab storage is optional. */ }
  }, []);
  const allowedGuide = guide && canOpenGuide(guide, account, availableProducts) ? guide : undefined;
  const walk = walkthroughFor(allowedGuide);
  const formsGuide = isFormsGuide(allowedGuide) && onGuidePage(allowedGuide) ? allowedGuide : undefined;
  const active = Boolean(allowedGuide && (walk || isFormsGuide(allowedGuide) || allowedGuide === "live" || allowedGuide === "access" || !onGuidePage(allowedGuide)));
  const handoff = (question: string) => {
    setInitialQuestion(question);
    setOpen(true);
    return true;
  };
  const openCatalog = () => {
    setGuide(undefined);
    return handoff("");
  };
  const dedicatedHcmue = location.pathname === "/hcmue";
  return <CompanionContextProvider.Provider value={companion}><GuideContext.Provider value={{ active, handoff, openCatalog, formsGuide, walkthrough: walk && onGuidePage(walk.id) ? walk.id : undefined, reportFormsStep: setFormsStep, startFormsGuide: setGuide,
    switching: active && Boolean(allowedGuide && (allowedGuide === "CH-03" || productForGuide(allowedGuide) || isFormsGuide(allowedGuide) && !formsGuide)), availableProducts }}>
    {children}
    {(!dedicatedHcmue || open) && <button ref={trigger} type="button" className="ai-launcher" aria-label="Trợ lý AI" title="Hỏi trợ lý HANU"
      aria-expanded={open} aria-haspopup="dialog" onClick={() => open ? close() : setOpen(true)}>
      {open ? <X size={24} /> : <ChatTeardropText size={27} weight="duotone" />}<span>Hỏi AI</span>
    </button>}
    {open && <AssistantBoundary onClose={close}><Conversation account={account} availableProducts={availableProducts} restored={restored}
      initialQuestion={initialQuestion} active={active} guide={allowedGuide} setGuide={setGuide} formsStep={formsStep} onClose={close} companion={companion}/></AssistantBoundary>}
  </GuideContext.Provider></CompanionContextProvider.Provider>;
}
