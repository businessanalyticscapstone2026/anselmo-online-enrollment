-- Ensure the dedicated parent / guardian columns exist on enrollment applications.
-- Safe to run more than once. Existing records are backfilled from the
-- student_details.guardians JSON payload written by /api/submit-application.

alter table public.student_applications
  add column if not exists father_last_name text,
  add column if not exists father_first_name text,
  add column if not exists father_middle_name text,
  add column if not exists father_contact_number text,
  add column if not exists mother_last_name text,
  add column if not exists mother_first_name text,
  add column if not exists mother_middle_name text,
  add column if not exists mother_contact_number text,
  add column if not exists guardian_last_name text,
  add column if not exists guardian_first_name text,
  add column if not exists guardian_middle_name text,
  add column if not exists guardian_contact_number text;

-- Backfill father / mother / legal guardian details for older records that only
-- stored them inside student_details.guardians.
update public.student_applications
set father_last_name = coalesce(nullif(trim(student_details->'guardians'->'father'->>'lastName'), ''), father_last_name),
    father_first_name = coalesce(nullif(trim(student_details->'guardians'->'father'->>'firstName'), ''), father_first_name),
    father_middle_name = coalesce(nullif(trim(student_details->'guardians'->'father'->>'middleName'), ''), father_middle_name),
    father_contact_number = coalesce(nullif(trim(student_details->'guardians'->'father'->>'contactNumber'), ''), father_contact_number)
where student_details->'guardians'->'father' is not null;

update public.student_applications
set mother_last_name = coalesce(nullif(trim(student_details->'guardians'->'mother'->>'lastName'), ''), mother_last_name),
    mother_first_name = coalesce(nullif(trim(student_details->'guardians'->'mother'->>'firstName'), ''), mother_first_name),
    mother_middle_name = coalesce(nullif(trim(student_details->'guardians'->'mother'->>'middleName'), ''), mother_middle_name),
    mother_contact_number = coalesce(nullif(trim(student_details->'guardians'->'mother'->>'contactNumber'), ''), mother_contact_number)
where student_details->'guardians'->'mother' is not null;

update public.student_applications
set guardian_last_name = coalesce(nullif(trim(student_details->'guardians'->'legal_guardian'->>'lastName'), ''), guardian_last_name),
    guardian_first_name = coalesce(nullif(trim(student_details->'guardians'->'legal_guardian'->>'firstName'), ''), guardian_first_name),
    guardian_middle_name = coalesce(nullif(trim(student_details->'guardians'->'legal_guardian'->>'middleName'), ''), guardian_middle_name),
    guardian_contact_number = coalesce(nullif(trim(student_details->'guardians'->'legal_guardian'->>'contactNumber'), ''), guardian_contact_number)
where student_details->'guardians'->'legal_guardian' is not null;
