-- Add enrollment profile fields collected by the student information form:
-- special needs program details, returning learner details, SHS semester,
-- preferred distance learning modalities, and certification consent.
-- Safe to run more than once; older records keep null/empty values.

alter table public.student_applications
  add column if not exists special_needs_program boolean,
  add column if not exists special_needs_group text,
  add column if not exists special_needs_condition text,
  add column if not exists special_needs_detail text,
  add column if not exists has_pwd_id boolean,
  add column if not exists last_grade_level_completed text,
  add column if not exists last_school_year_completed text,
  add column if not exists last_school_attended text,
  add column if not exists last_school_id text,
  add column if not exists semester text,
  add column if not exists preferred_distance_modalities text[],
  add column if not exists certification_accepted boolean;
