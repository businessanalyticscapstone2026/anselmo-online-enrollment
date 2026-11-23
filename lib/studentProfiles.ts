import type { SupabaseClient } from "@supabase/supabase-js";
import { joinNameParts } from "@/lib/accountNames";

type JsonRecord = Record<string, unknown>;

function text(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function objectValue(value: unknown): JsonRecord {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as JsonRecord)
    : {};
}

function formatAddress(value: unknown): string {
  const address = objectValue(value);
  return [
    text(address.houseNo),
    text(address.street),
    text(address.barangay) ? `Brgy. ${text(address.barangay)}` : "",
    text(address.municipality),
    text(address.province),
    text(address.zipCode),
    text(address.country),
  ]
    .filter(Boolean)
    .join(", ");
}

function fullNameFromParts(
  record: JsonRecord,
  keys: { first: string; middle: string; last: string }
): string {
  return joinNameParts(
    text(record[keys.first]),
    text(record[keys.middle]),
    text(record[keys.last])
  );
}

function isMissingTable(error: { code?: string; message?: string } | null): boolean {
  if (!error) return false;
  const message = String(error.message || "").toLowerCase();
  return (
    error.code === "42P01" ||
    error.code === "PGRST205" ||
    message.includes("does not exist") ||
    message.includes("schema cache")
  );
}

type SyncOptions = {
  /**
   * Controls whether the applicant email is written to student_profiles.
   * - "auto" (default): copy the email when one already exists in the
   *   application/profile records (legacy rows and post-delivery syncs).
   * - "exclude": never write the email (used before credentials are sent).
   * - "include": write the resolved email (used after delivery).
   */
  emailMode?: "auto" | "include" | "exclude";
};

/**
 * Rebuilds public.student_profiles for one application. Best effort: schema
 * changes and transient database errors never block the enrollment flow.
 */
export async function syncStudentProfile(
  supabase: SupabaseClient,
  applicationId: string,
  options: SyncOptions = {}
): Promise<void> {
  if (!applicationId) return;

  try {
    const { data, error } = await supabase
      .from("student_applications")
      .select("*")
      .eq("id", applicationId)
      .maybeSingle();

    if (error || !data) return;

    const application = data as JsonRecord;
    const userId = text(application.user_id);
    if (!userId) return;

    const details = objectValue(application.student_details);
    const requirements = objectValue(application.requirements_documents);

    const [profileResult, sectionResult] = await Promise.all([
      supabase
        .from("profiles")
        .select("full_name, email")
        .eq("id", userId)
        .maybeSingle(),
      application.assigned_section_id
        ? supabase
            .from("sections")
            .select("name, adviser_name")
            .eq("id", application.assigned_section_id)
            .maybeSingle()
        : Promise.resolve({ data: null, error: null }),
    ]);

    const profile = objectValue(profileResult.data);
    const section = objectValue(sectionResult.data);

    const fullName =
      text(profile.full_name) ||
      joinNameParts(
        text(application.first_name),
        text(application.middle_name),
        text(application.last_name)
      ) ||
      text(details.full_name);

    const resolvedEmail =
      text(profile.email) ||
      text(requirements.student_email) ||
      text(details.email) ||
      text(application.email) ||
      "";

    const emailMode = options.emailMode ?? "auto";

    const payload: Record<string, unknown> = {
      id: userId,
      status: text(application.status) || null,
      full_name: fullName || null,
      track:
        text(details.selected_track) ||
        text(details.track) ||
        text(application.track) ||
        null,
      selected_cluster:
        text(details.selected_cluster) ||
        text(details.cluster) ||
        text(application.selected_cluster) ||
        null,
      contact_number:
        text(application.contact_number) || text(details.contact_number) || null,
      birth_date: text(application.birth_date) || null,
      address:
        text(application.address) ||
        text(application.current_address) ||
        formatAddress(details.current_address) ||
        text(details.address) ||
        null,
      assigned_section: text(section.name) || null,
      adviser: text(section.adviser_name) || null,
    };

    // The applicant email is only persisted once the credential email has been
    // delivered. Before that point the enrollment is just a draft.
    if (emailMode === "include") {
      payload.email = resolvedEmail || null;
    } else if (emailMode === "auto" && resolvedEmail) {
      payload.email = resolvedEmail;
    }

    const { error: upsertError } = await supabase
      .from("student_profiles")
      .upsert(payload, { onConflict: "id" });

    if (upsertError && !isMissingTable(upsertError)) {
      console.warn(
        `studentProfiles: could not sync profile for ${userId}:`,
        upsertError.message
      );
    }
  } catch (error) {
    console.warn(
      "studentProfiles: sync failed:",
      error instanceof Error ? error.message : error
    );
  }
}

export function guardianFullName(value: unknown): string {
  return fullNameFromParts(objectValue(value), {
    first: "firstName",
    middle: "middleName",
    last: "lastName",
  });
}
