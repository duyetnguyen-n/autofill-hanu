-- Additive provider storage. No changes to hanu sessions/runs or Google Forms.
CREATE SCHEMA IF NOT EXISTS hcmue;
REVOKE ALL ON SCHEMA hcmue FROM PUBLIC;
CREATE TABLE IF NOT EXISTS hcmue.runners (
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
ALTER TABLE hcmue.runners ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON hcmue.runners FROM PUBLIC, anon, authenticated;
CREATE INDEX IF NOT EXISTS hcmue_runner_owner ON hcmue.runners(owner);
