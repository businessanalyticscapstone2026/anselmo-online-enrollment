-- Refresh PostgREST's schema cache after DDL changes.
-- Run this in the Supabase SQL Editor if the API reports PGRST205
-- ("Could not find the table ... in the schema cache") even though
-- the table exists in the public schema.
NOTIFY pgrst, 'reload schema';
