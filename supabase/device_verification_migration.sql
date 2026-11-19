-- Device-aware verification for staff and admin sign-ins.
-- New/unrecognized browsers must confirm a one-time code sent by email before
-- the normal email OTP / TOTP flow continues.
-- Service-role only: no anon/authenticated access.

create table if not exists public.trusted_login_devices (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  area text not null check (area in ('staff', 'admin')),
  device_hash text not null,
  user_agent text,
  ip_address text,
  first_seen timestamptz not null default now(),
  last_seen timestamptz not null default now(),
  trusted_until timestamptz not null,
  unique (user_id, area, device_hash)
);

create index if not exists trusted_login_devices_lookup_idx
  on public.trusted_login_devices (user_id, area, device_hash);

create table if not exists public.device_verification_challenges (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  area text not null check (area in ('staff', 'admin')),
  device_hash text not null,
  code_hash text not null,
  attempts integer not null default 0,
  consumed_at timestamptz,
  expires_at timestamptz not null,
  created_at timestamptz not null default now()
);

create index if not exists device_verification_challenges_lookup_idx
  on public.device_verification_challenges (user_id, area, device_hash, created_at desc);

alter table public.trusted_login_devices enable row level security;
alter table public.device_verification_challenges enable row level security;

revoke all on table public.trusted_login_devices from anon, authenticated;
revoke all on table public.device_verification_challenges from anon, authenticated;

grant all on table public.trusted_login_devices to service_role;
grant all on table public.device_verification_challenges to service_role;

create or replace function public.cleanup_expired_device_challenges()
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  deleted_count integer;
begin
  delete from public.device_verification_challenges
  where expires_at < now() - interval '1 day'
     or (consumed_at is not null and consumed_at < now() - interval '1 day');

  get diagnostics deleted_count = row_count;
  return deleted_count;
end;
$$;

revoke all on function public.cleanup_expired_device_challenges() from public;
grant execute on function public.cleanup_expired_device_challenges() to service_role;

notify pgrst, 'reload schema';
