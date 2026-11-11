import { afterEach, expect, it, vi } from "vitest";
import { httpFixture, users } from "../cloud/fixture";
import { HcmueKnowledge } from "../../integrations/hcmue/cloud/knowledge";
import { splitDocument } from "../../integrations/hcmue/knowledge/documents";

const cleanup: (() => Promise<void>)[] = [];
afterEach(async () => { for (const close of cleanup.splice(0)) await close(); });
const root = "admin/hcmue/knowledge";
const draft = { title: "Đổi ảnh thẻ", content: "# Quy cách\nẢnh cần nền trắng.\n\n# Tải lên\nMở trang hồ sơ và chọn ảnh JPEG." };
async function fixture(knowledge = true) {
  const f = await httpFixture(undefined, true, false, knowledge);
  cleanup.push(f.close);
  await f.pool.query("UPDATE hanu.accounts SET role='admin' WHERE user_id=$1", [users[0]]);
  return f;
}

it("splits by heading, keeps line breaks, and does not split surrogate pairs", () => {
  const word = "a" + "🙂".repeat(375);
  const result = splitDocument(`# Mục\nHai dòng\nCòn nguyên\n# Mục dài\n${word}`);
  expect(result[0]).toEqual({ heading: "Mục", content: "Hai dòng\nCòn nguyên" });
  expect(result.slice(1).map(chunk => chunk.content).join("")).toBe(word);
  expect(result.every(chunk => chunk.content.length <= 700 && !/[\uD800-\uDFFF]/u.test(chunk.content))).toBe(true);
});

it("retrieves with real pgvector, skips paid calls for notice codes, and isolates the rerank experiment", async () => {
  const f = await fixture();
  const send = vi.fn<typeof fetch>(async (url, init) => {
    const data = JSON.parse(String(init?.body));
    if (String(url).endsWith("/rerank")) {
      expect(data.documents.length).toBeLessThanOrEqual(6);
      return Response.json({ results: [{ index: 1, relevance_score: 0.98 }] });
    }
    return Response.json({ data: data.input.map((_: string, i: number) => ({ index: i, embedding: i ? [0, 1, 0] : [1, 0, 0] })).reverse() });
  });
  const store = new HcmueKnowledge(f.pool, { apiKey: "fixture", send });
  const { id } = await store.publish(draft);
  expect(await store.publish(draft)).toEqual({ id });
  expect(await store.indexDocument(id)).toEqual({ indexed: 0 });
  expect(send).toHaveBeenCalledTimes(1);
  expect((await store.search("HC-DOI-CHIEU")).hybrid).toMatchObject([{ id: expect.any(String), score: 100 }]);
  expect((await store.search("Ảnh JPEG")).hybrid[0].id).toBe(`${id}-1`);
  expect(send).toHaveBeenCalledTimes(1);
  expect((await store.search("Chân dung hậu cảnh sáng")).hybrid[0].id).toBe(`${id}-0`);
  expect(send).toHaveBeenCalledTimes(2);
  const result = await store.compare("Ảnh JPEG", true);
  expect(result.vector[0]).toMatchObject({ id: `${id}-0`, score: 1, href: `/hcmue/knowledge?document=${id}#${id}-0` });
  expect(result.keyword[0].id).toBe(`${id}-1`);
  expect(result.reranked).toMatchObject([{ score: 0.98 }]);
  expect(result.elapsedMs).toBeGreaterThanOrEqual(0);
  expect(await store.map()).toMatchObject([{ embedding: [1, 0, 0] }, { embedding: [0, 1, 0] }]);
  await store.archive(id);
  expect((await store.search("Ảnh JPEG")).hybrid.some(match => match.id.startsWith(id))).toBe(false);
  expect(await store.map()).toEqual([]);
});

it("keeps publishing admin only, allows members to read a published citation, and indexes old documents", async () => {
  const f = await fixture();
  expect((await f.api(root, 1)).status).toBe(403);
  expect((await f.api(root, 1, draft)).status).toBe(403);
  const published = await f.api(root, 0, draft);
  expect(published.status).toBe(201);
  const { id } = await published.json();
  expect(await (await f.api(`hcmue/knowledge/${id}`, 1)).json()).toMatchObject({ title: draft.title });
  const store = new HcmueKnowledge(f.pool, { apiKey: "fixture", send: async (_, init) => Response.json({
    data: JSON.parse(String(init?.body)).input.map((_: string, index: number) => ({ index, embedding: [1, 0] })),
  }) });
  expect(await store.indexDocument(id)).toEqual({ indexed: 2 });
  expect((await store.list()).find(doc => doc.id === id)).toMatchObject({ indexed: 2, chunks: 2 });
  const trial = await f.api(`${root}/search`, 0, { question: "Ảnh JPEG" });
  expect(await trial.json()).toMatchObject({ keyword: expect.arrayContaining([{ id: `${id}-1`, title: expect.any(String), steps: expect.any(Array), href: expect.any(String), score: expect.any(Number) }]), embedding: "unavailable" });
  const chat = await f.api("hcmue/assistant/chat", 1, { message: "Ảnh JPEG" });
  expect((await chat.json()).references[0]).toMatchObject({ id: `${id}-1`, href: expect.stringContaining(id) });
  expect((await f.api(`${root}/${id}`, 0, undefined, "DELETE")).status).toBe(200);
  expect((await f.api(`hcmue/knowledge/${id}`, 1)).status).toBe(404);
});

it("explains a missing migration while chat still serves bundled guidance", async () => {
  const f = await fixture(false);
  const response = await f.api(root);
  expect(response.status).toBe(503);
  expect(await response.json()).toMatchObject({ error: expect.stringContaining("202611110001_hcmue_knowledge.sql") });
  expect((await f.api("hcmue/assistant/chat", 1, { message: "Runner cần kết nối như thế nào?" })).status).toBe(200);
});
