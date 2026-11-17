-- ============================================================
-- AASMNHS Online Enrollment - Student Portal + Email Fix
-- Run this in Supabase -> SQL Editor -> Click RUN.
--
-- This migration is transactional and idempotent. It:
-- 1. Ensures student_applications.email / registrar_remarks exist
-- 2. Backfills email from student_details / requirements_documents
-- 3. Recreates the role helper functions used by RLS
-- 4. Recreates the "Students can view their assigned section" policy
--    (the previous version referenced a non-existent email column,
--    so the policy silently failed to apply and students could not
--    read their section/adviser)
-- 5. Refreshes the PostgREST schema cache
-- ============================================================

begin;

-- ------------------------------------------------------------
-- 1. Required columns
-- ------------------------------------------------------------
alter table public.student_applications
  add column if not exists email text,
  add column if not exists registrar_remarks text;

-- ------------------------------------------------------------
-- 2. Backfill email from JSON detail columns (if present)
-- ------------------------------------------------------------
do $$
begin
  if exists (
    select 1 from information_schema.columns
    where table_schema = 'public'
      and table_name = 'student_applications'
      and column_name = 'student_details'
  ) and exists (
    select 1 from information_schema.columns
    where table_schema = 'public'
      and table_name = 'student_applications'
      and column_name = 'requirements_documents'
  ) then
    execute $sql$
      update public.student_applications
      set email = coalesce(
        nullif(trim(email), ''),
        nullif(trim(student_details->>'email'), ''),
        nullif(trim(requirements_documents->>'student_email'), '')
      )
      where email is null or trim(email) = ''
    $sql$;
  end if;
end
$$;

-- ------------------------------------------------------------
-- 3. Role helper functions
-- ------------------------------------------------------------
create or replace function public.current_user_role()
returns text
language sql
stable
security definer
set search_path = public
as $$
  select lower(trim(role))
  from public.profiles
  where id = auth.uid()
  limit 1
$$;

create or replace function public.is_staff_or_admin()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(
    public.current_user_role() in ('staff', 'registrar', 'admin'),
    false
  )
$$;

revoke all on function public.current_user_role() from public;
revoke all on function public.is_staff_or_admin() from public;

grant execute on function public.current_user_role() to authenticated, service_role;
grant execute on function public.is_staff_or_admin() to authenticated, service_role;

-- ------------------------------------------------------------
-- 4. sections RLS policies
-- ------------------------------------------------------------
alter table public.sections enable row level security;

revoke all on table public.sections from anon, authenticated;
grant select, insert, update, delete on table public.sections to authenticated;
grant all on table public.sections to service_role;

drop policy if exists "Staff can manage sections" on public.sections;
create policy "Staff can manage sections"
  on public.sections
  for all
  to authenticated
  using (public.is_staff_or_admin())
  with check (public.is_staff_or_admin());

drop policy if exists "Students can view their assigned section" on public.sections;
create policy "Students can view their assigned section"
  on public.sections
  for select
  to authenticated
  using (
    exists (
      select 1
      from public.student_applications sa
      where sa.assigned_section_id = public.sections.id
        and (
          sa.user_id = auth.uid()
          or (
            sa.user_id is null
            and lower(sa.email) = lower(auth.jwt()->>'email')
          )
        )
    )
  );

-- ------------------------------------------------------------
-- 5. Refresh PostgREST schema cache
-- ------------------------------------------------------------
notify pgrst, 'reload schema';

commit;
