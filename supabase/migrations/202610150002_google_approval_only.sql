BEGIN;

-- Google identity and admin approval are sufficient; contact fields are legacy.
-- Keep owner isolation, email verification, expiry and account status checks.
CREATE OR REPLACE FUNCTION hanu.can_use_account() RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = '' AS $$
  SELECT EXISTS (SELECT 1 FROM hanu.accounts WHERE user_id=(SELECT auth.uid())
    AND status='active' AND email_verified AND (expires_at IS NULL OR expires_at>now()))
$$;
REVOKE ALL ON FUNCTION hanu.can_use_account() FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION hanu.can_use_account() TO authenticated;

COMMIT;
