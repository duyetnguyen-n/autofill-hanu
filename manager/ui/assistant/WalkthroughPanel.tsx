import { useCallback, useLayoutEffect, useRef, useState } from "react";
import { ArrowRight, Compass, X } from "@phosphor-icons/react";
import { GuideSpotlight } from "./GuideSpotlight";
import type { Anchor, Walkthrough } from "./walkthrough-types";
import { normalizeWalkText } from "./walkthroughs";
import { rememberLoginGuide } from "./login-guide";

const rowTypes = ["tbody tr", ".hc-run", ".ct-run", ".ct-account", ".admin-session-list article", ".kv-register-list li"];
const rowSelector = rowTypes.join(", ");
const chatSelector = ".ai-panel, .hc-assistant, .guide-spotlight";

function visible(element: HTMLElement) {
  return element.getClientRects().length > 0 && !element.closest(`[inert], [aria-hidden=true], ${chatSelector}`) &&
    getComputedStyle(element).visibility === "visible";
}

function matches(anchor: Anchor, row?: Element) {
  const elements = [...document.querySelectorAll<HTMLElement>(anchor.selector)].filter(element => {
    if (!visible(element) || anchor.within && !element.closest(anchor.within)) return false;
    if (!anchor.label) return true;
    const labels = [element.getAttribute("aria-label"), element.textContent].filter((value): value is string => Boolean(value?.trim()));
    const expected = anchor.label;
    return labels.some(label => typeof expected === "string"
      ? normalizeWalkText(label) === normalizeWalkText(expected)
      : expected.test(label.trim().replace(/\s+/g, " ")));
  });
  const rowType = row?.isConnected ? rowTypes.find(selector => row.matches(selector)) : undefined;
  if (!rowType) return elements;
  return elements.filter(element => !element.closest(rowType) || row!.contains(element));
}

function spotlightTarget(anchor: Anchor, candidates: HTMLElement[], row?: Element) {
  if (candidates.length === 1) return candidates[0];
  if (!candidates.length || !anchor.group) return;
  if (row instanceof HTMLElement && row.isConnected && candidates.every(candidate => row.contains(candidate))) return row;
  const group = candidates[0].closest<HTMLElement>(anchor.group);
  if (group && visible(group) && candidates.every(candidate => group.contains(candidate))) {
    const heading = group.querySelector<HTMLElement>(":scope > :is(.list-toolbar, header, h2, h3, .ct-section-heading, .admin-list-toolbar)");
    return heading && visible(heading) ? heading : group;
  }
}

const disabled = (element: HTMLElement) => element.matches(":disabled, [aria-disabled=true]");

function reason(element: HTMLElement) {
  const references = element.getAttribute("aria-describedby")?.split(/\s+/) ?? [];
  const description = references.map(id => document.getElementById(id)?.textContent?.trim()).filter(Boolean).join(" ");
  return (description || element.title).slice(0, 220);
}

export function WalkthroughPanel({ flow, onClose }: { flow: Walkthrough; onClose(): void }) {
  const [index, setIndex] = useState(0);
  const [state, setState] = useState<{ present: boolean; disabled: boolean; reason: string; target?: HTMLElement; openTarget?: HTMLElement }>({ present: false, disabled: false, reason: "" });
  const chosenRow = useRef<Element>(undefined);
  const selected = flow.steps[index];
  const resolve = useCallback(() => state.target, [state.target]);
  useLayoutEffect(() => {
    let frame = 0;
    let clicked = false;
    function nextVisible() {
      for (let next = index + 1; next < flow.steps.length; next++) {
        const candidate = flow.steps[next];
        if (matches(candidate.anchor, chosenRow.current).length) return next;
        if (!candidate.optional) break;
      }
      return undefined;
    }
    function update() {
      frame = 0;
      const candidates = matches(selected.anchor, chosenRow.current);
      const isBlocked = candidates.length > 0 && candidates.every(disabled);
      const shouldAdvance = selected.advance === "visible" ||
        clicked && (selected.advance === "click" || selected.advance === "gone" && !candidates.length);
      const next = shouldAdvance ? nextVisible() : undefined;
      if (next !== undefined) { setIndex(next); return; }
      const target = spotlightTarget(selected.anchor, candidates, chosenRow.current) ??
        (!candidates.length && flow.fallback ? matches(flow.fallback.anchor, chosenRow.current)[0] : undefined);
      const reasonText = isBlocked ? reason(candidates[0]) || selected.blocked || "" : "";
      const present = candidates.length > 0;
      const openTarget = selected.assist && candidates.length === 1 && !isBlocked ? candidates[0] : undefined;
      setState(previous => previous.present === present && previous.disabled === isBlocked && previous.reason === reasonText &&
        previous.target === target && previous.openTarget === openTarget
        ? previous : { present, disabled: isBlocked, reason: reasonText, target, openTarget });
    }
    function schedule() {
      if (!frame) frame = requestAnimationFrame(update);
    }
    function select(event: Event) {
      const element = event.target;
      if (!(element instanceof Element) || element.closest(chatSelector)) return;
      const hit = matches(selected.action ?? selected.anchor, chosenRow.current).find(candidate => candidate.contains(element));
      if (!hit || disabled(hit)) return;
      if (flow.id === "CH-06" && index === 1 && event.type === "click") rememberLoginGuide("choose");
      const row = hit.closest(rowSelector);
      if (row && !hit.matches("input, select")) chosenRow.current = row;
      if (event.type === "click") clicked = true;
      schedule();
    }
    const observer = new MutationObserver(records => {
      if (records.some(record => !(record.target instanceof Element && record.target.closest(chatSelector)))) schedule();
    });
    observer.observe(document.body, { subtree: true, childList: true, characterData: true, attributes: true,
      attributeFilter: ["class", "aria-hidden", "inert", "open", "disabled", "aria-disabled", "aria-describedby", "aria-current", "aria-selected", "title"] });
    document.addEventListener("click", select, true);
    document.addEventListener("change", select, true);
    window.addEventListener("resize", schedule);
    update();
    return () => {
      cancelAnimationFrame(frame);
      observer.disconnect();
      document.removeEventListener("click", select, true);
      document.removeEventListener("change", select, true);
      window.removeEventListener("resize", schedule);
    };
  }, [flow, index, selected]);

  const last = index === flow.steps.length - 1;
  const openTarget = selected.assist && state.openTarget?.matches("button, summary, [role=tab]") ? state.openTarget : undefined;
  return <section className="guide-card guide-card-workflow" aria-label={`Hướng dẫn ${flow.title}`} data-walkthrough-id={flow.id}>
    <GuideSpotlight key={index} label={selected.title} resolve={resolve}/>
    <span className="guide-card-icon"><Compass size={20} weight="duotone"/></span>
    <div className="guide-card-copy" role="status">
      <span>Bước {index + 1} / {flow.steps.length}</span>
      <strong>{selected.title}</strong>
      <p>{selected.detail}</p>
      {(!state.present || state.disabled) && <p className="walk-blocked">
        {state.disabled ? state.reason || "Thao tác đang bị khóa. Kiểm tra điều kiện và thông báo tại màn này."
          : selected.optional ? "Bước này chưa xuất hiện. Có thể bỏ qua nếu không áp dụng."
          : flow.fallback?.detail || "Chưa thấy mục này. Kiểm tra bước trước, quyền và trạng thái trên màn hình."}
      </p>}
    </div>
    <button className="guide-dismiss" type="button" aria-label="Kết thúc hướng dẫn" onClick={onClose}><X size={15}/></button>
    <div className="guide-progress" aria-hidden="true">{flow.steps.map((_, position) => <i key={position} data-current={position <= index}/>)}</div>
    <div className="walk-actions">
      {openTarget && <button className="guide-action" type="button" data-walk-open onClick={() => {
        if (visible(openTarget) && !disabled(openTarget) && matches(selected.anchor, chosenRow.current)[0] === openTarget) openTarget.click();
      }}>Mở giúp tôi</button>}
      {index > 0 && <button className="guide-action" type="button" onClick={() => { chosenRow.current = undefined; setIndex(index - 1); }}>Quay lại</button>}
      {!last && <button className="guide-action" type="button" disabled={!selected.optional && (!state.present || state.disabled)}
        onClick={() => setIndex(index + 1)}>
        {!state.present && selected.optional ? "Bỏ qua bước này" : selected.external ? "Tiếp tục trên HANU" : "Tiếp theo"} <ArrowRight size={13}/>
      </button>}
    </div>
  </section>;
}
