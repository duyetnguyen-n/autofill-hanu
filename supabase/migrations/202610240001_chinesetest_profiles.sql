-- Portrait originals live in the existing private Storage bucket; metadata and
-- drafts live here. Only the authenticated backend can access this schema.
CREATE TABLE IF NOT EXISTS chinesetest.profiles (
 owner uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
 runner_id uuid NOT NULL REFERENCES chinesetest.runners(id) ON DELETE CASCADE,
 account_id text NOT NULL CHECK(length(account_id) BETWEEN 1 AND 100),
 personal jsonb NOT NULL DEFAULT '{}',
 revision integer NOT NULL DEFAULT 1,
 photo_key text,
 photo_version text,
 photo_mime text CHECK(photo_mime IN ('image/jpeg','image/png')),
 synced_photo_version text,
 chinesetest_photo text NOT NULL DEFAULT '',
 status text NOT NULL DEFAULT 'draft' CHECK(status IN ('draft','synced')),
 updated_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(owner,runner_id,account_id)
);
ALTER TABLE chinesetest.profiles ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON chinesetest.profiles FROM PUBLIC, anon, authenticated;
