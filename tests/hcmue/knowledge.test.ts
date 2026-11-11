import { existsSync } from "node:fs";
import { describe, expect, it } from "vitest";
import corpus from "../../integrations/hcmue/knowledge/guides.json";
import { retrieveGuides } from "../../integrations/hcmue/cloud/assistant-knowledge";

describe("HCMUE knowledge retrieval", () => {
  it("keeps guide IDs and notice codes unique and tracks the reviewed source", () => {
    const ids = corpus.guides.map(guide => guide.id);
    const codes = corpus.guides.flatMap(guide => guide.codes);
    expect(new Set(ids).size).toBe(ids.length);
    expect(new Set(codes).size).toBe(codes.length);
    for (const guide of corpus.guides) {
      expect(guide.id).toMatch(/^[a-z][a-z0-9-]*$/);
      expect(guide.steps.every(step => step.trim())).toBe(true);
      expect(guide.steps.length).toBeGreaterThan(0);
      expect(existsSync(guide.source)).toBe(true);
    }
  });

  const cases = [
    { question: "Máy báo runner mất kết nối", expected: "runner" },
    { question: "Em bị đăng xuất rồi, giờ làm sao?", expected: "login" },
    { question: "trang hcmue khong tra du lieu", expected: "network" },
    { question: "em dang ki duoc chua", expected: "result" },
    { question: "Ảnh thẻ và xác thực email cần làm ở đâu?", expected: "profile" },
    { question: "Đợt thi báo hết chỗ", expected: "catalog" },
    { question: "Hướng dẫn tạo lịch HSK 4", expected: "prepare" },
    { question: "Sao không bật được, em có quyền live chưa?", expected: "arm" },
    { question: "Khởi động lại Runner thì lịch còn không?", expected: "recovery" },
    { question: "Thanh toán ở đâu?", expected: "payment" },
    { question: "Giải thích HC-DOI-CHIEU", expected: "result" },
    { question: "Sao chưa có mã đơn HC-DOI-CHIEU?", noticeCode: "HC-PHIEN", expected: "login" },
    { question: "Thời tiết Hà Nội hôm nay thế nào?", expected: undefined },
    { question: "Giúp tôi với", expected: undefined },
  ];
  it.each(cases)("finds $expected for $question", ({ question, noticeCode, expected }) => {
    expect(retrieveGuides(question, noticeCode)[0]?.id).toBe(expected);
  });
});
