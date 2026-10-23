import { useEffect, useRef } from "react";

export const IDLE_STATE_MS = 60000, ACTIVE_STATE_MS = 2500, DEVICES_MS = 30000;
type MonitorOptions = {
  source: string; enabled: boolean; active: boolean;
  readDevices(): Promise<void>; readState(): Promise<void>; busy(): boolean; error(message: string): void;
};

// This refreshes the dashboard only. The runner's center-discovery interval is independent.
export function useRunnerMonitor(options: MonitorOptions) {
  const latest = useRef(options); latest.current = options;
  const wake = useRef<() => void>(() => {});
  useEffect(() => {
    if (!options.enabled) return;
    let stopped = false, inFlight = false, lastDevices = -Infinity, lastState = -Infinity, failures = 0;
    let timer: ReturnType<typeof setTimeout> | undefined;
    function schedule() {
      clearTimeout(timer);
      if (stopped || inFlight || document.visibilityState === "hidden") return;
      const now = Date.now(), interval = latest.current.active ? ACTIVE_STATE_MS : IDLE_STATE_MS;
      const delay = failures ? Math.min(5000 * 2 ** (failures - 1), 60000)
        : Math.max(1000, Math.min(lastDevices + DEVICES_MS - now, lastState + interval - now));
      timer = setTimeout(() => void tick(), delay);
    }
    async function tick() {
      if (stopped || inFlight || document.visibilityState === "hidden") return;
      clearTimeout(timer); inFlight = true;
      try {
        const interval = latest.current.active ? ACTIVE_STATE_MS : IDLE_STATE_MS;
        if (Date.now() - lastDevices >= DEVICES_MS) { lastDevices = Date.now(); await latest.current.readDevices(); }
        if (!stopped && !latest.current.busy() && Date.now() - lastState >= interval) { lastState = Date.now(); await latest.current.readState(); }
        if (!stopped) { failures = 0; latest.current.error(""); }
      } catch (e) { if (!stopped) { failures++; lastDevices = lastState = -Infinity; latest.current.error((e as Error).message); } }
      finally { inFlight = false; schedule(); }
    }
    const visible = () => { clearTimeout(timer); if (document.visibilityState !== "hidden") void tick(); };
    wake.current = schedule;
    document.addEventListener("visibilitychange", visible);
    void tick();
    return () => { stopped = true; clearTimeout(timer); document.removeEventListener("visibilitychange", visible); wake.current = () => {}; };
  }, [options.source, options.enabled]);
  useEffect(() => { wake.current(); }, [options.active]);
}
