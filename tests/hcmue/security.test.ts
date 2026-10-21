import { it, expect } from "vitest";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomBytes } from "node:crypto";
import {
  box,
  unbox,
  identityKeys,
  newReplyKey,
  seal,
  open,
  fingerprint,
} from "../../integrations/hcmue/crypto";
import {
  payload,
  questionSignature,
  schoolTime,
} from "../../integrations/hcmue/protocol";
import { Vault } from "../../integrations/hcmue/runner/vault";
import { exam } from "./support";
it("encrypts browser credentials and binds ciphertext to the command ID", async () => {
  const keys = await identityKeys(),
    message = { password: "fixture-only" },
    encrypted = await box(keys.publicKey, message, "command-1");
  expect(JSON.stringify(encrypted)).not.toContain(message.password);
  expect(await unbox(keys.privateKey, encrypted, "command-1")).toEqual(message);
  await expect(
    unbox(keys.privateKey, encrypted, "command-2"),
  ).rejects.toThrow();
  const replyKey = newReplyKey(),
    reply = await seal(replyKey, { ok: true }, "command-1");
  expect(await open(replyKey, reply, "command-1")).toEqual({ ok: true });
  expect(await fingerprint(keys.publicKey)).toMatch(
    /^[0-9a-f]{4}( [0-9a-f]{4}){15}$/,
  );
});
it("encrypts the vault, rejects tampering and the wrong OS key", async () => {
  const dir = await mkdtemp(join(tmpdir(), "hcmue-vault-"));
  try {
    const file = join(dir, "state.enc"),
      key = randomBytes(32),
      vault = new Vault<any>(file, key);
    await vault.write({ token: "fixture-token", accounts: [] });
    expect(await readFile(file, "utf8")).not.toContain("fixture-token");
    expect(await vault.load(() => null)).toEqual({
      token: "fixture-token",
      accounts: [],
    });
    await expect(
      new Vault(file, randomBytes(32)).load(() => null),
    ).rejects.toThrow();
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
it("uses option text, rejects missing answers and ignores volatile exam counters", () => {
  const q: any = {
    success: true,
    open_exam: { hasRegisterCode: 0, so_luong: 1 },
    questions: [
      {
        ma_cau_hoi: 8,
        noi_dung: "Địa điểm",
        cau_tra_loi: [{ ma_cau_tra_loi: 9, noi_dung: "TP.HCM" }],
      },
    ],
  };
  expect(payload(exam, q, { "8": "9" }).answers).toEqual([
    { ma_cau_hoi: 8, noi_dung_tra_loi: "TP.HCM" },
  ]);
  expect(() => payload(exam, q, {})).toThrow("Cần trả lời");
  expect(questionSignature(q)).toBe(
    questionSignature({
      ...q,
      open_exam: { hasRegisterCode: 0, so_luong: 100 },
    }),
  );
  expect(() =>
    questionSignature({ ...q, open_exam: { hasRegisterCode: 1 } }),
  ).toThrow();
  expect(schoolTime("2026-10-21 11:00:00")).toBe(
    Date.parse("2026-10-21T04:00:00Z"),
  );
});
