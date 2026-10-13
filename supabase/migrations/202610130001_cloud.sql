-- Run once in a NEW Supabase project (SQL Editor or `supabase db push`).
-- Application tables are not in the default Data API schema. The Node backend
-- checks ownership on every operation; RLS also protects direct user access.
CREATE SCHEMA IF NOT EXISTS hanu;

CREATE TABLE hanu.sessions (
  owner uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  id text NOT NULL CHECK (length(id) BETWEEN 20 AND 80),
  token_hash text NOT NULL,
  extension_id text NOT NULL,
  revoked boolean NOT NULL DEFAULT false,
  version integer NOT NULL DEFAULT 0,
  data jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (owner, id), UNIQUE (id)
);
CREATE TABLE hanu.groups (
  owner uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  id text NOT NULL,
  data jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (owner, id)
);
CREATE TABLE hanu.runs (
  owner uuid NOT NULL,
  session text NOT NULL,
  id text NOT NULL,
  data jsonb NOT NULL,
  seq integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (owner, session, id),
  FOREIGN KEY (owner, session) REFERENCES hanu.sessions(owner, id) ON DELETE CASCADE,
  FOREIGN KEY (owner, id) REFERENCES hanu.groups(owner, id)
);
CREATE TABLE hanu.locks (
  owner uuid NOT NULL,
  session text NOT NULL,
  form text NOT NULL,
  run text NOT NULL,
  resolution text NOT NULL CHECK (resolution IN ('local_reserved','uncertain','received','not_received')),
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (owner, session, form, run),
  FOREIGN KEY (owner, session, run) REFERENCES hanu.runs(owner, session, id)
);
CREATE TABLE hanu.pairing (
  code_hash text PRIMARY KEY,
  owner uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  replace_session text,
  expires_at timestamptz NOT NULL,
  FOREIGN KEY (owner, replace_session) REFERENCES hanu.sessions(owner, id)
);
CREATE TABLE hanu.attachments (
  owner uuid NOT NULL,
  session text NOT NULL,
  id text NOT NULL,
  hash text NOT NULL,
  object_path text NOT NULL UNIQUE,
  size integer NOT NULL CHECK (size BETWEEN 0 AND 10485760),
  PRIMARY KEY (owner, session, id),
  FOREIGN KEY (owner, session) REFERENCES hanu.sessions(owner, id) ON DELETE CASCADE
);
CREATE TABLE hanu.audit (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  owner uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  at timestamptz NOT NULL DEFAULT now(),
  session text,
  run text,
  kind text NOT NULL,
  message text NOT NULL
);
-- One active coordinator process in v1. A database lease also fences submit
-- grants if a previous server loses its connection and resumes late.
CREATE TABLE hanu.server_lease (
  id boolean PRIMARY KEY DEFAULT true CHECK (id),
  instance text NOT NULL,
  expires_at timestamptz NOT NULL
);
CREATE INDEX runs_history ON hanu.runs(owner,session,created_at DESC);
CREATE INDEX locks_by_form ON hanu.locks(owner,session,form);
CREATE INDEX audit_by_owner ON hanu.audit(owner,at DESC);

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['sessions','groups','runs','locks','pairing','attachments','audit'] LOOP
    EXECUTE format('ALTER TABLE hanu.%I ENABLE ROW LEVEL SECURITY', t);
  END LOOP;
  FOREACH t IN ARRAY ARRAY['groups','runs','locks','attachments','audit'] LOOP
    EXECUTE format('CREATE POLICY owner_read ON hanu.%I FOR SELECT TO authenticated USING (owner = (SELECT auth.uid()))',t);
  END LOOP;
END $$;
ALTER TABLE hanu.server_lease ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON SCHEMA hanu FROM anon, authenticated;
REVOKE ALL ON ALL TABLES IN SCHEMA hanu FROM anon, authenticated;
REVOKE ALL ON ALL SEQUENCES IN SCHEMA hanu FROM anon, authenticated;
GRANT USAGE ON SCHEMA hanu TO authenticated;
GRANT SELECT ON hanu.groups,hanu.runs,hanu.locks,hanu.attachments,hanu.audit TO authenticated;
-- Do not expose pairing codes / token hashes through a user-accessible table.
CREATE VIEW hanu.profile_views WITH (security_invoker = true) AS
  SELECT owner,id,data,created_at FROM hanu.sessions;
CREATE POLICY owner_read ON hanu.sessions FOR SELECT TO authenticated USING (owner = (SELECT auth.uid()));
GRANT SELECT (owner,id,data,created_at) ON hanu.sessions TO authenticated;
GRANT SELECT ON hanu.profile_views TO authenticated;

INSERT INTO storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
VALUES ('hanu-private','hanu-private',false,10485760,ARRAY['application/octet-stream'])
ON CONFLICT(id) DO NOTHING;
-- Backend-only Storage in v1: no anon/authenticated object policy is granted.
-- Downloads go through authenticated API / extension commands after ownership
-- checks; object paths are never made public or accepted from the browser.
