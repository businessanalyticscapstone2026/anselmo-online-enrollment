import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { isWalkInRecord } from "@/lib/walkInEnrollment";

export type StudentApplicationRecord = Record<string, unknown>;
export type StudentSectionRecord = Record<string, unknown>;
export type StudentProfileRecord = Record<string, unknown>;

export type StudentDashboardData = {
  application: StudentApplicationRecord | null;
  section: StudentSectionRecord | null;
  studentProfile: StudentProfileRecord | null;
};

const SECTION_COLUMNS = "*";

function createAdminClient(): SupabaseClient | null {
  const supabaseUrl =
    process.env.NEXT_PUBLIC_SUPABASE_URL ||
    "https://tmrimwhwwvojbsztnbxf.supabase.co";
  const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!supabaseKey) return null;

  return createClient(supabaseUrl, supabaseKey, {
    auth: { persistSession: false },
  });
}

/**
 * Loads a student's latest application and assigned section using the service
 * role so the result is not blocked by the `sections` RLS policy (which
 * students cannot read directly).
 */
export async function getStudentDashboardData(params: {
  userId: string;
  email?: string;
}): Promise<StudentDashboardData> {
  const supabaseAdmin = createAdminClient();

  if (!supabaseAdmin) {
    console.error(
      "Student dashboard data: SUPABASE_SERVICE_ROLE_KEY is not configured."
    );
    return { application: null, section: null, studentProfile: null };
  }

  let application: StudentApplicationRecord | null = null;
  let studentProfile: StudentProfileRecord | null = null;

  if (params.userId) {
    const [applicationResult, profileResult] = await Promise.all([
      supabaseAdmin
        .from("student_applications")
        .select("*")
        .eq("user_id", params.userId)
        .order("submitted_at", { ascending: false })
        .limit(1)
        .maybeSingle(),
      supabaseAdmin
        .from("student_profiles")
        .select("*")
        .eq("id", params.userId)
        .maybeSingle(),
    ]);

    if (applicationResult.error) {
      console.error(
        "Student dashboard user_id lookup failed:",
        applicationResult.error
      );
    }

    application =
      (applicationResult.data as StudentApplicationRecord | null) ?? null;

    if (
      profileResult.error &&
      !/does not exist|schema cache|PGRST205|42P01/i.test(
        profileResult.error.message
      )
    ) {
      console.error(
        "Student dashboard student_profiles lookup failed:",
        profileResult.error
      );
    }

    studentProfile =
      (profileResult.data as StudentProfileRecord | null) ?? null;
  }

  const email = String(params.email ?? "").trim();

  if (!application && email) {
    const { data, error } = await supabaseAdmin
      .from("student_applications")
      .select("*")
      .ilike("email", email)
      .order("submitted_at", { ascending: false })
      .limit(5);

    if (error && !/column .*email.* does not exist/i.test(error.message)) {
      console.error("Student dashboard email lookup failed:", error);
    }

    // Walk-ins are registrar-only records. Even when the registrar stored a
    // contact email that matches a student account, it must never surface on
    // the student dashboard.
    const candidates = (data ?? []) as StudentApplicationRecord[];
    application =
      candidates.find((candidate) => !isWalkInRecord(candidate)) ?? null;
  }

  if (application && isWalkInRecord(application)) {
    application = null;
  }

  let section: StudentSectionRecord | null = null;
  const sectionId = application?.assigned_section_id;

  if (sectionId) {
    const { data, error } = await supabaseAdmin
      .from("sections")
      .select(SECTION_COLUMNS)
      .eq("id", sectionId)
      .maybeSingle();

    if (error) {
      console.error("Student dashboard section lookup failed:", error);
    }

    section = (data as StudentSectionRecord | null) ?? null;
  }

  return { application, section, studentProfile };
}
