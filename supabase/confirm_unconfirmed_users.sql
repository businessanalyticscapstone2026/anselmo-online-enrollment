-- Confirm accounts that were created before email confirmation was enforced.
-- Run this once in the Supabase SQL editor.
--
-- This only fixes the "Email not confirmed" sign-in error. Students who do
-- not know their temporary password should use the Forgot Password flow.

UPDATE auth.users
SET email_confirmed_at = COALESCE(email_confirmed_at, now()),
    updated_at = now()
WHERE email_confirmed_at IS NULL;

-- Verify that no unconfirmed accounts remain.
SELECT id, email, email_confirmed_at
FROM auth.users
WHERE email_confirmed_at IS NULL;
