export interface PickerFile {
  dataUrl: string;
  name: string;
  type: string;
  pickerUrl: string;
  requestId: string;
}

export interface PickerUploadCheck {
  pickerUrl: string;
  requestId: string;
  checkOnly: true;
}

export interface PickerUploadPreparation {
  pickerUrl: string;
  requestId: string;
  prepareOnly: true;
}

export interface PickerUploadTimings {
  readMs: number;
  encodeMs: number;
  probeMs: number;
  handoffMs: number;
  totalMs: number;
}

export type PickerUploadResult =
  | { state: "ignored" | "ready" }
  | { state: "waiting"; waitingFor?: string }
  | { state: "assigned"; timing?: PickerUploadTimings }
  | { state: "error"; error: string };

// Chrome serializes this function for executeScript. Keep it self-contained:
// no references to imports or variables from the extension's service worker.
export function assignPickerFile(payload: PickerFile | PickerUploadCheck | PickerUploadPreparation): PickerUploadResult {
  const url = new URL(location.href);
  const expected = new URL(payload.pickerUrl);
  if (url.origin !== "https://docs.google.com" || !/^\/picker(?:\/|$)/.test(url.pathname)
    || url.searchParams.get("hostId") !== "file-upload"
    || url.searchParams.get("rpcService") !== expected.searchParams.get("rpcService")
    || url.searchParams.get("rpctoken") !== expected.searchParams.get("rpctoken")) return { state: "ignored" };

  const previous = document.documentElement.dataset.hanuPickerUpload;
  if (previous) {
    if (previous !== payload.requestId) return { state: "error", error: "Picker đang xử lý một tệp khác. Hãy hoàn tất hoặc đóng hộp chọn tệp rồi chạy lại." };
    const error = document.documentElement.dataset.hanuPickerError;
    return error ? { state: "error", error } : { state: "assigned" };
  }
  if ("checkOnly" in payload) return { state: "waiting" };

  const inputs = Array.from(document.querySelectorAll<HTMLInputElement>('input[type="file"]'))
    .filter(input => !input.disabled);
  if (!inputs.length) return { state: "waiting", waitingFor: "ô tải tệp chưa xuất hiện" };
  if (inputs.length !== 1) return { state: "error", error: "Picker có nhiều ô chọn tệp; hãy chọn ảnh thủ công để tránh gắn nhầm." };
  const input = inputs[0];
  if (input.files?.length) return { state: "error", error: "Picker đã có tệp đang chọn. Hãy hoàn tất thao tác đó trước." };

  // Picker can announce that it is open before its upload controller is
  // listening. Assigning then clears the input without starting an upload.
  // Keep a minimum startup window even when the announcement is present,
  // and require the current input to remain stable after replacement.
  const now = performance.now();
  const trackedInput = input as HTMLInputElement & { __hanuPickerObservedAt?: number };
  const observedAt = trackedInput.__hanuPickerObservedAt;
  if (observedAt === undefined) trackedInput.__hanuPickerObservedAt = now;
  if (document.readyState !== "complete" || now < 5000
    || observedAt === undefined || now - observedAt < 1000) return { state: "waiting", waitingFor:
      `document=${document.readyState}, tuổi=${Math.round(now)}ms, ô ổn định=${observedAt === undefined ? 0 : Math.round(now-observedAt)}ms` };
  if ("prepareOnly" in payload) return { state: "ready" };

  try {
    const comma = payload.dataUrl.indexOf(",");
    if (comma < 0 || !/;base64$/.test(payload.dataUrl.slice(0, comma))) throw new Error("Dữ liệu tệp đã lưu không hợp lệ.");
    const binary = atob(payload.dataUrl.slice(comma + 1));
    const bytes = Uint8Array.from(binary, character => character.charCodeAt(0));
    const type = payload.type || payload.dataUrl.slice(5, comma).split(";")[0];
    const file = new File([bytes], payload.name, { type });
    const limit = Number(url.searchParams.get("maxSizeBytesPerItem"));
    if (limit > 0 && file.size > limit) throw new Error("Tệp đã lưu vượt quá dung lượng Picker cho phép.");
    const accepts = input.accept.split(",").map(value => value.trim().toLowerCase()).filter(Boolean);
    if (accepts.length && !accepts.some(value => value === "*/*"
      || (value.startsWith(".") ? file.name.toLowerCase().endsWith(value)
        : value.endsWith("/*") ? file.type.toLowerCase().startsWith(value.slice(0, -1))
          : file.type.toLowerCase() === value))) throw new Error("Định dạng tệp đã lưu không được Picker chấp nhận.");

    const transfer = new DataTransfer();
    transfer.items.add(file);
    input.files = transfer.files;
    if (input.files?.length !== 1) throw new Error("Picker không nhận được ảnh đã lưu.");
    // Mark before dispatch: upload can replace/remove the input immediately.
    // Polling/retried messages must never upload the same file twice.
    document.documentElement.dataset.hanuPickerUpload = payload.requestId;
    delete document.documentElement.dataset.hanuPickerError;
    // Picker resets its file input after accepting a selection. On failure it
    // can return to the empty landing screen and show a short-lived snackbar.
    // Keep that original error even if it disappears before the next poll.
    const liveSelector = '[role="alert"], [role="alertdialog"], [role="status"], [aria-live="assertive"], [aria-live="polite"]';
    const failure = /lỗi|thất bại|không (?:thể |được )?(?:tải|đọc|hỗ trợ|cho phép)|vượt quá|hết dung lượng|error|failed|failure|unable|cannot|can't|unsupported|not supported|exceed|quota|storage.*full|network|try again|thử lại/i;
    const existing = new Set(Array.from(document.querySelectorAll(liveSelector)).map(el => el.textContent?.trim()));
    const capture = (node: Node) => {
      const element = node instanceof Element ? node : node.parentElement;
      if (!element) return;
      const candidates = [element.closest(liveSelector), ...Array.from(element.querySelectorAll(liveSelector))];
      for (const candidate of candidates) {
        const text = candidate?.textContent?.replace(/\s+/g, " ").trim();
        if (text && !existing.has(text) && failure.test(text)) {
          document.documentElement.dataset.hanuPickerError = `Google Picker: ${text.slice(0, 600)}`;
        }
      }
    };
    const observer = new MutationObserver(records => {
      if (document.documentElement.dataset.hanuPickerUpload !== payload.requestId) { observer.disconnect(); return; }
      for (const record of records) {
        capture(record.target);
        for (const node of Array.from(record.addedNodes)) capture(node);
      }
    });
    observer.observe(document.body, { subtree: true, childList: true, characterData: true });
    window.setTimeout(() => observer.disconnect(), 125000);
    input.dispatchEvent(new Event("input", { bubbles: true }));
    input.dispatchEvent(new Event("change", { bubbles: true }));
    return { state: "assigned" };
  } catch (error) {
    return { state: "error", error: error instanceof Error ? error.message : String(error) };
  }
}
