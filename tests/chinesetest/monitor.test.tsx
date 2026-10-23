// @vitest-environment jsdom
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { useRunnerMonitor } from "../../integrations/chinesetest/ui/monitor";

let root: Root, host: HTMLDivElement, hidden = false, busy = false;
let devices = vi.fn(async () => {}), state = vi.fn(async () => {}), error = vi.fn((_message: string) => {});
function View({ active = false }: { active?: boolean }) { useRunnerMonitor({ source: "runner-a", enabled: true, active, readDevices: devices, readState: state, busy: () => busy, error }); return null; }
beforeEach(() => {
  vi.useFakeTimers(); hidden = busy = false; vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.spyOn(document, "visibilityState", "get").mockImplementation(() => hidden ? "hidden" : "visible");
  devices = vi.fn(async () => {}); state = vi.fn(async () => {}); error = vi.fn((_message: string) => {});
  host = document.createElement("div"); document.body.append(host); root = createRoot(host);
});
afterEach(async () => { await act(async () => root.unmount()); host.remove(); vi.restoreAllMocks(); vi.unstubAllGlobals(); vi.useRealTimers(); });
async function render(active = false) { await act(async () => root.render(<View active={active}/>)); }
const advance = (ms: number) => act(async () => vi.advanceTimersByTimeAsync(ms));

it("uses 30-second device and 60-second state fallbacks while idle", async () => {
  await render(); expect(devices).toHaveBeenCalledTimes(1); expect(state).toHaveBeenCalledTimes(1);
  await advance(59999); expect(devices).toHaveBeenCalledTimes(2); expect(state).toHaveBeenCalledTimes(1);
  await advance(1); expect(devices).toHaveBeenCalledTimes(3); expect(state).toHaveBeenCalledTimes(2);
});
it("uses fast state reads only for active runs without repeatedly reading devices", async () => {
  await render(); await render(true); expect(state).toHaveBeenCalledTimes(1);
  await advance(10000); expect(state).toHaveBeenCalledTimes(5); expect(devices).toHaveBeenCalledTimes(1);
  await render(false); await advance(10000); expect(state).toHaveBeenCalledTimes(5);
});
it("never stacks slow refreshes", async () => {
  let release!: () => void; state.mockImplementationOnce(() => new Promise<void>(r => release = r));
  await render(true); await advance(15000); expect(state).toHaveBeenCalledTimes(1);
  await act(async () => release()); await advance(1000); expect(state).toHaveBeenCalledTimes(2);
});
it("makes no requests in a hidden tab and coalesces repeated visibility notifications", async () => {
  await render(); hidden = true; await act(async () => document.dispatchEvent(new Event("visibilitychange")));
  await advance(180000); expect(devices).toHaveBeenCalledTimes(1); expect(state).toHaveBeenCalledTimes(1);
  hidden = false; await act(async () => { document.dispatchEvent(new Event("visibilitychange")); document.dispatchEvent(new Event("visibilitychange")); });
  expect(devices).toHaveBeenCalledTimes(2); expect(state).toHaveBeenCalledTimes(2);
});
it("backs off failed reads instead of accumulating commands", async () => {
  state.mockRejectedValue(new Error("offline")); await render(true); expect(error).toHaveBeenLastCalledWith("offline");
  await advance(4999); expect(state).toHaveBeenCalledTimes(1); await advance(1); expect(state).toHaveBeenCalledTimes(2);
  await advance(9999); expect(state).toHaveBeenCalledTimes(2); state.mockResolvedValue(undefined);
  await advance(1); expect(state).toHaveBeenCalledTimes(3); expect(error).toHaveBeenLastCalledWith("");
});
it("does not enqueue state reads while a user command is running", async () => {
  busy = true; await render(true); await advance(6000); expect(state).not.toHaveBeenCalled(); expect(devices).toHaveBeenCalledTimes(1);
  busy = false; await advance(1000); expect(state).toHaveBeenCalledTimes(1);
});
