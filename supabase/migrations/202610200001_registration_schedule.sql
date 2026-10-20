BEGIN;
CREATE TABLE IF NOT EXISTS hanu.registration_schedules (
  owner uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  data jsonb NOT NULL
);
ALTER TABLE hanu.registration_schedules ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON hanu.registration_schedules FROM anon, authenticated;
DO $$ BEGIN IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname='service_role') THEN
  GRANT SELECT, INSERT, UPDATE, DELETE ON hanu.registration_schedules TO service_role;
END IF; END $$;
COMMIT;
