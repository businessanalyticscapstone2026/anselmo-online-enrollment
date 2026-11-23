import type { SupabaseClient } from "@supabase/supabase-js";

type JsonRecord = Record<string, unknown>;

export const STORAGE_FOLDERS = {
  birthCertificate: "birth-certificates",
  reportCard: "report-cards",
  form137: "other-requirements",
} as const;

export type UploadKind = keyof typeof STORAGE_FOLDERS;

const PREFERRED_BUCKETS = [
  "enrollment-documents.",
  "enrollment-documents",
  "requirements",
];

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export type ApplicationLookupInput = {
  applicationId?: unknown;
  email?: unknown;
  contactNumber?: unknown;
};

export type ApplicationLookupResult =
  | { application: JsonRecord; storedEmail: string; storedContact: string }
  | { error: string; code: string; status: number };

function asRecord(value: unknown): JsonRecord {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as JsonRecord)
    : {};
}

function text(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

export function isUuid(value: unknown): boolean {
  return UUID_PATTERN.test(text(value));
}

export function normalizePhone(value: unknown): string {
  if (typeof value !== "string") return "";
  let digits = value.replace(/\D+/g, "");
  if (digits.startsWith("63") && digits.length >= 12) {
    digits = `0${digits.slice(2)}`;
  } else if (digits.length === 10 && digits.startsWith("9")) {
    digits = `0${digits}`;
  }
  return digits;
}

export function sanitizeStorageName(value: string): string {
  const cleaned = value
    .replace(/[^a-zA-Z0-9._-]/g, "_")
    .replace(/^[._-]+|[._-]+$/g, "")
    .slice(-120);

  return cleaned || "document";
}

export function cleanStorageSegment(value: string): string {
  return value.replace(/[^a-zA-Z0-9_-]/g, "_");
}

export function buildStoragePath(
  rowId: string,
  folder: string,
  fileName: string
): string {
  const cleanId = cleanStorageSegment(rowId);
  const cleanName = sanitizeStorageName(fileName);
  const unique = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  return `${folder}/${cleanId}-${unique}-${cleanName}`;
}

async function resolveStoredEmail(
  supabaseAdmin: SupabaseClient,
  record: JsonRecord
): Promise<string> {
  const documents = asRecord(record.requirements_documents);
  const details = asRecord(record.student_details);

  const candidate = [record.email, documents.student_email, details.email].find(
    (value): value is string =>
      typeof value === "string" && value.trim().length > 0
  );

  if (candidate) return candidate.trim();

  if (record.user_id) {
    try {
      const { data: linkedUser } = await supabaseAdmin.auth.admin.getUserById(
        String(record.user_id)
      );

      if (linkedUser?.user?.email) {
        return linkedUser.user.email.trim();
      }
    } catch (lookupError) {
      console.warn("Could not resolve linked auth user email:", lookupError);
    }
  }

  return "";
}

async function findApplicationByEmail(
  supabaseAdmin: SupabaseClient,
  targetEmail: string,
  targetContact: string
): Promise<JsonRecord | null> {
  if (!targetEmail) return null;

  const normalizedContact = normalizePhone(targetContact);

  // 1. Direct lookup once the email column exists.
  let lookup = supabaseAdmin
    .from("student_applications")
    .select("*")
    .ilike("email", targetEmail);

  if (targetContact) {
    lookup = lookup.eq("contact_number", targetContact);
  }

  const { data, error } = await lookup.limit(1).maybeSingle();

  if (!error && data) {
    return data as JsonRecord;
  }

  if (error) {
    console.warn(
      "[enrollRequirements] Email column lookup failed:",
      error.message
    );
  }

  // 2. Fallback for databases without the email column: resolve the linked
  // auth user, then verify the phone number with normalization.
  try {
    const { data: userList } = await supabaseAdmin.auth.admin.listUsers({
      page: 1,
      perPage: 1000,
    });

    const matches = (userList?.users || []).filter(
      (user) => user.email?.trim().toLowerCase() === targetEmail.toLowerCase()
    );

    for (const user of matches) {
      const { data: rows, error: rowError } = await supabaseAdmin
        .from("student_applications")
        .select("*")
        .eq("user_id", user.id)
        .order("submitted_at", { ascending: false });

      if (rowError || !rows) continue;

      const typedRows = rows as JsonRecord[];

      if (!normalizedContact) {
        return typedRows[0] || null;
      }

      const contactRow = typedRows.find(
        (row) => normalizePhone(row.contact_number) === normalizedContact
      );

      if (contactRow) {
        return contactRow;
      }
    }
  } catch (lookupError) {
    console.warn("[enrollRequirements] Auth user lookup failed:", lookupError);
  }

  return null;
}

/**
 * Finds the enrollment application a requirements upload belongs to and
 * verifies the submitted identity against the stored record.
 */
export async function resolveApplicationForUpload(
  supabaseAdmin: SupabaseClient,
  input: ApplicationLookupInput
): Promise<ApplicationLookupResult> {
  const applicationId = text(input.applicationId);
  const providedEmail = text(input.email);
  const providedContact = text(input.contactNumber);

  if (!applicationId && (!providedEmail || !providedContact)) {
    return {
      error:
        "An application ID or a matching email and contact number are required.",
      code: "APPLICATION_CONTEXT_REQUIRED",
      status: 400,
    };
  }

  let application: JsonRecord | null = null;

  if (isUuid(applicationId)) {
    const { data, error } = await supabaseAdmin
      .from("student_applications")
      .select("*")
      .eq("id", applicationId)
      .maybeSingle();

    if (error) {
      return { error: error.message, code: "LOOKUP_FAILED", status: 500 };
    }

    application = (data as JsonRecord) || null;
  }

  if (!application) {
    application = await findApplicationByEmail(
      supabaseAdmin,
      providedEmail,
      providedContact
    );
  }

  if (!application) {
    return {
      error:
        "No matching enrollment application was found. Please return to the enrollment form and try again.",
      code: "APPLICATION_NOT_FOUND",
      status: 404,
    };
  }

  let storedEmail = await resolveStoredEmail(supabaseAdmin, application);
  let storedContact = text(application.contact_number);

  const contactMatches =
    Boolean(normalizePhone(providedContact)) &&
    normalizePhone(providedContact) === normalizePhone(storedContact);

  if (
    storedEmail &&
    providedEmail &&
    storedEmail.toLowerCase() !== providedEmail.toLowerCase()
  ) {
    const relinked = await findApplicationByEmail(
      supabaseAdmin,
      providedEmail,
      providedContact
    );

    if (relinked) {
      application = relinked;
      storedEmail = await resolveStoredEmail(supabaseAdmin, application);
      storedContact = text(application.contact_number);
    } else if (!contactMatches) {
      return {
        error: "The email does not match this enrollment application.",
        code: "EMAIL_MISMATCH",
        status: 403,
      };
    }
  }

  if (
    !storedEmail &&
    normalizePhone(storedContact) &&
    normalizePhone(providedContact) !== normalizePhone(storedContact)
  ) {
    return {
      error:
        "This application has no email on file and the contact number does not match. Please contact the school registrar.",
      code: "CONTACT_MISMATCH",
      status: 403,
    };
  }

  return { application, storedEmail, storedContact };
}

/**
 * Picks the requirements storage bucket, preferring the names used by this
 * project and creating a fallback bucket only when the project has none.
 */
export async function pickStorageBucket(
  supabaseAdmin: SupabaseClient
): Promise<string> {
  try {
    const { data: buckets } = await supabaseAdmin.storage.listBuckets();
    const names = (buckets || []).map((bucket) => bucket.name);

    for (const preferred of PREFERRED_BUCKETS) {
      if (names.includes(preferred)) return preferred;
    }

    if (names.length > 0) return names[0];
  } catch (listError) {
    console.warn("Could not list storage buckets:", listError);
  }

  try {
    const { error } = await supabaseAdmin.storage.createBucket(
      "enrollment-documents",
      { public: false }
    );

    if (!error || /already exists|duplicate/i.test(error.message)) {
      return "enrollment-documents";
    }
  } catch (createError) {
    console.warn("Could not create the enrollment documents bucket:", createError);
  }

  return "enrollment-documents";
}
