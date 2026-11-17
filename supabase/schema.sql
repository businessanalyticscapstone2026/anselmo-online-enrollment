-- ============================================================
-- AASMNHS Online Enrollment - Supabase Complete Database Fix
-- Targets table: public.student_applications & storage.buckets
-- Paste this entire file into Supabase -> SQL Editor -> Click RUN.
-- This fixes:
-- 1. Secure inserts by enabling RLS with scoped policies
-- 2. user_id NOT NULL error (makes user_id optional for new applicants)
-- 3. status check constraint error
-- 4. Missing columns (track, email, address, guardians, documents)
-- 5. Public document reads with anon writes disabled
-- ============================================================

-- 1. Create table if not exists with core columns
CREATE TABLE IF NOT EXISTS public.student_applications (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  first_name text,
  middle_name text,
  last_name text,
  birth_date date,
  sex text,
  contact_number text,
  address text,
  status text DEFAULT 'pending',
  submitted_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

-- 1b. Profiles used for role-based access control
CREATE TABLE IF NOT EXISTS public.profiles (
  id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  full_name text,
  email text,
  role text DEFAULT 'student',
  created_at timestamptz DEFAULT now()
);

-- 1c. Student dashboard profile (one row per student)
CREATE TABLE IF NOT EXISTS public.student_profiles (
  id uuid PRIMARY KEY,
  status text,
  full_name text,
  track text,
  selected_cluster text,
  email text,
  contact_number text,
  birth_date date,
  address text,
  assigned_section text,
  adviser text
);

-- 2. CRITICAL: Allow guest/student applicants to enroll without requiring an existing auth user
ALTER TABLE public.student_applications ALTER COLUMN user_id DROP NOT NULL;

-- 3. Remove restrictive check constraints on status so 'pending', 'Under Review', etc. are accepted
ALTER TABLE public.student_applications DROP CONSTRAINT IF EXISTS student_applications_status_check;
ALTER TABLE public.student_applications ALTER COLUMN status SET DEFAULT 'pending';

-- 4. Assignment and remarks columns are required by the Staff and Student dashboards.
-- They are added below if they do not exist yet.

-- 5. Add all full enrollment form columns if not already present
ALTER TABLE public.student_applications
  ADD COLUMN IF NOT EXISTS email text,
  ADD COLUMN IF NOT EXISTS track text,
  ADD COLUMN IF NOT EXISTS selected_cluster text,
  ADD COLUMN IF NOT EXISTS student_details jsonb DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS lrn text,
  ADD COLUMN IF NOT EXISTS grade_level text,
  ADD COLUMN IF NOT EXISTS strand text,
  ADD COLUMN IF NOT EXISTS assigned_section_id text,
  ADD COLUMN IF NOT EXISTS registrar_remarks text,
  ADD COLUMN IF NOT EXISTS requirements_documents jsonb DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS extension text,
  ADD COLUMN IF NOT EXISTS place_of_birth text,
  ADD COLUMN IF NOT EXISTS gender text,
  ADD COLUMN IF NOT EXISTS religion text,
  ADD COLUMN IF NOT EXISTS is_ip_community boolean DEFAULT false,
  ADD COLUMN IF NOT EXISTS is_4ps_beneficiary boolean DEFAULT false,
  ADD COLUMN IF NOT EXISTS current_address text,
  ADD COLUMN IF NOT EXISTS current_house_no text,
  ADD COLUMN IF NOT EXISTS current_street text,
  ADD COLUMN IF NOT EXISTS current_barangay text,
  ADD COLUMN IF NOT EXISTS current_municipality text,
  ADD COLUMN IF NOT EXISTS current_province text,
  ADD COLUMN IF NOT EXISTS current_country text,
  ADD COLUMN IF NOT EXISTS current_zip_code text,
  ADD COLUMN IF NOT EXISTS same_as_current_address boolean DEFAULT false,
  ADD COLUMN IF NOT EXISTS permanent_address text,
  ADD COLUMN IF NOT EXISTS permanent_house_no text,
  ADD COLUMN IF NOT EXISTS permanent_street text,
  ADD COLUMN IF NOT EXISTS permanent_barangay text,
  ADD COLUMN IF NOT EXISTS permanent_municipality text,
  ADD COLUMN IF NOT EXISTS permanent_province text,
  ADD COLUMN IF NOT EXISTS permanent_country text,
  ADD COLUMN IF NOT EXISTS permanent_zip_code text,
  ADD COLUMN IF NOT EXISTS father_name text,
  ADD COLUMN IF NOT EXISTS mother_name text,
  ADD COLUMN IF NOT EXISTS legal_guardian_name text,
  ADD COLUMN IF NOT EXISTS legal_guardian_contact_number text,
  ADD COLUMN IF NOT EXISTS father_last_name text,
  ADD COLUMN IF NOT EXISTS father_first_name text,
  ADD COLUMN IF NOT EXISTS father_middle_name text,
  ADD COLUMN IF NOT EXISTS father_contact_number text,
  ADD COLUMN IF NOT EXISTS mother_last_name text,
  ADD COLUMN IF NOT EXISTS mother_first_name text,
  ADD COLUMN IF NOT EXISTS mother_middle_name text,
  ADD COLUMN IF NOT EXISTS mother_contact_number text,
  ADD COLUMN IF NOT EXISTS guardian_last_name text,
  ADD COLUMN IF NOT EXISTS guardian_first_name text,
  ADD COLUMN IF NOT EXISTS guardian_middle_name text,
  ADD COLUMN IF NOT EXISTS guardian_contact_number text,
  ADD COLUMN IF NOT EXISTS report_card_url text,
  ADD COLUMN IF NOT EXISTS birth_certificate_url text,
  ADD COLUMN IF NOT EXISTS other_requirement_url text,
  ADD COLUMN IF NOT EXISTS requirements_submitted boolean DEFAULT false;

CREATE INDEX IF NOT EXISTS student_applications_user_id_idx
  ON public.student_applications (user_id);
CREATE INDEX IF NOT EXISTS student_applications_email_idx
  ON public.student_applications (lower(email));
CREATE INDEX IF NOT EXISTS student_applications_selected_cluster_idx
  ON public.student_applications (selected_cluster);
CREATE INDEX IF NOT EXISTS student_applications_assigned_section_id_idx
  ON public.student_applications (assigned_section_id);

-- 5b. Sections used by the registrar and student dashboards
CREATE TABLE IF NOT EXISTS public.sections (
  id text PRIMARY KEY,
  name text NOT NULL,
  grade_level text,
  track text,
  strand text,
  adviser_name text,
  school_year text,
  capacity integer,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

ALTER TABLE public.sections
  ADD COLUMN IF NOT EXISTS grade_level text,
  ADD COLUMN IF NOT EXISTS track text,
  ADD COLUMN IF NOT EXISTS strand text,
  ADD COLUMN IF NOT EXISTS adviser_name text,
  ADD COLUMN IF NOT EXISTS school_year text,
  ADD COLUMN IF NOT EXISTS capacity integer,
  ADD COLUMN IF NOT EXISTS created_at timestamptz DEFAULT now(),
  ADD COLUMN IF NOT EXISTS updated_at timestamptz DEFAULT now();

INSERT INTO public.sections (id, name, grade_level, track, strand, adviser_name, school_year, capacity)
VALUES
  ('sec-stem-11a', '11 - STEM Einstein', 'Grade 11', 'academic', 'STEM', 'Mrs. Maria Santos', '2025-2026', 45),
  ('sec-stem-11b', '11 - STEM Newton', 'Grade 11', 'academic', 'STEM', 'Mr. John Dela Cruz', '2025-2026', 45),
  ('sec-abm-11a', '11 - ABM Pacioli', 'Grade 11', 'academic', 'ABM', 'Ms. Elena Reyes', '2025-2026', 45),
  ('sec-humss-11a', '11 - HUMSS Rizal', 'Grade 11', 'academic', 'HUMSS', 'Mr. Carlos Aquino', '2025-2026', 45),
  ('sec-humss-11b', '11 - HUMSS Mabini', 'Grade 11', 'academic', 'HUMSS', 'Mrs. Gloria Ramos', '2025-2026', 45),
  ('sec-gas-11a', '11 - GAS Bonifacio', 'Grade 11', 'academic', 'GAS', 'Mr. Antonio Luna', '2025-2026', 45),
  ('sec-tvl-11a', '11 - TVL ICT Turing', 'Grade 11', 'techpro', 'TVL-ICT', 'Engr. Mark Castillo', '2025-2026', 40),
  ('sec-tvl-11b', '11 - TVL HE Escoffier', 'Grade 11', 'techpro', 'TVL-HE', 'Ms. Teresa Garcia', '2025-2026', 40),
  ('sec-tvl-11c', '11 - TVL IA Tesla', 'Grade 11', 'techpro', 'TVL-IA', 'Mr. Roberto Mendoza', '2025-2026', 40)
ON CONFLICT (id) DO NOTHING;

UPDATE public.sections
SET track = CASE
  WHEN strand ~* '^(tvl|tech|industrial|construction|hospitality|ict|home economics|caregiving|food)' THEN 'techpro'
  WHEN strand IS NOT NULL AND btrim(strand) <> '' THEN 'academic'
  ELSE NULL
END
WHERE track IS NULL;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'student_applications_assigned_section_id_fkey'
      AND conrelid = 'public.student_applications'::regclass
  ) THEN
    ALTER TABLE public.student_applications
      ADD CONSTRAINT student_applications_assigned_section_id_fkey
      FOREIGN KEY (assigned_section_id)
      REFERENCES public.sections(id)
      ON DELETE SET NULL;
  END IF;
END
$$;

-- 5c. Role helper functions
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
  SELECT coalesce(public.current_user_role() IN ('admin', 'ict_admin'), false)
$$;

CREATE OR REPLACE FUNCTION public.is_staff_or_admin()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT coalesce(
    public.current_user_role() IN ('staff', 'registrar', 'admin', 'ict_admin'),
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

-- 6. Drop previous policies before recreating secure ones
DO $$
DECLARE
  policy_record record;
BEGIN
  FOR policy_record IN
    SELECT policyname
    FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'student_applications'
  LOOP
    EXECUTE format(
      'DROP POLICY IF EXISTS %I ON public.student_applications',
      policy_record.policyname
    );
  END LOOP;

  FOR policy_record IN
    SELECT policyname
    FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'profiles'
  LOOP
    EXECUTE format(
      'DROP POLICY IF EXISTS %I ON public.profiles',
      policy_record.policyname
    );
  END LOOP;
END
$$;

-- 7. student_applications RLS
ALTER TABLE public.student_applications ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.student_applications FROM anon, authenticated;
GRANT INSERT ON TABLE public.student_applications TO anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.student_applications TO authenticated;
GRANT ALL ON TABLE public.student_applications TO service_role;

CREATE POLICY "Applicants can submit pending applications"
  ON public.student_applications
  FOR INSERT
  TO anon, authenticated
  WITH CHECK (
    lower(coalesce(status, 'pending')) = 'pending'
    AND (user_id IS NULL OR user_id = auth.uid())
  );

CREATE POLICY "Applicants can view their own application"
  ON public.student_applications
  FOR SELECT
  TO authenticated
  USING (
    user_id = auth.uid()
    OR public.is_staff_or_admin()
  );

CREATE POLICY "Applicants can view application by verified email"
  ON public.student_applications
  FOR SELECT
  TO authenticated
  USING (
    user_id IS NULL
    AND lower(email) = lower(auth.jwt()->>'email')
  );

CREATE POLICY "Staff can update applications"
  ON public.student_applications
  FOR UPDATE
  TO authenticated
  USING (public.is_staff_or_admin())
  WITH CHECK (public.is_staff_or_admin());

CREATE POLICY "Admins can delete applications"
  ON public.student_applications
  FOR DELETE
  TO authenticated
  USING (public.is_admin());

-- 8. profiles RLS
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.profiles FROM anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.profiles TO authenticated;
GRANT ALL ON TABLE public.profiles TO service_role;

CREATE POLICY "Users can view their own profile"
  ON public.profiles
  FOR SELECT
  TO authenticated
  USING (id = auth.uid() OR public.is_admin());

CREATE POLICY "Admins can create profiles"
  ON public.profiles
  FOR INSERT
  TO authenticated
  WITH CHECK (public.is_admin());

CREATE POLICY "Admins can update profiles"
  ON public.profiles
  FOR UPDATE
  TO authenticated
  USING (public.is_admin())
  WITH CHECK (public.is_admin());

CREATE POLICY "Admins can delete profiles"
  ON public.profiles
  FOR DELETE
  TO authenticated
  USING (public.is_admin());

-- 9. Optional sections table RLS
DO $$
DECLARE
  policy_record record;
BEGIN
  IF to_regclass('public.sections') IS NOT NULL THEN
    EXECUTE 'ALTER TABLE public.sections ENABLE ROW LEVEL SECURITY';
    EXECUTE 'REVOKE ALL ON TABLE public.sections FROM anon, authenticated';
    EXECUTE 'GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.sections TO authenticated';
    EXECUTE 'GRANT ALL ON TABLE public.sections TO service_role';

    FOR policy_record IN
      SELECT policyname
      FROM pg_policies
      WHERE schemaname = 'public' AND tablename = 'sections'
    LOOP
      EXECUTE format(
        'DROP POLICY IF EXISTS %I ON public.sections',
        policy_record.policyname
      );
    END LOOP;

    EXECUTE '
      CREATE POLICY "Staff can manage sections"
        ON public.sections
        FOR ALL
        TO authenticated
        USING (public.is_staff_or_admin())
        WITH CHECK (public.is_staff_or_admin())
    ';

    EXECUTE '
      CREATE POLICY "Students can view their assigned section"
        ON public.sections
        FOR SELECT
        TO authenticated
        USING (
          EXISTS (
            SELECT 1
            FROM public.student_applications sa
            WHERE sa.assigned_section_id = public.sections.id
              AND (
                sa.user_id = auth.uid()
                OR (
                  sa.user_id IS NULL
                  AND lower(sa.email) = lower(auth.jwt()->>''email'')
                )
              )
          )
        )
    ';
  END IF;
END
$$;

-- 10. Trigger to keep updated_at current
CREATE OR REPLACE FUNCTION public.set_student_applications_updated_at()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  new.updated_at = now();
  RETURN new;
END;
$$;

DROP TRIGGER IF EXISTS student_applications_set_updated_at ON public.student_applications;
CREATE TRIGGER student_applications_set_updated_at
  BEFORE UPDATE ON public.student_applications
  FOR EACH ROW EXECUTE FUNCTION public.set_student_applications_updated_at();

CREATE OR REPLACE FUNCTION public.set_sections_updated_at()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  new.updated_at = now();
  RETURN new;
END;
$$;

DROP TRIGGER IF EXISTS sections_set_updated_at ON public.sections;
CREATE TRIGGER sections_set_updated_at
  BEFORE UPDATE ON public.sections
  FOR EACH ROW EXECUTE FUNCTION public.set_sections_updated_at();

-- 10b. Realtime updates for student dashboards
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_publication WHERE pubname = 'supabase_realtime'
  ) THEN
    IF NOT EXISTS (
      SELECT 1
      FROM pg_publication_tables
      WHERE pubname = 'supabase_realtime'
        AND schemaname = 'public'
        AND tablename = 'student_applications'
    ) THEN
      ALTER PUBLICATION supabase_realtime ADD TABLE public.student_applications;
    END IF;

    IF NOT EXISTS (
      SELECT 1
      FROM pg_publication_tables
      WHERE pubname = 'supabase_realtime'
        AND schemaname = 'public'
        AND tablename = 'sections'
    ) THEN
      ALTER PUBLICATION supabase_realtime ADD TABLE public.sections;
    END IF;
  END IF;
END
$$;

-- 11. Storage: public read only, no anon writes
INSERT INTO storage.buckets (id, name, public)
VALUES
  ('enrollment-documents.', 'enrollment-documents.', true),
  ('requirements', 'requirements', true)
ON CONFLICT (id) DO UPDATE SET public = true;

DROP POLICY IF EXISTS "requirements_upload_anon" ON storage.objects;
DROP POLICY IF EXISTS "requirements_read_public" ON storage.objects;
DROP POLICY IF EXISTS "requirements_update_anon" ON storage.objects;
DROP POLICY IF EXISTS "Give public access to requirements" ON storage.objects;

DO $$
DECLARE
  policy_record record;
BEGIN
  FOR policy_record IN
    SELECT policyname
    FROM pg_policies
    WHERE schemaname = 'storage'
      AND tablename = 'objects'
      AND (
        coalesce(qual, '') ILIKE '%enrollment-documents%'
        OR coalesce(with_check, '') ILIKE '%enrollment-documents%'
        OR coalesce(qual, '') ILIKE '%requirements%'
        OR coalesce(with_check, '') ILIKE '%requirements%'
      )
  LOOP
    EXECUTE format(
      'DROP POLICY IF EXISTS %I ON storage.objects',
      policy_record.policyname
    );
  END LOOP;
END
$$;

CREATE POLICY "Public read enrollment documents"
  ON storage.objects
  FOR SELECT
  TO anon, authenticated
  USING (bucket_id IN ('enrollment-documents.', 'requirements'));

-- No INSERT/UPDATE/DELETE policies are created for anon/authenticated.
-- The service role bypasses RLS and is used by the upload API route.

-- 12. Admin Dashboard & System Settings
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS cluster text;

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

INSERT INTO public.enrollment_settings (id)
VALUES (1)
ON CONFLICT (id) DO NOTHING;

CREATE TABLE IF NOT EXISTS public.activity_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at timestamptz DEFAULT now(),
  user_type text NOT NULL,
  user_email text NOT NULL,
  ip_address text,
  action text NOT NULL
);

ALTER TABLE public.student_profiles ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Students can read their own profile" ON public.student_profiles;
CREATE POLICY "Students can read their own profile"
  ON public.student_profiles
  FOR SELECT
  TO authenticated
  USING (auth.uid() = id);

DROP POLICY IF EXISTS "Staff and admins can read student profiles" ON public.student_profiles;
CREATE POLICY "Staff and admins can read student profiles"
  ON public.student_profiles
  FOR SELECT
  TO authenticated
  USING (public.is_staff_or_admin());

GRANT SELECT ON public.student_profiles TO authenticated;
GRANT ALL ON public.student_profiles TO service_role;

CREATE INDEX IF NOT EXISTS activity_logs_created_at_idx
  ON public.activity_logs (created_at DESC);

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

GRANT SELECT ON TABLE public.enrollment_settings TO anon, authenticated;
GRANT ALL ON TABLE public.enrollment_settings TO service_role;
GRANT ALL ON TABLE public.enrollment_settings TO authenticated;

GRANT SELECT, INSERT, DELETE ON TABLE public.activity_logs TO authenticated;
GRANT ALL ON TABLE public.activity_logs TO service_role;

-- 12b. Centralized enrollment availability (Asia/Manila wall clock)
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

-- 12c. Database-level enforcement for direct application inserts
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

DROP TRIGGER IF EXISTS enforce_enrollment_window ON public.student_applications;
CREATE TRIGGER enforce_enrollment_window
  BEFORE INSERT ON public.student_applications
  FOR EACH ROW EXECUTE FUNCTION public.enforce_enrollment_window();
