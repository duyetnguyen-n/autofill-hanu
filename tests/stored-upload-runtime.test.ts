// @vitest-environment jsdom
import { afterEach, expect, it, vi } from "vitest";
import { emptyProfile } from "../src/rules";
import type { ExtensionMessage } from "../src/shared";

let listener: (message: ExtensionMessage) => void;
afterEach(() => {
  listener?.({ type: "HALT_RUN" });
  vi.useRealTimers(); vi.unstubAllGlobals(); vi.restoreAllMocks(); vi.resetModules();
  document.body.replaceChildren();
});

async function setup(result = { state: "assigned" }, uploaded = false, mountDelay = 0) {
  vi.useFakeTimers();
  document.body.innerHTML = `<div role="listitem" data-item-id="file">
    <div role="heading">ẢNH MẶT TRƯỚC GTTT CỦA THÍ SINH | 身份证件图 *</div>
    <p>Upload 1 supported file: PDF or image.</p><button aria-label="ẢNH MẶT TRƯỚC GTTT CỦA THÍ SINH">Add file</button>
  </div><button id="next">Next</button>`;
  vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockReturnValue({ width: 100, height: 40 } as DOMRect);
  Object.defineProperty(HTMLElement.prototype, "scrollIntoView", { configurable: true, value: () => {} });
  const card = document.querySelector<HTMLElement>('[data-item-id="file"]')!;
  const commit = (name = "saved.png") => {
    card.innerHTML += `<span>${name}</span><button aria-label="Remove file">×</button>`;
    document.querySelector("iframe")?.remove();
  };
  if (uploaded) commit();
  else {
    const opener = card.querySelector("button")!;
    if (mountDelay) { opener.remove(); window.setTimeout(() => card.append(opener), mountDelay); }
    opener.addEventListener("click", () => {
    const iframe = document.createElement("iframe");
    iframe.src = "https://docs.google.com/picker?hostId=file-upload&rpcService=test&rpctoken=token";
    document.body.append(iframe);
    });
  }
  const profile = emptyProfile();
  profile.attachments.identityDocument = { id: "stored-image", name: "saved.png", type: "image/png", size: 3, updatedAt: "" };
  const sent: ExtensionMessage[] = [];
  const sendMessage = vi.fn(async (message: ExtensionMessage) => {
    sent.push(message);
    if (message.type === "GET_PROFILE") return profile;
    if (message.type === "UPLOAD_STORED_FILE") return result;
    return undefined;
  });
  vi.stubGlobal("chrome", { runtime: { sendMessage, onMessage: { addListener: (fn: typeof listener) => { listener = fn; } } } });
  const submit = vi.fn();
  const next = vi.fn(() => {
    document.body.innerHTML = "<button>Submit</button>";
    document.querySelector("button")!.addEventListener("click", submit);
  });
  document.querySelector("#next")!.addEventListener("click", next);
  await import("../src/content");
  listener({ type: "RUN_CURRENT_PAGE", mode: "test" });
  await vi.advanceTimersByTimeAsync(100);
  return { next, submit, sent, commit, sendMessage };
}

it("opens Picker with the stored attachment, waits for server completion, then advances without submitting", async () => {
  const fixture = await setup();
  expect(fixture.sendMessage).toHaveBeenCalledWith(expect.objectContaining({ type: "UPLOAD_STORED_FILE", attachmentId: "stored-image" }));
  expect(fixture.next).not.toHaveBeenCalled(); // files assigned != uploaded
  await vi.advanceTimersByTimeAsync(1000);
  expect(fixture.next).not.toHaveBeenCalled();
  fixture.commit();
  await vi.advanceTimersByTimeAsync(1500);
  expect(fixture.next).toHaveBeenCalledTimes(1);
  expect(fixture.submit).not.toHaveBeenCalled();
  expect(fixture.sent).toContainEqual({ type: "FORM_EVENT", event: { type: "ready_to_submit" } });
});

it("HALT during upload never advances even if the upload subsequently completes", async () => {
  const fixture = await setup();
  listener({ type: "HALT_RUN" });
  fixture.commit();
  await vi.advanceTimersByTimeAsync(2000);
  expect(fixture.next).not.toHaveBeenCalled();
});

it("blocks on a rejected stored upload instead of falling through to Next", async () => {
  const fixture = await setup({ state: "error", error: "Picker từ chối tệp" } as { state: string });
  await vi.advanceTimersByTimeAsync(1000);
  expect(fixture.next).not.toHaveBeenCalled();
  expect(fixture.sent).toContainEqual(expect.objectContaining({ type: "FORM_EVENT", event: expect.objectContaining({ type: "block", issue: expect.objectContaining({ reason: "file_upload", message: "Picker từ chối tệp" }) }) }));
});

it("blocks if Picker closes without committing the expected filename", async () => {
  const fixture = await setup();
  fixture.commit("wrong.png");
  await vi.advanceTimersByTimeAsync(6000);
  expect(fixture.next).not.toHaveBeenCalled();
});

it("allows the committed chip to render just after Picker closes", async () => {
  const fixture = await setup();
  document.querySelector("iframe")!.remove();
  await vi.advanceTimersByTimeAsync(500);
  expect(fixture.next).not.toHaveBeenCalled();
  fixture.commit();
  await vi.advanceTimersByTimeAsync(1000);
  expect(fixture.next).toHaveBeenCalledTimes(1);
});

it("does not re-upload a matching committed file", async () => {
  const fixture = await setup({ state: "assigned" }, true);
  await vi.advanceTimersByTimeAsync(1000);
  expect(fixture.next).toHaveBeenCalledTimes(1);
  expect(fixture.sendMessage.mock.calls.some(([message]) => message.type === "UPLOAD_STORED_FILE")).toBe(false);
});

it("a stalled upload times out without repeating the upload or navigating", async () => {
  const fixture = await setup();
  await vi.advanceTimersByTimeAsync(121000);
  expect(fixture.next).not.toHaveBeenCalled();
  expect(fixture.sendMessage.mock.calls.filter(([message]) => message.type === "UPLOAD_STORED_FILE")).toHaveLength(1);
  expect(fixture.sent).toContainEqual(expect.objectContaining({ type: "FORM_EVENT", event: expect.objectContaining({ type: "block" }) }));
});

it("does not skip a required upload card whose button mounts after page navigation", async () => {
  const fixture = await setup({ state: "assigned" }, false, 800);
  expect(fixture.next).not.toHaveBeenCalled();
  expect(fixture.sendMessage.mock.calls.some(([message]) => message.type === "UPLOAD_STORED_FILE")).toBe(false);
  await vi.advanceTimersByTimeAsync(900);
  expect(fixture.sendMessage).toHaveBeenCalledWith(expect.objectContaining({ type: "UPLOAD_STORED_FILE" }));
  expect(fixture.next).not.toHaveBeenCalled();
  fixture.commit();
  await vi.advanceTimersByTimeAsync(1500);
  expect(fixture.next).toHaveBeenCalledTimes(1);
  expect(fixture.submit).not.toHaveBeenCalled();
});
