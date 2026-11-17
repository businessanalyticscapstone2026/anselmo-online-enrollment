-- ============================================================
-- AASMNHS Online Enrollment - Admin Dashboard Migration
-- Adds enrollment_settings, activity_logs, and cluster column to profiles
-- Paste this into Supabase -> SQL Editor -> Click RUN
-- ============================================================

-- 1. Ensure profiles table has cluster column
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS cluster text;

-- Backfill cluster in profiles from student_applications where possible
UPDATE public.profiles p
SET cluster = sa.selected_cluster
FROM public.student_applications sa
WHERE (sa.user_id = p.id OR (sa.user_id IS NULL AND lower(sa.email) = lower(p.email)))
  AND sa.selected_cluster IS NOT NULL
  AND (p.cluster IS NULL OR trim(p.cluster) = '');

-- 2. Create enrollment_settings table (exact live schema)
CREATE TABLE IF NOT EXISTS public.enrollment_settings (
  id integer PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  enrollment_start_date date,
  enrollment_end_date date,
  updated_at timestamptz DEFAULT now(),
  updated_by uuid REFERENCES auth.users(id) ON DELETE SET NULL
);

ALTER TABLE public.enrollment_settings
  ADD COLUMN IF NOT EXISTS enrollment_start_date date,
  ADD COLUMN IF NOT EXISTS enrollment_end_date date,
  ADD COLUMN IF NOT EXISTS updated_at timestamptz DEFAULT now(),
  ADD COLUMN IF NOT EXISTS updated_by uuid REFERENCES auth.users(id) ON DELETE SET NULL;

-- Create the singleton row without hardcoded sample dates.
INSERT INTO public.enrollment_settings (id)
VALUES (1)
ON CONFLICT (id) DO NOTHING;

-- 3. Create activity_logs table
CREATE TABLE IF NOT EXISTS public.activity_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at timestamptz DEFAULT now(),
  user_type text NOT NULL,
  user_email text NOT NULL,
  ip_address text,
  action text NOT NULL
);

CREATE INDEX IF NOT EXISTS activity_logs_created_at_idx
  ON public.activity_logs (created_at DESC);

-- 4. Enable RLS
ALTER TABLE public.enrollment_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.activity_logs ENABLE ROW LEVEL SECURITY;

-- 5. Policies for enrollment_settings
DROP POLICY IF EXISTS "Anyone can view enrollment settings" ON public.enrollment_settings;
CREATE POLICY "Anyone can view enrollment settings"
  ON public.enrollment_settings
  FOR SELECT
  TO anon, authenticated
  USING (true);

DROP POLICY IF EXISTS "Admins can update enrollment settings" ON public.enrollment_settings;
CREATE POLICY "Admins can update enrollment settings"
  ON public.enrollment_settings
  FOR ALL
  TO authenticated
  USING (public.is_admin())
  WITH CHECK (public.is_admin());

-- 6. Policies for activity_logs
DROP POLICY IF EXISTS "Admins can view activity logs" ON public.activity_logs;
CREATE POLICY "Admins can view activity logs"
  ON public.activity_logs
  FOR SELECT
  TO authenticated
  USING (public.is_admin());

DROP POLICY IF EXISTS "Admins can delete activity logs" ON public.activity_logs;
CREATE POLICY "Admins can delete activity logs"
  ON public.activity_logs
  FOR DELETE
  TO authenticated
  USING (public.is_admin());

DROP POLICY IF EXISTS "Allow authenticated to insert activity logs" ON public.activity_logs;
CREATE POLICY "Allow authenticated to insert activity logs"
  ON public.activity_logs
  FOR INSERT
  TO authenticated
  WITH CHECK (true);

-- 7. Permissions
GRANT SELECT ON TABLE public.enrollment_settings TO anon, authenticated;
GRANT ALL ON TABLE public.enrollment_settings TO service_role;
GRANT ALL ON TABLE public.enrollment_settings TO authenticated;

GRANT SELECT, INSERT, DELETE ON TABLE public.activity_logs TO authenticated;
GRANT ALL ON TABLE public.activity_logs TO service_role;

-- 8. Create removed_accounts table to track accounts removed by administrators
CREATE TABLE IF NOT EXISTS public.removed_accounts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email text NOT NULL UNIQUE,
  user_id uuid,
  role text,
  removed_at timestamptz DEFAULT now(),
  removed_by text
);

CREATE INDEX IF NOT EXISTS removed_accounts_email_idx ON public.removed_accounts (lower(email));
ALTER TABLE public.removed_accounts ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Anyone can view removed accounts" ON public.removed_accounts;
CREATE POLICY "Anyone can view removed accounts"
  ON public.removed_accounts
  FOR SELECT
  TO anon, authenticated
  USING (true);

GRANT SELECT, INSERT ON TABLE public.removed_accounts TO anon, authenticated;
GRANT ALL ON TABLE public.removed_accounts TO service_role;

-- Ask PostgREST to refresh its schema cache so the API sees the latest columns.
NOTIFY pgrst, 'reload schema';


