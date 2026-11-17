-- Backfill blank profile display names so existing accounts stop appearing as
-- "Unnamed User" in the admin dashboard and activity logs.
--
-- Priority:
--   1. Existing profile full_name
--   2. Latest student application's first/middle/last name
--   3. Auth user metadata full_name
--   4. Auth user metadata first/middle/last name
--   5. Readable email prefix
--
-- Safe to run multiple times. It never overwrites a non-blank name.

with candidates as (
  select
    p.id,
    coalesce(
      nullif(btrim(p.full_name), ''),
      (
        select nullif(
          btrim(
            concat_ws(
              ' ',
              nullif(btrim(sa.first_name), ''),
              nullif(btrim(sa.middle_name), ''),
              nullif(btrim(sa.last_name), '')
            )
          ),
          ''
        )
        from public.student_applications sa
        where sa.user_id = p.id
        order by sa.submitted_at desc nulls last
        limit 1
      ),
      nullif(btrim(u.raw_user_meta_data ->> 'full_name'), ''),
      nullif(
        btrim(
          concat_ws(
            ' ',
            nullif(btrim(u.raw_user_meta_data ->> 'first_name'), ''),
            nullif(btrim(u.raw_user_meta_data ->> 'middle_name'), ''),
            nullif(btrim(u.raw_user_meta_data ->> 'last_name'), '')
          )
        ),
        ''
      ),
      nullif(
        initcap(
          btrim(
            regexp_replace(
              split_part(
                coalesce(
                  nullif(btrim(p.email), ''),
                  nullif(btrim(u.email), '')
                ),
                '@',
                1
              ),
              '[._-]+',
              ' ',
              'g'
            )
          )
        ),
        ''
      )
    ) as resolved_name
  from public.profiles p
  left join auth.users u on u.id = p.id
  where p.full_name is null or btrim(p.full_name) = ''
)
update public.profiles p
set full_name = c.resolved_name
from candidates c
where p.id = c.id
  and c.resolved_name is not null
  and (p.full_name is null or btrim(p.full_name) = '');
