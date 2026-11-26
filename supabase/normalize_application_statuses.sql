-- Reduce enrollment status to the three supported values:
-- pending, enrolled, rejected.

update public.student_applications
set
    status = 'enrolled'
where
    lower(trim(coalesce(status, ''))) = 'approved';

update public.student_applications
set
    status = 'pending'
where
    status is null
    or lower(trim(status)) not in(
        'pending',
        'enrolled',
        'rejected'
    );