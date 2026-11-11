import { useLayoutEffect, useState } from "react";
import { createPortal } from "react-dom";
import { CursorClick } from "@phosphor-icons/react";
import { targetMarker, type GuideTarget } from "./guide";
import "./guide.css";

type Target = { step: GuideTarget; x: number; y: number; width: number; height: number; below: boolean; labelX: number };

export function visibleGuideTarget(step: GuideTarget) {
  return [...document.querySelectorAll<HTMLElement>(`[data-guide-target="${targetMarker(step)}"]`)]
    .find(element => element.getClientRects().length > 0 && !element.closest('[inert], [aria-hidden="true"]') &&
      getComputedStyle(element).visibility === "visible");
}

export function GuideSpotlight({ destination, fallback, label, onStep }: {
  destination: GuideTarget;
  fallback: boolean;
  label: string;
  onStep(step: GuideTarget): void;
}) {
  const [target, setTarget] = useState<Target>();
  useLayoutEffect(() => {
    let frame = 0;
    let previous: HTMLElement | undefined;
    const resize = new ResizeObserver(schedule);
    const update = () => {
      frame = 0;
      const primary = visibleGuideTarget(destination);
      const step = primary || !fallback ? destination : "menu";
      onStep(step);
      const element = primary ?? (fallback ? visibleGuideTarget("menu") : undefined);
      if (element !== previous) {
        resize.disconnect();
        if (element) {
          resize.observe(element);
          element.scrollIntoView({
            block: element.closest(".account-page, .drawer-content") ? "center" : "nearest",
            inline: "nearest", behavior: "instant",
          });
        }
        previous = element;
      }
      if (!element) { setTarget(undefined); return; }
      const { left, top, width, height } = element.getBoundingClientRect();
      const scrollArea = element.closest(".drawer-content, .pair-dialog-guided");
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
  }, [destination, fallback, onStep]);
  if (!target) return null;
  return createPortal(<div className="guide-spotlight" aria-hidden="true">
    <div className="guide-halo" data-step={target.step} style={{ left: target.x, top: target.y, width: target.width, height: target.height }} />
    <div className="guide-pin" data-below={target.below} style={{ left: target.labelX, top: target.below ? target.y + target.height + 12 : target.y - 12 }}>
      <CursorClick size={16} weight="fill" />
      {target.step === "menu" ? "Bấm để mở tài khoản" : label}
    </div>
  </div>, document.body);
}
