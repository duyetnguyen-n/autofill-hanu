export interface PickerFile {
  dataUrl: string;
  name: string;
  type: string;
  pickerUrl: string;
  requestId: string;
}

export type PickerUploadResult =
  | { state: "ignored" | "waiting" | "assigned" }
  | { state: "error"; error: string };

// Chrome serializes this function for executeScript. Keep it self-contained:
// no references to imports or variables from the extension's service worker.
export function assignPickerFile(payload: PickerFile): PickerUploadResult {
  const url = new URL(location.href);
  const expected = new URL(payload.pickerUrl);
  if (url.origin !== "https://docs.google.com" || !/^\/picker(?:\/|$)/.test(url.pathname)
    || url.searchParams.get("hostId") !== "file-upload"
    || url.searchParams.get("rpcService") !== expected.searchParams.get("rpcService")
    || url.searchParams.get("rpctoken") !== expected.searchParams.get("rpctoken")) return { state: "ignored" };

  const previous = document.documentElement.dataset.hanuPickerUpload;
  if (previous) return previous === payload.requestId
    ? { state: "assigned" }
    : { state: "error", error: "Picker đang xử lý một tệp khác. Hãy hoàn tất hoặc đóng hộp chọn tệp rồi chạy lại." };

  const inputs = Array.from(document.querySelectorAll<HTMLInputElement>('input[type="file"]'))
    .filter(input => !input.disabled);
  if (!inputs.length) return { state: "waiting" };
  if (inputs.length !== 1) return { state: "error", error: "Picker có nhiều ô chọn tệp; hãy chọn ảnh thủ công để tránh gắn nhầm." };
  const input = inputs[0];
  if (input.files?.length) return { state: "error", error: "Picker đã có tệp đang chọn. Hãy hoàn tất thao tác đó trước." };

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
    input.dispatchEvent(new Event("input", { bubbles: true }));
    input.dispatchEvent(new Event("change", { bubbles: true }));
    return { state: "assigned" };
  } catch (error) {
    return { state: "error", error: error instanceof Error ? error.message : String(error) };
  }
}
