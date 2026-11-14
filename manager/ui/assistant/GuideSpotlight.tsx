import { useLayoutEffect, useState } from "react";
import { createPortal } from "react-dom";
import { CursorClick } from "@phosphor-icons/react";
import { targetMarker, type GuideTarget } from "./guide";
import "./guide.css";

type Target = { step: GuideTarget | "walkthrough"; x: number; y: number; width: number; height: number; below: boolean; labelX: number };

export function visibleGuideTarget(step: GuideTarget) {
  return [...document.querySelectorAll<HTMLElement>(`[data-guide-target="${targetMarker(step)}"]`)]
    .find(element => element.getClientRects().length > 0 && !element.closest('[inert], [aria-hidden="true"]') &&
      getComputedStyle(element).visibility === "visible");
}

export function GuideSpotlight({ destination, fallback = false, label, onStep, resolve, companion = false }: {
  destination?: GuideTarget;
  fallback?: boolean;
  label: string;
  onStep?(step: GuideTarget): void;
  resolve?(): HTMLElement | undefined;
  companion?: boolean;
}) {
  const [target, setTarget] = useState<Target>();
  useLayoutEffect(() => {
    let frame = 0;
    let previous: HTMLElement | undefined;
    const resize = new ResizeObserver(schedule);
    const update = () => {
      frame = 0;
      const primary = resolve ? resolve() : destination && visibleGuideTarget(destination);
      const step = resolve ? "walkthrough" : destination && (primary || !fallback ? destination : "menu");
      if (!step) return;
      if (step !== "walkthrough") onStep?.(step);
      const element = primary ?? (fallback ? visibleGuideTarget("menu") : undefined);
      if (element !== previous) {
        resize.disconnect();
        if (element) {
          resize.observe(element);
          element.scrollIntoView({
            block: resolve || element.closest(".account-page, .drawer-content") ? "center" : "nearest",
            inline: "nearest", behavior: "instant",
          });
        }
        previous = element;
      }
      if (!element) { setTarget(undefined); return; }
      const { left, top, width, height } = element.getBoundingClientRect();
      const scrollArea = element.closest(".drawer-content, .pair-dialog-guided, .walk-dialog");
      const bounds = scrollArea?.getBoundingClientRect();
      if (bounds && (top + height <= bounds.top || top >= bounds.bottom)) { setTarget(undefined); return; }
      const below = top < 92 || Boolean(bounds && top - bounds.top < 46 && top + height + 72 < bounds.bottom);
      const next: Target = { step, x: left - 5, y: top - 5, width: width + 10, height: height + 10, below,
        labelX: Math.min(Math.max(left + width / 2, 112), window.innerWidth - 112) };
      setTarget(old => old && Object.keys(next).every(key => old[key as keyof Target] === next[key as keyof Target]) ? old : next);
    };
    function schedule() { if (!frame) frame = requestAnimationFrame(update); }
    const observer = new MutationObserver(records => {
      if (records.some(record => !(record.target instanceof Element && record.target.closest(".guide-spotlight")))) schedule();
    });
    observer.observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ["aria-hidden", "hidden", "inert", "class", "style"] });
    window.addEventListener("resize", schedule);
    window.addEventListener("scroll", schedule, true);
    window.visualViewport?.addEventListener("resize", schedule);
    schedule();
    return () => {
      cancelAnimationFrame(frame);
      observer.disconnect();
      resize.disconnect();
      window.removeEventListener("resize", schedule);
      window.removeEventListener("scroll", schedule, true);
      window.visualViewport?.removeEventListener("resize", schedule);
    };
  }, [destination, fallback, onStep, resolve]);
  if (!target) return null;
  return createPortal(<div className="guide-spotlight" data-companion-focus={companion} aria-hidden="true">
    <div className="guide-halo" data-step={target.step} style={{ left: target.x, top: target.y, width: target.width, height: target.height }} />
    <div className="guide-pin" data-below={target.below} style={{ left: target.labelX, top: target.below ? target.y + target.height + 12 : target.y - 12 }}>
      <CursorClick size={16} weight="fill" />
      {target.step === "menu" ? "Bấm để mở tài khoản" : label}
    </div>
  </div>, document.body);
}
