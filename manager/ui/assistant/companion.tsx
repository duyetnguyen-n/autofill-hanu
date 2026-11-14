import { createContext, useContext, useEffect, useSyncExternalStore } from "react";
import { companionPaths, readCompanionContext, readCompanionHistory, safeCompanionText, type CompanionContext, type CompanionEvent, type CompanionFact, type CompanionPage, type CompanionTurn } from "../../assistant/context";

const excluded = ".ai-panel, .ai-launcher, .hc-assistant, .hc-assistant-launcher, .guide-spotlight, [data-companion-ignore]";
const interactive = 'button, a[href], input:not([type=hidden]), select, textarea, summary, [role=tab], [role=button]';
const ttl = 2 * 60 * 60_000;
const titles: Record<string, string> = { "/": "Google Forms", "/google-direct": "Google Forms Direct", "/hcmue": "HCMUE", "/chinesetest": "ChineseTest", "/account": "Tài khoản", "/admin": "Quản trị", "/knowledge": "Kho tri thức", "/hcmue/knowledge": "Kho tri thức" };
const visible = (element: HTMLElement) => !element.closest(`${excluded}, [hidden], [inert], [aria-hidden=true]`) &&
  element.getClientRects().length > 0 && getComputedStyle(element).visibility !== "hidden";
const disabled = (element: HTMLElement) => element.matches(":disabled, [aria-disabled=true]");
const text = (element: Element | null, limit = 180) => safeCompanionText(element?.textContent, limit);
function labelledBy(element: HTMLElement, attribute: string) {
  return (element.getAttribute(attribute) ?? "").split(/\s+/).filter(Boolean).map(id => text(document.getElementById(id), 240)).join(" ");
}
function label(element: HTMLElement) {
  const field = element instanceof HTMLInputElement || element instanceof HTMLSelectElement || element instanceof HTMLTextAreaElement;
  // Labels are read, never input values, selected options, uploaded files or editable text.
  return safeCompanionText(element.getAttribute("aria-label") || labelledBy(element, "aria-labelledby") ||
    (field ? [...(element.labels ?? [])].map(item => {
      const clone = item.cloneNode(true) as HTMLElement;
      clone.querySelectorAll("input, select, textarea").forEach(child => child.remove());
      return clone.textContent;
    }).join(" ") : element.textContent) || element.getAttribute("title"), 100);
}
function sensitive(element: HTMLElement) {
  return element.matches('input[type=password], input[type=hidden], input[type=file], [contenteditable=true]') ||
    /mật khẩu|password|cookie|token|api.?key|mã liên kết|cccd|hộ chiếu|passport/i.test(label(element));
}
function reason(element: HTMLElement) {
  return safeCompanionText(labelledBy(element, "aria-describedby") || element.getAttribute("title"), 240);
}

export type CompanionMemory = {
  context: CompanionContext;
  turns: CompanionTurn[];
  hcmueTurns: CompanionTurn[];
  open: boolean;
};

/** One account-scoped, tab-local observer. No network requests are made by observation. */
export function createCompanion(owner: string) {
  const key = `hanu-companion-v1:${owner}`;
  let events: CompanionEvent[] = [], turns: CompanionTurn[] = [], hcmueTurns: CompanionTurn[] = [], goal = "", resume = "";
  try {
    const saved = JSON.parse(sessionStorage.getItem(key) ?? "null");
    if (saved?.owner === owner && typeof saved.updatedAt === "number" && Date.now() - saved.updatedAt < ttl && saved.updatedAt <= Date.now()) {
      turns = readCompanionHistory(saved.turns); hcmueTurns = readCompanionHistory(saved.hcmueTurns);
      goal = safeCompanionText(saved.goal, 400);
      events = readCompanionContext({ page: { path: location.pathname, capturedAt: new Date().toISOString() }, events: saved.events })?.events ?? [];
      if (saved.resume?.path === location.pathname && Date.now() - saved.resume.at < 60_000) resume = saved.resume.path;
    }
  } catch { /* Session memory is optional. */ }
  let context: CompanionContext = {
    page: { path: location.pathname, title: titles[location.pathname] || "HANU", capturedAt: new Date().toISOString(), facts: [], dialogs: [], notices: [], controls: [] }, goal, events,
  };
  let snapshot: CompanionMemory = { context, turns, hcmueTurns, open: false };
  const listeners = new Set<() => void>(), factSources = new Map<string, CompanionFact[]>();
  const ids = new WeakMap<HTMLElement, string>(), elements = new Map<string, HTMLElement>();
  let sequence = 0, focused: HTMLElement | undefined, stopped = false;
  const openChannels = new Set<string>();
  let resumeTarget: { path: string; at: number } | undefined;
  const persist = () => {
    if (stopped) return;
    try { sessionStorage.setItem(key, JSON.stringify({ owner, updatedAt: Date.now(), goal, events, turns, hcmueTurns, resume: resumeTarget })); }
    catch { /* Quota or private browsing must not interrupt the page. */ }
  };
  const publish = () => {
    snapshot = { context, turns, hcmueTurns, open: openChannels.size > 0 };
    listeners.forEach(listener => listener());
    persist();
  };
  const event = (kind: CompanionEvent["kind"], value: string) => {
    if (!companionPaths.includes(location.pathname)) return;
    const label = safeCompanionText(value, 140);
    const last = events.at(-1), now = Date.now();
    if (!label || last?.kind === kind && last.label === label && now - Date.parse(last.at) < 1000) return;
    events = [...events.filter(item => now - Date.parse(item.at) < ttl), { kind, label, path: location.pathname, at: new Date(now).toISOString() }].slice(-12);
  };
  const idFor = (element: HTMLElement) => {
    let id = ids.get(element);
    if (!id) { id = `c-${++sequence}`; ids.set(element, id); }
    elements.set(id, element);
    return id;
  };
  function refresh() {
    if (stopped || !companionPaths.includes(location.pathname)) return context;
    elements.clear();
    const dialogs = [...document.querySelectorAll<HTMLElement>('[role=dialog], [role=alertdialog]')].filter(visible);
    const notices = [...document.querySelectorAll<HTMLElement>('[role=alert], [role=status], [data-companion-notice]')]
      .filter(visible).map(element => text(element, 240)).filter(Boolean);
    const uniqueNotices = [...new Set(notices)].slice(-4);
    for (const notice of uniqueNotices) if (!context.page.notices.includes(notice)) event("notice", notice);
    if (focused && (!focused.isConnected || !visible(focused))) focused = undefined;
    const scope = dialogs.at(-1) ?? document.body;
    const candidates = [...scope.querySelectorAll<HTMLElement>(interactive)].filter(element => visible(element) && !sensitive(element) && label(element));
    const ordered = [...new Set([...(focused ? [focused] : []), ...candidates.filter(element => disabled(element) && reason(element)), ...candidates])].slice(0, 12);
    const controls = ordered.map(element => ({ id: idFor(element), label: label(element), disabled: disabled(element), reason: reason(element) || undefined }));
    const workflowElement = document.querySelector<HTMLElement>('.ai-panel .guide-card-workflow .guide-card-copy');
    const workflow = workflowElement ? { title: text(workflowElement.querySelector("strong")), detail: text(workflowElement.querySelector("p"), 240), done: workflowElement.textContent?.includes("Hoàn tất") } : undefined;
    const page: CompanionPage = {
      path: location.pathname, title: titles[location.pathname] || "HANU", capturedAt: context.page.capturedAt,
      facts: [...factSources.values()].flat().slice(0, 12),
      dialogs: dialogs.map(element => safeCompanionText(element.getAttribute("aria-label") || labelledBy(element, "aria-labelledby") || text(element.querySelector("h1,h2,h3")), 100)).filter(Boolean).slice(-3),
      notices: uniqueNotices, controls, focusedControl: focused ? ids.get(focused) : undefined, workflow,
    };
    const next = { page, goal, events };
    if (JSON.stringify(next) !== JSON.stringify(context)) {
      context = { ...next, page: { ...page, capturedAt: new Date().toISOString() } };
      publish();
    }
    return { ...context, page: { ...context.page, capturedAt: new Date().toISOString() } };
  }
  return {
    subscribe(listener: () => void) { listeners.add(listener); return () => { listeners.delete(listener); }; },
    getSnapshot: () => snapshot,
    read: refresh,
    shouldResume: () => Boolean(resume),
    setOpen(value: boolean, channel = "system") {
      if (openChannels.has(channel) === value) return;
      if (value) openChannels.add(channel); else openChannels.delete(channel);
      publish();
    },
    resolve(id: string) { const element = elements.get(id); return element?.isConnected && visible(element) ? element : undefined; },
    remember(value: CompanionTurn[], channel: "system" | "hcmue" = "system") {
      const history = readCompanionHistory(value);
      if (channel === "system") turns = history; else hcmueTurns = history;
      publish();
    },
    setGoal(value: string) { goal = safeCompanionText(value, 400); refresh(); },
    report(source: string, facts: CompanionFact[]) {
      factSources.set(source, facts.map(item => ({ label: safeCompanionText(item.label, 60), value: safeCompanionText(item.value) })).filter(item => item.label && item.value));
      refresh();
      return () => { factSources.delete(source); refresh(); };
    },
    start() {
      stopped = false;
      let timer: ReturnType<typeof setTimeout> | undefined;
      const schedule = () => { if (!timer) timer = setTimeout(() => { timer = undefined; refresh(); }, 200); };
      const select = (raw: Event) => {
        const target = raw.target instanceof Element ? raw.target.closest<HTMLElement>(interactive) : undefined;
        if (!target || target.closest(excluded) || !visible(target)) return;
        if (sensitive(target)) { focused = undefined; refresh(); return; }
        focused = target;
        if (raw.type === "click" || raw.type === "change") {
          event(raw.type, `${raw.type === "change" ? "Đã sửa" : "Đã chọn"}: ${label(target)}`);
          if (raw.type === "click" && target instanceof HTMLAnchorElement && openChannels.size > 0 && !(raw instanceof MouseEvent && (raw.metaKey || raw.ctrlKey || raw.shiftKey || raw.altKey)) && target.target !== "_blank") {
            const url = new URL(target.href);
            if (url.origin === location.origin && companionPaths.includes(url.pathname) && url.pathname !== location.pathname) resumeTarget = { path: url.pathname, at: Date.now() };
          }
        }
        refresh(); schedule();
      };
      const observer = new MutationObserver(records => {
        if (records.some(record => !(record.target instanceof Element && record.target.closest(excluded)) ||
          record.target instanceof Element && record.target.closest(".guide-card-workflow"))) schedule();
      });
      observer.observe(document.body, { subtree: true, childList: true, characterData: true, attributes: true,
        attributeFilter: ["disabled", "aria-disabled", "aria-describedby", "aria-hidden", "hidden", "inert", "open", "class", "title"] });
      function clear() {
        stopped = true; turns = []; hcmueTurns = []; goal = ""; events = [];
        context = { ...context, goal: "", events: [], page: { ...context.page, facts: [], notices: [], controls: [] } };
        snapshot = { context, turns, hcmueTurns, open: false }; listeners.forEach(listener => listener());
        try { sessionStorage.removeItem(key); } catch { /* Optional storage. */ }
      }
      const types = ["pointerdown", "focusin", "click", "change"];
      types.forEach(type => document.addEventListener(type, select, true));
      window.addEventListener("hanu-session-ended", clear);
      event("navigate", `Mở ${titles[location.pathname] || "HANU"}`); refresh(); persist();
      return () => {
        observer.disconnect(); clearTimeout(timer);
        types.forEach(type => document.removeEventListener(type, select, true));
        window.removeEventListener("hanu-session-ended", clear);
      };
    },
  };
}

export type Companion = ReturnType<typeof createCompanion>;
export const CompanionContextProvider = createContext<Companion | undefined>(undefined);
export const useCompanion = () => useContext(CompanionContextProvider);
export function useCompanionMemory(companion: Companion) {
  return useSyncExternalStore(companion.subscribe, companion.getSnapshot);
}
const noopSubscribe = () => () => {};
export function useCompanionOpen() {
  const companion = useCompanion();
  return useSyncExternalStore(companion?.subscribe ?? noopSubscribe, () => companion?.getSnapshot().open ?? false);
}
export function useCompanionFacts(source: string, facts: CompanionFact[]) {
  const companion = useCompanion(), serialized = JSON.stringify(facts);
  useEffect(() => companion?.report(source, JSON.parse(serialized)), [companion, source, serialized]);
}
