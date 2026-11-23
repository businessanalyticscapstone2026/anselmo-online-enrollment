import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { randomInt } from "node:crypto";
import {
  evaluateEnrollmentAvailability,
  type EnrollmentSettings,
} from "@/lib/enrollmentSettings";
import { getTrackConfig, isValidClusterForTrack } from "@/lib/clusters";
import {
  DISTANCE_LEARNING_MODALITIES,
  SPECIAL_NEEDS_DETAILS,
  SPECIAL_NEEDS_DIAGNOSES,
  SPECIAL_NEEDS_MANIFESTATIONS,
} from "@/lib/enrollmentFormOptions";
import { logActivity } from "@/lib/activityLog";
import { joinNameParts } from "@/lib/accountNames";
import {
  guardianFullName,
  syncStudentProfile,
} from "@/lib/studentProfiles";

export const runtime = "nodejs";

const MAX_BIRTH_DATE = new Date(Date.now() + 8 * 60 * 60 * 1000)
  .toISOString()
  .slice(0, 10);
const CURRENT_YEAR = Number(MAX_BIRTH_DATE.slice(0, 4));
const MIN_BIRTH_YEAR = CURRENT_YEAR - 30;
const MIN_BIRTH_DATE = `${MIN_BIRTH_YEAR}-01-01`;

const GUARDIAN_LABELS = ["Father", "Mother", "Legal Guardian"];
const REQUIRED_GUARDIAN_FIELDS: Array<[keyof ReturnType<typeof guardianValue>, string]> = [
  ["lastName", "last name"],
  ["firstName", "first name"],
  ["contactNumber", "contact number"],
];
const GUARDIAN_NAME_FIELDS: Array<[keyof ReturnType<typeof guardianValue>, string]> = [
  ["lastName", "last name"],
  ["firstName", "first name"],
  ["middleName", "middle name"],
];

type Address = {
  houseNo?: unknown;
  street?: unknown;
  barangay?: unknown;
  municipality?: unknown;
  province?: unknown;
  country?: unknown;
  zipCode?: unknown;
};

type Guardian = {
  lastName?: unknown;
  firstName?: unknown;
  middleName?: unknown;
  contactNumber?: unknown;
};

function textValue(value: unknown, maxLength = 250): string {
  return typeof value === "string" ? value.trim().slice(0, maxLength) : "";
}

function containsDigit(value: string): boolean {
  return /\d/.test(value);
}

function isValidContactNumber(value: string): boolean {
  return /^\d{11}$/.test(value);
}

function addressValue(value: unknown): Record<string, string> {
  const address = (value && typeof value === "object" ? value : {}) as Address;
  return {
    houseNo: textValue(address.houseNo, 100),
    street: textValue(address.street, 150),
    barangay: textValue(address.barangay, 150),
    municipality: textValue(address.municipality, 150),
    province: textValue(address.province, 150),
    country: textValue(address.country, 100),
    zipCode: textValue(address.zipCode, 20),
  };
}

function guardianValue(value: unknown): Record<string, string> {
  const guardian = (value && typeof value === "object" ? value : {}) as Guardian;
  return {
    lastName: textValue(guardian.lastName, 100),
    firstName: textValue(guardian.firstName, 100),
    middleName: textValue(guardian.middleName, 100),
    contactNumber: textValue(guardian.contactNumber, 30),
  };
}

function booleanOrNull(value: unknown): boolean | null {
  return value === true ? true : value === false ? false : null;
}

function integerValue(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) {
    return Math.trunc(value);
  }

  if (typeof value === "string" && value.trim()) {
    const parsed = Number(value.trim());
    return Number.isFinite(parsed) ? Math.trunc(parsed) : null;
  }

  return null;
}

function formatAddress(address: Record<string, string>): string {
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

function generatePassword(): string {
  // Short, easy-to-memorize password; never log or return it in the API response.
  const digits = String(randomInt(0, 1_000_000)).padStart(6, "0");
  return `AASMNHS - ${digits}`;
}

// Columns every application insert depends on. If the live schema is missing
// one of these the save fails loudly instead of silently degrading.
const CORE_APPLICATION_COLUMNS = new Set([
  "user_id",
  "first_name",
  "last_name",
  "status",
  "submitted_at",
  "updated_at",
  "student_details",
  "requirements_documents",
]);

const LIVE_SCHEMA_CACHE_MS = 60_000;
let liveColumnsCache: { columns: Set<string>; fetchedAt: number } | null = null;

// Ask PostgREST which columns actually exist on student_applications in the
// live database. Databases that have not had every extended-column migration
// applied (email, dedicated guardian columns, ...) still accept applications
// because the insert payload is filtered down to these columns first.
async function fetchLiveApplicationColumns(
  supabaseUrl: string,
  serviceRoleKey: string
): Promise<Set<string> | null> {
  if (
    liveColumnsCache &&
    Date.now() - liveColumnsCache.fetchedAt < LIVE_SCHEMA_CACHE_MS
  ) {
    return liveColumnsCache.columns;
  }

  try {
    const response = await fetch(`${supabaseUrl}/rest/v1/`, {
      headers: {
        apikey: serviceRoleKey,
        Authorization: `Bearer ${serviceRoleKey}`,
      },
    });

    if (!response.ok) return null;

    const spec = (await response.json()) as {
      definitions?: Record<string, { properties?: Record<string, unknown> }>;
    };

    const properties = spec.definitions?.student_applications?.properties;

    if (!properties) return null;

    const columns = new Set(Object.keys(properties));
    liveColumnsCache = { columns, fetchedAt: Date.now() };

    return columns;
  } catch (error) {
    console.warn(
      "submit-application: could not read the live table schema:",
      error instanceof Error ? error.message : String(error)
    );
    return null;
  }
}

function filterToLiveColumns(
  payload: Record<string, unknown>,
  liveColumns: Set<string>
): { payload: Record<string, unknown>; droppedColumns: string[] } {
  const filtered: Record<string, unknown> = {};
  const droppedColumns: string[] = [];

  for (const [column, value] of Object.entries(payload)) {
    if (CORE_APPLICATION_COLUMNS.has(column) || liveColumns.has(column)) {
      filtered[column] = value;
    } else {
      droppedColumns.push(column);
    }
  }

  return { payload: filtered, droppedColumns };
}

// PostgREST reports unknown columns one at a time, e.g.
// "Could not find the 'email' column of 'student_applications' in the schema cache".
function strippableColumnsFromError(
  payload: Record<string, unknown>,
  errorMessage: string
): string[] {
  const quoted = [...errorMessage.matchAll(/['"]([a-zA-Z_][a-zA-Z0-9_]*)['"]/g)]
    .map((match) => match[1])
    .filter((column) => column !== "student_applications");

  if (/email/i.test(errorMessage)) quoted.push("email");

  return [...new Set(quoted)].filter(
    (column) =>
      Object.prototype.hasOwnProperty.call(payload, column) &&
      !CORE_APPLICATION_COLUMNS.has(column)
  );
}

export async function POST(request: NextRequest) {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!supabaseUrl || !serviceRoleKey) {
    return NextResponse.json(
      { success: false, message: "The server is missing its Supabase configuration." },
      { status: 500 }
    );
  }

  let createdUserId: string | null = null;
  let applicationWasSaved = false;

  try {
    const body: unknown = await request.json();
    if (!body || typeof body !== "object" || Array.isArray(body)) {
      return NextResponse.json(
        { success: false, message: "Invalid application request." },
        { status: 400 }
      );
    }

    const data = body as Record<string, unknown>;
    const firstName = textValue(data.firstName, 100);
    const middleName = textValue(data.middleName, 100);
    const lastName = textValue(data.lastName, 100);
    const studentFullName = joinNameParts(firstName, middleName, lastName);
    const extension = textValue(data.extension, 30);
    const lrn = textValue(data.lrn, 12);
    const email = textValue(data.email, 254).toLowerCase();
    const birthDate = textValue(data.birthDate, 10);
    const age = integerValue(data.age);
    const placeOfBirth = textValue(data.placeOfBirth, 200);
    const gender = textValue(data.gender, 30).toLowerCase();
    const religion = textValue(data.religion, 100);
    const contactNumber = textValue(data.contactNumber, 30);
    const collegeCourse = textValue(data.collegeCourse, 200);
    const selectedTrack = textValue(data.selectedTrack, 100);
    const selectedCluster = textValue(data.selectedCluster, 150);
    const isIpCommunity = data.isIpCommunity === true;
    const ipCommunityType = textValue(data.ipCommunityType, 150);
    const is4psBeneficiary = data.is4psBeneficiary === true;
    const fourPsHouseholdId = textValue(data.fourPsHouseholdId, 20);
    const sameAsCurrentAddress = data.sameAsCurrentAddress === true;

    const specialNeedsProgram = booleanOrNull(data.specialNeedsProgram);
    let specialNeedsGroup = textValue(data.specialNeedsGroup, 20);
    let specialNeedsCondition = textValue(data.specialNeedsCondition, 150);
    let specialNeedsDetail = textValue(data.specialNeedsDetail, 50);
    const hasPwdId = booleanOrNull(data.hasPwdId);
    const lastSchoolYearCompleted = textValue(data.lastSchoolYearCompleted, 20);
    const lastSchoolAttended = textValue(data.lastSchoolAttended, 150);
    const lastSchoolId = textValue(data.lastSchoolId, 6);
    const rawModalities = Array.isArray(data.preferredModalities)
      ? data.preferredModalities
      : [];
    const preferredModalities = [
      ...new Set(
        rawModalities
          .map((value) => textValue(value, 60))
          .filter((value) =>
            DISTANCE_LEARNING_MODALITIES.includes(
              value as (typeof DISTANCE_LEARNING_MODALITIES)[number]
            )
          )
      ),
    ];
    if (!firstName || !lastName || !email) {
      return NextResponse.json(
        { success: false, message: "First name, last name, and email address are required." },
        { status: 400 }
      );
    }

    const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailPattern.test(email)) {
      return NextResponse.json(
        { success: false, message: "Please enter a valid email address." },
        { status: 400 }
      );
    }

    if (!birthDate || !placeOfBirth) {
      return NextResponse.json(
        { success: false, message: "Date of birth and place of birth are required." },
        { status: 400 }
      );
    }

    const parsedBirthDate = new Date(`${birthDate}T00:00:00Z`);

    if (
      Number.isNaN(parsedBirthDate.getTime()) ||
      parsedBirthDate.toISOString().slice(0, 10) !== birthDate ||
      birthDate > MAX_BIRTH_DATE
    ) {
      return NextResponse.json(
        { success: false, message: "Please provide a valid date of birth." },
        { status: 400 }
      );
    }

    if (birthDate < MIN_BIRTH_DATE || birthDate > MAX_BIRTH_DATE) {
      return NextResponse.json(
        {
          success: false,
          message: `Birth date must be between ${MIN_BIRTH_YEAR} and ${CURRENT_YEAR}.`,
        },
        { status: 400 }
      );
    }

    if (age === null || age < 10 || age > 100) {
      return NextResponse.json(
        {
          success: false,
          message: "Age must be a whole number between 10 and 100.",
        },
        { status: 400 }
      );
    }

    if (gender !== "male" && gender !== "female") {
      return NextResponse.json(
        { success: false, message: "Gender must be either Male or Female." },
        { status: 400 }
      );
    }

    if (!contactNumber) {
      return NextResponse.json(
        { success: false, message: "Contact number is required." },
        { status: 400 }
      );
    }

    if (!isValidContactNumber(contactNumber)) {
      return NextResponse.json(
        {
          success: false,
          message: "Contact number must contain exactly 11 digits.",
        },
        { status: 400 }
      );
    }

    if (!selectedTrack || !selectedCluster) {
      return NextResponse.json(
        { success: false, message: "Please select a senior high track and cluster." },
        { status: 400 }
      );
    }

    if (
      !getTrackConfig(selectedTrack) ||
      !isValidClusterForTrack(selectedTrack, selectedCluster)
    ) {
      return NextResponse.json(
        {
          success: false,
          message: "The selected track and cluster combination is invalid.",
        },
        { status: 400 }
      );
    }

    const digitFreeFields: Array<[string, string]> = [
      ["First name", firstName],
      ["Middle name", middleName],
      ["Last name", lastName],
      ["Extension", extension],
      ["Place of birth", placeOfBirth],
      ["Religion", religion],
    ];
    const invalidTextField = digitFreeFields.find(([, value]) => containsDigit(value));

    if (invalidTextField) {
      return NextResponse.json(
        {
          success: false,
          message: `${invalidTextField[0]} must contain letters only.`,
        },
        { status: 400 }
      );
    }

    const currentAddress = addressValue(data.currentAddress);
    const permanentAddress = sameAsCurrentAddress
      ? { ...currentAddress }
      : addressValue(data.permanentAddress);

    const requiredAddressFields: Array<[string, string]> = [
      ["Barangay", currentAddress.barangay],
      ["Municipality / City", currentAddress.municipality],
      ["Province", currentAddress.province],
    ];

    if (!sameAsCurrentAddress) {
      requiredAddressFields.push(
        ["Permanent barangay", permanentAddress.barangay],
        ["Permanent municipality / city", permanentAddress.municipality],
        ["Permanent province", permanentAddress.province]
      );
    }

    const missingAddressField = requiredAddressFields.find(([, value]) => !value);

    if (missingAddressField) {
      return NextResponse.json(
        {
          success: false,
          message: `${missingAddressField[0]} is required.`,
        },
        { status: 400 }
      );
    }

    if (currentAddress.zipCode && !/^\d{4}$/.test(currentAddress.zipCode)) {
      return NextResponse.json(
        { success: false, message: "ZIP code must contain exactly 4 digits." },
        { status: 400 }
      );
    }

    if (
      !sameAsCurrentAddress &&
      permanentAddress.zipCode &&
      !/^\d{4}$/.test(permanentAddress.zipCode)
    ) {
      return NextResponse.json(
        { success: false, message: "Permanent ZIP code must contain exactly 4 digits." },
        { status: 400 }
      );
    }

    const digitFreeAddressFields: Array<[string, string]> = [
      ["Street", currentAddress.street],
      ["Municipality / City", currentAddress.municipality],
      ["Province", currentAddress.province],
      ["Country", currentAddress.country],
      ...(sameAsCurrentAddress
        ? []
        : ([
            ["Permanent street", permanentAddress.street],
            ["Permanent municipality / city", permanentAddress.municipality],
            ["Permanent province", permanentAddress.province],
            ["Permanent country", permanentAddress.country],
          ] as Array<[string, string]>)),
    ];
    const invalidAddressField = digitFreeAddressFields.find(([, value]) =>
      containsDigit(value)
    );

    if (invalidAddressField) {
      return NextResponse.json(
        {
          success: false,
          message: `${invalidAddressField[0]} must contain letters only.`,
        },
        { status: 400 }
      );
    }

    const rawGuardians = Array.isArray(data.guardians) ? data.guardians : [];
    const submittedGuardians = GUARDIAN_LABELS.map((_, index) =>
      guardianValue(rawGuardians[index])
    );

    for (let i = 0; i < GUARDIAN_LABELS.length; i++) {
      const guardian = submittedGuardians[i];
      const label = GUARDIAN_LABELS[i];

      const requiredFields =
        i === 0 ? [] : REQUIRED_GUARDIAN_FIELDS;
      const missingFields = requiredFields
        .filter(([field]) => !guardian[field])
        .map(([, fieldLabel]) => fieldLabel);

      if (missingFields.length > 0) {
        return NextResponse.json(
          {
            success: false,
            message: `${label}'s information is missing the required field(s): ${missingFields.join(", ")}.`,
          },
          { status: 400 }
        );
      }

      if (guardian.contactNumber && !isValidContactNumber(guardian.contactNumber)) {
        return NextResponse.json(
          {
            success: false,
            message: `${label}'s contact number must contain exactly 11 digits.`,
          },
          { status: 400 }
        );
      }

      const guardianTextField = GUARDIAN_NAME_FIELDS.find(([field]) =>
        containsDigit(guardian[field])
      );

      if (guardianTextField) {
        return NextResponse.json(
          {
            success: false,
            message: `${label}'s ${guardianTextField[1]} must contain letters only.`,
          },
          { status: 400 }
        );
      }
    }

    while (submittedGuardians.length < 3) {
      submittedGuardians.push({
        lastName: "",
        firstName: "",
        middleName: "",
        contactNumber: "",
      });
    }

    const allowedSpecialNeedsConditions: string[] = [
      ...SPECIAL_NEEDS_DIAGNOSES,
      ...SPECIAL_NEEDS_MANIFESTATIONS,
    ];

    if (specialNeedsProgram === null) {
      return NextResponse.json(
        {
          success: false,
          message:
            "Please answer whether the learner is under the Special Needs Education Program.",
        },
        { status: 400 }
      );
    }

    if (specialNeedsProgram) {
      if (
        !specialNeedsCondition ||
        !allowedSpecialNeedsConditions.includes(specialNeedsCondition)
      ) {
        return NextResponse.json(
          {
            success: false,
            message:
              "Please select one valid diagnosis or manifestation under the Special Needs Education Program.",
          },
          { status: 400 }
        );
      }

      specialNeedsGroup = SPECIAL_NEEDS_DIAGNOSES.includes(
        specialNeedsCondition as (typeof SPECIAL_NEEDS_DIAGNOSES)[number]
      )
        ? "diagnosis"
        : "manifestation";

      const requiredDetails = SPECIAL_NEEDS_DETAILS[specialNeedsCondition];
      if (requiredDetails) {
        if (!requiredDetails.includes(specialNeedsDetail)) {
          return NextResponse.json(
            {
              success: false,
              message: `Please select the required detail for ${specialNeedsCondition}.`,
            },
            { status: 400 }
          );
        }
      } else {
        specialNeedsDetail = "";
      }
    } else {
      specialNeedsGroup = "";
      specialNeedsCondition = "";
      specialNeedsDetail = "";
    }

    if (hasPwdId === null) {
      return NextResponse.json(
        {
          success: false,
          message: "Please answer whether the learner has a PWD ID.",
        },
        { status: 400 }
      );
    }

    if (lastSchoolId && !/^\d{6}$/.test(lastSchoolId)) {
      return NextResponse.json(
        {
          success: false,
          message: "School ID must contain exactly 6 digits.",
        },
        { status: 400 }
      );
    }

    if (preferredModalities.length === 0) {
      return NextResponse.json(
        {
          success: false,
          message: "Please select at least one preferred distance learning modality.",
        },
        { status: 400 }
      );
    }

    const supabase = createClient(supabaseUrl, serviceRoleKey, {
      auth: {
        autoRefreshToken: false,
        persistSession: false,
      },
    });

    // Enforce the enrollment window on the server using the real
    // Asia/Manila clock. This cannot be bypassed by calling the API directly.
    const { data: settingsData, error: settingsError } = await supabase
      .from("enrollment_settings")
      .select("id, enrollment_start_date, enrollment_end_date")
      .eq("id", 1)
      .maybeSingle();

    if (settingsError) {
      console.error("Could not read enrollment settings:", settingsError);
      return NextResponse.json(
        {
          success: false,
          message:
            "Enrollment availability could not be verified right now. Please try again later or contact the school registrar.",
        },
        { status: 503 }
      );
    }

    const availability = evaluateEnrollmentAvailability(
      (settingsData as EnrollmentSettings | null) ?? null
    );

    if (!availability.isOpen) {
      return NextResponse.json(
        {
          success: false,
          message: availability.message,
          reason: availability.reason,
        },
        { status: 403 }
      );
    }

    const password = generatePassword();

    // Auth account is created server-side. Duplicate email is handled by Supabase Auth.
    const { data: authData, error: authError } =
      await supabase.auth.admin.createUser({
        email,
        password,
        email_confirm: true,
        user_metadata: {
          full_name: studentFullName,
          first_name: firstName,
          middle_name: middleName,
          last_name: lastName,
          track: selectedTrack,
          cluster: selectedCluster,
          account_type: "student",
          must_change_password: true,
        },
      });

    if (authError || !authData.user) {
      const message = authError?.message || "Could not create the student account.";
      const isDuplicate =
        /already|registered|exists|duplicate/i.test(message);

      return NextResponse.json(
        {
          success: false,
          message: isDuplicate
            ? "An account with this email address already exists. Please sign in or use the password recovery option."
            : message,
        },
        { status: isDuplicate ? 409 : 400 }
      );
    }

    createdUserId = authData.user.id;

    // The profile row may be created by a database trigger that only reads
    // user_metadata. Upsert the display name here as well so new accounts never
    // appear as "Unnamed User" in the admin dashboard or activity logs.
    // The email is intentionally not stored yet: it is only persisted after
    // the credential email is sent on the final account step.
    const { error: profileError } = await supabase.from("profiles").upsert(
      {
        id: createdUserId,
        full_name: studentFullName,
        email: null,
        role: "student",
      },
      { onConflict: "id" }
    );

    if (profileError) {
      console.warn(
        `submit-application: could not set the profile name for ${email}: ${profileError.message}`
      );
    }

    const studentDetails = {
      extension,
      lrn: lrn || null,
      college_course: collegeCourse || null,
      place_of_birth: placeOfBirth,
      age,
      religion,
      selected_track: selectedTrack,
      selected_cluster: selectedCluster,
      ip_community_type: isIpCommunity ? ipCommunityType || null : null,
      four_ps_household_id: is4psBeneficiary ? fourPsHouseholdId || null : null,
      special_needs_program: specialNeedsProgram,
      special_needs_group: specialNeedsGroup || null,
      special_needs_condition: specialNeedsCondition || null,
      special_needs_detail: specialNeedsDetail || null,
      has_pwd_id: hasPwdId,
      last_school_year_completed: lastSchoolYearCompleted || null,
      last_school_attended: lastSchoolAttended || null,
      last_school_id: lastSchoolId || null,
      preferred_distance_modalities: preferredModalities,
      current_address: currentAddress,
      permanent_address: permanentAddress,
      same_as_current_address: sameAsCurrentAddress,
      guardians: {
        father: submittedGuardians[0],
        mother: submittedGuardians[1],
        legal_guardian: submittedGuardians[2],
      },
      // Staff/admin records stay hidden until the final account step confirms
      // that the credential email was delivered.
      credentials_sent: false,
      credentials_sent_at: null,
    };

    // Only columns confirmed in the user's current table schema are inserted here.
    const [fatherGuardian, motherGuardian, legalGuardian] = submittedGuardians;
    const applicationPayload = {
      user_id: createdUserId,
      first_name: firstName,
      middle_name: middleName || null,
      last_name: lastName,
      lrn: lrn || null,
      birth_date: birthDate || null,
      age,
      place_of_birth: placeOfBirth || null,
      sex: gender || null,
      gender: gender || null,
      religion: religion || null,
      address: formatAddress(currentAddress) || null,
      current_address: formatAddress(currentAddress) || null,
      permanent_address: formatAddress(permanentAddress) || null,
      contact_number: contactNumber || null,
      college_course: collegeCourse || null,
      ip_community_type: isIpCommunity ? ipCommunityType || null : null,
      four_ps_household_id: is4psBeneficiary ? fourPsHouseholdId || null : null,
      special_needs_program: specialNeedsProgram,
      special_needs_group: specialNeedsGroup || null,
      special_needs_condition: specialNeedsCondition || null,
      special_needs_detail: specialNeedsDetail || null,
      has_pwd_id: hasPwdId,
      last_school_year_completed: lastSchoolYearCompleted || null,
      last_school_attended: lastSchoolAttended || null,
      last_school_id: lastSchoolId || null,
      preferred_distance_modalities: preferredModalities,
      track: selectedTrack || null,
      selected_cluster: selectedCluster || null,
      strand: selectedCluster || null,
      status: "pending",
      submitted_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
      father_name: guardianFullName(fatherGuardian) || null,
      mother_name: guardianFullName(motherGuardian) || null,
      legal_guardian_name: guardianFullName(legalGuardian) || null,
      legal_guardian_contact_number: legalGuardian.contactNumber || null,
      student_details: studentDetails,
      father_last_name: fatherGuardian.lastName || null,
      father_first_name: fatherGuardian.firstName || null,
      father_middle_name: fatherGuardian.middleName || null,
      father_contact_number: fatherGuardian.contactNumber || null,
      mother_last_name: motherGuardian.lastName || null,
      mother_first_name: motherGuardian.firstName || null,
      mother_middle_name: motherGuardian.middleName || null,
      mother_contact_number: motherGuardian.contactNumber || null,
      guardian_last_name: legalGuardian.lastName || null,
      guardian_first_name: legalGuardian.firstName || null,
      guardian_middle_name: legalGuardian.middleName || null,
      guardian_contact_number: legalGuardian.contactNumber || null,
      // The applicant email is intentionally left out of the draft. It is
      // written to the application only after the credential email is sent on
      // the final account step.
      requirements_documents: {},
    };

    // The live table may not have every extended column yet (email, dedicated
    // guardian columns, ...). Filter the insert payload down to the columns
    // the live schema actually has so the application always saves; the
    // guardian details are also stored inside the student_details jsonb
    // either way.
    const liveColumns = await fetchLiveApplicationColumns(
      supabaseUrl,
      serviceRoleKey
    );

    let insertPayload: Record<string, unknown> = {
      ...applicationPayload,
    };

    if (liveColumns) {
      const filtered = filterToLiveColumns(insertPayload, liveColumns);
      insertPayload = filtered.payload;

      if (filtered.droppedColumns.length > 0) {
        console.warn(
          `submit-application: live student_applications table lacks columns (stored in student_details instead): ${filtered.droppedColumns.join(", ")}`
        );
      }
    }

    let application: { id: string } | null = null;
    let insertError: { code?: string; message?: string } | null = null;

    // Backstop for schema drift between the introspection above and this
    // insert, or deployments where the introspection failed: PostgREST
    // reports each unknown column one at a time, so drop the offending
    // extended columns and retry until the application row saves.
    for (let attempt = 0; attempt < 20; attempt++) {
      const result = await supabase
        .from("student_applications")
        .insert(insertPayload)
        .select("id")
        .single();

      application = (result.data ?? null) as { id: string } | null;
      insertError = (result.error ?? null) as { code?: string; message?: string } | null;

      if (application) break;

      const strippable = strippableColumnsFromError(
        insertPayload,
        insertError?.message || ""
      );

      if (strippable.length === 0) break;

      console.warn(
        `submit-application: retrying insert without unsupported columns: ${strippable.join(", ")}`
      );

      const nextPayload = { ...insertPayload };
      for (const column of strippable) {
        delete nextPayload[column];
      }
      insertPayload = nextPayload;
    }

    if (!application) {
      throw new Error(
        `The student account was created, but the application could not be saved: ${insertError?.message || "No application record was returned."
        }`
      );
    }

    applicationWasSaved = true;

    await syncStudentProfile(supabase, application.id, {
      emailMode: "exclude",
    });

    await logActivity({
      userType: "Student",
      userEmail: email,
      action: "Started Enrollment Application",
      details: {
        applicationId: application.id,
        userId: createdUserId,
        studentName: `${firstName} ${lastName}`.trim(),
        track: selectedTrack || null,
        cluster: selectedCluster || null,
        timestamp: new Date().toISOString(),
      },
    });

    // Credentials are sent on the final account step after requirements are
    // uploaded. The draft stays hidden from staff/admin until then.
    return NextResponse.json(
      {
        success: true,
        id: application.id,
        emailSent: false,
        message:
          "Your application details were saved. Complete the requirements and account steps to receive your login credentials.",
      },
      { status: 201 }
    );
  } catch (error) {
    console.error("Submit application API error:", error);

    // Roll back the Auth user only when no application row was saved.
    if (createdUserId && !applicationWasSaved) {
      try {
        const cleanupClient = createClient(supabaseUrl, serviceRoleKey, {
          auth: { autoRefreshToken: false, persistSession: false },
        });
        const { error: deleteError } =
          await cleanupClient.auth.admin.deleteUser(createdUserId);
        if (deleteError) {
          console.error("Could not roll back unused Auth user:", deleteError);
        }
      } catch (cleanupError) {
        console.error("Auth user rollback failed:", cleanupError);
      }
    }

    const message =
      error instanceof Error
        ? error.message
        : "An unexpected server error occurred.";

    return NextResponse.json(
      { success: false, message },
      { status: 500 }
    );
  }
}
