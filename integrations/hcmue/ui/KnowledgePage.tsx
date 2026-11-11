import { useEffect, useMemo, useState } from "react";
import { Button, Checkbox, Field, Input, Spinner, Textarea } from "@fluentui/react-components";
import { Books, FileText, MagnifyingGlass } from "@phosphor-icons/react";
import type { Account } from "../../../src/account";
import { WorkspaceHeader } from "../../../manager/ui/WorkspaceHeader";
import { useTheme } from "../../../manager/ui/theme";
import {
  MAX_DOCUMENT_CHUNKS, MAX_DOCUMENT_LENGTH, splitDocument,
  type KnowledgeDocument, type KnowledgeMapPoint, type KnowledgeSearch,
} from "../knowledge/documents";
import { KnowledgeMap } from "./KnowledgeMap";
import "./knowledge.css";

const adminPath = "/api/admin/hcmue/knowledge";
type Library = { documents: KnowledgeDocument[]; model: string; embeddingEnabled: boolean };
type Article = { title: string; chunks: { id: string; heading: string; content: string }[] };
const documentHref = (id: string) => id.startsWith("doc-")
  ? `/hcmue/knowledge?document=${id}`
  : `/hcmue-downloads/knowledge.html#${id}`;

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(path, { cache: "no-store", ...init });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error ?? "Không tải được dữ liệu kho tri thức.");
  return data as T;
}

function post<T>(path: string, value: object = {}) {
  return request<T>(path, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(value) });
}

function ArticleView({ id }: { id: string }) {
  const [article, setArticle] = useState<Article>();
  const [error, setError] = useState("");
  useEffect(() => {
    const controller = new AbortController();
    void request<Article>(`/api/hcmue/knowledge/${id}`, { signal: controller.signal })
      .then(setArticle).catch(error => { if (!controller.signal.aborted) setError(error.message); });
    return () => controller.abort();
  }, [id]);
  useEffect(() => {
    if (article && location.hash) document.getElementById(location.hash.slice(1))?.scrollIntoView();
  }, [article]);
  if (error) return <p className="hck-error" role="alert">{error}</p>;
  if (!article) return <Spinner label="Đang tải tài liệu" />;
  return <article className="hck-card hck-article">
    <h1>{article.title}</h1>
    {article.chunks.map(chunk => <section key={chunk.id} id={chunk.id} className="hck-chunk">
      {chunk.heading && <h2>{chunk.heading}</h2>}
      <p className="hck-excerpt">{chunk.content}</p>
    </section>)}
  </article>;
}

function LibraryView() {
  const [library, setLibrary] = useState<Library>();
  const [points, setPoints] = useState<KnowledgeMapPoint[]>();
  const [title, setTitle] = useState("");
  const [content, setContent] = useState("");
  const [question, setQuestion] = useState("");
  const [rerank, setRerank] = useState(false);
  const [results, setResults] = useState<KnowledgeSearch>();
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const preview = useMemo(() => splitDocument(content), [content]);

  useEffect(() => {
    const controller = new AbortController();
    void request<Library>(adminPath, { signal: controller.signal })
      .then(setLibrary).catch(error => { if (!controller.signal.aborted) setError(error.message); });
    return () => controller.abort();
  }, []);

  async function run(label: string, work: () => Promise<void>) {
    setBusy(label);
    setError("");
    setNotice("");
    try { await work(); }
    catch (error) { setError((error as Error).message); }
    finally { setBusy(""); }
  }

  async function refresh() {
    setLibrary(await request<Library>(adminPath));
    setPoints(undefined);
    setResults(undefined);
  }

  return <>
    <header className="hck-intro">
      <h1>Kho tri thức HCMUE</h1>
      <p>Thêm tài liệu hướng dẫn, xem các đoạn đã lập chỉ mục và kiểm tra câu hỏi tìm được nguồn nào.</p>
    </header>
    {error && <p className="hck-error" role="alert">{error}</p>}
    {notice && <p className="hck-notice" role="status">{notice}</p>}
    {busy && <p role="status">{busy}…</p>}
    {!library && !error && <Spinner label="Đang tải kho tri thức" />}
    <div className="hck-grid">
      <section className="hck-card">
        <h2><FileText size={20} /> Thêm tài liệu</h2>
        <form className="hck-form" onSubmit={event => {
          event.preventDefault();
          void run("Đang xuất bản tài liệu", async () => {
            await post(adminPath, { title, content });
            setTitle(""); setContent("");
            await refresh();
            setNotice("Tài liệu đã được xuất bản.");
          });
        }}>
          <Field label="Tiêu đề"><Input value={title} maxLength={160} onChange={(_, data) => setTitle(data.value)} required /></Field>
          <Field label="Tải tệp .md hoặc .txt">
            {control => <input {...control} type="file" accept=".md,.txt,text/plain,text/markdown" disabled={!!busy} onChange={event => {
              const file = event.currentTarget.files?.[0];
              event.currentTarget.value = "";
              if (!file) return;
              void run("Đang đọc tệp", async () => {
                if (!/\.(md|txt)$/i.test(file.name) || file.size > MAX_DOCUMENT_LENGTH * 4)
                  throw new Error("Chọn tệp .md hoặc .txt có tối đa 12.000 ký tự.");
                const text = await file.text();
                if (text.length > MAX_DOCUMENT_LENGTH) throw new Error("Tệp vượt quá 12.000 ký tự.");
                setTitle(file.name.replace(/\.[^.]+$/, "").slice(0, 160));
                setContent(text);
              });
            }} />}
          </Field>
          <Field label="Nội dung" hint="Tối đa 12.000 ký tự và 40 đoạn. Tài liệu xuất bản có thể được mọi tài khoản đang hoạt động đọc; chỉ đưa hướng dẫn dùng chung.">
            <Textarea value={content} rows={6} maxLength={MAX_DOCUMENT_LENGTH} onChange={(_, data) => setContent(data.value)} />
          </Field>
          {preview.length > 0 && <details className="hck-preview">
            <summary>Xem trước {preview.length} đoạn</summary>
            {preview.map((chunk, index) => <section key={index} className="hck-chunk">
              {chunk.heading && <strong>{chunk.heading}</strong>}
              <p className="hck-excerpt">{chunk.content}</p>
            </section>)}
          </details>}
          {preview.length > MAX_DOCUMENT_CHUNKS && <p className="hck-error" role="alert">Tài liệu có hơn 40 đoạn. Gộp bớt mục hoặc chia thành hai tài liệu để xuất bản.</p>}
          <Button type="submit" appearance="primary" disabled={!library || !!busy || !title.trim() || !preview.length || preview.length > MAX_DOCUMENT_CHUNKS}>Xuất bản</Button>
        </form>
      </section>

      <section className="hck-card">
        <h2><Books size={20} /> Tài liệu</h2>
        {library && <>
          <p className="hck-muted">{library.embeddingEnabled ? library.model : "Chưa có API key OpenRouter. Có thể xuất bản và tìm theo từ khóa."}</p>
          <Button disabled={!!busy || !library.embeddingEnabled} onClick={() => void run("Đang lập chỉ mục", async () => {
            const { indexed } = await post<{ indexed: number }>(`${adminPath}/index-guides`);
            await refresh();
            setNotice(indexed ? `Đã lập chỉ mục ${indexed} bài hướng dẫn có sẵn.` : "Các bài hướng dẫn có sẵn đã được lập chỉ mục.");
          })}>Lập chỉ mục bài có sẵn</Button>
          <ul className="hck-list">
            {library.documents.map(doc => <li key={doc.id}>
              <div>
                {doc.published ? <a href={documentHref(doc.id)}>{doc.title}</a> : <strong>{doc.title}</strong>}
                <small>{doc.published ? `${doc.indexed}/${doc.chunks} đoạn có vector` : "Đã ẩn khỏi truy xuất"}</small>
              </div>
              {doc.id.startsWith("doc-") && doc.published && <div className="hck-actions">
                {library.embeddingEnabled && doc.indexed < doc.chunks && <Button size="small" disabled={!!busy} onClick={() => void run("Đang tạo vector", async () => {
                  const { indexed } = await post<{ indexed: number }>(`${adminPath}/${doc.id}/index`);
                  await refresh();
                  setNotice(indexed ? `Đã tạo vector cho ${indexed} đoạn.` : "Không có đoạn nào cần tạo vector.");
                })}>Tạo vector</Button>}
                <Button size="small" appearance="subtle" disabled={!!busy} onClick={() => void run("Đang ẩn tài liệu", async () => {
                  await request(`${adminPath}/${doc.id}`, { method: "DELETE" });
                  await refresh();
                  setNotice("Đã ẩn tài liệu khỏi truy xuất.");
                })}>Ẩn</Button>
              </div>}
            </li>)}
          </ul>
        </>}
      </section>

      <section className="hck-card">
        <h2>Bản đồ vector</h2>
        <p className="hck-muted">Chọn một điểm để đọc đoạn gốc. Bản đồ hiển thị tối đa 60 đoạn mới nhất.</p>
        <Button disabled={!library || !!busy} onClick={() => void run("Đang tải bản đồ", async () => {
          setPoints(await request<KnowledgeMapPoint[]>(`${adminPath}/map`));
        })}>{points ? "Tải lại bản đồ" : "Xem bản đồ"}</Button>
        {points && <KnowledgeMap points={points} />}
      </section>

      <section className="hck-card">
        <h2><MagnifyingGlass size={20} /> Thử truy xuất</h2>
        <form className="hck-form" onSubmit={event => {
          event.preventDefault();
          void run("Đang thử truy xuất", async () => setResults(await post(`${adminPath}/search`, { question, rerank })));
        }}>
          <Field label="Câu hỏi thử"><Input value={question} maxLength={500} onChange={(_, data) => setQuestion(data.value)} /></Field>
          <Checkbox label="Thử xếp hạng lại bằng OpenRouter" checked={rerank} disabled={!library?.embeddingEnabled || !!busy}
            onChange={(_, data) => setRerank(data.checked === true)} />
          <Button type="submit" disabled={!library || !!busy || !question.trim()}>So sánh kết quả</Button>
        </form>
        {results && <>
          {results.elapsedMs !== undefined && <p className="hck-muted">Thời gian truy xuất: {results.elapsedMs} ms</p>}
          {results.embedding !== "used" && <p className="hck-muted">{results.embedding === "not-indexed" ? "Kho chưa có đoạn được lập chỉ mục." : "Không có kết quả từ API embedding cho lượt thử này."}</p>}
          {results.rerankUnavailable && <p className="hck-muted">Không xếp hạng lại được. Các kết quả truy xuất ban đầu vẫn hiển thị bên dưới.</p>}
          {([["Kết hợp", results.hybrid], ["Từ khóa", results.keyword], ["Vector", results.vector], ["Xếp hạng lại", results.reranked]] as const).map(([label, matches]) => matches && <details key={label} open={label === "Kết hợp"} className="hck-preview">
            <summary>{label} · {matches.length} đoạn</summary>
            {matches.map(match => <section key={match.id} className="hck-chunk">
              <a href={match.href ?? documentHref(match.id)}>{match.title}</a>
              <small className="hck-score">Điểm {match.score.toFixed(3)}</small>
              <p className="hck-excerpt">{match.steps.join("\n")}</p>
            </section>)}
          </details>)}
        </>}
      </section>
    </div>
  </>;
}

export function HcmueKnowledgePage({ account, logout }: { account: Account; logout: () => Promise<void> }) {
  const { dark, toggleTheme } = useTheme();
  const documentId = new URLSearchParams(location.search).get("document");
  const validDocument = documentId && /^doc-[a-f0-9]{32}$/.test(documentId);
  return <div className="hck-page">
    <WorkspaceHeader title="Kho tri thức HCMUE" icon={<Books size={20} />} dark={dark} toggleTheme={toggleTheme}
      account={account} logout={logout} primaryAction={<Button as="a" href="/hcmue">Về HCMUE</Button>} />
    <main className="hck-main">
      {validDocument ? <ArticleView id={documentId} /> : account.role === "admin" && !documentId
        ? <LibraryView /> : <p className="hck-error">Chỉ quản trị viên có thể quản lý kho tri thức.</p>}
    </main>
  </div>;
}
