export const redactAssistantText = (value: string) => value
  .replace(/(?:sk-[\w-]{12,}|eyJ[\w-]+\.[\w-]+\.[\w-]+|\bBearer\s+[\w.-]+)/gi, "[đã ẩn]")
  .replace(/[\w.+-]+@[\w.-]+\.[a-z]{2,}/gi, "[email đã ẩn]")
  .replace(/(?<!\d)(?:\d[ .-]?){9,}(?!\d)/g, "[số đã ẩn]")
  .replace(/((?:mật khẩu|mat khau|password|cookie|api[_ ]?key|token|\bmk)\s*(?:là|[:=])\s*)(?:\[đã ẩn\]|\S+)/gi, "$1[đã ẩn]")
  .replace(/((?:mật khẩu|mat khau|password|\bmk)\s+)\S*\d\S*/gi, "$1[đã ẩn]");
