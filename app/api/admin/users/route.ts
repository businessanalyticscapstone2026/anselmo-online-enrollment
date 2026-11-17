import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { verifyAdminRequest } from "@/lib/auth/adminAuth";
import { formatAccountName, normalizeEmail } from "@/lib/accountNames";

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
    const { data: applications, error: applicationError } = await supabaseAdmin
      .from("student_applications")
      .select("user_id, first_name, middle_name, last_name");

    if (applicationError) {
      console.warn(
        "Failed to fetch application names for the users list:",
        applicationError.message
      );
    }

    const applicationsByUserId = new Map<
      string,
      {
        first_name: string | null;
        middle_name: string | null;
        last_name: string | null;
      }
    >();

    for (const application of applications || []) {
      if (application.user_id && !applicationsByUserId.has(application.user_id)) {
        applicationsByUserId.set(application.user_id, application);
      }
    }

    const users = (profiles || []).map((p) => {
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

    return NextResponse.json({ users });
  } catch (err) {
    console.error("Error in GET /api/admin/users:", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Internal server error" },
      { status: 500 }
    );
  }
}
