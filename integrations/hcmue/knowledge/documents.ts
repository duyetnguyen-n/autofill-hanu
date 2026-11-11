export const MAX_DOCUMENT_LENGTH = 12_000;
export const MAX_CHUNK_LENGTH = 700;
export const MAX_DOCUMENT_CHUNKS = 40;
export interface DocumentChunk { heading: string; content: string }

export function splitDocument(body: string): DocumentChunk[] {
  const chunks: DocumentChunk[] = [];
  let heading = "", content = "";
  function flush() {
    if (content) chunks.push({ heading, content });
    content = "";
  }
  for (const raw of body.split(/\r?\n/)) {
    const line = raw.trim();
    const section = /^#{1,6}\s+(.+)$/.exec(line);
    if (section) {
      flush();
      heading = section[1].slice(0, 160);
      continue;
    }
    if (!line) continue;
    let separator = "\n";
    for (let word of line.split(/\s+/)) {
      if (content.length + separator.length + word.length > MAX_CHUNK_LENGTH) flush();
      while (word.length > MAX_CHUNK_LENGTH) {
        let end = MAX_CHUNK_LENGTH;
        const last = word.charCodeAt(end - 1);
        if (last >= 0xd800 && last <= 0xdbff) end--;
        content = word.slice(0, end);
        flush();
        word = word.slice(end);
      }
      content += (content ? separator : "") + word;
      separator = " ";
    }
  }
  flush();
  return chunks;
}

export interface KnowledgeMatch {
  id: string;
  title: string;
  steps: string[];
  href?: string;
  score: number;
}
export interface KnowledgeSearch {
  keyword: KnowledgeMatch[];
  vector: KnowledgeMatch[];
  hybrid: KnowledgeMatch[];
  embedding: "used" | "unavailable" | "not-indexed";
  reranked?: KnowledgeMatch[];
  rerankUnavailable?: boolean;
  elapsedMs?: number;
}
export interface KnowledgeDocument {
  id: string;
  title: string;
  published: boolean;
  chunks: number;
  indexed: number;
}
export interface KnowledgeMapPoint extends DocumentChunk {
  id: string;
  title: string;
  embedding: number[];
}
