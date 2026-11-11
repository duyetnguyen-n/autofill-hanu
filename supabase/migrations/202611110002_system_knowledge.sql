-- Shared AI library. Safe to run with or without the earlier HCMUE RAG migration.
-- Keep the existing tables and document IDs so existing citations remain valid.
CREATE SCHEMA IF NOT EXISTS hcmue;
REVOKE ALL ON SCHEMA hcmue FROM PUBLIC;
CREATE SCHEMA IF NOT EXISTS extensions;
CREATE EXTENSION IF NOT EXISTS vector WITH SCHEMA extensions;
CREATE TABLE IF NOT EXISTS hcmue.knowledge_documents (
  id text PRIMARY KEY, title text NOT NULL, content_hash text NOT NULL UNIQUE,
  published boolean NOT NULL DEFAULT true, created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE hcmue.knowledge_documents ADD COLUMN IF NOT EXISTS scope text NOT NULL DEFAULT 'hcmue'
  CHECK (scope IN ('system', 'forms', 'hcmue', 'chinesetest'));
CREATE TABLE IF NOT EXISTS hcmue.knowledge_chunks (
  document_id text NOT NULL REFERENCES hcmue.knowledge_documents(id) ON DELETE CASCADE,
  ordinal integer NOT NULL, heading text NOT NULL, content text NOT NULL,
  search_text tsvector NOT NULL, embedding extensions.vector, embedding_model text,
  PRIMARY KEY (document_id, ordinal)
);
CREATE INDEX IF NOT EXISTS hcmue_knowledge_search ON hcmue.knowledge_chunks USING gin(search_text);
ALTER TABLE hcmue.knowledge_documents ENABLE ROW LEVEL SECURITY;
ALTER TABLE hcmue.knowledge_chunks ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON hcmue.knowledge_documents, hcmue.knowledge_chunks FROM PUBLIC, anon, authenticated;
