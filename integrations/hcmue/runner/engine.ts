import { randomUUID } from "node:crypto";
import { performance } from "node:perf_hooks";
import { atDeadline } from "./deadline";
import { HcmueClient, ApiFailure, type Session } from "./client";
import { identityKeys, fingerprint } from "../crypto";
import {
  MAX_ACCOUNTS,
  activeStatus,
  examKey,
  schoolTime,
  payload,
  questionSignature,
  scheduleProblem,
  type Inspection,
  type RunnerState,
  type Schedule,
  type Exam,
  type Questions,
  type Limits,
  type Command,
  type HcmueAccount,
} from "../protocol";
export interface RunnerData {
  deviceId: string;
  name: string;
  keys: { publicKey: JsonWebKey; privateKey: JsonWebKey };
  accounts: { view: HcmueAccount; session: Session }[];
  schedules: Schedule[];
  cloud?: { origin: string; token: string; owner?: string };
  seen: string[];
}
export interface Persistence {
  write(value: RunnerData): Promise<void>;
}
export async function freshData(name: string): Promise<RunnerData> {
  return {
    deviceId: randomUUID(),
    name,
    keys: await identityKeys(),
    accounts: [],
    schedules: [],
    seen: [],
  };
}
const delay = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));
export class Engine {
  private clients = new Map<string, HcmueClient>();
  private bodies = new Map<string, unknown>();
  private timers = new Map<string, () => void>();
  private generation = new Map<string, number>();
  private tail = Promise.resolve();
  private closing = false;
  private lag = 0;
  private healthTimer: ReturnType<typeof setInterval>;
  private lastWall = Date.now();
  private lastMono = performance.now();
  private mutateTail = Promise.resolve();
  constructor(
    public data: RunnerData,
    private persistence: Persistence,
    private factory: (s?: Session) => HcmueClient = (s) => new HcmueClient(s),
    private changed: () => void = () => {},
  ) {
    for (const a of data.accounts)
      this.clients.set(a.view.id, factory(a.session));
    for (const s of data.schedules) {
      if (["reserved", "sending", "queued"].includes(s.status))
        s.status = "uncertain";
      else if (s.status === "armed") {
        s.status = "stopped";
        s.attempt.message =
          "Runner đã khởi động lại. Chuẩn bị và bật lịch lại.";
      }
    }
    this.healthTimer = setInterval(() => {
      const w = Date.now(),
        m = performance.now(),
        gap = m - this.lastMono;
      this.lag = Math.max(0, gap - 1000);
      if (Math.abs(w - this.lastWall - gap) > 100 || gap > 3000) {
        for (const s of this.data.schedules)
          if (["armed", "reserved"].includes(s.status))
            this.stop(s, "Đồng hồ hoặc trạng thái ngủ máy thay đổi.");
      }
      this.lastWall = w;
      this.lastMono = m;
    }, 1000);
  }
  snapshot(): RunnerState {
    return structuredClone({
      protocolVersion: 2,
      deviceId: this.data.deviceId,
      name: this.data.name,
      platform: process.platform,
      accounts: this.data.accounts.map((a) => a.view),
      schedules: this.data.schedules,
      now: new Date().toISOString(),
      eventLoopLagMs: Math.round(this.lag),
      awake: !this.closing,
    });
  }
  private save() {
    const snapshot = structuredClone(this.data);
    const operation = this.tail.then(() => this.persistence.write(snapshot));
    this.tail = operation.catch(() => {});
    return operation;
  }
  persist() {
    return this.save();
  }
  private async update(
    s: Schedule,
    status: Schedule["status"],
    message?: string,
  ) {
    s.status = status;
    if (message) s.attempt.message = message;
    await this.save();
    this.changed();
  }
  private account(id: string) {
    const a = this.data.accounts.find((a) => a.view.id === id);
    if (!a || !a.view.loggedIn) throw new Error("Tài khoản chưa đăng nhập.");
    return a;
  }
  private client(id: string) {
    this.account(id);
    const client = this.clients.get(id);
    if (!client) throw new Error("Cần đăng nhập lại.");
    return client;
  }
  private schedule(id: string) {
    const s = this.data.schedules.find((s) => s.id === id);
    if (!s) throw new Error("Không tìm thấy lịch.");
    return s;
  }
  private stop(s: Schedule, message = "Đã dừng trên máy.") {
    this.generation.set(s.id, (this.generation.get(s.id) ?? 0) + 1);
    this.timers.get(s.id)?.();
    this.timers.delete(s.id);
    if (["sending", "queued", "uncertain"].includes(s.status)) {
      s.status = "uncertain";
      s.attempt.message =
        "Đã dừng theo dõi. Yêu cầu đã gửi cần kiểm tra kết quả.";
    } else if (s.status !== "pending_payment") {
      s.status = "stopped";
      s.attempt.message = message;
    }
    void this.save().catch(() => {});
    this.changed();
  }
  async execute(
    command: Command,
    args: Record<string, unknown>,
    limits: Limits,
  ) {
    if (command === "state") return this.snapshot();
    if (command === "stop-all") {
      for (const s of this.data.schedules)
        if (activeStatus(s.status)) this.stop(s);
      await this.save();
      return this.snapshot();
    }
    if (command === "stop") {
      this.stop(this.schedule(String(args.id)));
      await this.save();
      return this.snapshot();
    }
    if (command === "reconcile") {
      const s = this.schedule(String(args.id));
      if (activeStatus(s.status)) throw new Error("Đang tự theo dõi.");
      await this.reconcile(s, false);
      return this.snapshot();
    }
    if (this.closing) throw new Error("Runner đang đóng.");
    // Serialize configuration mutations, never serialize scheduled POSTs.
    let release!: () => void;
    const before = this.mutateTail;
    this.mutateTail = new Promise<void>((r) => {
      release = r;
    });
    await before;
    try {
      if (this.closing) throw new Error("Runner đang đóng.");
      return await this.configure(command, args, limits);
    } finally {
      release();
    }
  }
  private async configure(
    command: Command,
    args: Record<string, unknown>,
    limits: Limits,
  ): Promise<unknown> {
    if (command === "login") {
      if (
        this.data.accounts.length >=
          Math.min(MAX_ACCOUNTS, limits.maxAccounts) &&
        !args.id
      )
        throw new Error("Đã đạt giới hạn tài khoản.");
      if (
        typeof args.cccd !== "string" ||
        !/^\d{9,12}$/.test(args.cccd) ||
        typeof args.password !== "string" ||
        args.password.length > 256
      )
        throw new Error("Nhập CCCD và mật khẩu hợp lệ.");
      const client = this.factory();
      let session: Session;
      try {
        session = await client.login(args.cccd, args.password);
      } catch (e) {
        client.close();
        throw e;
      } finally {
        args.password = "";
      }
      const old = this.data.accounts.find(
        (a) => a.session.identity.key === session.identity.key,
      );
      if (
        this.data.schedules.some(
          (s) => s.accountId === old?.view.id && activeStatus(s.status),
        )
      ) {
        client.close();
        throw new Error("Dừng lịch đang hoạt động trước khi đăng nhập lại.");
      }
      const id =
        old?.view.id ??
        this.data.schedules.find((s) => s.accountKey === session.identity.key)
          ?.accountId ??
        randomUUID();
      if (old) {
        this.clients.get(id)?.close();
        this.data.accounts = this.data.accounts.filter((a) => a.view.id !== id);
      } else if (
        this.data.accounts.length >= Math.min(MAX_ACCOUNTS, limits.maxAccounts)
      ) {
        client.close();
        throw new Error("Đã đạt giới hạn tài khoản.");
      }
      this.clients.set(id, client);
      this.data.accounts.push({
        view: { id, identity: session.identity, loggedIn: true },
        session,
      });
      await this.save();
      return this.snapshot();
    }
    if (command === "logout" || command === "remove") {
      const id = String(args.id);
      if (
        this.data.schedules.some(
          (s) => s.accountId === id && activeStatus(s.status),
        )
      )
        throw new Error("Dừng các lịch của tài khoản trước.");
      this.clients.get(id)?.close();
      this.clients.delete(id);
      this.data.accounts = this.data.accounts.filter((a) => a.view.id !== id);
      await this.save();
      return this.snapshot();
    }
    if (command === "exams") {
      return this.client(String(args.accountId)).exams(
        String(args.date ?? ""),
        String(args.location ?? "HCMUE"),
      );
    }
    if (command === "prepare" || command === "inspect") {
      const accountId = String(args.accountId),
        client = this.client(accountId),
        exams = await client.exams(
          String(args.date ?? ""),
          String(args.location ?? "HCMUE"),
        );
      const exam = exams.find((e) => examKey(e) === args.examKey);
      if (!exam) throw new Error("Không còn kỳ thi đã chọn.");
      if (command === "inspect") {
        const checks = await Promise.all([
          (async () => {
            const identity = await client.profile();
            if (identity.key !== this.account(accountId).view.identity.key) throw new Error("Tài khoản đã thay đổi. Đăng nhập lại.");
            const missing = [!identity.hasPhoto && "thiếu ảnh thẻ", !identity.verified && "chưa xác thực email"].filter(Boolean);
            return { label: "Hồ sơ", ok: true, message: missing.length ? `API đọc được; ${missing.join(", ")}.` : "API đọc được; có ảnh thẻ và email đã xác thực." };
          })().catch(e => ({ label: "Hồ sơ", ok: false, message: (e as Error).message })),
          client.questions(exam).then(q => {
            questionSignature(q);
            return { label: "Câu hỏi", ok: true, message: `Đọc được ${q.questions.length} câu hỏi bổ sung.` };
          }).catch(e => ({ label: "Câu hỏi", ok: false, message: (e as Error).message })),
          client.registration(exam).then(r => ({ label: "Đăng ký cũ", ok: true, message: r.isRegistered ? "Trường trả đã có đăng ký cho đợt này." : "Trường trả chưa có đăng ký cho đợt này." })).catch(e => ({ label: "Đăng ký cũ", ok: false, message: (e as Error).message })),
          client.conflict(exam).then(c => ({ label: "Trùng lịch", ok: true, message: c.hasConflict ? "Trường trả có xung đột lịch/địa điểm." : "Trường trả không có xung đột lịch/địa điểm." })).catch(e => ({ label: "Trùng lịch", ok: false, message: (e as Error).message })),
        ]);
        return { checkedAt: new Date().toISOString(), exam, checks } satisfies Inspection;
      }
      const starts = schoolTime(exam.ngay_mo_dang_ky);
      let target = Number(args.targetAt);
      if (args.runNow === true) target = args.test === true ? Date.now() + 7000 : Math.max(Date.now() + 7000, starts);
      const problem = scheduleProblem(exam, target, Date.now(), args.test === true);
      if (problem) throw new Error(problem);
      if (
        this.data.schedules.some(
          (s) =>
            (s.accountId === accountId ||
              s.accountKey === this.account(accountId).view.identity.key) &&
            examKey(s.exam) === examKey(exam) &&
            ([
              "armed",
              "reserved",
              "sending",
              "queued",
              "uncertain",
              "pending_payment",
            ].includes(s.status) ||
              (s.attempt.count > 0 && !s.test)),
        )
      )
        throw new Error(
          "Đợt này đã có lịch hoặc khóa gửi. Kiểm tra lịch sử trước.",
        );
      const identity = await client.profile();
      if (identity.key !== this.account(accountId).view.identity.key)
        throw new Error("Tài khoản đã thay đổi.");
      if (!identity.hasPhoto || !identity.verified)
        throw new Error(
          "Hoàn tất ảnh thẻ và xác thực email trên trang trường.",
        );
      const [q, registration, conflict] = await Promise.all([
        client.questions(exam),
        client.registration(exam),
        client.conflict(exam),
      ]);
      questionSignature(q);
      if (registration.isRegistered && args.test !== true)
        throw new Error("Tài khoản đã đăng ký kỳ thi này.");
      if (conflict.hasConflict && args.test !== true)
        throw new Error("Tài khoản có xung đột lịch hoặc địa điểm.");
      if (args.answers === undefined) return { exam, questions: q, identity };
      if (target < Date.now() + 6000)
        throw new Error(
          "Giờ gửi quá sát sau khi kiểm tra. Chọn lại giờ và chuẩn bị.",
        );
      const answers = args.answers as Record<string, string>;
      payload(exam, q, answers);
      const s: Schedule = {
        id: randomUUID(),
        accountId,
        accountKey: this.account(accountId).view.identity.key,
        exam,
        targetAt: new Date(target).toISOString(),
        answers,
        questionSignature: questionSignature(q),
        status: "prepared",
        version: 1,
        attempt: { count: 0 },
        preparedAt: Date.now(),
        expiresAt: target + 600000,
        test: args.test === true,
      };
      for (const previous of this.data.schedules)
        if (
          previous.accountId === accountId &&
          previous.status === "prepared"
        ) {
          previous.status = "stopped";
          previous.attempt.message = "Được thay bằng lịch chuẩn bị mới.";
        }
      this.data.schedules.push(s);
      await this.save();
      return this.snapshot();
    }
    if (command === "arm") {
      const ids = Array.isArray(args.ids) ? args.ids.map(String) : [];
      if (!ids.length || new Set(ids).size !== ids.length)
        throw new Error("Chọn lịch khác nhau để bật.");
      const selected = ids.map((id) => this.schedule(id));
      const active = this.data.schedules.filter((s) => activeStatus(s.status));
      if (
        active.length + selected.length >
        Math.min(MAX_ACCOUNTS, limits.maxConcurrent)
      )
        throw new Error("Vượt giới hạn lịch chạy đồng thời.");
      if (!limits.liveEnabled && selected.some((s) => !s.test))
        throw new Error("Tài khoản website chưa có quyền Live.");
      const accountIds = new Set(active.map((s) => s.accountId));
      for (const s of selected) {
        if (
          s.status !== "prepared" ||
          Date.parse(s.targetAt) < Date.now() + 2500 ||
          Date.parse(s.targetAt) > limits.expiresAt ||
          s.attempt.count
        )
          throw new Error("Lịch chưa sẵn sàng hoặc quá sát giờ.");
        if (accountIds.has(s.accountId))
          throw new Error(
            "Mỗi tài khoản chỉ được bật một lịch tại một thời điểm.",
          );
        accountIds.add(s.accountId);
      }
      for (const s of selected) {
        s.status = "armed";
        s.attempt.message = "Đã bật lịch trên máy. Chờ đến giờ gửi.";
        s.version++;
        s.expiresAt = Math.min(s.expiresAt, limits.expiresAt);
      }
      try {
        await this.save();
      } catch (e) {
        for (const s of selected) s.status = "prepared";
        throw e;
      }
      for (const s of selected) this.install(s);
      return this.snapshot();
    }
    throw new Error("Lệnh không hỗ trợ.");
  }
  private install(s: Schedule) {
    const generation = (this.generation.get(s.id) ?? 0) + 1;
    this.generation.set(s.id, generation);
    const remaining = Date.parse(s.targetAt) - Date.now(),
      deadline = performance.now() + remaining;
    const valid = () =>
      !this.closing &&
      this.generation.get(s.id) === generation &&
      ["armed", "reserved"].includes(s.status);
    const step = (offset: number, fn: () => Promise<void>) => {
      const wait = remaining - offset;
      if (wait <= 0) return;
      setTimeout(
        () => {
          if (valid())
            void fn().catch((e) =>
              valid()
                ? this.update(s, "failed", (e as Error).message).catch(() => {})
                : undefined,
            );
        },
        Math.min(wait, 2147483647),
      );
    };
    if (remaining > 35000) step(30000, () => this.preflight(s));
    const prepareAt = Math.max(0, remaining - 5000);
    const prepareTimer = setTimeout(() => {
      if (!valid()) return;
      void this.preflight(s)
        .then(async () => {
          if (!valid()) return;
          const body = payload(
            s.exam,
            JSON.parse(s.questionSignature),
            s.answers,
          );
          s.status = "reserved";
          s.attempt.message = "Đã kiểm tra và lưu lịch trước giờ gửi.";
          await this.save();
          if (!valid()) return;
          if (performance.now() > deadline - 2000)
            throw new Error(
              "Không lưu xong lịch trước giờ gửi 2 giây. Chuẩn bị lại.",
            );
          this.bodies.set(s.id, body);
          this.changed();
        })
        .catch((e) =>
          valid()
            ? this.update(s, "failed", (e as Error).message).catch(() => {})
            : undefined,
        );
    }, prepareAt);
    this.timers.set(
      s.id,
      atDeadline(deadline, () => {
        if (!valid()) return;
        clearTimeout(prepareTimer);
        if (
          Math.abs(Date.now() - Date.parse(s.targetAt)) > 100 ||
          s.status !== "reserved" ||
          !this.bodies.has(s.id)
        ) {
          void this.update(
            s,
            "failed",
            "Chưa sẵn sàng hoặc đồng hồ thay đổi trước giờ gửi.",
          ).catch(() => {});
          return;
        }
        // No disk/cloud await occurs in this dispatch callback.
        void this.dispatch(s, generation).catch(() =>
          this.update(
            s,
            "uncertain",
            "Không lưu hoặc xác nhận được kết quả.",
          ).catch(() => {}),
        );
      }),
    );
  }
  private async preflight(s: Schedule) {
    const client = this.client(s.accountId),
      [identity, exams, q, r, c] = await Promise.all([
        client.profile(),
        client.exams("", s.exam.dia_diem_code ?? "HCMUE"),
        client.questions(s.exam),
        client.registration(s.exam),
        client.conflict(s.exam),
      ]);
    if (
      identity.key !== this.account(s.accountId).view.identity.key ||
      !identity.hasPhoto ||
      !identity.verified
    )
      throw new Error("Hồ sơ hoặc phiên không còn sẵn sàng.");
    const exam = exams.find((e) => examKey(e) === examKey(s.exam));
    if (
      !exam ||
      exam.hasRegisterCode !== 0 ||
      (!s.test && (!["open", "upcoming"].includes(exam.trang_thai) ||
      Number(exam.so_luong) >= Number(exam.so_luong_toi_da)))
    )
      throw new Error("Kỳ thi đã thay đổi hoặc hết chỗ.");
    if (questionSignature(q) !== s.questionSignature)
      throw new Error("Câu hỏi đã thay đổi. Chuẩn bị lại.");
    if (r.isRegistered && !s.test) throw new Error("Đã có đăng ký trên trường.");
    if (c.hasConflict && !s.test)
      throw new Error("Phát hiện xung đột lịch hoặc địa điểm.");
  }
  private async dispatch(s: Schedule, generation: number): Promise<void> {
    if (this.closing || this.generation.get(s.id) !== generation) return;
    if (
      Date.now() < Date.parse(s.targetAt) ||
      (!s.test && Date.now() < schoolTime(s.exam.ngay_mo_dang_ky)) ||
      Date.now() > s.expiresAt
    ) {
      await this.update(s, "failed", "Đã ngoài thời gian cho phép gửi.");
      return;
    }
    const client = this.client(s.accountId);
    s.status = "sending";
    s.attempt = {
      count: s.attempt.count + 1,
      sentAt: new Date().toISOString(),
      latenessMs: Date.now() - Date.parse(s.targetAt),
    };
    this.changed();
    if (s.test) {
      s.attempt.receivedAt = new Date().toISOString();
      s.attempt.elapsedMs = 0;
      await this.update(
        s,
        "stopped",
        "Kiểm tra hoàn tất. Không gọi API gửi đăng ký.",
      );
      return;
    }
    const start = performance.now();
    let response: any;
    try {
      response = await client.submit(this.bodies.get(s.id));
      s.attempt.httpStatus = 200;
    } catch (e) {
      if (e instanceof ApiFailure) {
        s.attempt.httpStatus = e.status;
        if (
          !e.mayHaveSent &&
          s.attempt.count < 2 &&
          this.generation.get(s.id) === generation &&
          Date.now() < schoolTime(s.exam.ngay_ket_thuc_dang_ky)
        ) {
          await delay(500);
          return this.dispatch(s, generation);
        }
        if (e.response?.code === "EXAM_FULL") {
          await this.update(s, "failed", "Trường báo đã hết chỗ.");
          return;
        }
        if (e.response?.code === "DUPLICATE_REGISTRATION") {
          await this.update(s, "uncertain", "Đã có đăng ký. Đang đối chiếu.");
          await this.reconcile(s, true, generation);
          return;
        }
      }
      await this.update(
        s,
        "uncertain",
        "Phản hồi chưa rõ. Đang kiểm tra kết quả, không gửi lặp.",
      );
      await this.reconcile(s, true, generation);
      return;
    }
    s.attempt.elapsedMs = Math.round(performance.now() - start);
    s.attempt.receivedAt = new Date().toISOString();
    if (response.status === "success") {
      const code =
        typeof response.data === "string"
          ? response.data
          : (response.ma_dang_ky ?? response.data?.ma_dang_ky);
      if (code) {
        s.attempt.registrationCode = String(code);
        await this.update(
          s,
          "pending_payment",
          "Trường trả mã đăng ký. Đang kiểm tra hạn thanh toán.",
        );
        await this.reconcile(s, false);
        return;
      }
    }
    if (response.status === "queued" && response.jobId) {
      s.attempt.jobId = String(response.jobId);
      await this.update(s, "queued", "Đã vào hàng đợi, chưa xác nhận slot.");
      await this.poll(s, generation);
      return;
    }
    if (response.code === "EXAM_FULL") {
      await this.update(s, "failed", "Trường báo đã hết chỗ.");
      return;
    }
    await this.update(s, "uncertain", "Cần đối chiếu kết quả đăng ký.");
    await this.reconcile(s, true, generation);
  }
  private async poll(s: Schedule, generation: number) {
    const until = Date.now() + 120000;
    let next = 1000;
    while (
      Date.now() < until &&
      !this.closing &&
      this.generation.get(s.id) === generation
    ) {
      await delay(next);
      if (this.closing || this.generation.get(s.id) !== generation) return;
      try {
        const r = await this.client(s.accountId).job(s.attempt.jobId!);
        const state = String(r.data?.jobStatus ?? "").toLowerCase();
        if (state === "completed" && r.data.ma_dang_ky) {
          s.attempt.registrationCode = String(r.data.ma_dang_ky);
          await this.update(s, "pending_payment", "Đã có mã đăng ký.");
          await this.reconcile(s, false);
          return;
        }
        if (state === "failed") {
          await this.update(
            s,
            "failed",
            "Trường báo yêu cầu trong hàng đợi thất bại.",
          );
          return;
        }
      } catch (e) {
        if (e instanceof ApiFailure && e.retryAfterMs)
          next = Math.min(60000, Math.max(next, e.retryAfterMs));
      }
      if (Date.now() > until - 110000) next = Math.max(next, 2000);
    }
    if (s.status !== "pending_payment")
      await this.update(
        s,
        "uncertain",
        "Hàng đợi chưa có kết quả cuối. Bấm Kiểm tra kết quả.",
      );
  }
  private async reconcile(s: Schedule, repeat: boolean, generation?: number) {
    const offsets = repeat
      ? [0, 1000, 2000, 4000, 8000, 16000, 30000, 60000]
      : [0];
    const start = Date.now();
    for (const offset of offsets) {
      await delay(Math.max(0, start + offset - Date.now()));
      if (
        this.closing ||
        (generation !== undefined && this.generation.get(s.id) !== generation)
      )
        return;
      try {
        const r = await this.client(s.accountId).registration(s.exam);
        if (r.isRegistered && r.registration?.ma_dang_ky) {
          s.attempt.registrationCode = String(r.registration.ma_dang_ky);
          const dates = [
            r.registration.order_expire_at_hien_thi,
            r.registration.ngay_het_han_hien_thi,
          ]
            .filter((d: any) => typeof d === "string")
            .map(schoolTime)
            .filter(Number.isFinite);
          if (dates.length)
            s.attempt.paymentDeadline = new Date(
              Math.min(...dates),
            ).toISOString();
          await this.update(
            s,
            "pending_payment",
            "Đã xác minh đăng ký trên trường. Thanh toán tại website HCMUE.",
          );
          return;
        }
      } catch {}
    }
    if (s.status !== "pending_payment")
      await this.update(
        s,
        "uncertain",
        "Chưa đủ bằng chứng kết quả. Không tự gửi lại.",
      );
  }
  async revoke() {
    this.closing = true;
    for (const s of this.data.schedules)
      if (activeStatus(s.status)) this.stop(s);
    await this.mutateTail;
    for (const c of this.clients.values()) c.close();
    this.clients.clear();
    this.data.accounts = [];
    this.data.schedules = [];
    this.data.cloud = undefined;
    await this.save();
    this.changed();
  }
  async close() {
    this.closing = true;
    clearInterval(this.healthTimer);
    for (const cancel of this.timers.values()) cancel();
    for (const s of this.data.schedules)
      if (["armed", "reserved"].includes(s.status))
        this.stop(s, "Runner đã đóng.");
    await this.save();
    for (const c of this.clients.values()) c.close();
  }
  async identity() {
    return {
      id: this.data.deviceId,
      name: this.data.name,
      platform: process.platform,
      publicKey: this.data.keys.publicKey,
      fingerprint: await fingerprint(this.data.keys.publicKey),
    };
  }
}
