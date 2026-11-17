-- ============================================================
-- AASMNHS Online Enrollment - Deleted Accounts Archive
-- Stores a full snapshot of every deleted student/staff/admin
-- account so it can be retrieved or restored later.
-- Paste this into Supabase -> SQL Editor -> Click RUN
-- ============================================================

CREATE TABLE IF NOT EXISTS public.deleted_accounts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid,
  email text,
  full_name text,
  role text,
  user_type text,
  profile_data jsonb DEFAULT '{}'::jsonb,
  auth_data jsonb DEFAULT '{}'::jsonb,
  role_profile_data jsonb DEFAULT '{}'::jsonb,
  applications_data jsonb DEFAULT '[]'::jsonb,
  deleted_at timestamptz DEFAULT now(),
  deleted_by text,
  deleted_by_id uuid,
  restored_at timestamptz,
  restored_by text,
  notes text
);

CREATE INDEX IF NOT EXISTS deleted_accounts_email_idx
  ON public.deleted_accounts (lower(email));

CREATE INDEX IF NOT EXISTS deleted_accounts_deleted_at_idx
  ON public.deleted_accounts (deleted_at DESC);

CREATE INDEX IF NOT EXISTS deleted_accounts_role_idx
  ON public.deleted_accounts (lower(role));

ALTER TABLE public.deleted_accounts ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Admins can view deleted accounts" ON public.deleted_accounts;
CREATE POLICY "Admins can view deleted accounts"
  ON public.deleted_accounts
  FOR SELECT
  TO authenticated
  USING (public.is_admin());

GRANT ALL ON TABLE public.deleted_accounts TO service_role;
GRANT SELECT ON TABLE public.deleted_accounts TO authenticated;

NOTIFY pgrst, 'reload schema';
