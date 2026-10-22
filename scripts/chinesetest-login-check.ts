// Read-only live API validation. The human enters credentials and completes verification.
import { createInterface } from "node:readline/promises";
import { join } from "node:path";
import { Engine, freshData, type RunnerData } from "../integrations/chinesetest/runner/engine";
import { Vault, systemKey, runnerDirectory } from "../integrations/chinesetest/runner/vault";
const dir = runnerDirectory(), vault = new Vault<RunnerData>(join(dir, "state.enc"), await systemKey(dir));
const data = await vault.load(() => null as unknown as RunnerData) || await freshData("Máy ChineseTest");
const engine = new Engine(data, vault);
const limits = { maxAccounts: 20, maxConcurrent: 20, liveEnabled: false, expiresAt: Date.now() + 600000 };
const rl = createInterface({ input: process.stdin, output: process.stdout });
try {
  await engine.execute("login", {}, limits);
  console.log("LOGIN_WINDOW_READY: Hãy tự đăng nhập ChineseTest trong cửa sổ Chrome vừa mở.");
  while (true) {
    await rl.question("Khi đăng nhập xong, nhấn Enter để kiểm tra API đọc (không tạo đăng ký): ");
    try {
      const result = await engine.execute("finish-login", {}, limits);
      console.log(JSON.stringify({ authenticatedApi: true, hasSavedCandidate: Boolean(result.personal.ksEName), hasUploadedPhoto: Boolean(result.personal.photo), accountCount: engine.snapshot().accounts.length, registrationPostCount: 0 }));
      break;
    } catch (e) { console.log((e as Error).message); }
  }
} finally { rl.close(); await engine.close(); }
