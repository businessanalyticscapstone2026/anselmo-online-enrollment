import {
  getCanonicalCluster,
  getTrackLabel,
  isValidClusterForTrack,
  normalizeTrack,
} from "@/lib/clusters";

type JsonRecord = Record<string, unknown>;

export const WALK_IN_GRADE_LEVELS = ["Grade 11", "Grade 12"] as const;

export const WALK_IN_SEX_OPTIONS = ["Male", "Female"] as const;

export const WALK_IN_STATUSES = ["pending", "enrolled", "denied"] as const;

export type WalkInAddress = {
  houseNo: string;
  street: string;
  barangay: string;
  municipality: string;
  province: string;
  country: string;
  zipCode: string;
};

export type WalkInGuardian = {
  lastName: string;
  firstName: string;
  middleName: string;
  contactNumber: string;
};

export type WalkInInput = {
  track: string;
  selectedCluster: string;
  gradeLevel: string;
  lrn: string;
  firstName: string;
  middleName: string;
  lastName: string;
  extension: string;
  email: string;
  birthDate: string;
  age: number | null;
  placeOfBirth: string;
  sex: string;
  religion: string;
  contactNumber: string;
  currentAddress: WalkInAddress;
  permanentAddress: WalkInAddress;
  sameAsCurrentAddress: boolean;
  isIpCommunity: boolean;
  ipCommunityType: string;
  is4psBeneficiary: boolean;
  fourPsHouseholdId: string;
  specialNeedsProgram: boolean | null;
  specialNeedsGroup: string;
  specialNeedsCondition: string;
  specialNeedsDetail: string;
  hasPwdId: boolean | null;
  lastSchoolYearCompleted: string;
  lastSchoolAttended: string;
  lastSchoolId: string;
  collegeCourse: string;
  preferredModalities: string[];
  guardians: WalkInGuardian[];
  certificationAccepted: boolean;
  registrarRemarks: string;
  requirementsToFollow: boolean;
};

export const EMPTY_WALK_IN_ADDRESS: WalkInAddress = {
  houseNo: "",
  street: "",
  barangay: "",
  municipality: "",
  province: "",
  country: "PHILIPPINES",
  zipCode: "",
};

export const EMPTY_WALK_IN_GUARDIAN: WalkInGuardian = {
  lastName: "",
  firstName: "",
  middleName: "",
  contactNumber: "",
};

export function emptyWalkInInput(): WalkInInput {
  return {
    track: "",
    selectedCluster: "",
    gradeLevel: "Grade 11",
    lrn: "",
    firstName: "",
    middleName: "",
    lastName: "",
    extension: "",
    email: "",
    birthDate: "",
    age: null,
    placeOfBirth: "",
    sex: "",
    religion: "",
    contactNumber: "",
    currentAddress: { ...EMPTY_WALK_IN_ADDRESS },
    permanentAddress: { ...EMPTY_WALK_IN_ADDRESS },
    sameAsCurrentAddress: false,
    isIpCommunity: false,
    ipCommunityType: "",
    is4psBeneficiary: false,
    fourPsHouseholdId: "",
    specialNeedsProgram: null,
    specialNeedsGroup: "",
    specialNeedsCondition: "",
    specialNeedsDetail: "",
    hasPwdId: null,
    lastSchoolYearCompleted: "",
    lastSchoolAttended: "",
    lastSchoolId: "",
    collegeCourse: "",
    preferredModalities: [],
    guardians: [
      { ...EMPTY_WALK_IN_GUARDIAN },
      { ...EMPTY_WALK_IN_GUARDIAN },
      { ...EMPTY_WALK_IN_GUARDIAN },
    ],
    certificationAccepted: false,
    registrarRemarks: "",
    requirementsToFollow: false,
  };
}

function asRecord(value: unknown): JsonRecord {
  if (typeof value === "string") {
    try {
      const parsed: unknown = JSON.parse(value);
      return parsed && typeof parsed === "object" && !Array.isArray(parsed)
        ? (parsed as JsonRecord)
        : {};
    } catch {
      return {};
    }
  }

  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as JsonRecord)
    : {};
}

function text(value: unknown, maxLength = 250): string {
  return typeof value === "string" ? value.trim().slice(0, maxLength) : "";
}

function digits(value: unknown, maxLength = 11): string {
  return String(value ?? "")
    .replace(/\D/g, "")
    .slice(0, maxLength);
}

function bool(value: unknown): boolean {
  return value === true || value === "true" || value === 1 || value === "1";
}

function nullableBool(value: unknown): boolean | null {
  if (value === true || value === "true") return true;
  if (value === false || value === "false") return false;
  return null;
}

function numberValue(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) {
    return Math.trunc(value);
  }

  if (typeof value === "string" && value.trim()) {
    const parsed = Number(value.trim());
    return Number.isFinite(parsed) ? Math.trunc(parsed) : null;
  }

  return null;
}

function stringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value
        .filter((item): item is string => typeof item === "string")
        .map((item) => item.trim())
        .filter(Boolean)
    : [];
}

function normalizeAddress(value: unknown): WalkInAddress {
  const record = asRecord(value);

  return {
    houseNo: text(record.houseNo ?? record.house_no, 20),
    street: text(record.street, 150),
    barangay: text(record.barangay, 150),
    municipality: text(record.municipality, 150),
    province: text(record.province, 150),
    country: text(record.country, 100) || "PHILIPPINES",
    zipCode: digits(record.zipCode ?? record.zip_code, 4),
  };
}

function normalizeGuardian(value: unknown): WalkInGuardian {
  const record = asRecord(value);

  return {
    lastName: text(record.lastName ?? record.last_name, 100).toUpperCase(),
    firstName: text(record.firstName ?? record.first_name, 100).toUpperCase(),
    middleName: text(record.middleName ?? record.middle_name, 100).toUpperCase(),
    contactNumber: digits(record.contactNumber ?? record.contact_number, 11),
  };
}

export function formatWalkInAddress(address: WalkInAddress): string {
  return [
    address.houseNo,
    address.street,
    address.barangay ? `Brgy. ${address.barangay}` : "",
    address.municipality,
    address.province,
    address.zipCode,
    address.country,
  ]
    .filter(Boolean)
    .join(", ");
}

export function walkInFullName(record: JsonRecord): string {
  const details = asRecord(record.student_details);

  return [
    text(record.first_name) || text(details.first_name),
    text(record.middle_name) || text(details.middle_name),
    text(record.last_name) || text(details.last_name),
    text(record.extension) || text(details.extension),
  ]
    .filter(Boolean)
    .join(" ")
    .replace(/\s+/g, " ")
    .trim();
}

export function isWalkInRecord(record: JsonRecord): boolean {
  if (text(record.enrollment_type).toLowerCase() === "walk_in") return true;

  const details = asRecord(record.student_details);

  return text(details.enrollment_type).toLowerCase() === "walk_in";
}

export function computeAge(birthDate: string): number | null {
  if (!birthDate) return null;

  const birth = new Date(`${birthDate}T00:00:00`);
  if (Number.isNaN(birth.getTime())) return null;

  const today = new Date();
  let age = today.getFullYear() - birth.getFullYear();
  const monthDiff = today.getMonth() - birth.getMonth();

  if (monthDiff < 0 || (monthDiff === 0 && today.getDate() < birth.getDate())) {
    age -= 1;
  }

  return age >= 0 ? age : null;
}

export function normalizeWalkInInput(raw: unknown): WalkInInput {
  const record = asRecord(raw);
  const input = emptyWalkInInput();

  const track = normalizeTrack(record.track) ?? text(record.track, 40);
  const cluster = text(record.selectedCluster ?? record.selected_cluster, 120);

  input.track = track;
  input.selectedCluster = track
    ? getCanonicalCluster(track, cluster)
    : cluster;
  input.gradeLevel = text(record.gradeLevel ?? record.grade_level, 40) || "Grade 11";
  input.lrn = digits(record.lrn, 12);
  input.firstName = text(record.firstName ?? record.first_name, 100).toUpperCase();
  input.middleName = text(record.middleName ?? record.middle_name, 100).toUpperCase();
  input.lastName = text(record.lastName ?? record.last_name, 100).toUpperCase();
  input.extension = text(record.extension, 30).toUpperCase();
  input.email = text(record.email, 254);
  input.birthDate = text(record.birthDate ?? record.birth_date, 10);
  input.age =
    numberValue(record.age) ?? computeAge(input.birthDate);
  input.placeOfBirth = text(record.placeOfBirth ?? record.place_of_birth, 200).toUpperCase();
  input.sex = text(record.sex ?? record.gender, 20);
  input.religion = text(record.religion, 100).toUpperCase();
  input.contactNumber = digits(record.contactNumber ?? record.contact_number, 11);
  input.currentAddress = normalizeAddress(
    record.currentAddress ?? record.current_address
  );
  input.permanentAddress = normalizeAddress(
    record.permanentAddress ?? record.permanent_address
  );
  input.sameAsCurrentAddress = bool(
    record.sameAsCurrentAddress ?? record.same_as_current_address
  );
  input.isIpCommunity = bool(record.isIpCommunity);
  input.ipCommunityType = text(record.ipCommunityType ?? record.ip_community_type, 120);
  input.is4psBeneficiary = bool(record.is4psBeneficiary);
  input.fourPsHouseholdId = text(
    record.fourPsHouseholdId ?? record.four_ps_household_id,
    60
  );
  input.specialNeedsProgram = nullableBool(
    record.specialNeedsProgram ?? record.special_needs_program
  );
  input.specialNeedsGroup = text(
    record.specialNeedsGroup ?? record.special_needs_group,
    120
  );
  input.specialNeedsCondition = text(
    record.specialNeedsCondition ?? record.special_needs_condition,
    150
  );
  input.specialNeedsDetail = text(
    record.specialNeedsDetail ?? record.special_needs_detail,
    150
  );
  input.hasPwdId = nullableBool(record.hasPwdId ?? record.has_pwd_id);
  input.lastSchoolYearCompleted = text(
    record.lastSchoolYearCompleted ?? record.last_school_year_completed,
    40
  );
  input.lastSchoolAttended = text(
    record.lastSchoolAttended ?? record.last_school_attended,
    200
  );
  input.lastSchoolId = text(
    record.lastSchoolId ?? record.last_school_id,
    60
  );
  input.collegeCourse = text(record.collegeCourse ?? record.college_course, 200);
  input.preferredModalities = stringArray(
    record.preferredModalities ?? record.preferred_distance_modalities
  );
  input.certificationAccepted = bool(
    record.certificationAccepted ?? record.certification_accepted
  );
  input.registrarRemarks = text(record.registrarRemarks ?? record.registrar_remarks, 1000);
  input.requirementsToFollow = bool(record.requirementsToFollow);

  const rawGuardians = Array.isArray(record.guardians) ? record.guardians : [];
  input.guardians = rawGuardians
    .slice(0, 3)
    .map((guardian) => normalizeGuardian(guardian));

  while (input.guardians.length < 3) {
    input.guardians.push({ ...EMPTY_WALK_IN_GUARDIAN });
  }

  if (input.sameAsCurrentAddress) {
    input.permanentAddress = { ...input.currentAddress };
  }

  return input;
}

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const NAME_PATTERN = /^[A-Za-zÀ-ÖØ-öø-ÿ.'’\-\s]+$/;
const CURRENT_YEAR = new Date().getFullYear();
const MIN_BIRTH_DATE = `${CURRENT_YEAR - 30}-01-01`;
const MAX_BIRTH_DATE = new Date().toISOString().slice(0, 10);

function guardianHasAnyValue(guardian: WalkInGuardian): boolean {
  return Boolean(
    guardian.lastName ||
      guardian.firstName ||
      guardian.middleName ||
      guardian.contactNumber
  );
}

function guardianIsComplete(guardian: WalkInGuardian): boolean {
  return Boolean(
    guardian.lastName &&
      guardian.firstName &&
      /^\d{11}$/.test(guardian.contactNumber)
  );
}

export function validateWalkInInput(
  input: WalkInInput
): Record<string, string> {
  const errors: Record<string, string> = {};

  if (!normalizeTrack(input.track)) {
    errors.track = "Select the student's senior high school track.";
  }

  if (!input.selectedCluster) {
    errors.selectedCluster = "Select the cluster under the chosen track.";
  } else if (!isValidClusterForTrack(input.track, input.selectedCluster)) {
    errors.selectedCluster = "The cluster does not belong to the selected track.";
  }

  if (!input.gradeLevel) {
    errors.gradeLevel = "Select the grade level.";
  }

  if (input.lrn && !/^\d{12}$/.test(input.lrn)) {
    errors.lrn = "LRN must be exactly 12 digits.";
  }

  if (!input.lastName) {
    errors.lastName = "Last name is required.";
  } else if (!NAME_PATTERN.test(input.lastName)) {
    errors.lastName = "Last name must not contain digits.";
  }

  if (!input.firstName) {
    errors.firstName = "First name is required.";
  } else if (!NAME_PATTERN.test(input.firstName)) {
    errors.firstName = "First name must not contain digits.";
  }

  if (input.middleName && !NAME_PATTERN.test(input.middleName)) {
    errors.middleName = "Middle name must not contain digits.";
  }

  if (!input.birthDate) {
    errors.birthDate = "Birth date is required.";
  } else if (
    !/^\d{4}-\d{2}-\d{2}$/.test(input.birthDate) ||
    Number.isNaN(new Date(`${input.birthDate}T00:00:00`).getTime()) ||
    input.birthDate < MIN_BIRTH_DATE ||
    input.birthDate > MAX_BIRTH_DATE
  ) {
    errors.birthDate = "Enter a valid birth date.";
  }

  if (input.age === null || input.age < 10 || input.age > 100) {
    errors.age = "Age must be a whole number between 10 and 100.";
  }

  if (!input.placeOfBirth) {
    errors.placeOfBirth = "Place of birth is required.";
  }

  if (!input.sex) {
    errors.sex = "Select the student's sex.";
  }

  if (input.contactNumber && !/^\d{11}$/.test(input.contactNumber)) {
    errors.contactNumber = "Contact number must be 11 digits.";
  }

  if (input.email && !EMAIL_PATTERN.test(input.email)) {
    errors.email = "Enter a valid email address.";
  }

  if (!input.currentAddress.barangay) {
    errors["currentAddress.barangay"] = "Barangay is required.";
  }
  if (!input.currentAddress.municipality) {
    errors["currentAddress.municipality"] = "Municipality / city is required.";
  }
  if (!input.currentAddress.province) {
    errors["currentAddress.province"] = "Province is required.";
  }

  if (!input.sameAsCurrentAddress) {
    if (!input.permanentAddress.barangay) {
      errors["permanentAddress.barangay"] = "Barangay is required.";
    }
    if (!input.permanentAddress.municipality) {
      errors["permanentAddress.municipality"] =
        "Municipality / city is required.";
    }
    if (!input.permanentAddress.province) {
      errors["permanentAddress.province"] = "Province is required.";
    }
  }

  if (input.isIpCommunity && !input.ipCommunityType) {
    errors.ipCommunityType = "Specify the IP community group.";
  }

  if (input.is4psBeneficiary && !input.fourPsHouseholdId) {
    errors.fourPsHouseholdId = "Enter the 4Ps household ID.";
  }

  if (input.specialNeedsProgram === null) {
    errors.specialNeedsProgram =
      "Indicate whether the learner is under the Special Needs Education Program.";
  }

  if (input.specialNeedsProgram === true && !input.specialNeedsCondition) {
    errors.specialNeedsCondition = "Select the special needs condition.";
  }

  if (input.hasPwdId === null) {
    errors.hasPwdId = "Indicate whether the learner has a PWD ID.";
  }

  if (input.lastSchoolId && !/^\d{6}$/.test(input.lastSchoolId)) {
    errors.lastSchoolId = "School ID must contain exactly 6 digits.";
  }

  if (!input.collegeCourse) {
    errors.collegeCourse = "Enter the course the student wants to take in college.";
  }

  if (input.preferredModalities.length === 0) {
    errors.preferredModalities =
      "Select at least one preferred distance learning modality.";
  }

  input.guardians.forEach((guardian, index) => {
    // Online enrollment: Father optional, Mother and Legal Guardian required.
    const required = index > 0;

    if (!required && !guardianHasAnyValue(guardian)) return;

    if (required || guardianHasAnyValue(guardian)) {
      if (!guardian.lastName) {
        errors[`guardians.${index}.lastName`] = "Last name is required.";
      }
      if (!guardian.firstName) {
        errors[`guardians.${index}.firstName`] = "First name is required.";
      }
      if (!/^\d{11}$/.test(guardian.contactNumber)) {
        errors[`guardians.${index}.contactNumber`] =
          "Contact number must be 11 digits.";
      }
    }
  });

  if (!input.certificationAccepted) {
    errors.certificationAccepted =
      "Confirm the walk-in certification before saving the enrollment record.";
  }

  return errors;
}

export function guardianComplete(guardian: WalkInGuardian): boolean {
  return guardianIsComplete(guardian);
}

export function buildWalkInInsertRow(
  input: WalkInInput,
  options: {
    staffId: string;
    staffEmail: string;
    reference: string;
    nowIso?: string;
  }
): JsonRecord {
  const nowIso = options.nowIso ?? new Date().toISOString();
  const currentAddress = formatWalkInAddress(input.currentAddress);
  const permanentAddress = formatWalkInAddress(input.permanentAddress);
  const [father, mother, legalGuardian] = input.guardians;

  return {
    user_id: null,
    enrollment_type: "walk_in",
    walk_in_reference: options.reference,
    encoded_by: options.staffId,
    encoded_at: nowIso,
    first_name: input.firstName,
    middle_name: input.middleName || null,
    last_name: input.lastName,
    extension: input.extension || null,
    email: input.email || null,
    lrn: input.lrn || null,
    birth_date: input.birthDate || null,
    age: input.age ?? computeAge(input.birthDate),
    place_of_birth: input.placeOfBirth || null,
    sex: input.sex || null,
    gender: input.sex || null,
    religion: input.religion || null,
    contact_number: input.contactNumber || null,
    address: currentAddress || null,
    current_address: currentAddress || null,
    current_house_no: input.currentAddress.houseNo || null,
    current_street: input.currentAddress.street || null,
    current_barangay: input.currentAddress.barangay || null,
    current_municipality: input.currentAddress.municipality || null,
    current_province: input.currentAddress.province || null,
    current_country: input.currentAddress.country || null,
    current_zip_code: input.currentAddress.zipCode || null,
    permanent_address: permanentAddress || null,
    permanent_house_no: input.permanentAddress.houseNo || null,
    permanent_street: input.permanentAddress.street || null,
    permanent_barangay: input.permanentAddress.barangay || null,
    permanent_municipality: input.permanentAddress.municipality || null,
    permanent_province: input.permanentAddress.province || null,
    permanent_country: input.permanentAddress.country || null,
    permanent_zip_code: input.permanentAddress.zipCode || null,
    same_as_current_address: input.sameAsCurrentAddress,
    ip_community_type: input.isIpCommunity ? input.ipCommunityType || null : null,
    four_ps_household_id: input.is4psBeneficiary
      ? input.fourPsHouseholdId || null
      : null,
    special_needs_program: input.specialNeedsProgram,
    special_needs_group: input.specialNeedsGroup || null,
    special_needs_condition: input.specialNeedsCondition || null,
    special_needs_detail: input.specialNeedsDetail || null,
    has_pwd_id: input.hasPwdId,
    last_school_year_completed: input.lastSchoolYearCompleted || null,
    last_school_attended: input.lastSchoolAttended || null,
    last_school_id: input.lastSchoolId || null,
    college_course: input.collegeCourse || null,
    certification_accepted: input.certificationAccepted,
    preferred_distance_modalities: input.preferredModalities,
    father_name: walkInFullName({
      first_name: father.firstName,
      middle_name: father.middleName,
      last_name: father.lastName,
    }) || null,
    father_last_name: father.lastName || null,
    father_first_name: father.firstName || null,
    father_middle_name: father.middleName || null,
    father_contact_number: father.contactNumber || null,
    mother_name: walkInFullName({
      first_name: mother.firstName,
      middle_name: mother.middleName,
      last_name: mother.lastName,
    }) || null,
    mother_last_name: mother.lastName || null,
    mother_first_name: mother.firstName || null,
    mother_middle_name: mother.middleName || null,
    mother_contact_number: mother.contactNumber || null,
    legal_guardian_name: walkInFullName({
      first_name: legalGuardian.firstName,
      middle_name: legalGuardian.middleName,
      last_name: legalGuardian.lastName,
    }) || null,
    guardian_last_name: legalGuardian.lastName || null,
    guardian_first_name: legalGuardian.firstName || null,
    guardian_middle_name: legalGuardian.middleName || null,
    guardian_contact_number: legalGuardian.contactNumber || null,
    legal_guardian_contact_number: legalGuardian.contactNumber || null,
    track: input.track,
    selected_cluster: input.selectedCluster,
    strand: input.selectedCluster,
    grade_level: input.gradeLevel,
    status: "pending",
    submitted_at: nowIso,
    updated_at: nowIso,
    registrar_remarks: input.registrarRemarks || null,
    requirements_submitted: false,
    requirements_documents: {},
    student_details: {
      enrollment_type: "walk_in",
      source: "walk_in",
      account_created: false,
      credentials_sent: false,
      credentials_sent_at: null,
      lrn: input.lrn || null,
      place_of_birth: input.placeOfBirth || null,
      age: input.age ?? computeAge(input.birthDate),
      religion: input.religion || null,
      selected_track: input.track,
      selected_cluster: input.selectedCluster,
      ip_community_type: input.isIpCommunity
        ? input.ipCommunityType || null
        : null,
      four_ps_household_id: input.is4psBeneficiary
        ? input.fourPsHouseholdId || null
        : null,
      special_needs_program: input.specialNeedsProgram,
      special_needs_group: input.specialNeedsGroup || null,
      special_needs_condition: input.specialNeedsCondition || null,
      special_needs_detail: input.specialNeedsDetail || null,
      has_pwd_id: input.hasPwdId,
      last_school_year_completed: input.lastSchoolYearCompleted || null,
      last_school_attended: input.lastSchoolAttended || null,
      last_school_id: input.lastSchoolId || null,
      college_course: input.collegeCourse || null,
      preferred_distance_modalities: input.preferredModalities,
      certification_accepted: input.certificationAccepted,
      current_address: input.currentAddress,
      permanent_address: input.permanentAddress,
      same_as_current_address: input.sameAsCurrentAddress,
      guardians: {
        father,
        mother,
        legal_guardian: legalGuardian,
      },
      requirements_submitted: false,
      encoded_by: options.staffId,
      encoded_by_email: options.staffEmail || null,
      encoded_at: nowIso,
    },
  };
}

export function buildWalkInUpdateRow(
  input: WalkInInput,
  options: {
    staffId: string;
    staffEmail: string;
    existingDetails?: unknown;
    existingRequirementsSubmitted?: boolean;
    nowIso?: string;
  }
): JsonRecord {
  const nowIso = options.nowIso ?? new Date().toISOString();
  const existingDetails = asRecord(options.existingDetails);
  const insertRow = buildWalkInInsertRow(input, {
    staffId: options.staffId,
    staffEmail: options.staffEmail,
    reference: "",
    nowIso,
  });

  const insertDetails = insertRow.student_details;
  const mutable: JsonRecord = { ...insertRow };

  // These fields are owned by the create flow and must never be rewritten by
  // a details edit.
  for (const key of [
    "user_id",
    "enrollment_type",
    "walk_in_reference",
    "encoded_by",
    "encoded_at",
    "status",
    "submitted_at",
    "requirements_submitted",
    "requirements_documents",
    "student_details",
  ]) {
    delete mutable[key];
  }

  const mergedDetails: JsonRecord = {
    ...existingDetails,
    ...asRecord(insertDetails),
    requirements_submitted:
      options.existingRequirementsSubmitted ??
      bool(existingDetails.requirements_submitted),
  };

  // Encoding metadata belongs to the create flow: an edit must never rewrite
  // who encoded the walk-in or when. Track the editor separately.
  mergedDetails.encoded_by = existingDetails.encoded_by ?? options.staffId;
  mergedDetails.encoded_by_email =
    existingDetails.encoded_by_email ?? (options.staffEmail || null);
  mergedDetails.encoded_at = existingDetails.encoded_at ?? nowIso;
  mergedDetails.last_edited_by = options.staffId;
  mergedDetails.last_edited_by_email = options.staffEmail || null;
  mergedDetails.last_edited_at = nowIso;

  return {
    ...mutable,
    updated_at: nowIso,
    student_details: mergedDetails,
  };
}

export function walkInInputFromRecord(record: JsonRecord): WalkInInput {
  const details = asRecord(record.student_details);
  const guardians = asRecord(details.guardians);
  const birthDate = text(record.birth_date ?? details.birth_date, 10);

  return normalizeWalkInInput({
    track: record.track ?? details.selected_track,
    selectedCluster:
      record.selected_cluster ?? record.strand ?? details.selected_cluster,
    gradeLevel: record.grade_level ?? details.grade_level,
    lrn: record.lrn ?? details.lrn,
    firstName: record.first_name ?? details.first_name,
    middleName: record.middle_name ?? details.middle_name,
    lastName: record.last_name ?? details.last_name,
    extension: record.extension ?? details.extension,
    email: record.email ?? details.email,
    birthDate,
    age: record.age ?? details.age ?? computeAge(birthDate),
    placeOfBirth: record.place_of_birth ?? details.place_of_birth,
    sex: record.sex ?? record.gender ?? details.sex,
    religion: record.religion ?? details.religion,
    contactNumber: record.contact_number ?? details.contact_number,
    currentAddress:
      details.current_address ?? record.current_address ?? record.address,
    permanentAddress: details.permanent_address ?? record.permanent_address,
    sameAsCurrentAddress:
      record.same_as_current_address ?? details.same_as_current_address,
    isIpCommunity: Boolean(
      record.ip_community_type ?? details.ip_community_type
    ),
    ipCommunityType: record.ip_community_type ?? details.ip_community_type,
    is4psBeneficiary: Boolean(
      record.four_ps_household_id ?? details.four_ps_household_id
    ),
    fourPsHouseholdId:
      record.four_ps_household_id ?? details.four_ps_household_id,
    specialNeedsProgram:
      record.special_needs_program ?? details.special_needs_program,
    specialNeedsGroup:
      record.special_needs_group ?? details.special_needs_group,
    specialNeedsCondition:
      record.special_needs_condition ?? details.special_needs_condition,
    specialNeedsDetail:
      record.special_needs_detail ?? details.special_needs_detail,
    hasPwdId: record.has_pwd_id ?? details.has_pwd_id,
    lastSchoolYearCompleted:
      record.last_school_year_completed ?? details.last_school_year_completed,
    lastSchoolAttended:
      record.last_school_attended ?? details.last_school_attended,
    lastSchoolId: record.last_school_id ?? details.last_school_id,
    collegeCourse: record.college_course ?? details.college_course,
    preferredModalities:
      record.preferred_distance_modalities ??
      details.preferred_distance_modalities,
    certificationAccepted:
      record.certification_accepted === true ||
      details.certification_accepted === true,
    guardians: [
      guardians.father ?? {
        last_name: record.father_last_name,
        first_name: record.father_first_name,
        middle_name: record.father_middle_name,
        contact_number: record.father_contact_number,
      },
      guardians.mother ?? {
        last_name: record.mother_last_name,
        first_name: record.mother_first_name,
        middle_name: record.mother_middle_name,
        contact_number: record.mother_contact_number,
      },
      guardians.legal_guardian ?? {
        last_name: record.guardian_last_name,
        first_name: record.guardian_first_name,
        middle_name: record.guardian_middle_name,
        contact_number:
          record.guardian_contact_number ??
          record.legal_guardian_contact_number,
      },
    ],
    registrarRemarks: record.registrar_remarks ?? details.registrar_remarks,
    requirementsToFollow: record.requirements_submitted !== true,
  });
}

export type WalkInRequirementLink = {
  key: "report_card" | "birth_certificate" | "other_requirement";
  label: string;
  url: string;
  fileName: string;
};

export function walkInRequirementLinks(
  record: JsonRecord
): WalkInRequirementLink[] {
  const documents = asRecord(record.requirements_documents);
  const definitions: Array<{
    key: WalkInRequirementLink["key"];
    label: string;
    fallbackUrl: unknown;
  }> = [
    {
      key: "report_card",
      label: "Grade 10 Report Card",
      fallbackUrl: record.report_card_url ?? documents.report_card_url,
    },
    {
      key: "birth_certificate",
      label: "Birth Certificate",
      fallbackUrl:
        record.birth_certificate_url ?? documents.birth_certificate_url,
    },
    {
      key: "other_requirement",
      label: "Other Requirements (Form 137)",
      fallbackUrl:
        record.other_requirement_url ?? documents.other_requirement_url,
    },
  ];

  return definitions
    .map(({ key, label, fallbackUrl }) => {
      const document = asRecord(documents[key]);
      const url = text(
        document.signedUrl ?? document.signed_url ?? document.url ?? fallbackUrl,
        2000
      );

      return {
        key,
        label,
        url,
        fileName: text(document.name ?? document.file_name, 200),
      };
    })
    .filter((entry) => Boolean(entry.url));
}

export function walkInTrackLabel(track: unknown): string {
  return getTrackLabel(track);
}
