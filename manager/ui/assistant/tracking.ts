import { safeCompanionText } from "../../assistant/context";

export type TrackingPhase = "prepared" | "waiting" | "checking" | "sending" | "pending" | "confirmed" | "simulated" | "failed" | "uncertain" | "stopped" | "manual";
export type TrackingProvider = "forms" | "direct" | "hcmue" | "chinesetest";
export type TrackingRun = { id: string; account: string; label: string; phase: TrackingPhase; test: boolean; detail?: string };
export type TrackingFeed = { source: string; provider: TrackingProvider; connected: boolean; initializing?: boolean; checkedAt: string; selected: string[]; runs: TrackingRun[] };
export type TrackingUpdate = { id: string; text: string; at: string; kind: "progress" | "result" | "attention" };
type Watch = { source: string; provider: TrackingProvider; ids: string[]; baseline: string[]; accounts: string[]; awaiting: boolean; seen: Record<string, string[]>; finished: string[]; startedAt: number; paused: boolean; disconnected: boolean; active: boolean };
export type TrackingState = { watch?: Watch; updates: TrackingUpdate[]; choices: boolean; unread: number };
const names = { forms: "Google Forms", direct: "Google Forms Direct", hcmue: "HCMUE", chinesetest: "ChineseTest" };
const terminal = new Set<TrackingPhase>(["confirmed", "simulated", "failed", "stopped"]);
const phases: TrackingPhase[] = ["prepared", "waiting", "checking", "sending", "pending", "confirmed", "simulated", "failed", "uncertain", "stopped", "manual"];
const key = (value: unknown): value is string => typeof value === "string" && value.length > 0 && value.length <= 160;
const strings = (value: unknown) => Array.isArray(value) ? value.filter(key).slice(0, 100) : [];

export function trackingIntent(question: string): "start" | "stop" | undefined {
  const text = question.normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/đ/gi, "d").toLowerCase();
  if (/^(cach|huong dan|lam sao|tai sao|vi sao)\b/.test(text)) return;
  if (/facebook|san link|theo doi nguon|thong bao ket qua.*o dau/.test(text)) return;
  if (/\b(dung|ngung|tat|huy) theo doi\b/.test(text)) return "stop";
  if (/\b(khong|dung|chua)\b.*(?:theo doi|dang ky|dki)/.test(text)) return;
  if (/theo doi|bao (?:minh|toi|em|ket qua)|nhan (?:minh|toi).*(?:ket qua|xong)|canh (?:gio|lich)|sap.*(?:dang ky|dang ki|dki|\bdk\b)/.test(text)) return "start";
}

function updateText(run: TrackingRun) {
  const suffix = ` (${run.label})`;
  switch (run.phase) {
    case "prepared": return `Lịch đã chuẩn bị${suffix}, nhưng chưa bật. Bạn xem lại thông tin và bấm Bật lịch nhé; mình sẽ theo dõi từ bước đó.`;
    case "waiting": return `Lịch đã bật${suffix}. Runner đang chờ giờ chạy; có bước mới mình sẽ báo ở đây.`;
    case "checking": return `Runner đang kiểm tra điều kiện đăng ký${suffix}. Mình sẽ báo khi chuyển sang gửi hoặc nếu có mục cần bạn xử lý.`;
    case "sending": return `Runner đang gửi yêu cầu${suffix}. Chưa có xác nhận đăng ký, mình đang chờ kết quả tiếp.`;
    case "pending": return `Yêu cầu đang chờ kết quả từ hệ thống thi${suffix}. Mình chưa thấy xác nhận đăng ký để báo thành công.`;
    case "confirmed": return `Đã có xác nhận đăng ký${suffix}. Bạn mở Lịch và kết quả để kiểm tra mã đăng ký và hạn thanh toán nhé.`;
    case "simulated": return `Diễn tập đã hoàn tất${suffix}. Lượt này không gửi đơn đăng ký thật.`;
    case "failed": return `Lượt này gặp lỗi${suffix}.${run.detail ? ` ${run.detail}` : " Bạn mở chi tiết để xem phần cần xử lý nhé."} Mình chưa có xác nhận đăng ký thành công.`;
    case "uncertain": return `Kết quả chưa rõ${suffix}. Bạn kiểm tra kết quả trên hệ thống thi trước khi chạy lại để tránh gửi trùng. Mình vẫn theo dõi nếu có cập nhật xác nhận.`;
    case "stopped": return `Lượt này đã dừng${suffix}. Trạng thái dừng không xác nhận có đăng ký; nếu đã gửi trước đó, bạn cần đối chiếu kết quả.`;
    case "manual": return `Đến bước cần bạn xử lý${suffix}.${run.detail ? ` ${run.detail}` : " Bạn mở chi tiết lượt chạy nhé."} Mình sẽ theo dõi tiếp sau khi bạn hoàn tất.`;
  }
}

export function restoreTracking(value: unknown, now = Date.now()): TrackingState {
  const empty: TrackingState = { updates: [], choices: false, unread: 0 };
  if (!value || typeof value !== "object") return empty;
  const raw = value as TrackingState, watch = raw.watch;
  const updates = Array.isArray(raw.updates) ? raw.updates.slice(-24).flatMap(item => {
    if (!item || !key(item.id) || !Number.isFinite(Date.parse(item.at)) || now - Date.parse(item.at) > 2 * 3600000 || Date.parse(item.at) > now) return [];
    const text = safeCompanionText(item.text, 600);
    return text ? [{ id: item.id, text, at: item.at, kind: ["progress", "result", "attention"].includes(item.kind) ? item.kind : "progress" } as TrackingUpdate] : [];
  }) : [];
  if (!watch || !Object.hasOwn(names, watch.provider) || !key(watch.source) || !Number.isFinite(watch.startedAt) || now - watch.startedAt > 7 * 86400000 || watch.startedAt > now)
    return { ...empty, updates };
  const seen = Object.fromEntries(Object.entries(watch.seen ?? {}).filter(([id]) => key(id)).slice(0, 100).map(([id, value]) => [id, strings(value).filter(phase => phases.includes(phase as TrackingPhase))]));
  return { updates, choices: false, unread: Math.min(updates.length, Math.max(0, Number(raw.unread) || 0)), watch: {
    source: watch.source, provider: watch.provider, ids: strings(watch.ids), baseline: strings(watch.baseline), accounts: strings(watch.accounts), seen,
    finished: strings(watch.finished), awaiting: watch.awaiting === true, startedAt: watch.startedAt, active: watch.active === true, paused: watch.paused === true, disconnected: watch.disconnected === true,
  } };
}

/** Progress follows typed runner state, never DOM clicks or model-generated claims. */
export function createRunTracker(saved: unknown, notify: () => void, isOpen: () => boolean) {
  let state = restoreTracking(saved), feed: TrackingFeed | undefined;
  const emit = (text: string, kind: TrackingUpdate["kind"] = "progress") => {
    state = { ...state, updates: [...state.updates, { id: crypto.randomUUID(), text: safeCompanionText(text, 600), at: new Date().toISOString(), kind }].slice(-24), unread: isOpen() ? 0 : state.unread + 1 };
  };
  function observe(next: TrackingFeed) {
    feed = next;
    const watch = state.watch;
    if (!watch?.active) return;
    if (next.initializing) return;
    if (watch.source !== next.source) {
      if (!watch.paused && !(next.provider === watch.provider && next.source.endsWith(":unselected"))) {
        watch.paused = true;
        emit(`Mình tạm ngừng cập nhật vì bạn đang ở ứng dụng hoặc máy khác. Lịch ở ${names[watch.provider]} vẫn do Runner thực hiện; mở lại đúng trang và máy để mình báo tiếp.`, "attention"); notify();
      }
      return;
    }
    watch.paused = false;
    const fresh = Number.isFinite(Date.parse(next.checkedAt)) && Math.abs(Date.now() - Date.parse(next.checkedAt)) < 90_000;
    if (!next.connected || !fresh) {
      if (!watch.disconnected) emit(`Mình đang mất cập nhật từ ${names[watch.provider]}. Lịch trên máy có thể vẫn chạy; khi kết nối lại mình sẽ đối chiếu và báo tiếp.`, "attention");
      watch.disconnected = true; notify(); return;
    }
    if (watch.disconnected) { emit("Đã đọc lại được trạng thái. Mình tiếp tục theo dõi lịch bạn đã chọn."); watch.disconnected = false; }
    if (watch.awaiting) {
      const bound = next.runs.filter(run => watch.ids.includes(run.id)).map(run => run.account);
      for (const run of next.runs) if (!watch.baseline.includes(run.id) && watch.accounts.includes(run.account) && !bound.includes(run.account)) {
        watch.ids.push(run.id); bound.push(run.account);
      }
      watch.awaiting = watch.accounts.some(account => !bound.includes(account));
    }
    for (const run of next.runs.filter(run => watch.ids.includes(run.id))) {
      const seen = watch.seen[run.id] ?? [];
      if (seen.includes(run.phase)) continue;
      watch.seen[run.id] = [...seen, run.phase];
      emit(updateText(run), terminal.has(run.phase) ? "result" : run.phase === "uncertain" || run.phase === "manual" ? "attention" : "progress");
      if (terminal.has(run.phase) && !watch.finished.includes(run.id)) watch.finished.push(run.id);
    }
    if (!watch.awaiting && watch.ids.length && watch.ids.every(id => watch.finished.includes(id))) watch.active = false;
    notify();
  }
  return {
    get: () => state,
    feed: () => feed,
    summary: () => state.watch?.active ? `Đang theo dõi ${state.watch.ids.length || "lịch mới"} · ${names[state.watch.provider]}${state.watch.paused ? " · tạm ngừng cập nhật" : state.watch.disconnected ? " · chờ kết nối" : ""}` : state.updates.length ? "Đã có cập nhật đăng ký" : "",
    start(ids?: string[]) {
      if (!feed) return "Bạn mở trang đăng ký cần theo dõi trước nhé. Mình cần đọc được lịch và máy đang chọn để theo dõi đúng lượt.";
      if (feed.initializing) return "Mình đang chờ đọc trạng thái máy và lịch. Bạn đợi trang tải xong rồi nhắn mình theo dõi nhé.";
      if (feed.source.endsWith(":unselected")) return "Bạn chọn và kết nối máy chạy trước nhé. Khi đọc được lịch trên đúng máy, mình mới theo dõi và báo kết quả cho bạn được.";
      const eligible = feed.runs.filter(run => !terminal.has(run.phase) && (!feed!.selected.length || feed!.selected.includes(run.account)));
      const chosen = ids ? feed.runs.filter(run => ids.includes(run.id)) : eligible;
      if (ids && (!ids.length || chosen.length !== ids.length)) return "Mình chưa thấy đầy đủ lịch bạn chọn. Bạn đọc lại trạng thái rồi chọn lại giúp mình nhé.";
      if (state.watch?.active) return state.watch.source === feed.source ? "Mình đang theo dõi lịch bạn đã chọn rồi. Có bước mới hoặc kết quả mình sẽ nhắn tại đây." : "Mình đang theo dõi một lượt ở ứng dụng hoặc máy khác. Bạn dừng phần theo dõi hiện tại trước khi chọn lượt mới nhé.";
      if (!ids && chosen.length > 1 && !feed.selected.length) {
        state = { ...state, choices: true }; notify();
        return `Có ${chosen.length} lịch có thể theo dõi. Bạn chọn lịch trong phần Theo dõi đăng ký để mình bám đúng lượt nhé.`;
      }
      if (!chosen.length && !feed.selected.length) return "Bạn chọn tài khoản hoặc profile cần đăng ký trước nhé. Mình cần biết đang theo dõi lượt của ai để tránh báo nhầm kết quả.";
      state = { ...state, choices: false, watch: { source: feed.source, provider: feed.provider, ids: chosen.map(run => run.id), baseline: chosen.length ? [] : feed.runs.map(run => run.id), accounts: [...feed.selected], awaiting: !chosen.length, seen: {}, finished: [], startedAt: Date.now(), paused: false, disconnected: false, active: true } };
      observe(feed);
      if (!chosen.length) { emit("Mình đang chờ lịch mới trên trang này. Bạn chuẩn bị và bật lịch nhé; mình chưa tạo hay bật lịch thay bạn."); notify(); }
      return chosen.length ? "Được, mình đang theo dõi lịch này. Có bước mới, lỗi cần xử lý hoặc kết quả, mình sẽ nhắn ngay trong khung chat. Bạn giữ trang này mở nhé."
        : "Được, mình sẽ theo dõi lịch bạn chuẩn bị trên trang này. Hiện chưa có lượt phù hợp để theo dõi; bạn chọn tài khoản, chuẩn bị và bật lịch trước nhé. Mình chưa tạo hay bật lịch thay bạn.";
    },
    stop() {
      if (state.watch) state.watch.active = false;
      state = { ...state, choices: false }; notify();
      return "Mình đã dừng phần theo dõi của AI. Lịch trên Runner vẫn giữ nguyên; muốn dừng đăng ký bạn dùng nút Dừng lịch trên trang nhé.";
    },
    read() { if (state.unread) { state = { ...state, unread: 0 }; notify(); } },
    clear() { state = { updates: [], choices: false, unread: 0 }; feed = undefined; },
    observe,
    suspend(source: string) {
      if (state.watch?.active && state.watch.source === source && !state.watch.paused) {
        state.watch.paused = true;
        emit(`Mình tạm ngừng cập nhật vì bạn đã rời màn ${names[state.watch.provider]} hoặc đổi máy. Lịch vẫn do Runner thực hiện; mở lại đúng trang và máy để mình báo tiếp.`, "attention"); notify();
      }
      if (feed?.source === source) feed = undefined;
    },
  };
}
