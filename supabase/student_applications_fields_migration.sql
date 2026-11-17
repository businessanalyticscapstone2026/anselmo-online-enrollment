-- Add the student application fields shown on the staff application detail.
-- Internal columns used by the enrollment flow (id, user_id, status,
-- assigned_section_id, requirements_documents, upload tokens, ...) are kept.
--
-- upload requirements are stored in the existing requirements_documents jsonb
-- column. Safe to run multiple times.

ALTER TABLE public.student_applications
  ADD COLUMN IF NOT EXISTS email text,
  ADD COLUMN IF NOT EXISTS place_of_birth text,
  ADD COLUMN IF NOT EXISTS gender text,
  ADD COLUMN IF NOT EXISTS religion text,
  ADD COLUMN IF NOT EXISTS is_ip_community boolean,
  ADD COLUMN IF NOT EXISTS is_4ps_beneficiary boolean,
  ADD COLUMN IF NOT EXISTS current_address text,
  ADD COLUMN IF NOT EXISTS permanent_address text,
  ADD COLUMN IF NOT EXISTS father_name text,
  ADD COLUMN IF NOT EXISTS mother_name text,
  ADD COLUMN IF NOT EXISTS legal_guardian_name text,
  ADD COLUMN IF NOT EXISTS legal_guardian_contact_number text;

UPDATE public.student_applications
SET
  email = coalesce(
    nullif(btrim(email), ''),
    nullif(btrim(requirements_documents ->> 'student_email'), ''),
    nullif(btrim(student_details ->> 'email'), '')
  ),
  place_of_birth = coalesce(
    nullif(btrim(place_of_birth), ''),
    nullif(btrim(student_details ->> 'place_of_birth'), '')
  ),
  gender = coalesce(
    nullif(btrim(gender), ''),
    nullif(btrim(sex), ''),
    nullif(btrim(student_details ->> 'gender'), '')
  ),
  religion = coalesce(
    nullif(btrim(religion), ''),
    nullif(btrim(student_details ->> 'religion'), '')
  ),
  is_ip_community = coalesce(
    is_ip_community,
    lower(coalesce(student_details ->> 'is_ip_community', '')) IN ('true', 'yes', '1')
  ),
  is_4ps_beneficiary = coalesce(
    is_4ps_beneficiary,
    lower(coalesce(student_details ->> 'is_4ps_beneficiary', '')) IN ('true', 'yes', '1')
  ),
  current_address = coalesce(
    nullif(btrim(current_address), ''),
    nullif(btrim(address), ''),
    case
      when jsonb_typeof(student_details -> 'current_address') = 'string'
        then nullif(btrim(student_details ->> 'current_address'), '')
      else nullif(
        btrim(
          concat_ws(
            ', ',
            student_details -> 'current_address' ->> 'houseNo',
            student_details -> 'current_address' ->> 'street',
            student_details -> 'current_address' ->> 'barangay',
            student_details -> 'current_address' ->> 'municipality',
            student_details -> 'current_address' ->> 'province',
            student_details -> 'current_address' ->> 'zipCode',
            student_details -> 'current_address' ->> 'country'
          )
        ),
        ''
      )
    end
  ),
  permanent_address = coalesce(
    nullif(btrim(permanent_address), ''),
    case
      when jsonb_typeof(student_details -> 'permanent_address') = 'string'
        then nullif(btrim(student_details ->> 'permanent_address'), '')
      else nullif(
        btrim(
          concat_ws(
            ', ',
            student_details -> 'permanent_address' ->> 'houseNo',
            student_details -> 'permanent_address' ->> 'street',
            student_details -> 'permanent_address' ->> 'barangay',
            student_details -> 'permanent_address' ->> 'municipality',
            student_details -> 'permanent_address' ->> 'province',
            student_details -> 'permanent_address' ->> 'zipCode',
            student_details -> 'permanent_address' ->> 'country'
          )
        ),
        ''
      )
    end
  ),
  father_name = coalesce(
    nullif(btrim(father_name), ''),
    nullif(
      btrim(
        concat_ws(
          ' ',
          student_details -> 'guardians' -> 'father' ->> 'firstName',
          student_details -> 'guardians' -> 'father' ->> 'middleName',
          student_details -> 'guardians' -> 'father' ->> 'lastName'
        )
      ),
      ''
    )
  ),
  mother_name = coalesce(
    nullif(btrim(mother_name), ''),
    nullif(
      btrim(
        concat_ws(
          ' ',
          student_details -> 'guardians' -> 'mother' ->> 'firstName',
          student_details -> 'guardians' -> 'mother' ->> 'middleName',
          student_details -> 'guardians' -> 'mother' ->> 'lastName'
        )
      ),
      ''
    )
  ),
  legal_guardian_name = coalesce(
    nullif(btrim(legal_guardian_name), ''),
    nullif(
      btrim(
        concat_ws(
          ' ',
          student_details -> 'guardians' -> 'legal_guardian' ->> 'firstName',
          student_details -> 'guardians' -> 'legal_guardian' ->> 'middleName',
          student_details -> 'guardians' -> 'legal_guardian' ->> 'lastName'
        )
      ),
      ''
    )
  ),
  legal_guardian_contact_number = coalesce(
    nullif(btrim(legal_guardian_contact_number), ''),
    nullif(
      btrim(student_details -> 'guardians' -> 'legal_guardian' ->> 'contactNumber'),
      ''
    )
  );
