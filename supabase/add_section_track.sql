-- Add a track column to public.sections so registrars can classify each
-- section as Academic or Technical Professional (TechPro).
alter table public.sections
  add column if not exists track text;

-- Support both naming conventions for the cluster field across deployments.
alter table public.sections
  add column if not exists cluster text;

alter table public.sections
  add column if not exists strand text;

-- Keep the two cluster columns in sync for existing rows.
update public.sections
set cluster = strand
where (cluster is null or btrim(cluster) = '')
  and strand is not null
  and btrim(strand) <> '';

update public.sections
set strand = cluster
where (strand is null or btrim(strand) = '')
  and cluster is not null
  and btrim(cluster) <> '';

-- Backfill existing sections from their cluster.
update public.sections
set track = case
  when coalesce(nullif(btrim(cluster), ''), nullif(btrim(strand), '')) ~* '^(tvl|tech|industrial|construction|hospitality|ict|home economics|caregiving|food)' then 'techpro'
  when coalesce(nullif(btrim(cluster), ''), nullif(btrim(strand), '')) is not null then 'academic'
  else null
end
where track is null;

-- Refresh PostgREST's schema cache so the new column is exposed immediately.
notify pgrst, 'reload schema';
