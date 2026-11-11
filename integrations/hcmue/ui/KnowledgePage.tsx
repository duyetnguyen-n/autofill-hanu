import { useEffect, useMemo, useState } from "react";
import { FluentProvider, Button, Checkbox, Field, Input, Select, Textarea } from "@fluentui/react-components";
import { ArrowLeft, ArrowUpRight, Books, CheckCircle, CircleNotch, Cube, FileText, Flask, Graph, MagnifyingGlass, Plus, UploadSimple } from "@phosphor-icons/react";
import type { Account } from "../../../src/account";
import { WorkspaceHeader } from "../../../manager/ui/WorkspaceHeader";
import { darkTheme, lightTheme, useTheme } from "../../../manager/ui/theme";
import { MAX_DOCUMENT_CHUNKS, MAX_DOCUMENT_LENGTH, splitDocument, knowledgeScopes, scopeLabels,
  type KnowledgeDocument, type KnowledgeMapPoint, type KnowledgeSearch, type KnowledgeScope } from "../knowledge/documents";
import { KnowledgeMap } from "./KnowledgeMap";
import "./knowledge.css";

const adminPath = "/api/admin/knowledge";
type Library = { documents: KnowledgeDocument[]; model: string; embeddingEnabled: boolean };
type Article = { title: string; chunks: { id: string; heading: string; content: string }[] };
const documentHref = (id: string) => id.startsWith("doc-") ? `/knowledge?document=${id}` : `/hcmue-downloads/knowledge.html#${id}`;
async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(path, { cache: "no-store", ...init });
  let data;
  try { data = await response.json(); } catch { throw new Error("Máy chủ chưa trả dữ liệu kho tri thức hợp lệ. Tải lại để thử kết nối."); }
  if (!response.ok) throw new Error(data.error ?? "Không tải được dữ liệu kho tri thức.");
  return data as T;
}
function post<T>(path: string, value: object = {}) {
  return request<T>(path, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(value) });
}

function ArticleView({ id }: { id: string }) {
  const [article, setArticle] = useState<Article>(), [error, setError] = useState("");
  useEffect(() => {
    const controller = new AbortController();
    void request<Article>(`/api/knowledge/${id}`, { signal: controller.signal })
      .then(setArticle).catch(error => { if (!controller.signal.aborted) setError(error.message); });
    return () => controller.abort();
  }, [id]);
  useEffect(() => { if (article && location.hash) document.getElementById(location.hash.slice(1))?.scrollIntoView(); }, [article]);
  return <div className="kv-article-wrap"><a className="kv-back" href="/knowledge"><ArrowLeft size={16}/>Về kho tri thức</a>
    {error ? <div className="kv-error" role="alert">{error}</div> : article ? <article className="kv-article">
      <span className="kv-eyebrow">TÀI LIỆU NGUỒN</span><h1>{article.title}</h1>
      {article.chunks.map((chunk, index) => <section key={chunk.id} id={chunk.id}>
        <span className="kv-chunk-number">ĐOẠN {String(index + 1).padStart(2, "0")}</span>
        {chunk.heading && <h2>{chunk.heading}</h2>}<p>{chunk.content}</p>
      </section>)}
    </article> : <div className="kv-skeleton" role="status">Đang tải tài liệu…</div>}
  </div>;
}

function KnowledgeLibrary({ canManage }: { canManage: boolean }) {
  const [library, setLibrary] = useState<Library>(), [points, setPoints] = useState<KnowledgeMapPoint[]>([]);
  const [tab, setTab] = useState("map"), [filter, setFilter] = useState("all"), [query, setQuery] = useState("");
  const [selectedId, setSelectedId] = useState(""), [title, setTitle] = useState(""), [content, setContent] = useState("");
  const [scope, setScope] = useState<KnowledgeScope>("system");
  const [question, setQuestion] = useState(""), [rerank, setRerank] = useState(false), [results, setResults] = useState<KnowledgeSearch>();
  const [busy, setBusy] = useState(""), [error, setError] = useState(""), [notice, setNotice] = useState("");
  const preview = useMemo(() => splitDocument(content), [content]);
  async function refresh(signal?: AbortSignal) {
    const [data, map] = await Promise.all([
      request<Library>("/api/knowledge", { signal }), request<KnowledgeMapPoint[]>("/api/knowledge/map", { signal }),
    ]);
    setLibrary(data); setPoints(map);
  }
  useEffect(() => {
    const controller = new AbortController();
    void refresh(controller.signal).catch(error => { if (!controller.signal.aborted) setError(error.message); });
    return () => controller.abort();
  }, []);
  async function run(label: string, work: () => Promise<void>) {
    setBusy(label); setError(""); setNotice("");
    try { await work(); } catch (error) { setError((error as Error).message); } finally { setBusy(""); }
  }
  const documents = (library?.documents ?? []).filter(doc => (filter === "all" || doc.scope === filter) && doc.title.toLocaleLowerCase().includes(query.toLocaleLowerCase()));
  const visiblePoints = useMemo(() => points.filter(point =>
    (filter === "all" || point.scope === filter) && `${point.title} ${point.heading} ${point.content}`.toLocaleLowerCase().includes(query.toLocaleLowerCase())), [points, filter, query]);
  const selected = visiblePoints.find(point => point.id === selectedId) ?? visiblePoints[0];
  const chunks = library?.documents.reduce((sum, doc) => sum + (doc.published ? doc.chunks : 0), 0) ?? 0;
  const indexed = library?.documents.reduce((sum, doc) => sum + (doc.published ? doc.indexed : 0), 0) ?? 0;
  return <>
    <section className="kv-intro">
      <div><span className="kv-eyebrow"><span/>KNOWLEDGE EXPLORER</span><h1>Không gian tri thức<span>.</span></h1>
        <p>Từ tài liệu đến ngữ nghĩa. Khám phá nguồn dữ liệu giúp trợ lý hiểu hệ thống của bạn.</p></div>
      <Button appearance="primary" icon={<Plus size={17}/>} disabled={!canManage} title={canManage ? undefined : "Chỉ quản trị viên có thể thêm tài liệu"}
        onClick={() => setTab("documents")}>Thêm tài liệu</Button>
    </section>
    <div className="kv-overview">
      <div><FileText size={18}/><strong>{library?.documents.filter(doc => doc.published).length ?? "—"}</strong><span>Tài liệu</span></div>
      <div><Graph size={18}/><strong>{library ? indexed : "—"}<small> / {chunks}</small></strong><span>Đoạn đã có vector</span></div>
      <div className="kv-model"><span className="kv-live-dot"/><span><b>Embedding model</b><code>{library?.model ?? "Chờ kết nối kho tri thức"}</code></span></div>
    </div>
    {error && <div className="kv-error" role="alert"><strong>Kho tri thức cần được kiểm tra</strong><p>{error}</p>
      {!library && <><button onClick={() => void run("Đang kết nối lại", () => refresh())}>Thử kết nối lại</button>
        {canManage && <a href="/knowledge-setup.sql" download>Tải SQL cài đặt</a>}</>}</div>}
    {notice && <div className="kv-notice" role="status"><CheckCircle size={17}/>{notice}</div>}
    {busy && <p className="kv-busy" role="status"><CircleNotch size={16}/>{busy}…</p>}
    <nav className="kv-tabs" aria-label="Chức năng kho tri thức">
      {[["map", "Bản đồ vector", <Cube size={17}/>], ["documents", "Tài liệu", <Books size={17}/>], ["search", "Thử truy xuất", <Flask size={17}/>]].map(([id, label, icon]) =>
        <button key={String(id)} aria-current={tab === id ? "page" : undefined} onClick={() => setTab(String(id))}>{icon}{label}</button>)}
      <span>NGUỒN DÙNG CHUNG · QUYỀN THEO TÀI KHOẢN</span>
    </nav>
    {tab === "map" && <div className="kv-explorer">
      <aside className="kv-library">
        <div className="kv-library-heading"><h2>Nguồn tri thức</h2><span>{documents.length}</span></div>
        <label className="kv-search"><MagnifyingGlass size={16}/><input aria-label="Tìm tài liệu" placeholder="Tìm tài liệu…" value={query} onChange={event => setQuery(event.target.value)}/></label>
        <label className="kv-filter">Phạm vi<select aria-label="Lọc phạm vi" value={filter} onChange={event => setFilter(event.target.value)}>
          <option value="all">Tất cả ứng dụng</option>{knowledgeScopes.map(key => <option key={key} value={key}>{scopeLabels[key]}</option>)}</select></label>
        <div className="kv-document-list">
          {!library && !error && <div className="kv-skeleton" role="status">Đang tải danh mục…</div>}
          {documents.map(doc => <button key={doc.id} className={selected?.id.startsWith(doc.id + "-") ? "is-selected" : ""}
            onClick={() => {
              const point = visiblePoints.find(point => point.id.startsWith(doc.id + "-"));
              if (point) setSelectedId(point.id);
              else { setTab("documents"); setQuery(""); }
            }}><FileText size={16}/><span><strong>{doc.title}</strong><small>{scopeLabels[doc.scope ?? "hcmue"]} · {doc.indexed}/{doc.chunks} vector</small></span>
            <i className={doc.indexed ? "is-indexed" : ""}/></button>)}
          {library && !documents.length && <p className="kv-muted">Không tìm thấy tài liệu trong phạm vi này.</p>}
        </div>
        <footer><span className="kv-status-dot"/>{indexed ? "Dữ liệu đã lập chỉ mục" : "Cần tạo vector để xem bản đồ"}</footer>
      </aside>
      <KnowledgeMap points={visiblePoints} selectedId={selected?.id ?? ""} onSelect={setSelectedId}/>
      <aside className="kv-inspector">
        <span className="kv-eyebrow">ĐOẠN ĐANG CHỌN</span>
        {selected ? <>
          <h2>{selected.heading || selected.title}</h2><span className="kv-scope-chip">{scopeLabels[selected.scope ?? "hcmue"]}</span>
          <p className="kv-inspector-source">{selected.title}</p><p className="kv-excerpt">{selected.content}</p>
          <label className="kv-filter">Đoạn đang xem<select aria-label="Đoạn đang xem" value={selected.id} onChange={event => setSelectedId(event.target.value)}>
            {visiblePoints.map(point => <option key={point.id} value={point.id}>{point.title}{point.heading ? ` · ${point.heading}` : ""}</option>)}</select></label>
          <dl><div><dt>Số chiều gốc</dt><dd>{selected.embedding.length}</dd></div><div><dt>Phép chiếu</dt><dd>PCA</dd></div></dl>
          <p className="kv-muted">Các đường nối thể hiện độ gần cosine. Vị trí 2D/3D là phép chiếu để quan sát.</p>
        </> : <div className="kv-inspector-empty"><CursorIcon/><h2>Đọc sâu hơn một điểm</h2><p>Chọn một điểm trên bản đồ để xem nội dung mà AI có thể truy xuất.</p>
          {canManage && <><Button disabled={!library || !!busy || !library.embeddingEnabled} onClick={() => void run("Đang lập chỉ mục", async () => {
            await post(`${adminPath}/index-guides`); await refresh(); setNotice("Đã lập chỉ mục các bài hướng dẫn có sẵn.");
          })}>Lập chỉ mục bài có sẵn</Button>
          {!library?.embeddingEnabled && library && <small>Cấu hình OPENROUTER_API_KEY trên backend để tạo vector.</small>}</>}
        </div>}
      </aside>
    </div>}
    {tab === "documents" && <div className="kv-documents-layout">
      {canManage && <section className="kv-editor">
        <span className="kv-eyebrow">LÀM GIÀU NGUỒN DỮ LIỆU</span><h2>Thêm tài liệu</h2><p className="kv-muted">Chỉ xuất bản hướng dẫn dùng chung. Mọi tài khoản đang hoạt động đều có thể đọc.</p>
        <form onSubmit={event => { event.preventDefault(); void run("Đang xuất bản tài liệu", async () => {
          await post(adminPath, { title, content, scope }); setTitle(""); setContent(""); await refresh(); setNotice("Tài liệu đã được xuất bản.");
        }); }}>
          <Field label="Tiêu đề"><Input required maxLength={160} value={title} onChange={(_, data) => setTitle(data.value)}/></Field>
          <Field label="Ứng dụng"><Select value={scope} onChange={(_, data) => setScope(data.value as KnowledgeScope)}>
            {knowledgeScopes.map(key => <option key={key} value={key}>{scopeLabels[key]}</option>)}</Select></Field>
          <Field label="Tải tệp .md hoặc .txt" hint="Tối đa 12.000 ký tự."><input type="file" aria-label="Tải tệp .md hoặc .txt" accept=".md,.txt" disabled={!!busy} onChange={event => {
            const file = event.target.files?.[0]; event.target.value = ""; if (!file) return;
            void run("Đang đọc tệp", async () => {
              if (!/\.(md|txt)$/i.test(file.name) || file.size > MAX_DOCUMENT_LENGTH * 4) throw new Error("Chọn tệp .md hoặc .txt có tối đa 12.000 ký tự.");
              const value = await file.text(); if (value.length > MAX_DOCUMENT_LENGTH) throw new Error("Tệp vượt quá 12.000 ký tự.");
              setTitle(file.name.replace(/\.[^.]+$/, "").slice(0, 160)); setContent(value);
            });
          }}/></Field>
          <Field label="Nội dung" hint="Tiêu đề Markdown giúp chia mục. Tối đa 40 đoạn."><Textarea rows={8} value={content} maxLength={MAX_DOCUMENT_LENGTH} onChange={(_, data) => setContent(data.value)}/></Field>
          {preview.length > 0 && <details className="kv-preview"><summary>Xem trước {preview.length} đoạn</summary>{preview.map((chunk, index) =>
            <section key={index}><strong>{chunk.heading || `Đoạn ${index + 1}`}</strong><p>{chunk.content}</p></section>)}</details>}
          {preview.length > MAX_DOCUMENT_CHUNKS && <p className="kv-error" role="alert">Tài liệu có hơn 40 đoạn. Gộp bớt mục hoặc chia thành hai tài liệu.</p>}
          <Button appearance="primary" type="submit" icon={<UploadSimple size={16}/>} disabled={!library || !!busy || !title.trim() || !preview.length || preview.length > MAX_DOCUMENT_CHUNKS}>Xuất bản</Button>
        </form>
      </section>}
      <section className="kv-register"><div className="kv-section-heading"><div><span className="kv-eyebrow">DANH MỤC NGUỒN</span><h2>Tài liệu trong kho</h2></div>
        {canManage && <Button disabled={!library || !!busy || !library.embeddingEnabled} title={library?.embeddingEnabled ? undefined : "Cần cấu hình OpenRouter ở backend"}
          onClick={() => void run("Đang lập chỉ mục", async () => { await post(`${adminPath}/index-guides`); await refresh(); setNotice("Đã lập chỉ mục các bài hướng dẫn có sẵn."); })}>Lập chỉ mục bài có sẵn</Button>}</div>
        {!library?.embeddingEnabled && library && <p className="kv-muted">Chưa có API key OpenRouter. Vẫn có thể xuất bản và tìm tài liệu bằng từ khóa.</p>}
        <ul className="kv-register-list">{(library?.documents ?? []).map(doc => <li key={doc.id}>
          <FileText size={18}/><div><a href={doc.href ?? documentHref(doc.id)}>{doc.title}</a><p>{scopeLabels[doc.scope ?? "hcmue"]} · {doc.published ? `${doc.indexed}/${doc.chunks} đoạn có vector` : "Đã ẩn khỏi truy xuất"}</p></div>
          {canManage && doc.id.startsWith("doc-") && doc.published && <div className="kv-row-actions">
            {doc.indexed < doc.chunks && <Button size="small" disabled={!!busy || !library?.embeddingEnabled} title={library?.embeddingEnabled ? undefined : "Cấu hình OpenRouter để tạo vector"} onClick={() => void run("Đang tạo vector", async () => {
              await post(`${adminPath}/${doc.id}/index`); await refresh(); setNotice("Đã tạo vector cho tài liệu.");
            })}>Tạo vector</Button>}
            <Button size="small" appearance="subtle" disabled={!!busy} onClick={() => void run("Đang ẩn tài liệu", async () => {
              await request(`${adminPath}/${doc.id}`, { method: "DELETE" }); await refresh(); setNotice("Đã ẩn tài liệu khỏi truy xuất.");
            })}>Ẩn</Button>
          </div>}
        </li>)}</ul>
      </section>
    </div>}
    {tab === "search" && <section className="kv-lab">
      <div><span className="kv-eyebrow">RETRIEVAL LAB</span><h2>Một câu hỏi. Những nguồn nào được tìm thấy?</h2><p className="kv-muted">Đối chiếu truy xuất từ khóa, vector và kết hợp trước khi hỏi model.</p></div>
      {canManage ? <form onSubmit={event => { event.preventDefault(); void run("Đang thử truy xuất", async () => setResults(await post(`${adminPath}/search`, { question, rerank }))); }}>
        <Field label="Câu hỏi thử"><Input maxLength={500} value={question} onChange={(_, data) => setQuestion(data.value)} placeholder="Ví dụ: Tôi chưa biết lần chạy đã gửi đơn chưa"/></Field>
        <Checkbox label="Thử xếp hạng lại bằng OpenRouter" checked={rerank} disabled={!library?.embeddingEnabled || !!busy} onChange={(_, data) => setRerank(data.checked === true)}/>
        <Button appearance="primary" type="submit" disabled={!library || !!busy || !question.trim()}>So sánh kết quả</Button>
      </form> : <p className="kv-muted">Chỉ quản trị viên có thể chạy thử truy xuất. Bạn có thể hỏi Trợ lý AI ở góc màn hình.</p>}
      {results && <>
        <p className="kv-lab-timing">Thời gian truy xuất: {results.elapsedMs} ms · {results.embedding === "used" ? "Đã dùng embedding" : results.embedding === "not-indexed" ? "Chưa có vector phù hợp" : "API embedding chưa khả dụng"}</p>
        {results.rerankUnavailable && <p className="kv-error">Chưa xếp hạng lại được. Kết quả truy xuất ban đầu vẫn hiển thị bên dưới.</p>}
        <div className="kv-results">{([["Kết hợp", results.hybrid], ["Từ khóa", results.keyword], ["Vector", results.vector], ["Xếp hạng lại", results.reranked]] as const).map(([label, matches]) => matches && <section key={label}>
          <h3>{label}<span>{matches.length}</span></h3>{matches.length ? matches.map((match, index) => <article key={match.id}>
            <div><span className="kv-result-number">{String(index + 1).padStart(2, "0")}</span><a href={match.href ?? documentHref(match.id)}>{match.title}<ArrowUpRight size={12}/></a></div>
            <small>Điểm {match.score.toFixed(4)}</small><p>{match.steps.join("\n")}</p>
          </article>) : <p className="kv-muted">Không tìm thấy đoạn phù hợp.</p>}
        </section>)}</div>
      </>}
    </section>}
    <footer className="kv-page-footer"><span><Books size={13}/>Tri thức chung · Truy xuất có nguồn</span><span>Hiển thị tối đa 60 vector mới nhất · Không tự huấn luyện từ chat</span></footer>
  </>;
}
function CursorIcon() { return <span className="kv-inspector-icon"><MagnifyingGlass size={28} weight="thin"/></span>; }
export function HcmueKnowledgePage({ account, logout }: { account: Account; logout(): Promise<void> }) {
  const { dark, toggleTheme } = useTheme();
  const documentId = new URLSearchParams(location.search).get("document");
  return <FluentProvider theme={dark ? darkTheme : lightTheme} className={`kv-page ${dark ? "kv-dark" : ""}`}>
    <WorkspaceHeader title="Kho tri thức & vector" icon={<Graph size={20}/>} dark={dark} toggleTheme={toggleTheme} account={account} logout={logout}
      products={[{ label: "Google Forms", href: "/" }, { label: "HCMUE", href: "/hcmue" }, { label: "ChineseTest", href: "/chinesetest" }]}
      primaryAction={<Button as="a" href="/">Về không gian làm việc</Button>}/>
    <main className="kv-main">{documentId && /^doc-[a-f0-9]{32}$/.test(documentId) ? <ArticleView id={documentId}/> : <KnowledgeLibrary canManage={account.role === "admin"}/>}</main>
  </FluentProvider>;
}
