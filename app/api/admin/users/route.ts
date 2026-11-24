import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { verifyAdminRequest } from "@/lib/auth/adminAuth";
import { formatAccountName, normalizeEmail } from "@/lib/accountNames";
import { hasReceivedCredentials } from "@/lib/applicationVisibility";
import { normalizeEnrollmentStatus } from "@/lib/enrollmentStatus";

export const runtime = "nodejs";

export async function GET(request: Request) {
  try {
    const adminAuth = await verifyAdminRequest(request);

    if (!adminAuth.authorized || !adminAuth.user) {
      return NextResponse.json(
        { error: adminAuth.error || "Unauthorized. Admin privileges required." },
        { status: 403 }
      );
    }

    const supabaseUrl =
      process.env.NEXT_PUBLIC_SUPABASE_URL ||
      "https://tmrimwhwwvojbsztnbxf.supabase.co";
    const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

    if (!supabaseKey) {
      return NextResponse.json(
        { error: "Server configuration missing: SUPABASE_SERVICE_ROLE_KEY." },
        { status: 500 }
      );
    }

    const supabaseAdmin = createClient(supabaseUrl, supabaseKey, {
      auth: { persistSession: false },
    });

    // Fetch registered profiles using only existing schema columns
    const { data: profiles, error: profileError } = await supabaseAdmin
      .from("profiles")
      .select("id, full_name, email, role, created_at")
      .order("created_at", { ascending: false });

    if (profileError) {
      console.error("Failed to fetch profiles:", profileError);
      return NextResponse.json(
        { error: `Failed to fetch profiles: ${profileError.message}` },
        { status: 500 }
      );
    }

    // Older student accounts were created without a profile full_name. Their
    // application record still has the name, so use it instead of showing
    // "Unnamed User".
    type ApplicationSummary = {
      id?: string | null;
      user_id: string | null;
      first_name: string | null;
      middle_name: string | null;
      last_name: string | null;
      email?: string | null;
      status?: unknown;
      registrar_remarks?: string | null;
      requirements_submitted?: unknown;
      student_details?: unknown;
      submitted_at?: string | null;
      updated_at?: string | null;
    };

    let applications: ApplicationSummary[] = [];
    let applicationError: { message?: string } | null = null;
    let visibilityDataAvailable = true;

    const extendedApplications = await supabaseAdmin
      .from("student_applications")
      .select(
        "id, user_id, first_name, middle_name, last_name, email, status, registrar_remarks, requirements_submitted, student_details, submitted_at, updated_at"
      );

    if (!extendedApplications.error) {
      applications = (extendedApplications.data ??
        []) as ApplicationSummary[];
    } else {
      applicationError = extendedApplications.error;

      const fallbackApplications = await supabaseAdmin
        .from("student_applications")
        .select(
          "id, user_id, first_name, middle_name, last_name, email, status, registrar_remarks, student_details, submitted_at, updated_at"
        );

      if (!fallbackApplications.error) {
        applications = (fallbackApplications.data ??
          []) as ApplicationSummary[];
        applicationError = null;
      } else {
        const namesOnly = await supabaseAdmin
          .from("student_applications")
          .select("user_id, first_name, middle_name, last_name");

        applications = (namesOnly.data ??
          []) as unknown as ApplicationSummary[];
        applicationError = namesOnly.error ?? applicationError;
        visibilityDataAvailable = false;
      }
    }

    if (applicationError) {
      console.warn(
        "Failed to fetch application names for the users list:",
        applicationError.message
      );
    }

    const applicationsByUserId = new Map<string, ApplicationSummary>();
    const latestApplicationByUserId = new Map<string, ApplicationSummary>();
    const visibleApplicationUserIds = new Set<string>();

    for (const application of applications) {
      const userId = application.user_id ? String(application.user_id) : "";

      if (!userId) continue;

      if (!applicationsByUserId.has(userId)) {
        applicationsByUserId.set(userId, application);
      }

      const currentStamp =
        application.updated_at || application.submitted_at || "";
      const existing = latestApplicationByUserId.get(userId);
      const existingStamp = existing?.updated_at || existing?.submitted_at || "";

      if (!existing || currentStamp >= existingStamp) {
        latestApplicationByUserId.set(userId, application);
      }

      if (hasReceivedCredentials(application)) {
        visibleApplicationUserIds.add(userId);
      }
    }

    const profilesById = new Map(
      (profiles || []).map((profile) => [String(profile.id), profile])
    );
    const rejectedByUserId = new Map<string, ApplicationSummary>();

    for (const application of latestApplicationByUserId.values()) {
      const userId = application.user_id ? String(application.user_id) : "";

      if (!userId) continue;
      if (normalizeEnrollmentStatus(application.status) !== "rejected") continue;
      if (!hasReceivedCredentials(application)) continue;

      const profile = profilesById.get(userId);
      if (
        !profile ||
        String(profile.role || "student").trim().toLowerCase() !== "student"
      ) {
        continue;
      }

      rejectedByUserId.set(userId, application);
    }

    const rejectedStudents = Array.from(rejectedByUserId.values()).map(
      (application) => {
        const userId = String(application.user_id);
        const profile = profilesById.get(userId);
        const email =
          normalizeEmail(application.email) ||
          normalizeEmail(profile?.email) ||
          "No email";
        const fullName =
          formatAccountName(
            {
              fullName: profile?.full_name,
              firstName: application.first_name,
              middleName: application.middle_name,
              lastName: application.last_name,
            },
            email
          ) || "Unnamed Student";

        return {
          userId,
          applicationId: application.id ? String(application.id) : null,
          fullName,
          email,
          remarks:
            typeof application.registrar_remarks === "string"
              ? application.registrar_remarks
              : "",
          rejectedAt:
            application.updated_at || application.submitted_at || null,
        };
      }
    );

    const notificationsOnly =
      new URL(request.url).searchParams.get("view") === "notifications";

    if (notificationsOnly) {
      return NextResponse.json({ rejectedStudents });
    }

    const users = (profiles || [])
      .filter((profile) => {
        const role = String(profile.role || "student").trim().toLowerCase();

        if (role !== "student") return true;
        if (!visibilityDataAvailable) return true;
        if (!applicationsByUserId.has(profile.id)) return true;

        return visibleApplicationUserIds.has(profile.id);
      })
      .map((p) => {
        const role = String(p.role || "student").trim().toLowerCase();
        const email = normalizeEmail(p.email);
        const application = applicationsByUserId.get(p.id);
        const fullName =
          formatAccountName(
            {
              fullName: p.full_name,
              firstName: application?.first_name,
              middleName: application?.middle_name,
              lastName: application?.last_name,
            },
            email
          ) || "Unnamed User";

        return {
          id: p.id,
          fullName,
          email: p.email || "No email",
          role: role,
          createdAt: p.created_at,
        };
      });

    return NextResponse.json({ users, rejectedStudents });
  } catch (err) {
    console.error("Error in GET /api/admin/users:", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Internal server error" },
      { status: 500 }
    );
  }
}
