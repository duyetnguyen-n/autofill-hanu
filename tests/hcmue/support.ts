import { Engine, freshData } from "../../integrations/hcmue/runner/engine";
import type { HcmueClient } from "../../integrations/hcmue/runner/client";
import {
  examKey,
  type Exam,
  type Limits,
} from "../../integrations/hcmue/protocol";
export const identity = {
  key: "fixture-identity",
  name: "Nguyễn Minh An",
  maskedId: "•••• 1234",
  email: "an@example.test",
  hasPhoto: true,
  verified: true,
};
export const limits: Limits = {
  maxAccounts: 20,
  maxConcurrent: 20,
  liveEnabled: true,
  expiresAt: Date.now() + 86400000,
};
export const exam: Exam = {
  ma_cap_thi: "HSK4_D1",
  ten_cap_thi: "HSK 4 + HSKK trung cấp",
  ngay_mo_dang_ky: "2026-01-01 09:00:00",
  ngay_ket_thuc_dang_ky: "2099-01-01 12:00:00",
  ngay_thi: "2026-12-06",
  hasRegisterCode: 0,
  trang_thai: "open",
  so_luong: 0,
  so_luong_toi_da: 400,
  phi: 1550000,
  dia_diem_code: "HCMUE",
};
export class FakeClient {
  constructor(public who = identity) {}
  submits: unknown[] = [];
  closed = false;
  registered = false;
  conflicting = false;
  q: any = { success: true, open_exam: { hasRegisterCode: 0 }, questions: [] };
  result: any = { status: "success", data: "FIXTURE-0001" };
  async login(_cccd: string, _password: string) {
    return {
      token: "fixture-token",
      deviceId: "fixture-device",
      cookies: "{}",
      identity: this.who,
    };
  }
  async profile() {
    return this.who;
  }
  async exams() {
    return [exam];
  }
  async questions() {
    return structuredClone(this.q);
  }
  async registration() {
    return {
      isRegistered: this.registered,
      registration: this.registered
        ? {
            ma_dang_ky: "FIXTURE-0001",
            order_expire_at_hien_thi: "2026-12-06 23:00:00",
          }
        : undefined,
    };
  }
  async conflict() {
    return { hasConflict: this.conflicting };
  }
  async submit(body: unknown) {
    this.submits.push(body);
    if (this.result instanceof Error) throw this.result;
    this.registered = this.result.status === "success";
    return this.result;
  }
  async job() {
    this.registered = true;
    return { data: { jobStatus: "completed", ma_dang_ky: "FIXTURE-0001" } };
  }
  close() {
    this.closed = true;
  }
}
export async function fixtureEngine(write = async (_: any) => {}) {
  const data = await freshData("Máy kiểm thử"),
    client = new FakeClient();
  data.accounts = [
    {
      view: { id: "account-1", identity, loggedIn: true },
      session: {
        token: "fixture-token",
        deviceId: "fixture-device",
        cookies: "{}",
        identity,
      },
    },
  ];
  const engine = new Engine(
    data,
    { write },
    () => client as unknown as HcmueClient,
  );
  return {
    data,
    client,
    engine,
    async prepare(test = true, targetAt = Date.now() + 7000) {
      await engine.execute(
        "prepare",
        {
          accountId: "account-1",
          examKey: examKey(exam),
          targetAt,
          answers: {},
          test,
        },
        { ...limits, expiresAt: Date.now() + 86400000 },
      );
      return data.schedules.at(-1)!;
    },
    async arm(id: string, extra: Partial<Limits> = {}) {
      return engine.execute(
        "arm",
        { ids: [id] },
        { ...limits, expiresAt: Date.now() + 86400000, ...extra },
      );
    },
  };
}
