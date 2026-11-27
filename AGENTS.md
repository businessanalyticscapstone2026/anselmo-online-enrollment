<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes � APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` � verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->

# AASMNHS Online Enrollment � Agent Guide

## Commands (executable source of truth)
- `npm run dev` � Next.js dev server (Next 16.3.5, React 19, TS 5)
- `npm run build` � Production build
- `npm run start` � Serve built app
- `npm run lint` � ESLint (eslint-config-next core-web-vitals + typescript)

## Stack
- Next.js App Router (`app/`), TypeScript, Tailwind v4, lucide-react, @supabase/ssr/js
- reCAPTCHA (`react-google-recaptcha`), nodemailer (SMTP)
- Supabase: auth + DB + Storage

## Core Architecture
- Enrollment flow: `/` ? `/enroll` (track selection) ? `/form` (student info; posts to `/api/submit-application` with `validateOnly: true`, which validates and returns a `draftId` but writes no DB/auth rows; data stays in browser storage) ? `/requirements` (uploads files to Supabase Storage under the draft ID; no DB rows) ? `/enroll/account` (posts the saved draft plus requirements to `/api/submit-application` with `finalize: true`, creating the auth account + application/profiles and invoking `/api/send-account` to email the password; if email delivery fails, all created rows/auth are rolled back; password format `AASMNHS - <6 random digits>`; never displays the password) ? `/login`
- Unified login: `/login` is a single email/password form with no account-type selection. After auth it reads `profiles.role` and routes by role: `student` -> `/student/dashboard`, `staff`/`registrar` -> staff OTP -> `/staff/dashboard`, `admin`/`ict_admin` -> admin OTP + TOTP -> `/admin`. Role is never chosen in the UI. Legacy `/staff/login` -> `/login?area=staff` and `/admin/login` -> `/login?area=admin` (the `area` param only preserves old links).
- Staff/Admin MFA: password (+reCAPTCHA for admin) -> email OTP (`/api/auth/mfa/send|verify`); admin also completes Supabase TOTP when `ADMIN_REQUIRE_TOTP` is not `false`. Admin enrollment/verification at `/admin/security`.
- Staff portal: `/staff/dashboard` (requires `staff`/`registrar` role + valid staff MFA cookie). Admin portal: `/admin` (requires `admin` role + admin MFA cookie + AAL2).
- Supabase clients: `lib/supabaseClient.ts` exports singleton `supabase` (browser anon) with fallback defaults. `lib/supabase/client.ts` also exports wrapper; prefer `@/lib/supabaseClient` in client components or existing conventions.
- API routes use service role when available (`SUPABASE_SERVICE_ROLE_KEY`) to bypass RLS or to admin-create/update users (see `/api/submit-application`, `/api/send-account`).

## Supabase Schema & Quirks
- Table: `public.student_applications` (schema.sql has full definition). RLS is disabled by schema (`DISABLE ROW LEVEL SECURITY`) and grants ALL to anon/auth/service_role. Status values are not constrained � code uses `pending`, `Under Review`, etc.
- `user_id` is nullable (DROP NOT NULL) to allow guest applicants.
- Many extended columns exist (guardians, address split, docs URLs, flags). `/api/submit-application` inserts a full payload and falls back to minimal base payload if backend rejects extended columns (`PGRST204`), and can auto-provision auth user if `user_id` NOT NULL is enforced (`23502`) by creating/checking auth user and retrying with `user_id`.
- Storage: bucket `enrollment-documents` (referenced in `/app/requirements/page.tsx` as `enrollment-documents`) � schema.sql shows bucket `requirements`. Upload path: `${folder}/${draftIdOrApplicationId}-${unique}-${sanitizedName}`. Check actual bucket name if uploads fail; code and SQL differ slightly (`enrollment-documents` vs `requirements`). 
- Dashboard queries `student_applications` (no ORDER BY assumed; may need to inspect columns). Flexible getters read multiple possible column names.

## Environment Variables (.env.local)
Required/used:
- `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY` (client)
- `SUPABASE_SERVICE_ROLE_KEY` (server APIs; falls back to anon if missing)
- `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS`, `EMAIL_FROM` (nodemailer; `/api/send-account` treats placeholders as unconfigured and will still show generated password if email not sent)
- `NEXT_PUBLIC_RECAPTCHA_SITE_KEY`, `RECAPTCHA_SECRET_KEY` (reCAPTCHA v2)
- `MFA_SESSION_SECRET` (required; HMAC key for OTP hashes + signed `aasmnhs_mfa_staff`/`aasmnhs_mfa_admin` cookies; fails closed if unset)
- `ADMIN_REQUIRE_TOTP` (default `true`; only the literal string `false` disables the admin TOTP/AAL2 requirement)
- On Vercel, `.env.local` is not deployed; set every required variable in Project Settings -> Environment Variables (Production and Preview) and redeploy. Gmail SMTP works on ports 465/587; port 25 is blocked. The MFA send route sets `maxDuration = 60` because SMTP needs the function to stay alive until `sendMail` resolves.

## Key Files & Entry Points
- App: `app/page.tsx`, `app/enroll/page.tsx`, `app/form/page.tsx`, `app/requirements/page.tsx`, `app/enroll/account/page.tsx`, `app/login/page.tsx`
- Login/MFA: `app/login/page.tsx`, `app/login/_components/*`, `app/admin/security/*`, `app/staff/forgot-password/page.tsx`
- Staff: `app/staff/dashboard/page.tsx`, `app/staff/dashboard/applications/page.tsx` (application review, requirements, and status updates beside each record), `app/staff/dashboard/sections/page.tsx`, `app/staff/dashboard/reports/page.tsx`, `app/staff/reset-password/page.tsx`
- API: `app/api/submit-application/route.ts`, `app/api/send-account/route.ts`, `app/api/verify-recaptcha/route.ts`, `app/api/auth/mfa/{send,verify,logout}/route.ts`
- Auth: `lib/auth/{server,roles,adminAuth,mfa,mfaCookie,mfaToken}.ts`, `lib/mailer.ts`, `proxy.ts`
- Lib: `lib/supabaseClient.ts`, `lib/supabase/client.ts`, `lib/enrollmentFormOptions.ts`
- DB: `supabase/schema.sql`, `supabase/unified_login_mfa_migration.sql`, `supabase/add_enrollment_profile_fields_migration.sql`
- Config: `tsconfig.json` (strict, moduleResolution bundler, jsx react-jsx), `eslint.config.mjs` (next config), `postcss.config.mjs`

## Gotchas for Agents
- Client uses singleton `supabase` from `@/lib/supabaseClient` (has hardcoded fallback URL/key if env missing). Don�t duplicate client creation unnecessarily.
- API routes fall back to hardcoded Supabase creds if env missing (see route.ts) � treat env as source of truth in real deployments.
- `/requirements/page.tsx` uploads to storage bucket `enrollment-documents` but schema.sql creates `requirements`. If storage policies/uploads behave unexpectedly, verify bucket name/policies in Supabase.
- reCAPTCHA token is verified server-side via `/api/verify-recaptcha` before sign-in; token can only be used once.
- Credential emails are sent only by `/api/send-account`, which finalization invokes. Enrollment rows are created only during finalization; if the email is not delivered, `/api/submit-application` deletes the new application, profiles, `student_profiles`, and auth user. Staff/admin lists still use `lib/applicationVisibility.ts` and hide rows whose `student_details.credentials_sent` is not `true`; legacy rows without the flag fall back to `requirements_submitted`/final status.
- Staff decisions use `enrolled` or `denied`; `rejected` is legacy only. `denied` is not final: the student sees a resubmit action on `/student/dashboard`, uploads replacement documents at `/student/requirements` (POST `/api/student/resubmit-requirements`), and the application returns to `pending` for another review. `/api/staff/update-status` emails the denied notice via `sendEnrollmentStatusEmail`. Admin Manage Users no longer shows a rejected-student removal queue.
- Email delivery is required for finalization; if SMTP is unconfigured or delivery fails, the enrollment row/auth account is rolled back and the student sees an error.
- Staff auth checks `profiles.role` (case-insensitive) must be in {staff, registrar}; admin APIs also require `admin`/`ict_admin` role, the admin MFA cookie, and AAL2 (TOTP) via `verifyAdminRequest`. The SQL helpers (`is_admin`, `is_staff_or_admin`) still use `admin`; direct client RLS for `ict_admin` may need a SQL alias update.
- Staff/admin client logout must POST `/api/auth/mfa/logout` (e.g. `{area:"staff"}`) before clearing the Supabase session, otherwise the MFA cookie survives.
- OTP state lives in `login_otp_challenges` (service-role only). Apply `supabase/admin_dashboard_migration.sql` first (creates `activity_logs`), then `supabase/unified_login_mfa_migration.sql`; the MFA migration safely skips the activity-log policy if that table is absent. Email OTP requires `MFA_SESSION_SECRET`, `SUPABASE_SERVICE_ROLE_KEY`, and SMTP/Gmail credentials.
- The AGENTS.md Next.js block is auto-regenerated by `next dev` � don�t remove it; committing it keeps tree clean.

## When to Consult Existing Sources
- If Next.js 16 specifics matter, check `node_modules/next/dist/docs/` as noted. If schemas/policies unclear, trust `supabase/schema.sql` and running SQL in Supabase over prose. Let config (package.json, tsconfig, eslint) be executable sources.
