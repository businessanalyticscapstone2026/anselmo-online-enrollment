-- Unified login + MFA hardening
-- Run this in the Supabase SQL Editor after the existing schema/security migrations.

begin;

-- 1. One-time email OTP challenges for the Staff and Admin portals.
--    This table is intentionally service-role only: the anon/authenticated roles
--    must never be able to read or forge OTP rows.
create table if not exists public.login_otp_challenges (
    id uuid primary key default gen_random_uuid (),
    user_id uuid not null references auth.users (id) on delete cascade,
    email text not null,
    area text not null check (area in ('staff', 'admin')),
    code_hash text not null,
    attempts integer not null default 0,
    consumed_at timestamptz,
    expires_at timestamptz not null,
    created_at timestamptz not null default now()
);

create index if not exists login_otp_challenges_lookup_idx on public.login_otp_challenges (
    user_id,
    area,
    created_at desc
);

alter table public.login_otp_challenges enable row level security;

-- No policies on purpose. Only the service role (used server-side) may touch it.
revoke all on public.login_otp_challenges from anon, authenticated;

grant all on public.login_otp_challenges to service_role;

-- Optional housekeeping helper. Safe to call manually or from a scheduled job.
create or replace function public.cleanup_expired_login_otp_challenges()
returns void
language sql
security definer
set search_path = public
as $$
  delete from public.login_otp_challenges
  where created_at < now() - interval '2 days';
$$;

revoke all on function public.cleanup_expired_login_otp_challenges ()
from public;

grant
execute on function public.cleanup_expired_login_otp_challenges () to service_role;

-- 2. Activity logs may only be inserted by staff/admin sessions.
--    (The API routes use the service role, which bypasses RLS, so logging keeps
--    working while anon/student roles can no longer write arbitrary log rows.)
--    Skip this block when activity_logs has not been created yet so OTP table
--    creation in this migration can never be rolled back by it.
do $$
begin
  if to_regclass('public.activity_logs') is not null then
    execute 'drop policy if exists "Allow authenticated to insert activity logs" on public.activity_logs';
    execute 'drop policy if exists "Staff and admins can insert activity logs" on public.activity_logs';
    execute 'create policy "Staff and admins can insert activity logs" on public.activity_logs for insert to authenticated with check (public.is_staff_or_admin())';
  end if;
end
$$;

-- 3. Accept the ict_admin alias wherever the legacy admin role is checked.
create or replace function public.is_admin()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(public.current_user_role() in ('admin', 'ict_admin'), false)
$$;

create or replace function public.is_staff_or_admin()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(
    public.current_user_role() in ('staff', 'registrar', 'admin', 'ict_admin'),
    false
  )
$$;

-- Ask PostgREST to refresh its schema cache so login_otp_challenges is visible
-- immediately after this migration runs.
notify pgrst, 'reload schema';

commit;