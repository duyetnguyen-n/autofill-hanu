import { performance } from "node:perf_hooks";
/** A monotonic deadline, isolated from wall-clock changes after arming. */
export function atDeadline(deadline: number, fire: () => void) {
  let cancelled = false,
    timer: ReturnType<typeof setTimeout>;
  const tick = () => {
    if (cancelled) return;
    const left = deadline - performance.now();
    if (left > 0) {
      timer = setTimeout(tick, left > 20 ? Math.max(1, left - 20) : 1);
      return;
    }
    fire();
  };
  timer = setTimeout(tick, Math.max(1, deadline - performance.now() - 20));
  return () => {
    cancelled = true;
    clearTimeout(timer);
  };
}
