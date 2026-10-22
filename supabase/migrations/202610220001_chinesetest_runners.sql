-- Additive provider storage. No changes to hanu sessions/runs or Google Forms.
CREATE SCHEMA IF NOT EXISTS chinesetest;
REVOKE ALL ON SCHEMA chinesetest FROM PUBLIC;
CREATE TABLE IF NOT EXISTS chinesetest.runners (
 id uuid PRIMARY KEY,
 owner uuid REFERENCES auth.users(id) ON DELETE CASCADE,
 name text NOT NULL CHECK(length(name) BETWEEN 1 AND 100),
 platform text NOT NULL CHECK(platform IN ('darwin','win32','test')),
 public_key jsonb NOT NULL,
 fingerprint text NOT NULL,
 token_hash text NOT NULL,
 pair_hash text UNIQUE,
 pair_expires_at timestamptz,
 created_at timestamptz NOT NULL DEFAULT now(),
 last_seen timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE chinesetest.runners ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON chinesetest.runners FROM PUBLIC, anon, authenticated;
CREATE INDEX IF NOT EXISTS chinesetest_runner_owner ON chinesetest.runners(owner);
-- Opaque candidate/exam claims prevent duplicate sends across a user's runners.
CREATE TABLE IF NOT EXISTS chinesetest.claims (
 owner uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
 claim_key text NOT NULL CHECK(claim_key ~ '^[a-f0-9]{64}$'),
 runner_id uuid NOT NULL,
 run_id uuid NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(owner,claim_key)
);
ALTER TABLE chinesetest.claims ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON chinesetest.claims FROM PUBLIC, anon, authenticated;
