-- ============================================================
-- AASMNHS Online Enrollment - Security Migration
-- Run this in Supabase -> SQL Editor before deploying the
-- cookie-based authentication changes.
--
-- This migration:
-- 1. Enables RLS on student_applications and profiles
-- 2. Adds role helper functions
-- 3. Allows only pending guest/student application inserts
-- 4. Limits application reads/updates to staff/admin
-- 5. Removes anon storage writes while keeping public reads
-- 6. Conditionally secures public.sections if it exists
--
-- For the full Student Dashboard schema, run
-- student_dashboard_migration.sql first. This file remains safe to
-- rerun after that migration.
-- ============================================================

-- ------------------------------------------------------------
-- 1. Profiles table and role helpers
-- ------------------------------------------------------------
ALTER TABLE public.student_applications
  ADD COLUMN IF NOT EXISTS email text,
  ADD COLUMN IF NOT EXISTS assigned_section_id text;

CREATE TABLE IF NOT EXISTS public.profiles (
  id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  full_name text,
  email text,
  role text DEFAULT 'student',
  created_at timestamptz DEFAULT now()
);

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
-- 2. Drop old policies on application/profile tables
-- ------------------------------------------------------------
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

-- ------------------------------------------------------------
-- 3. student_applications RLS
-- ------------------------------------------------------------
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

-- ------------------------------------------------------------
-- 4. profiles RLS
-- ------------------------------------------------------------
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

-- ------------------------------------------------------------
-- 5. Optional sections table RLS
-- ------------------------------------------------------------
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

-- ------------------------------------------------------------
-- 6. Storage: public read only, no anon writes
-- ------------------------------------------------------------
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
