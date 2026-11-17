-- ============================================================
-- AASMNHS Online Enrollment - Staff Profiles Migration
-- Ensures every staff/registrar account has a staff_profiles row.
-- Paste this into Supabase -> SQL Editor -> Click RUN
-- ============================================================

CREATE TABLE IF NOT EXISTS public.staff_profiles (
  id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  email text,
  department text,
  position text,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

ALTER TABLE public.staff_profiles
  ADD COLUMN IF NOT EXISTS email text,
  ADD COLUMN IF NOT EXISTS department text,
  ADD COLUMN IF NOT EXISTS position text,
  ADD COLUMN IF NOT EXISTS created_at timestamptz DEFAULT now(),
  ADD COLUMN IF NOT EXISTS updated_at timestamptz DEFAULT now();

-- Backfill staff_profiles from the shared profiles table.
INSERT INTO public.staff_profiles (id, email, position, updated_at)
SELECT
  p.id,
  p.email,
  CASE
    WHEN lower(p.role) = 'registrar' THEN 'Registrar'
    ELSE 'Staff'
  END,
  now()
FROM public.profiles p
WHERE lower(p.role) IN ('staff', 'registrar')
ON CONFLICT (id) DO UPDATE
SET email = EXCLUDED.email,
    position = COALESCE(public.staff_profiles.position, EXCLUDED.position),
    updated_at = now();

ALTER TABLE public.staff_profiles ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Staff can view own staff profile" ON public.staff_profiles;
CREATE POLICY "Staff can view own staff profile"
  ON public.staff_profiles
  FOR SELECT
  USING (auth.uid() = id);
