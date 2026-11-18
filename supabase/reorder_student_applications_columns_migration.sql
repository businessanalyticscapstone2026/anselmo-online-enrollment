-- Reorders public.student_applications to match the /form field order.
-- PostgreSQL cannot reorder columns in place, so this rebuilds the table.
-- The current table is copied to public.student_applications_backup first.
-- Run in the Supabase SQL Editor after taking a database backup. Verify the
-- app afterwards, then drop the backup table when you are satisfied.

begin;

do $$
begin
  if to_regclass('public.student_applications_backup') is not null then
    raise exception 'public.student_applications_backup already exists. Rename or drop it before re-running this migration.';
  end if;
end
$$;

drop policy if exists "Students can view their assigned section" on public.sections;

create table public.student_applications_backup as
select * from public.student_applications;

revoke all on table public.student_applications_backup from public, anon, authenticated;
alter table public.student_applications_backup enable row level security;

drop table public.student_applications;

create table public.student_applications (
  track text,
  selected_cluster text,
  strand text,
  lrn text,
  college_course text,
  last_name text,
  first_name text,
  middle_name text,
  extension text,
  email text,
  birth_date date,
  place_of_birth text,
  gender text,
  sex text,
  religion text,
  contact_number text,
  ip_community_type text,
  four_ps_household_id text,
  current_house_no text,
  current_street text,
  current_barangay text,
  current_municipality text,
  current_province text,
  current_country text,
  current_zip_code text,
  current_address text,
  address text,
  same_as_current_address boolean default false,
  permanent_house_no text,
  permanent_street text,
  permanent_barangay text,
  permanent_municipality text,
  permanent_province text,
  permanent_country text,
  permanent_zip_code text,
  permanent_address text,
  father_last_name text,
  father_first_name text,
  father_middle_name text,
  father_contact_number text,
  father_name text,
  mother_last_name text,
  mother_first_name text,
  mother_middle_name text,
  mother_contact_number text,
  mother_name text,
  guardian_last_name text,
  guardian_first_name text,
  guardian_middle_name text,
  guardian_contact_number text,
  legal_guardian_name text,
  legal_guardian_contact_number text,
  special_needs_program boolean,
  special_needs_condition text,
  special_needs_group text,
  special_needs_detail text,
  has_pwd_id boolean,
  last_school_year_completed text,
  last_school_attended text,
  last_school_id text,
  preferred_distance_modalities text[],
  certification_accepted boolean,
  grade_level text,
  student_details jsonb default '{}'::jsonb,
  requirements_documents jsonb default '{}'::jsonb,
  report_card_url text,
  birth_certificate_url text,
  other_requirement_url text,
  requirements_submitted boolean default false,
  assigned_section_id text,
  registrar_remarks text,
  status text default 'pending',
  submitted_at timestamptz default now(),
  updated_at timestamptz default now(),
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users(id) on delete set null
);

do $$
declare
  missing_column record;
  shared_columns text;
begin
  for missing_column in
    select
      a.attname,
      format_type(a.atttypid, a.atttypmod) as column_type
    from pg_attribute a
    where a.attrelid = 'public.student_applications_backup'::regclass
      and a.attnum > 0
      and not a.attisdropped
      and a.attname not in (
        select attname
        from pg_attribute
        where attrelid = 'public.student_applications'::regclass
          and attnum > 0
          and not attisdropped
      )
    order by a.attnum
  loop
    execute format(
      'alter table public.student_applications add column %I %s',
      missing_column.attname,
      missing_column.column_type
    );
  end loop;

  select string_agg(format('%I', a.attname), ', ' order by a.attnum)
  into shared_columns
  from pg_attribute a
  where a.attrelid = 'public.student_applications_backup'::regclass
    and a.attnum > 0
    and not a.attisdropped
    and a.attname in (
      select attname
      from pg_attribute
      where attrelid = 'public.student_applications'::regclass
        and attnum > 0
        and not attisdropped
    );

  execute format(
    'insert into public.student_applications (%s) select %s from public.student_applications_backup',
    shared_columns,
    shared_columns
  );
end
$$;

create or replace function public.set_student_applications_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create or replace function public.is_enrollment_open()
returns boolean
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  s record;
  today_manila date;
begin
  if to_regclass('public.enrollment_settings') is null then
    return false;
  end if;

  select enrollment_start_date, enrollment_end_date
  into s
  from public.enrollment_settings
  where id = 1
  limit 1;

  if not found then
    return false;
  end if;

  if s.enrollment_start_date is null or s.enrollment_end_date is null then
    return false;
  end if;

  today_manila := (now() at time zone 'Asia/Manila')::date;

  return today_manila between s.enrollment_start_date and s.enrollment_end_date;
end;
$$;

create or replace function public.enforce_enrollment_window()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if coalesce(auth.role(), '') = 'service_role' then
    return new;
  end if;

  if public.is_staff_or_admin() then
    return new;
  end if;

  if not public.is_enrollment_open() then
    raise exception 'Online enrollment is currently closed. New applications are not being accepted.'
      using errcode = 'P0001';
  end if;

  return new;
end;
$$;

alter table public.student_applications
  add constraint student_applications_assigned_section_id_fkey
  foreign key (assigned_section_id)
  references public.sections(id)
  on delete set null;

create index student_applications_user_id_idx
  on public.student_applications (user_id);
create index student_applications_email_idx
  on public.student_applications (lower(email));
create index student_applications_selected_cluster_idx
  on public.student_applications (selected_cluster);
create index student_applications_assigned_section_id_idx
  on public.student_applications (assigned_section_id);

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

create trigger student_applications_set_updated_at
  before update on public.student_applications
  for each row execute function public.set_student_applications_updated_at();

create trigger enforce_enrollment_window
  before insert on public.student_applications
  for each row execute function public.enforce_enrollment_window();

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
  end if;
end
$$;

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

commit;

-- After verifying the app, remove the backup:
-- drop table public.student_applications_backup;
