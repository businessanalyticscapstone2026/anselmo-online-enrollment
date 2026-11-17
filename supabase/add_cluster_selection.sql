-- Add the selected elective cluster to enrollment applications.
-- Safe to run more than once. Existing records are backfilled from the
-- student_details JSON payload written by /api/submit-application.

alter table public.student_applications
  add column if not exists selected_cluster text,
  add column if not exists student_details jsonb default '{}'::jsonb;

-- Backfill the cluster selected during the new cluster-selection step.
update public.student_applications
set selected_cluster = nullif(trim(student_details->>'selected_cluster'), '')
where selected_cluster is null
  and nullif(trim(student_details->>'selected_cluster'), '') is not null;

-- Backfill the top-level track column for older records that only stored it
-- inside student_details.
update public.student_applications
set track = nullif(trim(student_details->>'selected_track'), '')
where (track is null or trim(track) = '')
  and nullif(trim(student_details->>'selected_track'), '') is not null;

create index if not exists student_applications_selected_cluster_idx
  on public.student_applications (selected_cluster);
