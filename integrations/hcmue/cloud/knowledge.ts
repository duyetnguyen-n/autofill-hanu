import { createHash } from "node:crypto";
import { CloudError } from "../../../manager/cloud/errors";
import { transaction, type SqlConnection, type SqlPool } from "../../../manager/cloud/postgres-store";
import { builtInGuides, normalize, rankGuides, searchWords } from "./assistant-knowledge";
import {
  MAX_DOCUMENT_CHUNKS, MAX_DOCUMENT_LENGTH, splitDocument,
  knowledgeScopes, type KnowledgeScope,
  type DocumentChunk, type KnowledgeDocument, type KnowledgeMapPoint, type KnowledgeMatch, type KnowledgeSearch,
} from "../knowledge/documents";

export const DEFAULT_EMBEDDING_MODEL = "qwen/qwen3-embedding-4b";
const unavailable = "Chưa tạo được embedding. Kiểm tra cấu hình OpenRouter rồi thử lại.";
const hash = (value: string) => createHash("sha256").update(value).digest("hex");
type Draft = { title: string; content: string; scope?: KnowledgeScope };
type Row = { id: string; document_id: string; title: string; heading: string; content: string; score: number };

const fromRow = (row: Row): KnowledgeMatch => {
  const guide = builtInGuides.find(item => item.id === row.document_id);
  if (guide) return { id: guide.id, title: guide.title, steps: guide.steps, href: guide.href, score: row.score };
  return {
    id: row.id, title: row.heading ? `${row.title} · ${row.heading}` : row.title,
    steps: [row.content], href: `/knowledge?document=${row.document_id}#${row.id}`, score: row.score,
  };
};

function fuse(keyword: KnowledgeMatch[], vector: KnowledgeMatch[]) {
  const results = new Map<string, KnowledgeMatch>();
  for (const list of [keyword, vector]) {
    list.forEach((match, index) => {
      const score = (results.get(match.id)?.score ?? 0) + 1 / (20 + index + 1);
      results.set(match.id, { ...match, score });
    });
  }
  return [...results.values()].sort((a, b) => b.score - a.score).slice(0, 3);
}

export class HcmueKnowledge {
  readonly model: string;
  readonly embeddingEnabled: boolean;
  private indexing = false;
  private lookupInFlight = 0;

  constructor(private pool: SqlPool, private options: { apiKey?: string; embeddingModel?: string; send?: typeof fetch } = {}) {
    this.model = options.embeddingModel || DEFAULT_EMBEDDING_MODEL;
    this.embeddingEnabled = Boolean(options.apiKey);
  }

  private async embed(input: string[], timeout = 15_000): Promise<number[][]> {
    try {
      const response = await (this.options.send ?? fetch)("https://openrouter.ai/api/v1/embeddings", {
        method: "POST",
        headers: { Authorization: `Bearer ${this.options.apiKey}`, "Content-Type": "application/json" },
        signal: AbortSignal.timeout(timeout),
        body: JSON.stringify({ input, model: this.model, encoding_format: "float", provider: { data_collection: "deny" } }),
      });
      if (!response.ok) throw new Error();
      const { data } = await response.json() as { data: { index: number; embedding: number[] }[] };
      const result = [...data].sort((a, b) => a.index - b.index);
      const dimensions = result[0]?.embedding?.length ?? 0;
      if (result.length !== input.length || dimensions < 2 || dimensions > 4096 ||
        !result.every(({ index, embedding }, i) => index === i && Array.isArray(embedding) &&
          embedding.length === dimensions && embedding.every(value => Number.isFinite(value) && Math.abs(value) <= 1e6) &&
          embedding.some(value => value !== 0))) throw new Error();
      return result.map(item => item.embedding);
    } catch {
      throw new CloudError(unavailable, 502);
    }
  }

  async list(): Promise<KnowledgeDocument[]> {
    const { rows } = await this.pool.query(`SELECT d.id, d.title, d.published, d.scope,
      count(c.ordinal)::int AS chunks, count(c.ordinal) FILTER (WHERE c.embedding_model=$1)::int AS indexed
      FROM hcmue.knowledge_documents d LEFT JOIN hcmue.knowledge_chunks c ON d.id=c.document_id
      GROUP BY d.id ORDER BY d.created_at DESC, d.id`, [this.model]);
    const builtins = builtInGuides.map(guide => ({
      id: guide.id, title: guide.title, scope: guide.scope, href: guide.href, published: true, chunks: 1,
      indexed: rows.find(row => row.id === guide.id)?.indexed ?? 0,
    }));
    return [...builtins, ...rows.filter(row => row.id.startsWith("doc-"))];
  }

  private async insertChunks(db: SqlConnection, id: string, title: string, chunks: DocumentChunk[], embeddings?: number[][]) {
    await db.query(`INSERT INTO hcmue.knowledge_chunks
      (document_id, ordinal, heading, content, search_text, embedding, embedding_model)
      SELECT $1, item.ordinal, item.heading, item.content, to_tsvector('simple',item.terms),
        item.embedding::extensions.vector, $3
      FROM jsonb_to_recordset($2::jsonb) AS item(ordinal int, heading text, content text, terms text, embedding text)`,
    [id, JSON.stringify(chunks.map((chunk, ordinal) => ({
      ...chunk, ordinal, terms: normalize(`${title} ${chunk.heading} ${chunk.content}`),
      embedding: embeddings ? JSON.stringify(embeddings[ordinal]) : null,
    }))), embeddings ? this.model : null]);
  }

  async publish(input: Partial<Draft>) {
    if (typeof input.title !== "string" || !input.title.trim() || input.title.trim().length > 160 ||
        typeof input.content !== "string" || input.content.length > MAX_DOCUMENT_LENGTH || input.content.includes("\0") || input.title.includes("\0")) {
      throw new CloudError("Nhập tiêu đề tối đa 160 ký tự và nội dung tối đa 12.000 ký tự.");
    }
    const title = input.title.trim(), chunks = splitDocument(input.content);
    const scope = input.scope ?? "hcmue";
    if (!knowledgeScopes.includes(scope)) throw new CloudError("Chọn phạm vi hợp lệ cho tài liệu.");
    if (!chunks.length || chunks.length > MAX_DOCUMENT_CHUNKS) throw new CloudError("Tài liệu phải có từ 1 đến 40 đoạn nội dung.");
    const signature = hash(JSON.stringify(scope === "hcmue" ? [title, chunks] : [scope, title, chunks]));
    const id = `doc-${signature.slice(0, 32)}`;
    const existing = await this.pool.query("SELECT id FROM hcmue.knowledge_documents WHERE id=$1", [id]);
    if (existing.rows.length) {
      await this.pool.query("UPDATE hcmue.knowledge_documents SET published=true WHERE id=$1", [id]);
      return { id };
    }
    const embeddings = this.embeddingEnabled ? await this.embed(chunks.map(chunk => [title, chunk.heading, chunk.content].filter(Boolean).join("\n"))) : undefined;
    await transaction(this.pool, async db => {
      const inserted = await db.query(`INSERT INTO hcmue.knowledge_documents(id,title,content_hash,scope)
        VALUES($1,$2,$3,$4) ON CONFLICT (id) DO NOTHING RETURNING id`, [id, title, signature, scope]);
      if (inserted.rows.length) await this.insertChunks(db, id, title, chunks, embeddings);
    });
    return { id };
  }

  async archive(id: string) {
    await this.pool.query("UPDATE hcmue.knowledge_documents SET published=false WHERE id=$1", [id]);
    return { ok: true };
  }

  async indexDocument(id: string) {
    if (!this.embeddingEnabled) throw new CloudError("Cần cấu hình OpenRouter để tạo embedding.", 503);
    const { rows } = await this.pool.query(`SELECT d.title,c.ordinal,c.heading,c.content,c.embedding_model
      FROM hcmue.knowledge_documents d JOIN hcmue.knowledge_chunks c ON d.id=c.document_id
      WHERE d.id=$1 AND d.published ORDER BY c.ordinal`, [id]);
    if (!rows.length) throw new CloudError("Tài liệu không còn được xuất bản.", 404);
    if (rows.every(row => row.embedding_model === this.model)) return { indexed: 0 };
    const embeddings = await this.embed(rows.map(row => [row.title, row.heading, row.content].filter(Boolean).join("\n")));
    const result = await this.pool.query(`UPDATE hcmue.knowledge_chunks c
      SET embedding=item.embedding::extensions.vector, embedding_model=$3
      FROM jsonb_to_recordset($2::jsonb) AS item(ordinal int, embedding text)
      WHERE c.document_id=$1 AND c.ordinal=item.ordinal
      AND EXISTS (SELECT 1 FROM hcmue.knowledge_documents d WHERE d.id=$1 AND d.published)`,
    [id, JSON.stringify(rows.map((row, i) => ({ ordinal: row.ordinal, embedding: JSON.stringify(embeddings[i]) }))), this.model]);
    return { indexed: result.rowCount };
  }

  async indexBuiltins() {
    if (!this.embeddingEnabled) throw new CloudError("Cần cấu hình OpenRouter để tạo embedding.", 503);
    if (this.indexing) throw new CloudError("Đang lập chỉ mục. Chờ một chút rồi thử lại.", 409);
    this.indexing = true;
    try {
      const existing = await this.pool.query("SELECT id,content_hash FROM hcmue.knowledge_documents d WHERE EXISTS (SELECT 1 FROM hcmue.knowledge_chunks c WHERE c.document_id=d.id AND c.embedding_model=$1)", [this.model]);
      const pending = builtInGuides.map(guide => ({
        id: guide.id, title: guide.title, scope: guide.scope, content: guide.steps.join("\n"), signature: hash(JSON.stringify(guide)),
      })).filter(guide => !existing.rows.some(row => row.id === guide.id && row.content_hash === guide.signature));
      if (!pending.length) return { indexed: 0 };
      const embeddings = await this.embed(pending.map(guide => `${guide.title}\n${guide.content}`));
      await transaction(this.pool, async db => {
        for (const [index, guide] of pending.entries()) {
          await db.query(`INSERT INTO hcmue.knowledge_documents(id,title,content_hash,scope) VALUES($1,$2,$3,$4)
            ON CONFLICT(id) DO UPDATE SET title=excluded.title, content_hash=excluded.content_hash,scope=excluded.scope`, [guide.id, guide.title, guide.signature, guide.scope]);
          await db.query("DELETE FROM hcmue.knowledge_chunks WHERE document_id=$1", [guide.id]);
          await this.insertChunks(db, guide.id, guide.title, [{ heading: "", content: guide.content }], [embeddings[index]]);
        }
      });
      return { indexed: pending.length };
    } finally {
      this.indexing = false;
    }
  }

  async document(id: string) {
    const { rows } = await this.pool.query(`SELECT d.title, c.heading, c.content, c.ordinal
      FROM hcmue.knowledge_documents d JOIN hcmue.knowledge_chunks c ON d.id=c.document_id
      WHERE d.id=$1 AND d.published ORDER BY c.ordinal`, [id]);
    if (!rows.length) throw new CloudError("Tài liệu không còn được xuất bản.", 404);
    return { title: rows[0].title as string, chunks: rows.map(row => ({
      id: `${id}-${row.ordinal}`, heading: row.heading as string, content: row.content as string,
    })) };
  }

  async map(): Promise<KnowledgeMapPoint[]> {
    const { rows } = await this.pool.query(`SELECT d.id || '-' || c.ordinal AS id, d.title, d.scope, c.heading, c.content,
      c.embedding::text AS embedding FROM hcmue.knowledge_documents d JOIN hcmue.knowledge_chunks c ON d.id=c.document_id
      WHERE d.published AND c.embedding_model=$1 ORDER BY d.created_at DESC, d.id, c.ordinal LIMIT 60`, [this.model]);
    const points = rows.map(row => ({ ...row, embedding: JSON.parse(row.embedding) as number[] }));
    return points.filter(point => point.embedding.length === points[0].embedding.length);
  }

  async search(question: string, noticeCode?: string, compare = false, scope: KnowledgeScope | "all" = "hcmue"): Promise<KnowledgeSearch> {
    const builtins = rankGuides(question, noticeCode, scope).map(({ guide, score }) => ({ ...guide, score }));
    if (builtins[0]?.score >= 100 && !compare) {
      const exact = builtins.filter(match => match.score >= 100);
      return { keyword: exact, vector: [], hybrid: exact, embedding: "not-indexed" };
    }
    const words = searchWords(question);
    const selection = `SELECT d.id || '-' || c.ordinal AS id,d.id AS document_id,d.title,c.heading,c.content,`;
    const from = `FROM hcmue.knowledge_documents d JOIN hcmue.knowledge_chunks c ON d.id=c.document_id`;
    const keywordRows = words.length ? (await this.pool.query(`${selection}
      ts_rank(c.search_text, to_tsquery('simple',$1)) AS score,
      c.search_text @@ plainto_tsquery('simple',$2) AS full_match ${from}
      WHERE d.published AND left(d.id,4)='doc-' AND c.search_text @@ to_tsquery('simple',$1)
      AND ($3='all' OR d.scope=$3 OR d.scope='system')
      ORDER BY full_match DESC, score DESC, id LIMIT 3`, [words.join(" | "), words.join(" "), scope])).rows : [];
    const matches = keywordRows.map(fromRow);
    // Keyword rankings use different scales. Interleave published and bundled results.
    const keyword = builtins[0]?.score >= 6
      ? [builtins[0], ...matches, ...builtins.slice(1)].slice(0, 3)
      : [...matches, ...builtins].slice(0, 3);
    const fallback: KnowledgeSearch = { keyword, vector: [], hybrid: keyword, embedding: "not-indexed" };
    if (!compare && (builtins[0]?.score >= 6 || (words.length >= 2 && keywordRows[0]?.full_match))) return fallback;
    if (!this.embeddingEnabled || !/\p{L}/u.test(question) || this.lookupInFlight >= 8)
      return { ...fallback, embedding: "unavailable" };
    this.lookupInFlight++;
    try {
      const available = await this.pool.query(`SELECT 1 ${from} WHERE d.published AND c.embedding_model=$1
        AND ($2='all' OR d.scope=$2 OR d.scope='system') LIMIT 1`, [this.model, scope]);
      if (!available.rows.length) return fallback;
      const query = this.model.startsWith("qwen/") ? `Instruct: Find HANU user documentation passages that answer the support question.\nQuery: ${question}` : question;
      const [embedding] = await this.embed([query], 6_000);
      const { rows } = await this.pool.query(`${selection}
        1 - (c.embedding OPERATOR(extensions.<=>) $1::extensions.vector) AS score ${from}
        WHERE d.published AND c.embedding_model=$2 AND extensions.vector_dims(c.embedding)=$3
        AND ($4='all' OR d.scope=$4 OR d.scope='system')
        ORDER BY score DESC, id LIMIT 3`, [JSON.stringify(embedding), this.model, embedding.length, scope]);
      const vector = rows.map(fromRow);
      const hybrid = fuse(keyword, vector.filter(match => match.score >= 0.40));
      if (builtins[0]?.score >= 100) {
        const first = builtins[0];
        return { keyword, vector, hybrid: [first, ...hybrid.filter(match => match.id !== first.id)].slice(0, 3), embedding: "used" };
      }
      return { keyword, vector, hybrid, embedding: "used" };
    } catch (error) {
      if (!(error instanceof CloudError)) throw error;
      return { ...fallback, embedding: "unavailable" };
    } finally {
      this.lookupInFlight--;
    }
  }

  async compare(question: string, rerank: boolean): Promise<KnowledgeSearch> {
    const start = performance.now();
    const result = await this.search(question, undefined, true, "all");
    if (rerank) {
      const candidates = [...new Map([...result.keyword, ...result.vector].map(match => [match.id, match])).values()];
      if (!this.embeddingEnabled || !candidates.length) result.rerankUnavailable = true;
      else {
        try {
          const response = await (this.options.send ?? fetch)("https://openrouter.ai/api/v1/rerank", {
            method: "POST",
            headers: { Authorization: `Bearer ${this.options.apiKey}`, "Content-Type": "application/json" },
            signal: AbortSignal.timeout(6_000),
            body: JSON.stringify({
              model: "mongodb/rerank-2.5-lite", query: question, top_n: Math.min(3, candidates.length),
              documents: candidates.map(match => `${match.title}\n${match.steps.join("\n").slice(0, 700)}`),
              provider: { data_collection: "deny" },
            }),
          });
          if (!response.ok) throw new Error();
          const { results } = await response.json() as { results: { index: number; relevance_score: number }[] };
          if (!Array.isArray(results) || !results.length || results.length > 3 || new Set(results.map(row => row.index)).size !== results.length) throw new Error();
          result.reranked = results.map(({ index, relevance_score }) => {
            if (!Number.isInteger(index) || !candidates[index] || !Number.isFinite(relevance_score)) throw new Error();
            return { ...candidates[index], score: relevance_score };
          });
        } catch {
          result.rerankUnavailable = true;
        }
      }
    }
    return { ...result, elapsedMs: Math.round(performance.now() - start) };
  }
}
