import { useLayoutEffect, useState } from "react";
import { createPortal } from "react-dom";
import { CursorClick } from "@phosphor-icons/react";
import { guideTargets } from "./guide";
import "./guide.css";

export type GuideStep = keyof typeof guideTargets;
type Target = { step: GuideStep; x: number; y: number; width: number; height: number; below: boolean; labelX: number };

export function visibleGuideTarget(step: keyof typeof guideTargets) {
  return [...document.querySelectorAll<HTMLElement>(`[data-guide-target="${guideTargets[step]}"]`)]
    .find(element => element.getClientRects().length > 0 && !element.closest('[inert], [aria-hidden="true"]') &&
      getComputedStyle(element).visibility === "visible");
}

export function AdminSpotlight({ onStep }: { onStep(step: GuideStep): void }) {
  const [target, setTarget] = useState<Target>();
  useLayoutEffect(() => {
    let frame = 0;
    let previous: HTMLElement | undefined;
    const resize = new ResizeObserver(schedule);
    const update = () => {
      frame = 0;
      const admin = visibleGuideTarget("admin");
      const menu = visibleGuideTarget("menu");
      const step = admin ? "admin" : "menu";
      onStep(step);
      const element = admin ?? menu;
      if (element !== previous) {
        resize.disconnect();
        if (element) {
          resize.observe(element);
          element.scrollIntoView({
            block: element.closest(".account-page") ? "center" : "nearest",
            inline: "nearest", behavior: "instant",
          });
        }
        previous = element;
      }
      if (!element) { setTarget(undefined); return; }
      const { left, top, width, height } = element.getBoundingClientRect();
      const below = top < 92;
      const next: Target = { step, x: left - 5, y: top - 5, width: width + 10, height: height + 10, below,
        labelX: Math.min(Math.max(left + width / 2, 86), window.innerWidth - 86) };
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
  }, [onStep]);
  if (!target) return null;
  return createPortal(<div className="guide-spotlight" aria-hidden="true">
    <div className="guide-halo" data-step={target.step} style={{ left: target.x, top: target.y, width: target.width, height: target.height }} />
    <div className="guide-pin" data-below={target.below} style={{ left: target.labelX, top: target.below ? target.y + target.height + 12 : target.y - 12 }}>
      <CursorClick size={16} weight="fill" />
      {target.step === "menu" ? "Bấm để mở tài khoản" : "Bấm để vào Quản trị"}
    </div>
  </div>, document.body);
}
