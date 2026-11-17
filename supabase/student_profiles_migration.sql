-- Student profile table used by the student dashboard.
-- Only these fields are stored (id is the internal key):
--   status, full_name, track, selected_cluster, email, contact_number,
--   birth_date, address, assigned_section, adviser
--
-- The live database may already have an older student_profiles table with
-- cluster / section_id / date_of_birth instead of the newer column names.
-- This migration adds the new columns, copies the old data across, and then
-- removes the superseded columns.
--
-- Safe to run multiple times.

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

-- Add every requested column in case an older table already exists.
ALTER TABLE public.student_profiles
  ADD COLUMN IF NOT EXISTS status text,
  ADD COLUMN IF NOT EXISTS full_name text,
  ADD COLUMN IF NOT EXISTS track text,
  ADD COLUMN IF NOT EXISTS selected_cluster text,
  ADD COLUMN IF NOT EXISTS email text,
  ADD COLUMN IF NOT EXISTS contact_number text,
  ADD COLUMN IF NOT EXISTS birth_date date,
  ADD COLUMN IF NOT EXISTS address text,
  ADD COLUMN IF NOT EXISTS assigned_section text,
  ADD COLUMN IF NOT EXISTS adviser text;

-- ON CONFLICT (id) requires a unique key on id.
DELETE FROM public.student_profiles
WHERE id IS NULL;

DELETE FROM public.student_profiles a
USING public.student_profiles b
WHERE a.id = b.id
  AND a.ctid < b.ctid;

DO $do$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_index i
    JOIN pg_attribute a
      ON a.attrelid = i.indrelid
     AND a.attnum = ANY (i.indkey)
    WHERE i.indrelid = 'public.student_profiles'::regclass
      AND i.indisunique
      AND a.attname = 'id'
  ) THEN
    ALTER TABLE public.student_profiles
      ADD CONSTRAINT student_profiles_id_key UNIQUE (id);
  END IF;
END
$do$;

ALTER TABLE public.student_profiles
  ALTER COLUMN id SET NOT NULL;

-- Copy data from the older column names when they are present.
DO $do$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'student_profiles'
      AND column_name = 'cluster'
  ) THEN
    EXECUTE $sql$
      UPDATE public.student_profiles
      SET selected_cluster = coalesce(
        nullif(btrim(selected_cluster), ''),
        nullif(btrim(cluster), '')
      )
    $sql$;
  END IF;

  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'student_profiles'
      AND column_name = 'date_of_birth'
  ) THEN
    EXECUTE $sql$
      UPDATE public.student_profiles
      SET birth_date = coalesce(birth_date, date_of_birth)
    $sql$;
  END IF;

  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'student_profiles'
      AND column_name = 'section_id'
  ) THEN
    EXECUTE $sql$
      UPDATE public.student_profiles sp
      SET assigned_section = coalesce(
            nullif(btrim(sp.assigned_section), ''),
            nullif(btrim(s.name), '')
          ),
          adviser = coalesce(
            nullif(btrim(sp.adviser), ''),
            nullif(btrim(s.adviser_name), '')
          )
      FROM public.sections s
      WHERE s.id::text = sp.section_id::text
    $sql$;
  END IF;
END
$do$;

-- Remove the superseded columns after their values have been copied.
ALTER TABLE public.student_profiles
  DROP COLUMN IF EXISTS cluster,
  DROP COLUMN IF EXISTS section_id,
  DROP COLUMN IF EXISTS date_of_birth;

ALTER TABLE public.student_profiles ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Students can read their own profile"
  ON public.student_profiles;
CREATE POLICY "Students can read their own profile"
  ON public.student_profiles
  FOR SELECT
  TO authenticated
  USING (auth.uid() = id);

DROP POLICY IF EXISTS "Staff and admins can read student profiles"
  ON public.student_profiles;
CREATE POLICY "Staff and admins can read student profiles"
  ON public.student_profiles
  FOR SELECT
  TO authenticated
  USING (public.is_staff_or_admin());

GRANT SELECT ON public.student_profiles TO authenticated;
GRANT ALL ON public.student_profiles TO service_role;

-- Backfill/refresh one row per student from their latest application.
INSERT INTO public.student_profiles (
  id,
  status,
  full_name,
  track,
  selected_cluster,
  email,
  contact_number,
  birth_date,
  address,
  assigned_section,
  adviser
)
SELECT DISTINCT ON (a.user_id)
  a.user_id,
  a.status,
  coalesce(
    nullif(btrim(p.full_name), ''),
    nullif(
      btrim(
        concat_ws(
          ' ',
          a.first_name,
          nullif(a.middle_name, ''),
          a.last_name
        )
      ),
      ''
    )
  ),
  coalesce(
    nullif(btrim(a.student_details ->> 'selected_track'), ''),
    nullif(btrim(a.student_details ->> 'track'), '')
  ),
  coalesce(
    nullif(btrim(a.student_details ->> 'selected_cluster'), ''),
    nullif(btrim(a.student_details ->> 'cluster'), '')
  ),
  coalesce(
    nullif(btrim(p.email), ''),
    nullif(btrim(a.requirements_documents ->> 'student_email'), ''),
    nullif(btrim(a.student_details ->> 'email'), '')
  ),
  coalesce(
    nullif(btrim(a.contact_number), ''),
    nullif(btrim(a.student_details ->> 'contact_number'), '')
  ),
  a.birth_date,
  coalesce(
    nullif(btrim(a.address), ''),
    nullif(btrim(a.student_details ->> 'address'), ''),
    case
      when jsonb_typeof(a.student_details -> 'current_address') = 'string'
        then nullif(btrim(a.student_details ->> 'current_address'), '')
      else nullif(
        btrim(
          concat_ws(
            ', ',
            a.student_details -> 'current_address' ->> 'houseNo',
            a.student_details -> 'current_address' ->> 'street',
            a.student_details -> 'current_address' ->> 'barangay',
            a.student_details -> 'current_address' ->> 'municipality',
            a.student_details -> 'current_address' ->> 'province',
            a.student_details -> 'current_address' ->> 'zipCode',
            a.student_details -> 'current_address' ->> 'country'
          )
        ),
        ''
      )
    end
  ),
  nullif(btrim(s.name), ''),
  nullif(btrim(s.adviser_name), '')
FROM public.student_applications a
LEFT JOIN public.profiles p ON p.id = a.user_id
LEFT JOIN public.sections s ON s.id = a.assigned_section_id
WHERE a.user_id IS NOT NULL
ORDER BY a.user_id, a.submitted_at DESC NULLS LAST, a.updated_at DESC NULLS LAST
ON CONFLICT (id) DO UPDATE SET
  status = EXCLUDED.status,
  full_name = EXCLUDED.full_name,
  track = EXCLUDED.track,
  selected_cluster = EXCLUDED.selected_cluster,
  email = EXCLUDED.email,
  contact_number = EXCLUDED.contact_number,
  birth_date = EXCLUDED.birth_date,
  address = EXCLUDED.address,
  assigned_section = EXCLUDED.assigned_section,
  adviser = EXCLUDED.adviser;
