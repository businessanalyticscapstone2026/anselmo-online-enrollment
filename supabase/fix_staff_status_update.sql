-- ============================================================
-- AASMNHS Online Enrollment - Staff Status Persistence Fix
-- Run this in Supabase -> SQL Editor -> Click RUN.
--
-- This migration is transactional and idempotent. It:
-- 1. Adds email and registrar_remarks columns used by the dashboards
-- 2. Ensures status defaults to pending only for new applications
-- 3. Recreates the role helper functions
-- 4. Replaces student_applications RLS policies with a safe set
-- 5. Allows staff/registrar/admin updates and blocks student updates
-- 6. Ensures updated_at is maintained by a trigger
-- ============================================================

begin;

-- ------------------------------------------------------------
-- 1. Required columns
-- ------------------------------------------------------------
alter table public.student_applications
  add column if not exists email text,
  add column if not exists registrar_remarks text;

-- ------------------------------------------------------------
-- 2. Status default and null cleanup
-- ------------------------------------------------------------
alter table public.student_applications
  alter column status set default 'pending';

update public.student_applications
set status = 'pending'
where status is null or trim(status) = '';

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

create or replace function public.is_staff()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(public.current_user_role() in ('staff', 'registrar'), false)
$$;

create or replace function public.is_admin()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(public.current_user_role() = 'admin', false)
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
revoke all on function public.is_staff() from public;
revoke all on function public.is_admin() from public;
revoke all on function public.is_staff_or_admin() from public;

grant execute on function public.current_user_role() to authenticated, service_role;
grant execute on function public.is_staff() to authenticated, service_role;
grant execute on function public.is_admin() to authenticated, service_role;
grant execute on function public.is_staff_or_admin() to authenticated, service_role;

-- ------------------------------------------------------------
-- 4. Remove existing application policies
-- ------------------------------------------------------------
do $$
declare
  policy_record record;
begin
  for policy_record in
    select policyname
    from pg_policies
    where schemaname = 'public'
      and tablename = 'student_applications'
  loop
    execute format(
      'drop policy if exists %I on public.student_applications',
      policy_record.policyname
    );
  end loop;
end
$$;

-- ------------------------------------------------------------
-- 5. RLS and grants
-- ------------------------------------------------------------
alter table public.student_applications enable row level security;

revoke all on table public.student_applications from anon, authenticated;
grant insert on table public.student_applications to anon;
grant select, insert, update, delete on table public.student_applications to authenticated;
grant all on table public.student_applications to service_role;

create policy "Applicants can submit pending applications"
  on public.student_applications
  for insert
  to anon, authenticated
  with check (
    lower(coalesce(status, 'pending')) = 'pending'
    and (user_id is null or user_id = auth.uid())
  );

create policy "Applicants can view their own application"
  on public.student_applications
  for select
  to authenticated
  using (
    user_id = auth.uid()
    or public.is_staff_or_admin()
  );

create policy "Applicants can view application by verified email"
  on public.student_applications
  for select
  to authenticated
  using (
    user_id is null
    and lower(email) = lower(auth.jwt()->>'email')
  );

create policy "Staff can update applications"
  on public.student_applications
  for update
  to authenticated
  using (public.is_staff_or_admin())
  with check (public.is_staff_or_admin());

create policy "Admins can delete applications"
  on public.student_applications
  for delete
  to authenticated
  using (public.is_admin());

-- ------------------------------------------------------------
-- 6. updated_at trigger
-- ------------------------------------------------------------
create or replace function public.set_student_applications_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists student_applications_set_updated_at
  on public.student_applications;

create trigger student_applications_set_updated_at
  before update on public.student_applications
  for each row execute function public.set_student_applications_updated_at();

notify pgrst, 'reload schema';

commit;
