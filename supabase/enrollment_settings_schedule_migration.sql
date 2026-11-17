-- ============================================================
-- AASMNHS Online Enrollment
-- Enrollment Settings: exact live schema + RLS verification
--
-- Live table verified through the Supabase REST API:
--   public.enrollment_settings
--     id                    integer primary key (default 1)
--     enrollment_start_date date
--     enrollment_end_date   date
--     updated_at            timestamptz
--     updated_by            uuid
--
-- This migration is idempotent and safe to run multiple times.
-- It does NOT create the older start_date/start_time/end_date/
-- end_time/status/is_system_enabled/admin_email columns.
-- ============================================================

-- ------------------------------------------------------------
-- 0. Role helper functions used by RLS policies and the trigger
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.current_user_role()
RETURNS text
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT lower(trim(role))
  FROM public.profiles
  WHERE id = auth.uid()
  LIMIT 1
$$;

CREATE OR REPLACE FUNCTION public.is_staff()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT coalesce(public.current_user_role() IN ('staff', 'registrar'), false)
$$;

CREATE OR REPLACE FUNCTION public.is_admin()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT coalesce(public.current_user_role() = 'admin', false)
$$;

CREATE OR REPLACE FUNCTION public.is_staff_or_admin()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT coalesce(
    public.current_user_role() IN ('staff', 'registrar', 'admin'),
    false
  )
$$;

REVOKE ALL ON FUNCTION public.current_user_role() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.is_staff() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.is_admin() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.is_staff_or_admin() FROM PUBLIC;

GRANT EXECUTE ON FUNCTION public.current_user_role() TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.is_staff() TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.is_admin() TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.is_staff_or_admin() TO authenticated, service_role;

-- ------------------------------------------------------------
-- 1. enrollment_settings table (exact live schema)
-- ------------------------------------------------------------
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

-- Create the singleton row safely. Never creates duplicates.
INSERT INTO public.enrollment_settings (id)
VALUES (1)
ON CONFLICT (id) DO NOTHING;

-- ------------------------------------------------------------
-- 2. activity_logs table (settings changes are audited)
-- ------------------------------------------------------------
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

-- ------------------------------------------------------------
-- 3. Row Level Security
-- ------------------------------------------------------------
ALTER TABLE public.enrollment_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.activity_logs ENABLE ROW LEVEL SECURITY;

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

-- ------------------------------------------------------------
-- 4. Table permissions
-- ------------------------------------------------------------
GRANT SELECT ON TABLE public.enrollment_settings TO anon, authenticated;
GRANT ALL ON TABLE public.enrollment_settings TO service_role;
GRANT ALL ON TABLE public.enrollment_settings TO authenticated;

GRANT SELECT, INSERT, DELETE ON TABLE public.activity_logs TO authenticated;
GRANT ALL ON TABLE public.activity_logs TO service_role;

-- ------------------------------------------------------------
-- 5. Date-only availability check using the Asia/Manila calendar
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.is_enrollment_open()
RETURNS boolean
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  s public.enrollment_settings%ROWTYPE;
  today_manila date;
BEGIN
  SELECT * INTO s
  FROM public.enrollment_settings
  WHERE id = 1
  LIMIT 1;

  IF NOT FOUND THEN
    RETURN false;
  END IF;

  IF s.enrollment_start_date IS NULL OR s.enrollment_end_date IS NULL THEN
    RETURN false;
  END IF;

  today_manila := (now() AT TIME ZONE 'Asia/Manila')::date;

  RETURN today_manila BETWEEN s.enrollment_start_date AND s.enrollment_end_date;
END;
$$;

REVOKE ALL ON FUNCTION public.is_enrollment_open() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.is_enrollment_open() TO anon, authenticated, service_role;

-- ------------------------------------------------------------
-- 6. Database-level enforcement for direct application inserts
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.enforce_enrollment_window()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF coalesce(auth.role(), '') = 'service_role' THEN
    RETURN NEW;
  END IF;

  IF public.is_staff_or_admin() THEN
    RETURN NEW;
  END IF;

  IF NOT public.is_enrollment_open() THEN
    RAISE EXCEPTION 'Online enrollment is currently closed. New applications are not being accepted.'
      USING ERRCODE = 'P0001';
  END IF;

  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.enforce_enrollment_window() FROM PUBLIC;

DO $$
BEGIN
  IF to_regclass('public.student_applications') IS NOT NULL THEN
    DROP TRIGGER IF EXISTS enforce_enrollment_window ON public.student_applications;
    CREATE TRIGGER enforce_enrollment_window
      BEFORE INSERT ON public.student_applications
      FOR EACH ROW EXECUTE FUNCTION public.enforce_enrollment_window();
  END IF;
END
$$;

-- ------------------------------------------------------------
-- 7. Verification
-- ------------------------------------------------------------
SELECT
  id,
  enrollment_start_date,
  enrollment_end_date,
  updated_at,
  updated_by,
  public.is_enrollment_open() AS currently_open
FROM public.enrollment_settings
WHERE id = 1;

-- Ask PostgREST to refresh its schema cache so the API sees the latest columns.
NOTIFY pgrst, 'reload schema';
