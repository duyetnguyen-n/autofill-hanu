import { afterEach, expect, it, vi } from "vitest";
import type { ExtensionMessage, RunState } from "../src/shared";
import { emptyProfile } from "../src/rules";
import { getAttachment, getProfile } from "../src/storage";

vi.mock("../src/storage", async importOriginal => ({
  ...await importOriginal<typeof import("../src/storage")>(),
  getAttachment: vi.fn(), getProfile: vi.fn()
}));
afterEach(() => { vi.unstubAllGlobals(); vi.clearAllMocks(); vi.resetModules(); });

async function setup() {
  let listener: (msg: ExtensionMessage, sender: chrome.runtime.MessageSender, reply: (value: unknown) => void) => void;
  const formUrl = "https://docs.google.com/forms/d/e/test-form/viewform";
  const run: RunState = { tabId: 7, formId: "test-form", mode: "test", status: "running", filled: [], skipped: [], logs: [], submitAttempted: false, updatedAt: "" };
  const profile = emptyProfile();
  profile.attachments.identityDocument = { id: "saved", name: "saved.png", type: "image/png", size: 3, updatedAt: "" };
  vi.mocked(getProfile).mockResolvedValue(profile);
  vi.mocked(getAttachment).mockResolvedValue(new Blob([new Uint8Array([1, 2, 3])], { type: "image/png" }));
  const executeScript = vi.fn(async (request: { args: Array<{ prepareOnly?: boolean }> }) => [{ frameId: 0, result: { state: "ignored" } }, { frameId: 1, result: { state: request.args[0].prepareOnly ? "ready" : "assigned" } }]);
  vi.stubGlobal("chrome", {
    action: { onClicked: { addListener: vi.fn() } },
    tabs: { onUpdated: { addListener: vi.fn() }, onRemoved: { addListener: vi.fn() } },
    runtime: { onMessage: { addListener: (fn: typeof listener) => { listener = fn; } } },
    storage: { local: { get: vi.fn(async () => ({ "run:7": run })) } },
    scripting: { executeScript }
  });
  await import("../src/background");
  const sender = { tab: { id: 7, url: formUrl }, url: formUrl, frameId: 0 } as chrome.runtime.MessageSender;
  const command: ExtensionMessage = { type: "UPLOAD_STORED_FILE", attachmentId: "saved", pickerUrl: "https://docs.google.com/picker?hostId=file-upload&rpcService=session&rpctoken=token", requestId: "request" };
  const ask = (msg = command, source = sender) => new Promise(resolve => listener(msg, source, resolve));
  return { ask, run, command, sender, executeScript };
}

it("passes locally stored bytes to the matched Picker without any filesystem path", async () => {
  const fixture = await setup();
  expect(await fixture.ask()).toEqual({ state: "assigned" });
  expect(fixture.executeScript).toHaveBeenCalledWith(expect.objectContaining({
    target: { tabId: 7, allFrames: true },
    args: [expect.objectContaining({ dataUrl: "data:image/png;base64,AQID", name: "saved.png", requestId: "request" })]
  }));
});

it("polls Picker errors without reading or sending the stored image again", async () => {
  const fixture = await setup();
  expect(await fixture.ask({ ...fixture.command, checkOnly: true })).toEqual({ state: "assigned" });
  expect(getAttachment).not.toHaveBeenCalled();
  expect(fixture.executeScript).toHaveBeenCalledWith(expect.objectContaining({
    args: [{ pickerUrl: fixture.command.pickerUrl, requestId: fixture.command.requestId, checkOnly: true }]
  }));
});

it("checks startup readiness without reading or copying photo bytes into frames", async () => {
  const fixture = await setup();
  fixture.executeScript.mockResolvedValue([{ frameId: 1, result: { state: 'waiting' } }]);
  expect(await fixture.ask()).toEqual({ state: 'waiting' });
  expect(await fixture.ask()).toEqual({ state: 'waiting' });
  expect(getAttachment).not.toHaveBeenCalled();
  expect(fixture.executeScript).toHaveBeenCalledWith(expect.objectContaining({
    args: [{ pickerUrl: fixture.command.pickerUrl, requestId: fixture.command.requestId, prepareOnly: true }]
  }));
});

it("a repeated assigned request never reads or transmits the image again", async () => {
  const fixture = await setup();
  fixture.executeScript.mockResolvedValue([{ frameId: 1, result: { state: 'assigned' } }]);
  expect(await fixture.ask()).toEqual({ state: 'assigned' });
  expect(getAttachment).not.toHaveBeenCalled();
  expect(fixture.executeScript).toHaveBeenCalledTimes(1);
});

it("does not send saved files into an unrelated website or a child frame's request", async () => {
  const fixture = await setup();
  expect(await fixture.ask(fixture.command, { ...fixture.sender, url: "https://example.com" })).toEqual(expect.objectContaining({ ok: false }));
  expect(await fixture.ask(fixture.command, { ...fixture.sender, frameId: 1 })).toEqual(expect.objectContaining({ ok: false }));
  expect(fixture.executeScript).not.toHaveBeenCalled();
});

it("refuses an unrecognized attachment and an unrelated Picker", async () => {
  const fixture = await setup();
  expect(await fixture.ask({ ...fixture.command, attachmentId: "other" })).toEqual(expect.objectContaining({ ok: false }));
  expect(await fixture.ask({ ...fixture.command, pickerUrl: "https://example.com/picker" })).toEqual(expect.objectContaining({ ok: false }));
  expect(fixture.executeScript).not.toHaveBeenCalled();
});

it("rechecks cancellation after reading the file, before injecting the upload", async () => {
  const fixture = await setup();
  vi.mocked(getAttachment).mockImplementationOnce(async () => {
    fixture.run.status = "paused";
    return new Blob(["image"]);
  });
  expect(await fixture.ask()).toEqual(expect.objectContaining({ ok: false }));
  expect(fixture.executeScript).toHaveBeenCalledTimes(1);
  expect(fixture.executeScript.mock.calls[0][0].args[0]).toHaveProperty('prepareOnly', true);
});

it("refuses uploading after the tab moved to a different form", async () => {
  const fixture = await setup();
  expect(await fixture.ask(fixture.command, { ...fixture.sender, url: "https://docs.google.com/forms/d/e/other-form/viewform" })).toEqual(expect.objectContaining({ ok: false }));
  expect(fixture.executeScript).not.toHaveBeenCalled();
});
