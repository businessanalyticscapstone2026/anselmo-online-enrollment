-- Add the learner age field to enrollment applications.
-- The enrollment form collects age and the submit API stores it on
-- public.student_applications.age (and inside student_details.age).
-- Safe to run multiple times.

ALTER TABLE public.student_applications
  ADD COLUMN IF NOT EXISTS age integer;

-- Backfill age for existing applications that already have a birth date.
UPDATE public.student_applications
SET age = date_part('year', age(current_date, birth_date))::int
WHERE age IS NULL
  AND birth_date IS NOT NULL;
