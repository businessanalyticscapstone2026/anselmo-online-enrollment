-- ============================================================
-- Fix enrollment email identity
-- Adds the missing email column and backfills it from every
-- source used by the enrollment flow, then indexes it.
-- Safe to re-run.
-- ============================================================

alter table public.student_applications
  add column if not exists email text;

alter table public.student_applications
  add column if not exists student_details jsonb default '{}'::jsonb;

-- 1. Linked auth users (the email used to sign in to the dashboard)
update public.student_applications sa
set email = nullif(trim(au.email), '')
from auth.users au
where sa.user_id = au.id
  and (sa.email is null or trim(sa.email) = '')
  and nullif(trim(au.email), '') is not null;

-- 2. Email captured on the enrollment form
update public.student_applications
set email = nullif(trim(student_details->>'email'), '')
where (email is null or trim(email) = '')
  and nullif(trim(student_details->>'email'), '') is not null;

-- 3. Email captured when requirements were uploaded
update public.student_applications
set email = nullif(trim(requirements_documents->>'student_email'), '')
where (email is null or trim(email) = '')
  and nullif(trim(requirements_documents->>'student_email'), '') is not null;

create index if not exists student_applications_email_idx
  on public.student_applications (lower(email));
