import React, { useEffect, useRef, useState, useCallback } from "react";
import {
  FluentProvider,
  Button,
  Input,
  Select,
  Checkbox,
  Field,
  Spinner,
  Dialog,
  DialogSurface,
  DialogBody,
  DialogTitle,
  DialogContent,
  DialogActions,
} from "@fluentui/react-components";
import {
  AddRegular,
  ArrowSyncRegular,
  CheckmarkCircleRegular,
  ClockRegular,
  DesktopRegular,
  LinkRegular,
  PlayRegular,
  ShieldCheckmarkRegular,
  StopRegular,
  WeatherMoonRegular,
  WeatherSunnyRegular,
  OpenRegular,
  DismissRegular,
} from "@fluentui/react-icons";
import type { Account } from "../../../src/account";
import { darkTheme, lightTheme, useTheme } from "../../../manager/ui/theme";
import { box, open, newReplyKey } from "../crypto";
import {
  examKey,
  statusLabel,
  activeStatus,
  examObservation,
  schoolDate,
  type Device,
  type RunnerState,
  type Exam,
  type Questions,
  type Command,
  type CommandReply,
  type Inspection,
} from "../protocol";
import { vnInput, targetTime, suggestedTarget, planForSchedule, matchesPlan, eachAccount, type AccountPlan } from "./planning";
import "./page.css";
import { WorkspaceSidebar } from "../../../manager/ui/WorkspaceSidebar";
import { Users, CalendarCheck, Desktop } from "@phosphor-icons/react";
async function api<T>(path: string, value?: unknown) {
  const controller = new AbortController(),
    timer = setTimeout(() => controller.abort(), 95000);
  try {
    const response = await fetch("/api/hcmue/" + path, {
      method: value === undefined ? "GET" : "POST",
      headers: { "Content-Type": "application/json" },
      body: value === undefined ? undefined : JSON.stringify(value),
      signal: controller.signal,
    });
    let data: any;
    try {
      data = await response.json();
    } catch {
      throw new Error(
        "Website chưa trả dữ liệu hợp lệ. Lịch đã bật vẫn nằm trên máy.",
      );
    }
    if (!response.ok)
      throw new Error(data.error || "Không xử lý được yêu cầu.");
    return data as T;
  } finally {
    clearTimeout(timer);
  }
}
const time = (value: string) =>
  new Date(value).toLocaleString("vi-VN", {
    timeZone: "Asia/Ho_Chi_Minh",
    hour12: false,
  });
const shortTime = (value: string) =>
  new Date(value).toLocaleTimeString("vi-VN", {
    timeZone: "Asia/Ho_Chi_Minh",
    hour12: false,
  });
export function HcmuePage({
  account,
  logout,
  chinesetestEnabled=false,
}: {
  account: Account;
  logout: () => Promise<void>;
  chinesetestEnabled?: boolean;
}) {
  const { dark, toggleTheme } = useTheme();
  const [devices, setDevices] = useState<Device[]>([]),
    [deviceId, setDeviceId] = useState(""),
    [state, setState] = useState<RunnerState>(),
    [loading, setLoading] = useState(true),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [notice, setNotice] = useState("");
  const [pairOpen, setPairOpen] = useState(false),
    [pairCode, setPairCode] = useState(""),
    [verify, setVerify] = useState<Device>(),
    [trusted, setTrusted] = useState(false),
    [loginOpen, setLoginOpen] = useState(false),
    [cccd, setCccd] = useState(""),
    [password, setPassword] = useState("");
  const [selected, setSelected] = useState<Set<string>>(new Set()),
    [exams, setExams] = useState<Exam[]>([]),
    [examId, setExamId] = useState(""),
    [target, setTarget] = useState(""),
    [test, setTest] = useState(true),
    [armOpen, setArmOpen] = useState(false),
    [armSelection, setArmSelection] = useState<string[]>([]),
    [now, setNow] = useState(Date.now());
  const [plans, setPlans] = useState<Record<string, AccountPlan>>({}),
    [rowErrors, setRowErrors] = useState<Record<string, string>>({}),
    [inspections, setInspections] = useState<Record<string, Inspection>>({}),
    [details, setDetails] = useState<Exam>();
  const [questionDraft, setQuestionDraft] = useState<
    | {
        accountId: string;
        q: Questions;
        args: any;
        answers: Record<string, string>;
      }[]
    | undefined
  >();
  const revision = useRef(0),
    busyRef = useRef(false),
    mounted = useRef(true),
    device = devices.find((d) => d.id === deviceId),
    deviceRef = useRef(device),
    trustedRef = useRef(trusted);
  deviceRef.current = device;
  trustedRef.current = trusted;
  const trustKey = (id: string) => `hcmue.trust.${account.id}.${id}`;
  const request = useCallback(
    async (command: Command, args: Record<string, unknown> = {}) => {
      const d = deviceRef.current;
      if (!d?.connected) throw new Error("Máy chạy chưa kết nối.");
      if (
        !trustedRef.current ||
        localStorage.getItem(trustKey(d.id)) !== d.fingerprint
      )
        throw new Error("Đối chiếu dấu vân tay máy trước khi dùng.");
      const commandId = crypto.randomUUID(),
        replyKey = newReplyKey();
      const encrypted = await box(
        d.publicKey,
        { issuedAt: Date.now(), commandId, command, args, replyKey },
        commandId,
      );
      const response = await api<{ box: any }>(`devices/${d.id}/command`, {
        commandId,
        command,
        box: encrypted,
      });
      const result = await open<CommandReply>(
        replyKey,
        response.box,
        commandId,
      );
      if (!result.ok)
        throw new Error(result.error || "Runner không thực hiện được lệnh.");
      return result.data as any;
    },
    [account.id],
  );
  async function act(work: () => Promise<void>) {
    if (busyRef.current) return;
    busyRef.current = true;
    revision.current++;
    setBusy(true);
    setError("");
    setNotice("");
    try {
      await work();
    } catch (e) {
      if (mounted.current)
        setError(
          (e as Error).name === "AbortError"
            ? "Chưa có xác nhận. Đọc trạng thái trước khi thử lại."
            : (e as Error).message,
        );
    } finally {
      busyRef.current = false;
      if (mounted.current) setBusy(false);
    }
  }
  async function refreshDevices() {
    const d = await api<Device[]>("devices");
    if (!mounted.current) return;
    setDevices(d);
    setDeviceId((old) =>
      d.some((x) => x.id === old) ? old : (d[0]?.id ?? ""),
    );
    setLoading(false);
  }
  useEffect(() => {
    mounted.current = true;
    void refreshDevices().catch((e) => {
      setError(e.message);
      setLoading(false);
    });
    const timer = setInterval(() => {
      if (!busyRef.current) void refreshDevices().catch(() => {});
    }, 5000);
    const clock = setInterval(() => setNow(Date.now()), 1000);
    return () => {
      mounted.current = false;
      clearInterval(timer);
      clearInterval(clock);
    };
  }, []);
  useEffect(() => {
    setState(undefined);
    setSelected(new Set());
    setExams([]);
    setExamId("");
    setPlans({});
    setRowErrors({});
    setInspections({});
    setQuestionDraft(undefined);
    setArmOpen(false);
    setTrusted(
      !!device &&
        localStorage.getItem(trustKey(device.id)) === device.fingerprint,
    );
  }, [deviceId, device?.fingerprint]);
  useEffect(() => {
    if (!device?.connected || !trusted) return;
    let stopped = false;
    async function poll() {
      if (busyRef.current) return;
      try {
        const before = revision.current,
          result = await request("state");
        if (!stopped && !busyRef.current && before === revision.current)
          setState(result);
      } catch (e) {
        if (!stopped) setError((e as Error).message);
      }
    }
    void poll();
    const timer = setInterval(() => void poll(), 4000);
    return () => {
      stopped = true;
      clearInterval(timer);
    };
  }, [device?.id, device?.connected, trusted, request]);
  const capacity = Math.min(20, account.maxProfiles);
  const accounts = state?.accounts ?? [],
    schedules = state?.schedules ?? [],
    chosen = accounts.filter((a) => selected.has(a.id)),
    prepared = schedules.filter((s) => s.status === "prepared" && Date.parse(s.targetAt) >= now + 2500 && !rowErrors[s.accountId] && matchesPlan(s, plans[s.accountId])),
    arming = prepared.filter((s) => armSelection.includes(s.id)),
    active = schedules.filter((s) => activeStatus(s.status)),
    success = schedules.filter((s) => s.status === "pending_payment"),
    attention = schedules.filter((s) =>
      ["failed", "uncertain"].includes(s.status),
    );
  const next = active
    .filter((s) => ["armed", "reserved"].includes(s.status))
    .sort((a, b) => Date.parse(a.targetAt) - Date.parse(b.targetAt))[0];
  const remaining = next ? Math.max(0, Date.parse(next.targetAt) - now) : 0;
  const countdown = next
    ? [
        Math.floor(remaining / 3600000),
        Math.floor(remaining / 60000) % 60,
        Math.floor(remaining / 1000) % 60,
      ]
        .map((v) => String(v).padStart(2, "0"))
        .join(":")
    : "--:--:--";
  const exam = exams.find((e) => examKey(e) === examId);
  function planFor(id: string): AccountPlan {
    const latest = [...schedules].reverse().find(s => s.accountId === id);
    return plans[id] ?? (latest ? planForSchedule(latest) : { examKey: "", target: "", test: true });
  }
  function editPlan(id: string, change: Partial<AccountPlan>) {
    const current = planFor(id);
    setPlans(old => ({ ...old, [id]: { ...current, ...change } }));
    setRowErrors(old => ({ ...old, [id]: "" }));
    setInspections(old => { const n = { ...old }; delete n[id]; return n; });
  }
  async function loadExams() {
    const data = await request("exams", { accountId: chosen[0]?.id ?? accounts[0]?.id });
    setExams(data);
    if (!data.length) setNotice("API trường chưa trả kỳ thi nào. Không có bộ lọc ẩn đợt cũ.");
  }
  const failRow = (a: { id: string }, message: string) => setRowErrors(old => ({ ...old, [a.id]: message }));
  async function inspectChosen() {
    setRowErrors(old => ({ ...old, ...Object.fromEntries(chosen.map(a => [a.id, ""])) }));
    const completed = await eachAccount(chosen, async a => {
      const p = planFor(a.id), e = exams.find(x => examKey(x) === p.examKey);
      if (!e) throw new Error("Chọn kỳ thi riêng cho tài khoản này trước khi kiểm tra.");
      setInspections(old => { const n = { ...old }; delete n[a.id]; return n; });
      const result = await request("inspect", { accountId: a.id, examKey: p.examKey, location: e.dia_diem_code ?? "HCMUE" });
      setInspections(old => ({ ...old, [a.id]: result }));
    }, failRow);
    setNotice(`Đã nhận báo cáo cho ${completed}/${chosen.length} tài khoản. Xem từng mục bên dưới. Không tạo lịch và không gửi đơn.`);
  }
  async function prepare() {
    const drafts: NonNullable<typeof questionDraft> = [];
    setRowErrors(old => ({ ...old, ...Object.fromEntries(chosen.map(a => [a.id, ""])) }));
    const completed = await eachAccount(chosen, async a => {
      const p = planFor(a.id), e = exams.find(x => examKey(x) === p.examKey);
      if (!e) throw new Error("Chọn kỳ thi riêng cho tài khoản này.");
      const args = { accountId: a.id, examKey: p.examKey, targetAt: targetTime(p.target), test: p.test, location: e.dia_diem_code ?? "HCMUE" };
      const result = await request("prepare", args);
      if (result.questions.questions.length) drafts.push({ accountId: a.id, q: result.questions, args, answers: {} });
      else setState(await request("prepare", { ...args, answers: {} }));
    }, failRow);
    if (drafts.length) setQuestionDraft(drafts);
    setNotice(`Đã xử lý ${completed}/${chosen.length} tài khoản${drafts.length ? `; ${drafts.length} tài khoản cần trả lời câu hỏi` : ""}. Lịch sẵn sàng vẫn cần bật và xác nhận; tài khoản lỗi được ghi riêng.`);
  }
  const accountIds = accounts.map((a) => a.id).join(",");
  useEffect(() => {
    setSelected(
      (old) =>
        new Set([...old].filter((id) => accountIds.split(",").includes(id))),
    );
  }, [accountIds]);
  const ready = !!device?.connected && trusted && !!state;
  const updatedRunner = (state?.protocolVersion ?? 1) >= 2;
  return (
    <FluentProvider
      theme={dark ? darkTheme : lightTheme}
      className={`hc-app ${dark ? "hc-dark" : ""}`}
    >
      <WorkspaceSidebar page="hcmue" hcmueEnabled chinesetestEnabled={chinesetestEnabled} connected={ready} email={account.email} logout={()=>void logout()} items={[
        {label:'Tài khoản và lịch',href:'#hc-accounts',icon:<Users size={19}/>,count:accounts.length},
        {label:'Kết quả đăng ký',href:'#hc-results',icon:<CalendarCheck size={19}/>,count:success.length},
        {label:'Máy thực thi',href:'#hc-device',icon:<Desktop size={19}/>},
      ]}/>
      <div className="hc-main">
        <header className="hc-topbar">
          <span>
            Đăng ký HSK <span className="hc-separator">/</span>{" "}
            <strong>HCMUE</strong>
          </span>
          <div>
            <span className="hc-zone">Giờ Việt Nam · UTC+7</span>
            <Button
              appearance="subtle"
              icon={dark ? <WeatherSunnyRegular /> : <WeatherMoonRegular />}
              aria-label="Đổi giao diện"
              onClick={toggleTheme}
            />
          </div>
        </header>
        <main className="hc-workspace">
          <div className="hc-heading">
            <div>
              <p className="hc-kicker">HSK / HSKK</p>
              <h1>Sẵn sàng trước giờ mở.</h1>
              <p>Chuẩn bị tài khoản. Đặt lịch gửi. Theo dõi từng kết quả.</p>
            </div>
            <Button
              appearance="primary"
              icon={<AddRegular />}
              disabled={!ready || busy || accounts.length >= capacity}
              onClick={() => setLoginOpen(true)}
            >
              Thêm tài khoản
            </Button>
          </div>
          {error && (
            <div className="hc-message hc-error" role="alert">
              <span>{error}</span>
              <Button
                appearance="transparent"
                icon={<DismissRegular />}
                aria-label="Đóng lỗi"
                onClick={() => setError("")}
              />
            </div>
          )}
          {notice && (
            <div className="hc-message" role="status">
              <CheckmarkCircleRegular />
              <span>{notice}</span>
            </div>
          )}
          <section className="hc-runway" aria-label="Lịch sắp gửi">
            <div className="hc-next">
              <span>LỊCH GỬI TIẾP THEO</span>
              <strong className="hc-countdown">{countdown}</strong>
              <p>
                {next
                  ? `${next.exam.ten_cap_thi} · ${time(next.targetAt)}`
                  : "Chưa có lịch được bật"}
              </p>
            </div>
            <div className="hc-runway-stats">
              <div>
                <span>Tài khoản</span>
                <strong>
                  {String(accounts.length).padStart(2, "0")}
                  <small> / {capacity}</small>
                </strong>
              </div>
              <div>
                <span>Đang hoạt động</span>
                <strong>{String(active.length).padStart(2, "0")}</strong>
              </div>
              <div>
                <span>Đã có mã đơn</span>
                <strong>{String(success.length).padStart(2, "0")}</strong>
              </div>
              <div>
                <span>Cần kiểm tra</span>
                <strong>{String(attention.length).padStart(2, "0")}</strong>
              </div>
            </div>
          </section>
          <section id="hc-device" className="hc-device">
            <div
              className={`hc-device-symbol ${device?.connected ? "hc-online" : ""}`}
            >
              <DesktopRegular />
            </div>
            <div className="hc-device-info">
              <h2>Máy thực hiện đăng ký{device ? ` · ${device.name}` : ""}</h2>
              <p>
                {device
                  ? `${device.platform === "darwin" ? "macOS" : "Windows"} · ${device.connected ? "Đã kết nối website" : "Chưa kết nối"}${trusted ? " · Đã đối chiếu thiết bị" : ""}`
                  : "Mở HCMUE Runner trên máy, rồi nhập mã liên kết một lần."}
              </p>
              <p className="hc-runner-help">Runner là chương trình gửi đăng ký trên máy này. Giữ máy bật, có mạng và không ngủ. Website chỉ dùng để điều khiển và xem kết quả.</p>
              {state && <p>{state.awake ? "Runner đang chạy" : "Runner đang dừng"} · {active.length} lịch đang hoạt động · Lịch đã nhận vẫn chạy khi đóng website.</p>}
              {state && !updatedRunner && <p className="hc-row-error">Runner đang là bản cũ. Dừng các lịch trước, tải bản mới ở “Cài Runner”, đóng bản cũ rồi mở bản mới để dùng kiểm tra API và diễn tập. Tài khoản và liên kết được giữ trên cùng máy.</p>}
              {devices.length > 1 && (
                <Select
                  aria-label="Chọn máy chạy"
                  value={deviceId}
                  onChange={(e) => setDeviceId(e.target.value)}
                >
                  {devices.map((d) => (
                    <option key={d.id} value={d.id}>
                      {d.name}
                    </option>
                  ))}
                </Select>
              )}
            </div>
            <div className="hc-device-actions">
              {device && !trusted && (
                <Button appearance="primary" onClick={() => setVerify(device)}>
                  Đối chiếu máy
                </Button>
              )}
              <Button
                icon={<LinkRegular />}
                disabled={busy}
                onClick={() => setPairOpen(true)}
              >
                Liên kết máy
              </Button>
              <a
                href="/hcmue-downloads/index.html"
                target="_blank"
                rel="noreferrer"
              >
                Cài Runner <OpenRegular />
              </a>
            </div>
          </section>
          {loading ? (
            <div className="hc-empty">
              <Spinner label="Đang tìm máy chạy" />
            </div>
          ) : !ready ? (
            <section className="hc-onboarding">
              <div>
                <span className="hc-step-number">01</span>
                <h3>Mở Runner trên máy</h3>
                <p>Runner giữ phiên đăng nhập và gửi trực tiếp tới HCMUE.</p>
              </div>
              <div>
                <span className="hc-step-number">02</span>
                <h3>Liên kết một lần</h3>
                <p>Nhập mã từ Runner và đối chiếu dấu vân tay thiết bị.</p>
              </div>
              <div>
                <span className="hc-step-number">03</span>
                <h3>Chuẩn bị lịch gửi</h3>
                <p>
                  Thêm tối đa {capacity} tài khoản. Máy vẫn chạy khi website
                  đóng.
                </p>
              </div>
            </section>
          ) : (
            <>
              <section id="hc-accounts" className="hc-section">
                <div className="hc-section-heading">
                  <div>
                    <h2>Tài khoản đăng ký</h2>
                    <p>
                      Chọn kỳ thi, giờ và chế độ riêng trên từng dòng. {selected.size} tài khoản đã chọn.
                    </p>
                  </div>
                  <Button
                    icon={<ArrowSyncRegular />}
                    disabled={busy}
                    onClick={() =>
                      void act(async () => setState(await request("state")))
                    }
                  >
                    Đọc trạng thái
                  </Button>
                </div>
                {!accounts.length ? (
                  <div className="hc-empty">
                    <DesktopRegular />
                    <h3>Thêm tài khoản đầu tiên</h3>
                    <p>Nhập CCCD và mật khẩu HCMUE để kiểm tra hồ sơ.</p>
                    <Button
                      appearance="primary"
                      icon={<AddRegular />}
                      onClick={() => setLoginOpen(true)}
                    >
                      Thêm tài khoản
                    </Button>
                  </div>
                ) : (
                  <div className="hc-table-scroll">
                    <table className="hc-table">
                      <thead>
                        <tr>
                          <th>
                            <Checkbox
                              aria-label="Chọn tất cả tài khoản"
                              checked={selected.size === accounts.length}
                              onChange={(_, d) =>
                                setSelected(
                                  d.checked
                                    ? new Set(accounts.map((a) => a.id))
                                    : new Set(),
                                )
                              }
                            />
                          </th>
                          <th>Thí sinh</th>
                          <th>Kỳ thi của tài khoản</th>
                          <th>Giờ gửi · Việt Nam</th>
                          <th>Chế độ và kết quả</th>
                        </tr>
                      </thead>
                      <tbody>
                        {accounts.map((a) => {
                          const run = [...schedules]
                            .reverse()
                            .find((s) => s.accountId === a.id);
                          const p = planFor(a.id), e = exams.find(x => examKey(x) === p.examKey);
                          const locked = schedules.some(s => s.accountId === a.id && activeStatus(s.status));
                          const report = inspections[a.id];
                          return (
                            <tr key={a.id} className="hc-account-row">
                              <td>
                                <Checkbox
                                  aria-label={`Chọn ${a.identity.name}`}
                                  checked={selected.has(a.id)}
                                  onChange={(_, d) =>
                                    setSelected((old) => {
                                      const n = new Set(old);
                                      d.checked ? n.add(a.id) : n.delete(a.id);
                                      return n;
                                    })
                                  }
                                />
                              </td>
                              <td>
                                <strong>{a.identity.name}</strong>
                                <small>
                                  {a.identity.maskedId} · {a.identity.email}
                                </small>
                              </td>
                              <td data-label="Kỳ thi">
                                <Select aria-label={`Kỳ thi cho ${a.identity.name}`} value={p.examKey} disabled={busy || locked || !exams.length} onChange={event => {
                                  const next = exams.find(x => examKey(x) === event.target.value);
                                  editPlan(a.id, { examKey: event.target.value, target: next ? suggestedTarget(next, p.test) : "" });
                                }}>
                                  <option value="">{exams.length ? "Chọn cấp và đợt thi" : "Tải kỳ thi trước"}</option>
                                  {exams.map(x => <option key={examKey(x)} value={examKey(x)}>{x.ten_cap_thi} · Thi {x.ngay_thi} · Mở {x.ngay_mo_dang_ky}</option>)}
                                </Select>
                                {e && <><small>{examObservation(e, now)}</small><Button appearance="transparent" size="small" onClick={() => setDetails(e)}>Xem dữ liệu trường</Button></>}
                              </td>
                              <td data-label="Giờ gửi · Việt Nam">
                                <Input aria-label={`Giờ gửi cho ${a.identity.name}`} type="datetime-local" step={1} value={p.target} disabled={busy || locked} onChange={(_, d) => editPlan(a.id, { target: d.value })} />
                                <small>{locked ? "Đã bật lịch trên máy; dừng lịch trước khi sửa." : "Chuẩn bị xong vẫn cần bật lịch."}</small>
                              </td>
                              <td data-label="Chế độ và kết quả">
                                <Select aria-label={`Chế độ cho ${a.identity.name}`} value={p.test ? "test" : "live"} disabled={busy || locked} onChange={event => {
                                  const isTest = event.target.value === "test";
                                  editPlan(a.id, { test: isTest, ...(e ? { target: suggestedTarget(e, isTest) } : {}) });
                                }}>
                                  <option value="test">Diễn tập hẹn giờ, không gửi đơn</option>
                                  <option value="live" disabled={!account.liveEnabled}>Đăng ký thật</option>
                                </Select>
                                <small className="hc-profile-ready">{a.identity.hasPhoto && a.identity.verified ? "Hồ sơ có ảnh và email xác thực" : "Hồ sơ cần hoàn thiện"}</small>
                                <span className={`hc-status hc-status-${run?.status ?? "draft"}`}>{run ? statusLabel[run.status] : "Đã đăng nhập"}</span>
                                {run && <small>Lịch gần nhất: {run.exam.ten_cap_thi} · {time(run.targetAt)} · {run.test ? "Diễn tập" : "Đăng ký thật"}</small>}
                                {run?.status === "prepared" && !matchesPlan(run, p) && <small className="hc-row-error">Thiết lập đã đổi. Chuẩn bị lại để thay lịch cũ.</small>}
                                {run?.status === "prepared" && Date.parse(run.targetAt) < now + 2500 && <small className="hc-row-error">Giờ bật lịch đã quá sát hoặc đã qua. Chọn giờ mới và chuẩn bị lại.</small>}
                                {rowErrors[a.id] && <p role="alert" className="hc-row-error">{rowErrors[a.id]}</p>}
                                {report && <details className="hc-inspection" open={report.checks.some(c => !c.ok)}>
                                  <summary>Báo cáo API · {shortTime(report.checkedAt)}</summary>
                                  <small>{report.exam.ten_cap_thi} · Đợt mở {report.exam.ngay_mo_dang_ky}</small>
                                  {report.checks.map(c => <p key={c.label} className={c.ok ? "" : "hc-row-error"}><strong>{c.label}: {c.ok ? "Đọc được" : "Lỗi"}</strong> {c.message}</p>)}
                                  <small>Chỉ đọc thông tin. Không tạo lịch hoặc gửi đăng ký.</small>
                                </details>}
                                <Button size="small" appearance="subtle" disabled={busy || locked} onClick={() => void act(async () => setState(await request("logout", { id: a.id })))}>Đăng xuất</Button>
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                )}
                {!!accounts.length && <div className="hc-compose-footer hc-account-footer">
                  <p>Kiểm tra API dùng được cả với đợt cũ. Chuẩn bị tạo lịch riêng cho từng người; chỉ gửi sau khi bật lịch và xác nhận.</p>
                  <Button disabled={busy || !chosen.length || !updatedRunner} onClick={() => void act(inspectChosen)}>Kiểm tra hồ sơ/API</Button>
                  <Button appearance="primary" disabled={busy || !chosen.length || !updatedRunner} onClick={() => void act(prepare)}>{busy && <Spinner size="tiny" />}Chuẩn bị {chosen.length || ""} tài khoản</Button>
                </div>}
              </section>
              <section className="hc-compose">
                <div className="hc-section-heading">
                  <div>
                    <h2>Kỳ thi từ trường</h2>
                    <p>
                      Giữ mọi đợt API trả về, kể cả quá hạn hoặc hết chỗ. Chọn để xem; áp dụng hàng loạt khi cần.
                    </p>
                  </div>
                  <Button icon={<ArrowSyncRegular />} disabled={busy || !accounts.length} onClick={() => void act(loadExams)}>Tải kỳ thi</Button>
                </div>
                <div className="hc-compose-fields">
                  <Field label="Kỳ thi">
                    <div className="hc-exam-select">
                      <Select
                        aria-label="Kỳ thi HCMUE"
                        value={examId}
                        disabled={!exams.length || busy}
                        onChange={(e) => {
                          setExamId(e.target.value);
                          const x = exams.find(
                            (x) => examKey(x) === e.target.value,
                          );
                          if (x)
                            setTarget(suggestedTarget(x, test));
                        }}
                      >
                        <option value="">Chọn kỳ thi</option>
                        {exams.map((e) => (
                          <option key={examKey(e)} value={examKey(e)}>
                            {e.ten_cap_thi} · Thi {e.ngay_thi} · Mở {e.ngay_mo_dang_ky}
                          </option>
                        ))}
                      </Select>
                    </div>
                  </Field>
                  <Field label="Giờ mẫu · Việt Nam">
                    <Input
                      aria-label="Giờ gửi tại Việt Nam"
                      type="datetime-local"
                      step={1}
                      value={target}
                      onChange={(_, d) => setTarget(d.value)}
                    />
                  </Field>
                  <Field label="Chế độ mẫu">
                    <Select
                      value={test ? "test" : "live"}
                      disabled={busy}
                      onChange={(e) => { const isTest = e.target.value === "test"; setTest(isTest); if (exam) setTarget(suggestedTarget(exam, isTest)); }}
                    >
                      <option value="test">Diễn tập hẹn giờ, không gửi đơn</option>
                      <option value="live" disabled={!account.liveEnabled}>
                        Live, đăng ký thật
                      </option>
                    </Select>
                  </Field>
                </div>
                {exam && <div className="hc-exam-details">
                  <dl>
                    <div><dt>Ngày thi</dt><dd>{schoolDate(exam.ngay_thi)}</dd></div>
                    <div><dt>Mở đăng ký</dt><dd>{schoolDate(exam.ngay_mo_dang_ky)}</dd></div>
                    <div><dt>Đóng đăng ký</dt><dd>{schoolDate(exam.ngay_ket_thuc_dang_ky)}</dd></div>
                    <div><dt>Số chỗ theo API</dt><dd>{exam.so_luong}/{exam.so_luong_toi_da}</dd></div>
                    <div><dt>Trạng thái gốc</dt><dd>{exam.trang_thai}</dd></div>
                    <div><dt>Lệ phí theo API</dt><dd>{Number(exam.phi).toLocaleString("vi-VN")}đ</dd></div>
                  </dl>
                  <p><strong>Nhận xét của tool:</strong> {examObservation(exam, now)}.</p>
                  <Button appearance="transparent" onClick={() => setDetails(exam)}>Xem toàn bộ dữ liệu kỳ thi</Button>
                </div>}
                <div className="hc-compose-footer">
                  <p>Mẫu chỉ thay các tài khoản đang chọn và chưa bật lịch. Bạn vẫn có thể sửa riêng từng dòng; chưa tạo lịch hoặc gửi đơn.</p>
                  <Button disabled={busy || !chosen.length || !exam} onClick={() => {
                    if (!exam) return;
                    let applied = 0;
                    for (const a of chosen) {
                      if (schedules.some(s => s.accountId === a.id && activeStatus(s.status))) continue;
                      editPlan(a.id, { examKey: examId, target, test }); applied++;
                    }
                    setNotice(`Đã áp dụng mẫu cho ${applied} tài khoản. Kiểm tra từng dòng trước khi chuẩn bị.`);
                  }}>Áp dụng mẫu cho tài khoản đã chọn</Button>
                </div>
              </section>
              <section id="hc-results" className="hc-section">
                <div className="hc-section-heading">
                  <div>
                    <h2>Lịch gửi và kết quả</h2>
                    <p>Chỉ coi là có đơn khi trường trả mã đăng ký.</p>
                  </div>
                  <div className="hc-toolbar">
                    <Button
                      icon={<StopRegular />}
                      disabled={busy || !active.length}
                      onClick={() =>
                        void act(async () => {
                          setState(await request("stop-all"));
                          setNotice(
                            "Máy đã xác nhận dừng. Các yêu cầu đã gửi vẫn cần kiểm tra kết quả.",
                          );
                        })
                      }
                    >
                      Dừng tất cả
                    </Button>
                    <Button
                      appearance="primary"
                      icon={<PlayRegular />}
                      disabled={busy || !prepared.length}
                      onClick={() => {
                        setArmSelection(prepared.map((s) => s.id));
                        setArmOpen(true);
                      }}
                    >
                      Bật {prepared.length || ""} lịch gửi
                    </Button>
                  </div>
                </div>
                {!schedules.length ? (
                  <div className="hc-empty hc-empty-small">
                    <ClockRegular />
                    <p>Lịch sẽ xuất hiện sau khi chuẩn bị tài khoản.</p>
                  </div>
                ) : (
                  <div className="hc-runs">
                    {[...schedules].reverse().map((s) => (
                      <article className="hc-run" key={s.id}>
                        <div className="hc-run-time">
                          <strong>{shortTime(s.targetAt)}</strong>
                          <small>
                            {new Date(s.targetAt).toLocaleDateString("vi-VN", {
                              timeZone: "Asia/Ho_Chi_Minh",
                            })}
                          </small>
                        </div>
                        <div className="hc-run-info">
                          <h3>
                            {s.exam.ten_cap_thi}
                            <span>{s.test ? "Diễn tập" : "Đăng ký thật"}</span>
                          </h3>
                          <p>
                            {accounts.find((a) => a.id === s.accountId)
                              ?.identity.name ?? "Tài khoản đã đăng xuất"}
                          </p>
                          <small>
                            {s.attempt.message ?? "Đã chuẩn bị, chưa bật lịch."}
                          </small>
                          {s.attempt.registrationCode && (
                            <p className="hc-result-code">
                              Mã đơn{" "}
                              <strong>{s.attempt.registrationCode}</strong>
                              {s.attempt.paymentDeadline && (
                                <small>
                                  Thanh toán trước{" "}
                                  {time(s.attempt.paymentDeadline)}
                                </small>
                              )}
                            </p>
                          )}
                        </div>
                        <div className="hc-run-measure">
                          <span className={`hc-status hc-status-${s.status}`}>
                            {statusLabel[s.status]}
                          </span>
                          {s.attempt.sentAt && (
                            <small>
                              Gửi {shortTime(s.attempt.sentAt)} · lệch{" "}
                              {s.attempt.latenessMs} ms
                            </small>
                          )}
                          {s.attempt.elapsedMs !== undefined && (
                            <small>
                              Phản hồi {(s.attempt.elapsedMs / 1000).toFixed(2)}{" "}
                              giây
                            </small>
                          )}
                        </div>
                        <div className="hc-run-actions">
                          {activeStatus(s.status) ? (
                            <Button
                              size="small"
                              icon={<StopRegular />}
                              disabled={busy}
                              onClick={() =>
                                void act(async () =>
                                  setState(await request("stop", { id: s.id })),
                                )
                              }
                            >
                              Dừng
                            </Button>
                          ) : s.status === "prepared" ? (
                            <>
                              <Button
                                size="small"
                                appearance="primary"
                                disabled={busy || !prepared.some(p => p.id === s.id)}
                                onClick={() => {
                                  setArmSelection([s.id]);
                                  setArmOpen(true);
                                }}
                              >
                                Bật lịch
                              </Button>
                              <Button
                                size="small"
                                disabled={busy}
                                onClick={() =>
                                  void act(async () =>
                                    setState(
                                      await request("stop", { id: s.id }),
                                    ),
                                  )
                                }
                              >
                                Bỏ lịch
                              </Button>
                            </>
                          ) : [
                              "uncertain",
                              "pending_payment",
                              "failed",
                            ].includes(s.status) ? (
                            <Button
                              size="small"
                              disabled={busy}
                              onClick={() =>
                                void act(async () =>
                                  setState(
                                    await request("reconcile", { id: s.id }),
                                  ),
                                )
                              }
                            >
                              Kiểm tra kết quả
                            </Button>
                          ) : null}
                        </div>
                      </article>
                    ))}
                  </div>
                )}
              </section>
            </>
          )}
          <footer className="hc-footer">
            <span>
              <ShieldCheckmarkRegular />
              Google Forms và HCMUE hoạt động độc lập.
            </span>
            <a
              href="https://hsk.hcmue.edu.vn/registered-exams"
              target="_blank"
              rel="noreferrer"
            >
              Mở lịch sử tại HCMUE <OpenRegular />
            </a>
          </footer>
        </main>
      </div>
      <Dialog
        open={pairOpen}
        onOpenChange={(_, d) => {
          setPairOpen(d.open);
          setPairCode("");
        }}
      >
        <DialogSurface>
          <DialogBody>
            <DialogTitle>Liên kết máy chạy</DialogTitle>
            <DialogContent>
              <p>Mở HCMUE Runner và sao chép mã liên kết hiển thị trên máy.</p>
              <Field label="Mã liên kết">
                <Input
                  value={pairCode}
                  onChange={(_, d) => setPairCode(d.value)}
                  autoComplete="off"
                />
              </Field>
              {error && (
                <p role="alert" className="hc-dialog-error">
                  {error}
                </p>
              )}
            </DialogContent>
            <DialogActions>
              <Button onClick={() => setPairOpen(false)}>Đóng</Button>
              <Button
                appearance="primary"
                disabled={busy || !pairCode.trim()}
                onClick={() =>
                  void act(async () => {
                    const d = await api<Device>("pair", { code: pairCode });
                    setPairOpen(false);
                    setPairCode("");
                    await refreshDevices();
                    setDeviceId(d.id);
                    setVerify(d);
                  })
                }
              >
                Liên kết
              </Button>
            </DialogActions>
          </DialogBody>
        </DialogSurface>
      </Dialog>
      <Dialog
        open={!!verify}
        onOpenChange={(_, d) => {
          if (!d.open) setVerify(undefined);
        }}
      >
        <DialogSurface>
          <DialogBody>
            <DialogTitle>Đối chiếu đúng máy của bạn</DialogTitle>
            <DialogContent>
              <p>
                Dấu vân tay dưới đây cần trùng với cửa sổ HCMUE Runner trên máy.
              </p>
              <pre className="hc-fingerprint">{verify?.fingerprint}</pre>
              <p>{verify?.name}</p>
            </DialogContent>
            <DialogActions>
              <Button onClick={() => setVerify(undefined)}>Đóng</Button>
              <Button
                appearance="primary"
                onClick={() => {
                  if (!verify) return;
                  localStorage.setItem(trustKey(verify.id), verify.fingerprint);
                  setTrusted(true);
                  trustedRef.current = true;
                  setVerify(undefined);
                }}
              >
                Đã đối chiếu, đúng máy
              </Button>
            </DialogActions>
          </DialogBody>
        </DialogSurface>
      </Dialog>
      <Dialog
        open={loginOpen}
        onOpenChange={(_, d) => {
          setLoginOpen(d.open);
          if (!d.open) setPassword("");
        }}
      >
        <DialogSurface>
          <DialogBody>
            <DialogTitle>Thêm tài khoản HCMUE</DialogTitle>
            <DialogContent>
              <p>
                Thông tin được mã hóa tới máy chạy. Mật khẩu chỉ dùng để đăng
                nhập, không được lưu.
              </p>
              <Field label="CCCD">
                <Input
                  autoComplete="off"
                  value={cccd}
                  onChange={(_, d) => setCccd(d.value)}
                />
              </Field>
              <Field label="Mật khẩu HCMUE">
                <Input
                  type="password"
                  autoComplete="off"
                  value={password}
                  onChange={(_, d) => setPassword(d.value)}
                />
              </Field>
              {error && (
                <p role="alert" className="hc-dialog-error">
                  {error}
                </p>
              )}
            </DialogContent>
            <DialogActions>
              <Button
                disabled={busy}
                onClick={() => {
                  setLoginOpen(false);
                  setPassword("");
                }}
              >
                Đóng
              </Button>
              <Button
                appearance="primary"
                disabled={busy || !cccd || !password}
                onClick={() =>
                  void act(async () => {
                    const secret = password;
                    setPassword("");
                    setState(
                      await request("login", { cccd, password: secret }),
                    );
                    setCccd("");
                    setLoginOpen(false);
                    setNotice("Đã đăng nhập và kiểm tra hồ sơ trên máy.");
                  })
                }
              >
                {busy ? "Đang đăng nhập" : "Đăng nhập"}
              </Button>
            </DialogActions>
          </DialogBody>
        </DialogSurface>
      </Dialog>
      <Dialog open={armOpen} onOpenChange={(_, d) => setArmOpen(d.open)}>
        <DialogSurface>
          <DialogBody>
            <DialogTitle>Bật {arming.length} lịch trên máy?</DialogTitle>
            <DialogContent>
              <p>
                Thiết bị {device?.name} sẽ thực hiện đúng giờ đã đặt. Lịch vẫn chạy
                khi đóng website.
              </p>
              <div className="hc-confirm-list">
                {arming.map((s) => (
                  <p key={s.id}>
                    <strong>{s.exam.ten_cap_thi}</strong> · {time(s.targetAt)} ·{" "}
                    {s.test ? "Diễn tập, không gửi đơn" : "Đăng ký thật"}
                  </p>
                ))}
              </div>
              <p>
                Giữ Runner hoạt động và máy có mạng. Khi website mất kết nối,
                dùng Dừng tất cả trực tiếp trên máy.
              </p>
              {error && (
                <p role="alert" className="hc-dialog-error">
                  {error}
                </p>
              )}
            </DialogContent>
            <DialogActions>
              <Button onClick={() => setArmOpen(false)}>Chưa bật</Button>
              <Button
                appearance="primary"
                disabled={busy || !arming.length}
                onClick={() =>
                  void act(async () => {
                    setState(
                      await request("arm", { ids: arming.map((s) => s.id) }),
                    );
                    setArmOpen(false);
                    setNotice(
                      "Máy đã nhận và lưu lịch. Sẵn sàng thực hiện đúng giờ.",
                    );
                  })
                }
              >
                Xác nhận bật lịch
              </Button>
            </DialogActions>
          </DialogBody>
        </DialogSurface>
      </Dialog>
      <Dialog open={!!details} onOpenChange={(_, d) => { if (!d.open) setDetails(undefined); }}>
        <DialogSurface><DialogBody>
          <DialogTitle>Dữ liệu kỳ thi từ HCMUE</DialogTitle>
          <DialogContent><p>Giữ nguyên các trường API trả về. Nhận xét của tool được hiển thị riêng trên website.</p><pre className="hc-api-data">{JSON.stringify(details, null, 2)}</pre></DialogContent>
          <DialogActions><Button onClick={() => setDetails(undefined)}>Đóng</Button></DialogActions>
        </DialogBody></DialogSurface>
      </Dialog>
      <Dialog
        open={!!questionDraft}
        onOpenChange={(_, d) => {
          if (!d.open) setQuestionDraft(undefined);
        }}
      >
        <DialogSurface>
          <DialogBody>
            <DialogTitle>Câu hỏi bổ sung của kỳ thi</DialogTitle>
            <DialogContent>
              {questionDraft?.map((d, index) => (
                <section key={d.accountId}>
                  <h3>
                    {accounts.find((a) => a.id === d.accountId)?.identity.name}
                  </h3>
                  <p>{exams.find(e => examKey(e) === d.args.examKey)?.ten_cap_thi} · {d.args.test ? "Diễn tập" : "Đăng ký thật"}</p>
                  {rowErrors[d.accountId] && <p role="alert" className="hc-row-error">{rowErrors[d.accountId]}</p>}
                  {d.q.questions.map((q) => (
                    <Field key={q.ma_cau_hoi} label={q.noi_dung}>
                      <Select
                        value={d.answers[q.ma_cau_hoi] ?? ""}
                        onChange={(e) => {
                          const value = e.target.value;
                          setQuestionDraft((old) =>
                            old?.map((x, i) =>
                              i === index
                                ? {
                                    ...x,
                                    answers: {
                                      ...x.answers,
                                      [q.ma_cau_hoi]: value,
                                    },
                                  }
                                : x,
                            ),
                          );
                        }}
                      >
                        <option value="">Chọn câu trả lời</option>
                        {q.cau_tra_loi.map((a) => (
                          <option
                            key={a.ma_cau_tra_loi}
                            value={String(a.ma_cau_tra_loi)}
                          >
                            {a.noi_dung}
                          </option>
                        ))}
                      </Select>
                    </Field>
                  ))}
                </section>
              ))}
            </DialogContent>
            <DialogActions>
              <Button onClick={() => setQuestionDraft(undefined)}>Đóng</Button>
              <Button
                appearance="primary"
                disabled={busy}
                onClick={() =>
                  void act(async () => {
                    const failed: NonNullable<typeof questionDraft> = [];
                    const completed = await eachAccount(questionDraft ?? [], async d => {
                      setState(await request("prepare", { ...d.args, answers: d.answers }));
                      setRowErrors(old => ({ ...old, [d.accountId]: "" }));
                    }, (d, message) => { failed.push(d); failRow({ id: d.accountId }, message); });
                    setQuestionDraft(failed.length ? failed : undefined);
                    setNotice(`Đã chuẩn bị ${completed} lịch. ${failed.length ? "Tài khoản lỗi giữ lại câu trả lời; xem lỗi trên từng dòng." : "Bật lịch để máy thực hiện."}`);
                  })
                }
              >
                Lưu và chuẩn bị
              </Button>
            </DialogActions>
          </DialogBody>
        </DialogSurface>
      </Dialog>
    </FluentProvider>
  );
}
