import { describe, expect, it } from "vitest";
import { HSK_RULES, emptyProfile } from "../src/rules";
import { decideNextAction, hasExactAlias, mappingKey, normalize, transitionStatus } from "../src/shared";

describe("normalization and exact aliases", () => {
  it("normalizes Vietnamese accents and whitespace without changing the matching rule", () => {
    expect(normalize("  HỌ   VÀ  TÊN ")).toBe("ho va ten");
    expect(hasExactAlias("HỌ VÀ TÊN | 姓名", HSK_RULES.find((rule) => rule.key === "fullName")!.aliases)).toBe(true);
    expect(hasExactAlias("Họ và tên thí sinh", HSK_RULES.find((rule) => rule.key === "fullName")!.aliases)).toBe(false);
  });

  it("keeps the Morse aliases used by the test form", () => {
    const fullName = HSK_RULES.find((rule) => rule.key === "fullName")!;
    expect(hasExactAlias("-. .- -- .", fullName.aliases)).toBe(true);
  });

  it("matches Google Forms headings after it appends the required asterisk", () => {
    const identityNumber = HSK_RULES.find((rule) => rule.key === "identityNumber")!;
    expect(hasExactAlias(".. -.. -. ..- -- *", identityNumber.aliases)).toBe(true);
  });

  it("matches the live commitment heading when Forms flattens bilingual lines", () => {
    const commitment = HSK_RULES.find((rule) => rule.key === "firstCommitment")!;
    expect(hasExactAlias("TÔI CAM KẾT 本人保证 *", commitment.aliases)).toBe(true);
    expect(hasExactAlias("TÔI CAM KẾT本人保证 *", commitment.aliases)).toBe(true);
  });
});

describe("run state decisions", () => {
  it("never chooses submit in test mode", () => {
    expect(decideNextAction("test", false, false)).toBe("next");
    expect(decideNextAction("test", true, false)).toBe("ready");
    expect(decideNextAction("test", true, true)).toBe("pause");
  });

  it("only chooses submit at the final live page", () => {
    expect(decideNextAction("live", false, false)).toBe("next");
    expect(decideNextAction("live", true, false)).toBe("submit");
    expect(transitionStatus("running", "block")).toBe("waiting_manual");
    expect(transitionStatus("waiting_manual", "resume")).toBe("running");
  });
});

describe("profile defaults", () => {
  it("creates one local profile with all predefined non-file values", () => {
    const profile = emptyProfile();
    expect(profile.values.fullName).toBe("");
    expect(profile.attachments.identityDocument).toBeUndefined();
    expect(mappingKey("form-1", "entry.100")).toBe("form-1:entry.100");
  });
});
