-- ============================================================
-- AASMNHS Online Enrollment - Student Dashboard Migration
-- Run this in Supabase -> SQL Editor after the base schema.
--
-- This migration is idempotent and:
-- 1. Adds the enrollment fields used by the Student Dashboard
-- 2. Creates the sections table and seeds the AASMNHS sections
-- 3. Links student applications to sections/advisers
-- 4. Backfills email, track, and missing student profiles
-- 5. Adds RLS policies for own-record and assigned-section reads
-- 6. Enables realtime updates for student applications
-- ============================================================

begin;

-- ------------------------------------------------------------
-- 1. Student application columns
-- ------------------------------------------------------------
alter table public.student_applications
  add column if not exists email text,
  add column if not exists track text,
  add column if not exists lrn text,
  add column if not exists grade_level text,
  add column if not exists strand text,
  add column if not exists assigned_section_id text,
  add column if not exists registrar_remarks text,
  add column if not exists requirements_documents jsonb default '{}'::jsonb;

create index if not exists student_applications_user_id_idx
  on public.student_applications (user_id);
create index if not exists student_applications_email_idx
  on public.student_applications (lower(email));
create index if not exists student_applications_assigned_section_id_idx
  on public.student_applications (assigned_section_id);

-- ------------------------------------------------------------
-- 2. Sections table
-- ------------------------------------------------------------
create table if not exists public.sections (
  id text primary key,
  name text not null,
  grade_level text,
  track text,
  strand text,
  adviser_name text,
  school_year text,
  capacity integer,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

alter table public.sections
  add column if not exists grade_level text,
  add column if not exists track text,
  add column if not exists strand text,
  add column if not exists adviser_name text,
  add column if not exists school_year text,
  add column if not exists capacity integer,
  add column if not exists created_at timestamptz default now(),
  add column if not exists updated_at timestamptz default now();

insert into public.sections (id, name, grade_level, track, strand, adviser_name, school_year, capacity)
values
  ('sec-stem-11a', '11 - STEM Einstein', 'Grade 11', 'academic', 'STEM', 'Mrs. Maria Santos', '2025-2026', 45),
  ('sec-stem-11b', '11 - STEM Newton', 'Grade 11', 'academic', 'STEM', 'Mr. John Dela Cruz', '2025-2026', 45),
  ('sec-abm-11a', '11 - ABM Pacioli', 'Grade 11', 'academic', 'ABM', 'Ms. Elena Reyes', '2025-2026', 45),
  ('sec-humss-11a', '11 - HUMSS Rizal', 'Grade 11', 'academic', 'HUMSS', 'Mr. Carlos Aquino', '2025-2026', 45),
  ('sec-humss-11b', '11 - HUMSS Mabini', 'Grade 11', 'academic', 'HUMSS', 'Mrs. Gloria Ramos', '2025-2026', 45),
  ('sec-gas-11a', '11 - GAS Bonifacio', 'Grade 11', 'academic', 'GAS', 'Mr. Antonio Luna', '2025-2026', 45),
  ('sec-tvl-11a', '11 - TVL ICT Turing', 'Grade 11', 'techpro', 'TVL-ICT', 'Engr. Mark Castillo', '2025-2026', 40),
  ('sec-tvl-11b', '11 - TVL HE Escoffier', 'Grade 11', 'techpro', 'TVL-HE', 'Ms. Teresa Garcia', '2025-2026', 40),
  ('sec-tvl-11c', '11 - TVL IA Tesla', 'Grade 11', 'techpro', 'TVL-IA', 'Mr. Roberto Mendoza', '2025-2026', 40)
on conflict (id) do nothing;

update public.sections
set track = case
  when strand ~* '^(tvl|tech|industrial|construction|hospitality|ict|home economics|caregiving|food)' then 'techpro'
  when strand is not null and btrim(strand) <> '' then 'academic'
  else null
end
where track is null;

-- Remove stale section ids before creating the foreign key.
update public.student_applications sa
set assigned_section_id = null
where sa.assigned_section_id is not null
  and not exists (
    select 1 from public.sections s where s.id = sa.assigned_section_id
  );

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'student_applications_assigned_section_id_fkey'
      and conrelid = 'public.student_applications'::regclass
  ) then
    alter table public.student_applications
      add constraint student_applications_assigned_section_id_fkey
      foreign key (assigned_section_id)
      references public.sections(id)
      on delete set null;
  end if;
end
$$;

-- ------------------------------------------------------------
-- 3. Backfill existing records from Supabase Auth
-- ------------------------------------------------------------
update public.student_applications sa
set
  email = coalesce(nullif(trim(sa.email), ''), au.email),
  track = coalesce(nullif(trim(sa.track), ''), au.raw_user_meta_data->>'track'),
  lrn = coalesce(nullif(trim(sa.lrn), ''), au.raw_user_meta_data->>'lrn'),
  grade_level = coalesce(
    nullif(trim(sa.grade_level), ''),
    au.raw_user_meta_data->>'grade_level'
  ),
  strand = coalesce(
    nullif(trim(sa.strand), ''),
    au.raw_user_meta_data->>'strand'
  )
from auth.users au
where sa.user_id = au.id
  and (
    sa.email is null
    or trim(sa.email) = ''
    or sa.track is null
    or trim(sa.track) = ''
    or sa.lrn is null
    or trim(sa.lrn) = ''
    or sa.grade_level is null
    or trim(sa.grade_level) = ''
    or sa.strand is null
    or trim(sa.strand) = ''
  );

insert into public.profiles (id, full_name, email, role)
select
  u.id,
  coalesce(
    nullif(trim(u.raw_user_meta_data->>'full_name'), ''),
    split_part(coalesce(u.email, ''), '@', 1)
  ),
  u.email,
  case
    when lower(trim(coalesce(u.raw_user_meta_data->>'role', ''))) in
      ('staff', 'registrar', 'admin')
      then lower(trim(u.raw_user_meta_data->>'role'))
    else 'student'
  end
from auth.users u
on conflict (id) do nothing;

-- Normalize existing status values (e.g. "Under Review" -> "under_review").
update public.student_applications
set status = lower(regexp_replace(trim(status), '[\s-]+', '_', 'g'))
where status is not null
  and status <> lower(regexp_replace(trim(status), '[\s-]+', '_', 'g'));

-- ------------------------------------------------------------
-- 4. Role helper functions
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
-- 5. RLS: student applications
-- ------------------------------------------------------------
alter table public.student_applications enable row level security;

revoke all on table public.student_applications from anon, authenticated;
grant insert on table public.student_applications to anon;
grant select, insert, update, delete on table public.student_applications to authenticated;
grant all on table public.student_applications to service_role;

drop policy if exists "Applicants can submit pending applications"
  on public.student_applications;
create policy "Applicants can submit pending applications"
  on public.student_applications
  for insert
  to anon, authenticated
  with check (
    lower(coalesce(status, 'pending')) = 'pending'
    and (user_id is null or user_id = auth.uid())
  );

drop policy if exists "Applicants can view their own application"
  on public.student_applications;
create policy "Applicants can view their own application"
  on public.student_applications
  for select
  to authenticated
  using (
    user_id = auth.uid()
    or public.is_staff_or_admin()
  );

drop policy if exists "Applicants can view application by verified email"
  on public.student_applications;
create policy "Applicants can view application by verified email"
  on public.student_applications
  for select
  to authenticated
  using (
    user_id is null
    and lower(email) = lower(auth.jwt()->>'email')
  );

drop policy if exists "Staff can update applications"
  on public.student_applications;
create policy "Staff can update applications"
  on public.student_applications
  for update
  to authenticated
  using (public.is_staff_or_admin())
  with check (public.is_staff_or_admin());

drop policy if exists "Admins can delete applications"
  on public.student_applications;
create policy "Admins can delete applications"
  on public.student_applications
  for delete
  to authenticated
  using (public.is_admin());

-- ------------------------------------------------------------
-- 6. RLS: profiles
-- ------------------------------------------------------------
alter table public.profiles enable row level security;

revoke all on table public.profiles from anon, authenticated;
grant select, insert, update, delete on table public.profiles to authenticated;
grant all on table public.profiles to service_role;

drop policy if exists "Users can view their own profile"
  on public.profiles;
create policy "Users can view their own profile"
  on public.profiles
  for select
  to authenticated
  using (id = auth.uid() or public.is_admin());

drop policy if exists "Admins can create profiles"
  on public.profiles;
create policy "Admins can create profiles"
  on public.profiles
  for insert
  to authenticated
  with check (public.is_admin());

drop policy if exists "Admins can update profiles"
  on public.profiles;
create policy "Admins can update profiles"
  on public.profiles
  for update
  to authenticated
  using (public.is_admin())
  with check (public.is_admin());

drop policy if exists "Admins can delete profiles"
  on public.profiles;
create policy "Admins can delete profiles"
  on public.profiles
  for delete
  to authenticated
  using (public.is_admin());

-- ------------------------------------------------------------
-- 7. RLS: sections
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
-- 8. updated_at triggers
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

create or replace function public.set_sections_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists sections_set_updated_at on public.sections;
create trigger sections_set_updated_at
  before update on public.sections
  for each row execute function public.set_sections_updated_at();

-- ------------------------------------------------------------
-- 9. Realtime for student application updates
-- ------------------------------------------------------------
do $$
begin
  if exists (
    select 1 from pg_publication where pubname = 'supabase_realtime'
  ) then
    if not exists (
      select 1
      from pg_publication_tables
      where pubname = 'supabase_realtime'
        and schemaname = 'public'
        and tablename = 'student_applications'
    ) then
      alter publication supabase_realtime add table public.student_applications;
    end if;

    if not exists (
      select 1
      from pg_publication_tables
      where pubname = 'supabase_realtime'
        and schemaname = 'public'
        and tablename = 'sections'
    ) then
      alter publication supabase_realtime add table public.sections;
    end if;
  end if;
end
$$;

commit;
