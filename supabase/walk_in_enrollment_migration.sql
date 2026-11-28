-- ============================================================
-- AASMNHS Online Enrollment - Walk-in Enrollment Migration
-- Adds the columns and helpers used by the staff "Manage Walk-ins"
-- module. Safe to re-run.
-- ============================================================

ALTER TABLE public.student_applications
  ADD COLUMN IF NOT EXISTS enrollment_type text,
  ADD COLUMN IF NOT EXISTS encoded_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS encoded_at timestamptz,
  ADD COLUMN IF NOT EXISTS walk_in_reference text,
  ADD COLUMN IF NOT EXISTS college_course text,
  ADD COLUMN IF NOT EXISTS certification_accepted boolean;

-- Existing records are online applicants.
UPDATE public.student_applications
SET enrollment_type = 'online'
WHERE enrollment_type IS NULL;

ALTER TABLE public.student_applications
  ALTER COLUMN enrollment_type SET DEFAULT 'online';

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'student_applications'
      AND column_name = 'enrollment_type'
      AND is_nullable = 'YES'
  ) THEN
    ALTER TABLE public.student_applications
      ALTER COLUMN enrollment_type SET NOT NULL;
  END IF;
END
$$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'student_applications_enrollment_type_check'
  ) THEN
    ALTER TABLE public.student_applications
      ADD CONSTRAINT student_applications_enrollment_type_check
      CHECK (enrollment_type IN ('online', 'walk_in'));
  END IF;
END
$$;

-- Walk-ins are encoded by the registrar and never receive an auth account.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'student_applications_walk_in_no_account_check'
  ) THEN
    ALTER TABLE public.student_applications
      ADD CONSTRAINT student_applications_walk_in_no_account_check
      CHECK (enrollment_type <> 'walk_in' OR user_id IS NULL) NOT VALID;
  END IF;
END
$$;

CREATE INDEX IF NOT EXISTS student_applications_enrollment_type_idx
  ON public.student_applications (enrollment_type);
CREATE INDEX IF NOT EXISTS student_applications_encoded_by_idx
  ON public.student_applications (encoded_by);
CREATE INDEX IF NOT EXISTS student_applications_walk_in_reference_idx
  ON public.student_applications (walk_in_reference);
CREATE INDEX IF NOT EXISTS student_applications_lrn_idx
  ON public.student_applications (lrn);

-- Sequential walk-in reference numbers (WI-YYYY-0001).
CREATE SEQUENCE IF NOT EXISTS public.walk_in_reference_seq START WITH 1;

CREATE OR REPLACE FUNCTION public.next_walk_in_reference()
RETURNS text
LANGUAGE sql
VOLATILE
SET search_path = public
AS $$
  SELECT 'WI-' || to_char(now() AT TIME ZONE 'Asia/Manila', 'YYYY') || '-' ||
         lpad(nextval('public.walk_in_reference_seq')::text, 4, '0')
$$;

REVOKE ALL ON FUNCTION public.next_walk_in_reference() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.next_walk_in_reference()
  TO authenticated, service_role;

CREATE UNIQUE INDEX IF NOT EXISTS student_applications_walk_in_reference_key
  ON public.student_applications (walk_in_reference)
  WHERE walk_in_reference IS NOT NULL;

-- Keep the reference and encoding metadata coherent even for direct SQL edits.
CREATE OR REPLACE FUNCTION public.set_walk_in_encoded_at()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.enrollment_type = 'walk_in' AND NEW.encoded_at IS NULL THEN
    NEW.encoded_at = now();
  END IF;

  IF NEW.enrollment_type = 'walk_in' THEN
    NEW.user_id = NULL;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS student_applications_set_walk_in_encoded_at
  ON public.student_applications;
CREATE TRIGGER student_applications_set_walk_in_encoded_at
  BEFORE INSERT OR UPDATE ON public.student_applications
  FOR EACH ROW EXECUTE FUNCTION public.set_walk_in_encoded_at();

-- Public applicants must not be able to inject registrar-only walk-in rows.
DROP POLICY IF EXISTS "Applicants can submit pending applications"
  ON public.student_applications;
CREATE POLICY "Applicants can submit pending applications"
  ON public.student_applications
  FOR INSERT
  TO anon, authenticated
  WITH CHECK (
    lower(coalesce(status, 'pending')) = 'pending'
    AND (user_id IS NULL OR user_id = auth.uid())
    AND coalesce(enrollment_type, 'online') <> 'walk_in'
  );

-- Student-facing RLS must never expose a walk-in record, even if the
-- registrar stored an email that matches a student account.
DROP POLICY IF EXISTS "Applicants can view application by verified email"
  ON public.student_applications;
CREATE POLICY "Applicants can view application by verified email"
  ON public.student_applications
  FOR SELECT
  TO authenticated
  USING (
    user_id IS NULL
    AND lower(email) = lower(auth.jwt()->>'email')
    AND coalesce(enrollment_type, 'online') <> 'walk_in'
  );

-- If the new columns do not appear through the API right away, run
-- supabase/refresh_postgrest_schema.sql or reload the schema cache.
