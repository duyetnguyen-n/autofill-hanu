-- Apply AFTER 202610130001_cloud.sql. Existing users must be approved too.
BEGIN;
CREATE TABLE hanu.accounts (
  user_id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  email text NOT NULL, email_verified boolean NOT NULL DEFAULT false,
  name text NOT NULL DEFAULT '', avatar_url text NOT NULL DEFAULT '', google_sub text NOT NULL DEFAULT '',
  role text NOT NULL DEFAULT 'member' CHECK (role IN ('admin','member')),
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','active','blocked','rejected')),
  contact_name text NOT NULL DEFAULT '', phone text NOT NULL DEFAULT '', purpose text NOT NULL DEFAULT '',
  consent_at timestamptz,
  max_profiles integer NOT NULL DEFAULT 5 CHECK (max_profiles BETWEEN 1 AND 100),
  max_concurrent integer NOT NULL DEFAULT 3 CHECK (max_concurrent BETWEEN 1 AND max_profiles),
  live_enabled boolean NOT NULL DEFAULT false, expires_at timestamptz,
  admin_note text NOT NULL DEFAULT '', version integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(), last_login_at timestamptz NOT NULL DEFAULT now(),
  last_seen_at timestamptz NOT NULL DEFAULT now(), last_session_key text NOT NULL DEFAULT ''
);
CREATE INDEX accounts_email ON hanu.accounts(lower(email));
CREATE INDEX accounts_created ON hanu.accounts(created_at DESC,user_id);
-- Show existing customers in the admin list immediately. Their Google identity
-- is verified again on next login; no old account is automatically approved.
INSERT INTO hanu.accounts(user_id,email,name,created_at,last_login_at,last_seen_at)
  SELECT id,coalesce(email,''),coalesce(raw_user_meta_data->>'full_name',email,''),
    coalesce(created_at,now()),coalesce(last_sign_in_at,created_at,now()),coalesce(last_sign_in_at,created_at,now())
  FROM auth.users;
CREATE TABLE hanu.access_grants (
  email text PRIMARY KEY CHECK (email=lower(email)),
  max_profiles integer NOT NULL CHECK (max_profiles BETWEEN 1 AND 100),
  max_concurrent integer NOT NULL CHECK (max_concurrent BETWEEN 1 AND max_profiles),
  live_enabled boolean NOT NULL DEFAULT false, expires_at timestamptz,
  created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE hanu.admin_events (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY, at timestamptz NOT NULL DEFAULT now(),
  actor uuid REFERENCES auth.users(id) ON DELETE SET NULL, actor_email text NOT NULL,
  target uuid REFERENCES auth.users(id) ON DELETE SET NULL, target_email text NOT NULL,
  action text NOT NULL, details jsonb NOT NULL DEFAULT '{}'
);
CREATE INDEX admin_events_recent ON hanu.admin_events(at DESC,id DESC);
ALTER TABLE hanu.accounts ENABLE ROW LEVEL SECURITY;
ALTER TABLE hanu.access_grants ENABLE ROW LEVEL SECURITY;
ALTER TABLE hanu.admin_events ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON hanu.accounts,hanu.access_grants,hanu.admin_events FROM anon,authenticated;
REVOKE ALL ON SEQUENCE hanu.admin_events_id_seq FROM anon,authenticated;

-- Direct Supabase reads obey the same account gate as HTTP/WebSocket.
CREATE FUNCTION hanu.can_use_account() RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = '' AS $$
  SELECT EXISTS (SELECT 1 FROM hanu.accounts WHERE user_id=(SELECT auth.uid())
    AND status='active' AND email_verified AND (expires_at IS NULL OR expires_at>now())
    AND (role='admin' OR (contact_name<>'' AND phone<>'' AND purpose<>'' AND consent_at IS NOT NULL)))
$$;
REVOKE ALL ON FUNCTION hanu.can_use_account() FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION hanu.can_use_account() TO authenticated;
DO $$ DECLARE t text; BEGIN
  FOREACH t IN ARRAY ARRAY['sessions','groups','runs','locks','attachments','audit'] LOOP
    EXECUTE format('ALTER POLICY owner_read ON hanu.%I USING (owner=(SELECT auth.uid()) AND (SELECT hanu.can_use_account()))', t);
  END LOOP;
END $$;
COMMIT;
