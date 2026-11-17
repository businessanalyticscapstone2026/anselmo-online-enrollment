-- Add the selected cluster/track to enrollment applications and backfill
-- existing records from Supabase Auth metadata. Safe to run more than once.

alter table public.student_applications
  add column if not exists track text;

update public.student_applications sa
set track = coalesce(
  nullif(trim(sa.track), ''),
  au.raw_user_meta_data->>'track'
)
from auth.users au
where sa.user_id = au.id
  and (
    sa.track is null
    or trim(sa.track) = ''
  );
