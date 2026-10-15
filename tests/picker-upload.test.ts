// @vitest-environment jsdom
// @vitest-environment-options {"url":"https://docs.google.com/picker?hostId=file-upload&rpcService=test&rpctoken=token&maxSizeBytesPerItem=1000"}
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { assignPickerFile, type PickerFile } from "../src/picker-upload";

const pickerUrl = "https://docs.google.com/picker?hostId=file-upload&rpcService=test&rpctoken=token&maxSizeBytesPerItem=1000";
const payload: PickerFile = { pickerUrl, requestId: "upload-1", name: "test.png", type: "image/png", dataUrl: "data:image/png;base64,AQID" };

beforeEach(() => {
  history.replaceState({}, "", pickerUrl);
  delete document.documentElement.dataset.hanuPickerUpload;
  document.body.innerHTML = '<input type="file" accept="image/*,.pdf">';
  // jsdom has no DataTransfer/FileList. Use a writable file list shim;
  // the real browser test must still verify Google accepts these events.
  const input = document.querySelector("input")!;
  vi.spyOn(performance, "now").mockReturnValue(6000);
  (input as HTMLInputElement & { __hanuPickerObservedAt?: number }).__hanuPickerObservedAt = 4500;
  let files: File[] = [];
  Object.defineProperty(input, "files", { configurable: true, get: () => files, set: value => { files = value; } });
  vi.stubGlobal("DataTransfer", class {
    files: File[] = [];
    items = { add: (file: File) => this.files.push(file) };
  });
});
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); document.body.replaceChildren(); });

it("retains Google's transient upload error after it resets the input and removes its snackbar", async () => {
  const input = document.querySelector("input")!;
  input.addEventListener("change", () => { input.files = [] as unknown as FileList; });
  expect(assignPickerFile(payload)).toEqual({ state: "assigned" });
  const toast = document.createElement("div");
  toast.setAttribute("role", "status");
  toast.textContent = "Đã xảy ra lỗi khi tải lên. Vui lòng thử lại.";
  document.body.append(toast);
  await Promise.resolve();
  toast.remove();
  const changed = vi.fn();
  input.addEventListener("change", changed);
  expect(assignPickerFile({ pickerUrl, requestId: payload.requestId, checkOnly: true })).toEqual({
    state: "error", error: "Google Picker: Đã xảy ra lỗi khi tải lên. Vui lòng thử lại."
  });
  expect(changed).not.toHaveBeenCalled();
});

it("a status query never assigns a file, and ignores unrelated existing notices", async () => {
  expect(assignPickerFile({ pickerUrl, requestId: payload.requestId, checkOnly: true })).toEqual({ state: "waiting" });
  const toast = document.createElement("div");
  toast.setAttribute("aria-live", "assertive");
  toast.textContent = "An error occurred before this upload";
  document.body.append(toast);
  expect(assignPickerFile(payload)).toEqual({ state: "assigned" });
  document.body.append(document.createElement("span"));
  await Promise.resolve();
  expect(assignPickerFile({ pickerUrl, requestId: payload.requestId, checkOnly: true })).toEqual({ state: "assigned" });
});

it("delivers stored bytes and emits change once even if the upload request is retried", () => {
  const input = document.querySelector("input")!;
  const changed = vi.fn(() => input.remove()); // uploader replaces its input
  input.addEventListener("change", changed);
  expect(assignPickerFile(payload)).toEqual({ state: "assigned" });
  expect(input.files![0].name).toBe("test.png");
  expect(input.files![0].size).toBe(3);
  expect(input.files![0].type).toBe("image/png");
  expect(assignPickerFile(payload)).toEqual({ state: "assigned" });
  expect(changed).toHaveBeenCalledTimes(1);
});

it("does not start an upload during Picker startup even when its input already exists", () => {
  const input = document.querySelector('input')!;
  const changed = vi.fn();input.addEventListener('change',changed);
  vi.mocked(performance.now).mockReturnValue(1200);
  expect(assignPickerFile(payload)).toEqual({state:'waiting'});
  expect(input.files).toHaveLength(0);
  expect(document.documentElement.dataset.hanuPickerUpload).toBeUndefined();
  vi.mocked(performance.now).mockReturnValue(6000);
  expect(assignPickerFile(payload)).toEqual({state:'assigned'});
  expect(changed).toHaveBeenCalledTimes(1);
});

it("uses the opened-picker announcement to upload before five seconds once the replacement input is stable", () => {
  const input = document.querySelector('input')!;
  (input as HTMLInputElement & { __hanuPickerObservedAt?: number }).__hanuPickerObservedAt = 1200;
  vi.mocked(performance.now).mockReturnValue(1500);
  const announcement=document.createElement('div');announcement.setAttribute('aria-live','polite');
  announcement.textContent='Đã mở bộ chọn Chèn tệp.';document.body.append(announcement);
  const changed=vi.fn();input.addEventListener('change',changed);
  expect(assignPickerFile({pickerUrl,requestId:payload.requestId,prepareOnly:true})).toEqual({state:'ready'});
  expect(input.files).toHaveLength(0);
  expect(document.documentElement.dataset.hanuPickerUpload).toBeUndefined();
  expect(changed).not.toHaveBeenCalled();
  expect(assignPickerFile(payload)).toEqual({state:'assigned'});
  expect(changed).toHaveBeenCalledTimes(1);
});

it("still waits for a newly replaced input even after the opened-picker announcement", () => {
  const input=document.querySelector('input')!;
  delete (input as HTMLInputElement & { __hanuPickerObservedAt?: number }).__hanuPickerObservedAt;
  document.body.insertAdjacentHTML('beforeend','<div role="status">Đã mở bộ chọn Chèn tệp.</div>');
  vi.mocked(performance.now).mockReturnValue(1500);
  expect(assignPickerFile(payload)).toEqual({state:'waiting'});
  vi.mocked(performance.now).mockReturnValue(1700);
  expect(assignPickerFile(payload)).toEqual({state:'waiting'});
  vi.mocked(performance.now).mockReturnValue(1800);
  expect(assignPickerFile(payload)).toEqual({state:'assigned'});
});

it("an unrelated live-region notice does not bypass startup", () => {
  document.body.insertAdjacentHTML('beforeend','<div aria-live="polite">Tải ảnh lên Google Drive.</div>');
  vi.mocked(performance.now).mockReturnValue(2000);
  (document.querySelector('input') as HTMLInputElement & {__hanuPickerObservedAt?:number}).__hanuPickerObservedAt=1000;
  expect(assignPickerFile(payload)).toEqual({state:'waiting'});
});

it("waits again when initialization replaces the input before a file is assigned", () => {
  vi.mocked(performance.now).mockReturnValue(10000);
  const input=document.querySelector('input')!;
  delete (input as HTMLInputElement & { __hanuPickerObservedAt?: number }).__hanuPickerObservedAt;
  expect(assignPickerFile(payload)).toEqual({state:'waiting'});
  input.replaceWith(input.cloneNode());
  vi.mocked(performance.now).mockReturnValue(11500);
  expect(assignPickerFile(payload)).toEqual({state:'waiting'});
  vi.mocked(performance.now).mockReturnValue(12000);
  expect(assignPickerFile(payload)).toEqual({state:'waiting'});
  expect(document.documentElement.dataset.hanuPickerUpload).toBeUndefined();
});

it("does not leak a stored file to a different Picker session or ordinary document", () => {
  const changed = vi.fn();
  document.querySelector("input")!.addEventListener("change", changed);
  expect(assignPickerFile({ ...payload, pickerUrl: pickerUrl.replace("token", "other") })).toEqual({ state: "ignored" });
  history.replaceState({}, "", "/forms/d/e/test/viewform");
  expect(assignPickerFile(payload)).toEqual({ state: "ignored" });
  expect(changed).not.toHaveBeenCalled();
});

it("waits for Picker's input to mount, and refuses ambiguous upload controls", () => {
  document.body.replaceChildren();
  expect(assignPickerFile(payload)).toEqual({ state: "waiting" });
  document.body.innerHTML = '<input type="file"><input type="file">';
  expect(assignPickerFile(payload).state).toBe("error");
});

it("rejects unsupported and oversized files before any upload starts", () => {
  const input = document.querySelector("input")!;
  const changed = vi.fn();
  input.addEventListener("change", changed);
  expect(assignPickerFile({ ...payload, name: "secret.txt", type: "text/plain" }).state).toBe("error");
  history.replaceState({}, "", pickerUrl.replace("1000", "1"));
  expect(assignPickerFile({ ...payload, pickerUrl: location.href }).state).toBe("error");
  expect(changed).not.toHaveBeenCalled();
});

it("does not overwrite a file the user has already selected", () => {
  const input = document.querySelector("input")!;
  Object.defineProperty(input, "files", { configurable: true, get: () => [new File(["existing"], "other.png")] });
  expect(assignPickerFile(payload).state).toBe("error");
});
