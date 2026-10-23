// @vitest-environment jsdom
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { DONG_A, type Plan } from "../../integrations/chinesetest/protocol";
import { useChineseTestCatalog } from "../../integrations/chinesetest/ui/catalog";

let root: Root, host: HTMLDivElement, current: ReturnType<typeof useChineseTestCatalog>;
const plan = (): Plan => ({ target: { ...DONG_A }, test: true });
function View({ request, source, plans }: any) { current = useChineseTestCatalog(request, source, true, plans); return <div>{current.sites(Object.values(plans)[0] ? (Object.values(plans)[0] as Plan).target : DONG_A).map(s => s.kdId).join(",")}</div>; }
beforeEach(() => { vi.useFakeTimers(); vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true); host = document.createElement("div"); document.body.append(host); root = createRoot(host); });
afterEach(async () => { await act(async () => root.unmount()); host.remove(); vi.unstubAllGlobals(); vi.useRealTimers(); });
const reply = async (_command: any, args: any) => ({ data: args.kind === "projects" ? { projectList: [{ KMID: "13" }] } : args.kind === "directory" ? [{ kdId: "hidden" }] : args.kind === "sites" ? [{ kdId: args.ksDate }] : [{ KMID: "828636" }] });
async function render(request: any, plans: Record<string, Plan>, source = "runner-a") { await act(async () => root.render(<View request={request} plans={plans} source={source}/>)); await act(async () => vi.advanceTimersByTimeAsync(250)); }

it("automatically loads Vietnam centers once per configuration across accounts without reloading on fee/time changes", async () => {
  const request = vi.fn(reply); await render(request, { a: plan(), b: plan() });
  expect(request).toHaveBeenCalledTimes(4); expect(current.directory("2")).toEqual([{ kdId: "hidden" }]); expect(host.textContent).toBe(DONG_A.ksDate);
  const changed = plan(); changed.target.maxFee = 200; changed.target.targetAt = Date.now() + 60000;
  await render(request, { a: changed, b: changed }); expect(request).toHaveBeenCalledTimes(4);
  const next = plan(); next.target.ksDate = "2026-11-14"; await render(request, { a: next });
  expect(request).toHaveBeenCalledTimes(5); expect(host.textContent).toBe("2026-11-14");
});
it("never shows a late center list under a different date or device", async () => {
  let release!: (r: any) => void;
  const request = vi.fn(async (command: any, args: any) => args.kind === "sites" && args.ksDate === DONG_A.ksDate ? new Promise(r => release = r) : reply(command, args));
  await render(request, { a: plan() });
  const next = plan(); next.target.ksDate = "2026-11-14"; await render(request, { a: next }); expect(host.textContent).toBe("2026-11-14");
  await act(async () => release({ data: [{ kdId: "stale" }] })); expect(host.textContent).toBe("2026-11-14");
  await render(request, { a: plan() }, "runner-b"); expect(host.textContent).toBe("");
  await act(async () => release({ data: [{ kdId: "runner-b" }] })); expect(host.textContent).toBe("runner-b");
});
it("reports failures and retries on reload instead of interpreting an error as an empty directory", async () => {
  let fail = true; const request = vi.fn(async (command: any, args: any) => { if (fail && args.kind === "directory") throw new Error("directory timeout"); return reply(command, args); });
  await render(request, { a: plan() }); expect(current.error(DONG_A)).toBe("directory timeout");
  fail = false; await act(async () => current.reload()); await act(async () => vi.advanceTimersByTimeAsync(250));
  expect(current.error(DONG_A)).toBeUndefined(); expect(current.directory("2")).toHaveLength(1);
});
