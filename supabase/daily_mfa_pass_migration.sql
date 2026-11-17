-- Once-per-day verification pass for staff and admin logins.
--
-- A row is created after the email OTP succeeds (email_verified_at) and, for
-- admins, updated after TOTP succeeds (totp_verified_at). The pass is scoped to
-- the Asia/Manila calendar day. Only the service role can read or write it.

begin;

create table if not exists public.login_daily_passes (
  user_id uuid not null references auth.users (id) on delete cascade,
  area text not null check (area in ('staff', 'admin')),
  pass_date date not null,
  email_verified_at timestamptz,
  totp_verified_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (user_id, area, pass_date)
);

create index if not exists login_daily_passes_date_idx
  on public.login_daily_passes (pass_date);

alter table public.login_daily_passes enable row level security;

revoke all on public.login_daily_passes from anon, authenticated;
grant all on public.login_daily_passes to service_role;

create or replace function public.cleanup_expired_login_daily_passes()
returns void
language sql
security definer
set search_path = public
as $$
  delete from public.login_daily_passes
  where pass_date < ((now() at time zone 'Asia/Manila')::date - 7);
$$;

revoke all on function public.cleanup_expired_login_daily_passes() from public;
grant execute on function public.cleanup_expired_login_daily_passes() to service_role;

notify pgrst, 'reload schema';

commit;
