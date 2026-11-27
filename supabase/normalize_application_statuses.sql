-- Reduce enrollment status to the supported values:
-- pending, enrolled, denied.
--
-- `rejected` is legacy. Convert it to `denied` so students with missing or
-- unclear requirements can resubmit documents and be reviewed again.

update public.student_applications
set
    status = 'enrolled'
where
    lower(trim(coalesce(status, ''))) = 'approved';

update public.student_applications
set
    status = 'denied'
where
    lower(trim(coalesce(status, ''))) = 'rejected';

update public.student_applications
set
    status = 'pending'
where
    status is null
    or lower(trim(status)) not in(
        'pending',
        'enrolled',
        'denied'
    );
