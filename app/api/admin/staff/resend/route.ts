import { NextResponse } from "next/server";
import { createClient, type User } from "@supabase/supabase-js";
import { verifyAdminRequest } from "@/lib/auth/adminAuth";
import { getClientIp } from "@/lib/requestIp";
import { isStaffRole } from "@/lib/auth/roles";
import {
  findAuthUserByEmail,
  generateStaffSetupLink,
  resolveAppUrl,
  sendStaffSetupEmail,
  type StaffSetupRole,
} from "@/lib/admin/staffSetup";

export const runtime = "nodejs";
export const maxDuration = 60;

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export async function POST(request: Request) {
  try {
    const adminAuth = await verifyAdminRequest(request);

    if (!adminAuth.authorized || !adminAuth.user) {
      return NextResponse.json(
        { error: adminAuth.error || "Unauthorized. Admin privileges required." },
        { status: 403 }
      );
    }

    const body = (await request.json().catch(() => null)) as
      | { email?: unknown }
      | null;
    const email =
      typeof body?.email === "string"
        ? body.email.trim().toLowerCase()
        : "";

    if (!email || email.length > 254 || !EMAIL_PATTERN.test(email)) {
      return NextResponse.json(
        { error: "A valid email address is required." },
        { status: 400 }
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

    const { data: profiles, error: profileError } = await supabaseAdmin
      .from("profiles")
      .select("id, full_name, role")
      .ilike("email", email)
      .limit(1);

    if (profileError) {
      return NextResponse.json(
        { error: `Could not check the staff profile: ${profileError.message}` },
        { status: 500 }
      );
    }

    const profile = profiles?.[0];

    if (!profile || !isStaffRole(profile.role)) {
      return NextResponse.json(
        { error: "No staff or registrar account was found for this email." },
        { status: 404 }
      );
    }

    const staffRole = String(profile.role).trim().toLowerCase() as StaffSetupRole;
    const fullName = String(profile.full_name || email).trim();

    let authUser: User | null = null;

    try {
      authUser = await findAuthUserByEmail(supabaseAdmin, email);
    } catch (authLookupError) {
      return NextResponse.json(
        {
          error:
            authLookupError instanceof Error
              ? authLookupError.message
              : "Could not check the auth account.",
        },
        { status: 500 }
      );
    }

    if (!authUser) {
      return NextResponse.json(
        { error: "The auth account for this email no longer exists." },
        { status: 404 }
      );
    }

    const appUrl = resolveAppUrl(request.url);
    const linkResult = await generateStaffSetupLink(
      supabaseAdmin,
      appUrl,
      email
    );

    if (!linkResult.setupUrl) {
      return NextResponse.json(
        {
          error:
            linkResult.error ||
            "Could not generate a staff setup link right now.",
        },
        { status: 502 }
      );
    }

    const mailResult = await sendStaffSetupEmail({
      to: email,
      fullName,
      role: staffRole,
      setupUrl: linkResult.setupUrl,
      appUrl,
    });

    try {
      await supabaseAdmin.from("activity_logs").insert({
        user_type: "Admin",
        user_email: adminAuth.user.email || "unknown",
        action: `Resent Staff Setup Link: ${email} (${staffRole}) - ${
          mailResult.sent ? "sent" : "failed"
        }`,
        ip_address: getClientIp(request) || null,
      });
    } catch {
      // Activity logging must not block the resend response.
    }

    if (!mailResult.sent) {
      return NextResponse.json(
        {
          success: false,
          emailSent: false,
          error:
            mailResult.error ||
            "The setup email could not be sent. You can copy the setup link instead.",
          setupUrl: linkResult.setupUrl,
        },
        { status: 502 }
      );
    }

    return NextResponse.json({
      success: true,
      emailSent: true,
      message: `Setup email resent to ${email}.`,
    });
  } catch (error) {
    console.error("Error in POST /api/admin/staff/resend:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Internal server error" },
      { status: 500 }
    );
  }
}
