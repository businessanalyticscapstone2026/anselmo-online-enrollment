-- ============================================================
-- AASMNHS Online Enrollment - Student Dashboard / Login Fix
-- Run this in Supabase -> SQL Editor -> Click RUN.
--
-- This migration is idempotent and fixes the live database
-- mismatch that causes:
--   "column student_applications.email does not exist"
--
-- It:
-- 1. Adds the email and extended enrollment columns
-- 2. Creates profiles and sections (with seed data)
-- 3. Backfills student emails from auth.users and requirements
-- 4. Backfills profiles from auth.users
-- 5. Recreates RLS policies, grants, triggers, and realtime
-- 6. Ensures the enrollment-documents storage bucket is public-read
-- ============================================================

begin;

-- ------------------------------------------------------------
-- 1. Core table (safe if it already exists)
-- ------------------------------------------------------------
create table if not exists public.student_applications (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users(id) on delete set null,
  first_name text,
  middle_name text,
  last_name text,
  birth_date date,
  sex text,
  contact_number text,
  address text,
  status text default 'pending',
  submitted_at timestamptz default now(),
  updated_at timestamptz default now()
);

alter table public.student_applications
  alter column user_id drop not null;

alter table public.student_applications
  drop constraint if exists student_applications_status_check;

alter table public.student_applications
  alter column status set default 'pending';

-- ------------------------------------------------------------
-- 2. Enrollment columns used by the form and dashboards
-- ------------------------------------------------------------
alter table public.student_applications
  add column if not exists email text,
  add column if not exists track text,
  add column if not exists lrn text,
  add column if not exists grade_level text,
  add column if not exists strand text,
  add column if not exists assigned_section_id text,
  add column if not exists registrar_remarks text,
  add column if not exists requirements_documents jsonb default '{}'::jsonb,
  add column if not exists extension text,
  add column if not exists place_of_birth text,
  add column if not exists gender text,
  add column if not exists religion text,
  add column if not exists current_house_no text,
  add column if not exists current_street text,
  add column if not exists current_barangay text,
  add column if not exists current_municipality text,
  add column if not exists current_province text,
  add column if not exists current_country text,
  add column if not exists current_zip_code text,
  add column if not exists same_as_current_address boolean default false,
  add column if not exists permanent_house_no text,
  add column if not exists permanent_street text,
  add column if not exists permanent_barangay text,
  add column if not exists permanent_municipality text,
  add column if not exists permanent_province text,
  add column if not exists permanent_country text,
  add column if not exists permanent_zip_code text,
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
  add column if not exists guardian_contact_number text,
  add column if not exists report_card_url text,
  add column if not exists birth_certificate_url text,
  add column if not exists other_requirement_url text,
  add column if not exists requirements_submitted boolean default false;

create index if not exists student_applications_user_id_idx
  on public.student_applications (user_id);
create index if not exists student_applications_email_idx
  on public.student_applications (lower(email));
create index if not exists student_applications_assigned_section_id_idx
  on public.student_applications (assigned_section_id);

-- ------------------------------------------------------------
-- 3. Profiles used for role-based access control
-- ------------------------------------------------------------
create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  full_name text,
  email text,
  role text default 'student',
  created_at timestamptz default now()
);

alter table public.profiles
  add column if not exists full_name text,
  add column if not exists email text,
  add column if not exists role text default 'student',
  add column if not exists created_at timestamptz default now();

-- ------------------------------------------------------------
-- 4. Sections used by registrar and student dashboards
-- ------------------------------------------------------------
create table if not exists public.sections (
  id text primary key,
  name text not null,
  grade_level text,
  strand text,
  adviser_name text,
  school_year text,
  capacity integer,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

alter table public.sections
  add column if not exists grade_level text,
  add column if not exists strand text,
  add column if not exists adviser_name text,
  add column if not exists school_year text,
  add column if not exists capacity integer,
  add column if not exists created_at timestamptz default now(),
  add column if not exists updated_at timestamptz default now();

do $$
declare
  section_id_type text;
begin
  select data_type
    into section_id_type
  from information_schema.columns
  where table_schema = 'public'
    and table_name = 'sections'
    and column_name = 'id';

  if section_id_type in ('text', 'character varying') then
    insert into public.sections (id, name, grade_level, strand, adviser_name, school_year, capacity)
    values
      ('sec-stem-11a', '11 - STEM Einstein', 'Grade 11', 'STEM', 'Mrs. Maria Santos', '2025-2026', 45),
      ('sec-stem-11b', '11 - STEM Newton', 'Grade 11', 'STEM', 'Mr. John Dela Cruz', '2025-2026', 45),
      ('sec-abm-11a', '11 - ABM Pacioli', 'Grade 11', 'ABM', 'Ms. Elena Reyes', '2025-2026', 45),
      ('sec-humss-11a', '11 - HUMSS Rizal', 'Grade 11', 'HUMSS', 'Mr. Carlos Aquino', '2025-2026', 45),
      ('sec-humss-11b', '11 - HUMSS Mabini', 'Grade 11', 'HUMSS', 'Mrs. Gloria Ramos', '2025-2026', 45),
      ('sec-gas-11a', '11 - GAS Bonifacio', 'Grade 11', 'GAS', 'Mr. Antonio Luna', '2025-2026', 45),
      ('sec-tvl-11a', '11 - TVL ICT Turing', 'Grade 11', 'TVL-ICT', 'Engr. Mark Castillo', '2025-2026', 40),
      ('sec-tvl-11b', '11 - TVL HE Escoffier', 'Grade 11', 'TVL-HE', 'Ms. Teresa Garcia', '2025-2026', 40),
      ('sec-tvl-11c', '11 - TVL IA Tesla', 'Grade 11', 'TVL-IA', 'Mr. Roberto Mendoza', '2025-2026', 40)
    on conflict (id) do nothing;
  elsif section_id_type = 'uuid' then
    insert into public.sections (id, name, grade_level, strand, adviser_name, school_year, capacity)
    select
      gen_random_uuid(),
      seed.name,
      seed.grade_level,
      seed.strand,
      seed.adviser_name,
      seed.school_year,
      seed.capacity
    from (
      values
        ('11 - STEM Einstein', 'Grade 11', 'STEM', 'Mrs. Maria Santos', '2025-2026', 45),
        ('11 - STEM Newton', 'Grade 11', 'STEM', 'Mr. John Dela Cruz', '2025-2026', 45),
        ('11 - ABM Pacioli', 'Grade 11', 'ABM', 'Ms. Elena Reyes', '2025-2026', 45),
        ('11 - HUMSS Rizal', 'Grade 11', 'HUMSS', 'Mr. Carlos Aquino', '2025-2026', 45),
        ('11 - HUMSS Mabini', 'Grade 11', 'HUMSS', 'Mrs. Gloria Ramos', '2025-2026', 45),
        ('11 - GAS Bonifacio', 'Grade 11', 'GAS', 'Mr. Antonio Luna', '2025-2026', 45),
        ('11 - TVL ICT Turing', 'Grade 11', 'TVL-ICT', 'Engr. Mark Castillo', '2025-2026', 40),
        ('11 - TVL HE Escoffier', 'Grade 11', 'TVL-HE', 'Ms. Teresa Garcia', '2025-2026', 40),
        ('11 - TVL IA Tesla', 'Grade 11', 'TVL-IA', 'Mr. Roberto Mendoza', '2025-2026', 40)
    ) as seed(name, grade_level, strand, adviser_name, school_year, capacity)
    where not exists (
      select 1
      from public.sections existing
      where existing.name = seed.name
    );
  end if;
end
$$;

update public.student_applications sa
set assigned_section_id = null
where sa.assigned_section_id is not null
  and not exists (
    select 1 from public.sections s where s.id::text = sa.assigned_section_id
  );

do $$
declare
  section_id_type text;
begin
  select data_type
    into section_id_type
  from information_schema.columns
  where table_schema = 'public'
    and table_name = 'sections'
    and column_name = 'id';

  if section_id_type in ('text', 'character varying') then
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
  end if;
end
$$;

alter table public.student_applications replica identity full;
alter table public.sections replica identity full;

-- ------------------------------------------------------------
-- 5. Backfill existing student data
-- ------------------------------------------------------------
-- Linked auth users: prefer the auth email because that is the
-- email used to sign in to the student dashboard.
update public.student_applications sa
set email = coalesce(
  nullif(trim(sa.email), ''),
  nullif(trim(au.email), ''),
  nullif(trim(sa.requirements_documents->>'student_email'), '')
)
from auth.users au
where sa.user_id = au.id
  and (sa.email is null or trim(sa.email) = '');

-- Unlinked legacy rows: recover the email saved with requirements.
update public.student_applications sa
set email = nullif(trim(sa.requirements_documents->>'student_email'), '')
where sa.user_id is null
  and (sa.email is null or trim(sa.email) = '')
  and nullif(trim(sa.requirements_documents->>'student_email'), '') is not null;

update public.student_applications sa
set
  track = coalesce(
    nullif(trim(sa.track), ''),
    au.raw_user_meta_data->>'track'
  ),
  lrn = coalesce(
    nullif(trim(sa.lrn), ''),
    au.raw_user_meta_data->>'lrn'
  ),
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
    sa.track is null
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

update public.student_applications
set status = lower(regexp_replace(trim(status), '[\s-]+', '_', 'g'))
where status is not null
  and status <> lower(regexp_replace(trim(status), '[\s-]+', '_', 'g'));

-- ------------------------------------------------------------
-- 6. Role helper functions
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
-- 7. Drop previous policies before recreating them
-- ------------------------------------------------------------
do $$
declare
  policy_record record;
begin
  for policy_record in
    select policyname
    from pg_policies
    where schemaname = 'public' and tablename = 'student_applications'
  loop
    execute format(
      'drop policy if exists %I on public.student_applications',
      policy_record.policyname
    );
  end loop;

  for policy_record in
    select policyname
    from pg_policies
    where schemaname = 'public' and tablename = 'profiles'
  loop
    execute format(
      'drop policy if exists %I on public.profiles',
      policy_record.policyname
    );
  end loop;

  for policy_record in
    select policyname
    from pg_policies
    where schemaname = 'public' and tablename = 'sections'
  loop
    execute format(
      'drop policy if exists %I on public.sections',
      policy_record.policyname
    );
  end loop;
end
$$;

-- ------------------------------------------------------------
-- 8. student_applications RLS
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
-- 9. profiles RLS
-- ------------------------------------------------------------
alter table public.profiles enable row level security;

revoke all on table public.profiles from anon, authenticated;
grant select, insert, update, delete on table public.profiles to authenticated;
grant all on table public.profiles to service_role;

create policy "Users can view their own profile"
  on public.profiles
  for select
  to authenticated
  using (id = auth.uid() or public.is_admin());

create policy "Admins can create profiles"
  on public.profiles
  for insert
  to authenticated
  with check (public.is_admin());

create policy "Admins can update profiles"
  on public.profiles
  for update
  to authenticated
  using (public.is_admin())
  with check (public.is_admin());

create policy "Admins can delete profiles"
  on public.profiles
  for delete
  to authenticated
  using (public.is_admin());

-- ------------------------------------------------------------
-- 10. sections RLS
-- ------------------------------------------------------------
alter table public.sections enable row level security;

revoke all on table public.sections from anon, authenticated;
grant select, insert, update, delete on table public.sections to authenticated;
grant all on table public.sections to service_role;

create policy "Staff can manage sections"
  on public.sections
  for all
  to authenticated
  using (public.is_staff_or_admin())
  with check (public.is_staff_or_admin());

create policy "Students can view their assigned section"
  on public.sections
  for select
  to authenticated
  using (
    exists (
      select 1
      from public.student_applications sa
      where sa.assigned_section_id = public.sections.id::text
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
-- 11. updated_at triggers
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
-- 12. Realtime updates for student dashboards
-- ------------------------------------------------------------
do $$
begin
  if not exists (
    select 1 from pg_publication where pubname = 'supabase_realtime'
  ) then
    create publication supabase_realtime;
  end if;

  if not exists (
    select 1
    from pg_publication
    where pubname = 'supabase_realtime'
      and puballtables = true
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

-- ------------------------------------------------------------
-- 13. Storage: public read, service-role writes
-- ------------------------------------------------------------
insert into storage.buckets (id, name, public)
values
  ('enrollment-documents.', 'enrollment-documents.', true),
  ('requirements', 'requirements', true)
on conflict (id) do update set public = true;

do $$
declare
  policy_record record;
begin
  for policy_record in
    select policyname
    from pg_policies
    where schemaname = 'storage'
      and tablename = 'objects'
      and (
        coalesce(qual, '') ilike '%enrollment-documents%'
        or coalesce(with_check, '') ilike '%enrollment-documents%'
        or coalesce(qual, '') ilike '%requirements%'
        or coalesce(with_check, '') ilike '%requirements%'
      )
  loop
    execute format(
      'drop policy if exists %I on storage.objects',
      policy_record.policyname
    );
  end loop;
end
$$;

drop policy if exists "Public read enrollment documents" on storage.objects;

create policy "Public read enrollment documents"
  on storage.objects
  for select
  to anon, authenticated
  using (bucket_id in ('enrollment-documents.', 'requirements'));

notify pgrst, 'reload schema';

commit;
