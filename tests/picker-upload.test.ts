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
  let files: File[] = [];
  Object.defineProperty(input, "files", { configurable: true, get: () => files, set: value => { files = value; } });
  vi.stubGlobal("DataTransfer", class {
    files: File[] = [];
    items = { add: (file: File) => this.files.push(file) };
  });
});
afterEach(() => { vi.unstubAllGlobals(); document.body.replaceChildren(); });

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
