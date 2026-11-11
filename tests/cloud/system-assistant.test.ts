import { afterEach, expect, it, vi } from "vitest";
import { readFile } from "node:fs/promises";
import { databaseFixture, httpFixture, users } from "./fixture";
import { answerSystemAssistant } from "../../manager/assistant/answer";
import { HcmueKnowledge } from "../../integrations/hcmue/cloud/knowledge";
import { readReply } from "../../manager/ui/assistant/reply";
import { projectVectors, vectorEdges } from "../../integrations/hcmue/ui/vector-layout";

const cleanup: (() => Promise<void>)[] = [];
afterEach(async () => { for (const close of cleanup.splice(0)) await close(); });
it.each([
  ["forms", "Chuẩn bị profile", "forms-prepare"],
  ["forms", "Google Forms Direct", "forms-direct"],
  ["chinesetest", "Kết nối ChineseTest", "chinesetest-runner"],
  ["system", "Xem vector ở đâu?", "system-knowledge"],
  ["forms", "Chờ duyệt quyền sử dụng", "system-access"],
])("answers %s questions with the right source", async (workspace, message, id) => {
  const reply = await answerSystemAssistant({ workspace, message }, {});
  expect(reply.references.map(ref => ref.id)).toContain(id);
});
it("redacts data, bounds context, rejects invented references, and does not execute a model action", async () => {
  const send = vi.fn<typeof fetch>(async () => Response.json({ choices: [{ message: {
    content: JSON.stringify({ answer: "Mở kho tri thức.", referenceIds: ["system-knowledge", "made-up"], action: "sql", proposal: { action: "arm" } }),
  } }] }));
  const reply = await answerSystemAssistant({ message: "Xem vector? mật khẩu: secret! an@example.com", history: [{ role: "user", text: "cookie: private" }] }, { apiKey: "fixture", send });
  const sent = String(send.mock.calls[0][1]?.body);
  expect(sent).not.toMatch(/secret!|an@example.com|private/);
  expect(reply.references.map(ref => ref.id)).toEqual(["system-knowledge"]);
  expect(reply).not.toHaveProperty("proposal");
  const fallback = await answerSystemAssistant({ message: "Xem vector" }, { apiKey: "fixture", send: async () => Response.json({}, { status: 429 }) });
  expect(fallback.source).toBe("guide");
});
it("serves shared AI and knowledge without HCMUE enabled and keeps writes admin only", async () => {
  const f = await httpFixture(undefined, false, false, true); cleanup.push(f.close);
  expect((await f.api("assistant/chat", 1, { message: "Google Forms Direct" })).status).toBe(200);
  expect((await f.api("knowledge", 1)).status).toBe(200);
  expect((await f.api("knowledge/map", 1)).status).toBe(200);
  const draft = { title: "Hướng dẫn ảnh", content: "Ảnh dùng định dạng JPEG.", scope: "forms" };
  expect((await f.api("admin/knowledge", 1, draft)).status).toBe(403);
  await f.pool.query("UPDATE hanu.accounts SET role='admin' WHERE user_id=$1", [users[0]]);
  const response = await f.api("admin/knowledge", 0, draft);
  expect(response.status).toBe(201);
  const { id } = await response.json();
  const store = new HcmueKnowledge(f.pool);
  expect((await store.search("Ảnh JPEG", undefined, false, "forms")).hybrid.some(match => match.id.startsWith(id))).toBe(true);
  expect((await store.search("Ảnh JPEG", undefined, false, "chinesetest")).hybrid.some(match => match.id.startsWith(id))).toBe(false);
  expect((await f.api(`knowledge/${id}`, 1)).status).toBe(200);
  await f.pool.query("UPDATE hanu.accounts SET status='blocked' WHERE user_id=$1", [users[1]]);
  expect((await f.api("assistant/chat", 1, { message: "Xem vector" })).status).toBe(403);
});
it("tolerates missing references but rejects missing answers and unsafe links", () => {
  expect(readReply({ answer: "Câu trả lời" }).references).toEqual([]);
  expect(() => readReply({ error: "bad" })).toThrow();
  expect(readReply({ answer: "Nguồn", references: [
    { id: "a", title: "x", href: "javascript:alert(1)" }, { id: "b", title: "y", href: "//evil.test" },
  ] }).references).toEqual([]);
});
it("upgrades an existing HCMUE library twice without losing published documents or vectors", async () => {
  const f = await databaseFixture(true); cleanup.push(f.close);
  await f.db.exec("CREATE SCHEMA hcmue;");
  await f.db.exec(await readFile("supabase/migrations/202611110001_hcmue_knowledge.sql", "utf8"));
  await f.db.exec(`INSERT INTO hcmue.knowledge_documents (id, title, content_hash) VALUES ('doc-legacy', 'Tài liệu cũ', 'hash');
    INSERT INTO hcmue.knowledge_chunks VALUES ('doc-legacy', 0, '', 'Nội dung cũ', to_tsvector('simple', 'noi dung cu'), '[1,0]', 'fixture');`);
  const migration = await readFile("supabase/migrations/202611110002_system_knowledge.sql", "utf8");
  await f.db.exec(migration); await f.db.exec(migration);
  const store = new HcmueKnowledge(f.pool, { embeddingModel: "fixture" });
  expect((await store.list()).find(doc => doc.id === "doc-legacy")).toMatchObject({ scope: "hcmue", indexed: 1, published: true });
  expect(await store.map()).toMatchObject([{ id: "doc-legacy-0", embedding: [1, 0] }]);
});
it("projects actual vectors, handles identical points and creates only similarity edges", () => {
  const points = [0, 1, 2].map(i => ({ id: String(i), title: "Tài liệu", heading: "", content: "Nội dung", embedding: i === 2 ? [0, 1, 0] : [1, 0, 0] }));
  const projected = projectVectors(points);
  expect(projected.every(point => point.position.every(Number.isFinite))).toBe(true);
  expect(vectorEdges(projected)).toEqual([[0, 1]]);
  expect(projectVectors([points[0]])[0].position).toEqual([0, 0, 0]);
});
