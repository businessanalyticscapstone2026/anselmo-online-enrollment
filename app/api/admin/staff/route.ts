import { NextResponse } from "next/server";
import { randomBytes } from "node:crypto";
import { createClient, type User } from "@supabase/supabase-js";
import { verifyAdminRequest } from "@/lib/auth/adminAuth";
import { getClientIp } from "@/lib/requestIp";
import { STAFF_PORTAL_ROLES } from "@/lib/auth/roles";
import {
  clearRemovedAccount,
  isAccountRemoved,
} from "@/lib/removedAccounts";
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
      | { fullName?: unknown; email?: unknown; role?: unknown }
      | null;

    const fullName =
      typeof body?.fullName === "string"
        ? body.fullName.trim().replace(/\s+/g, " ")
        : "";
    const email =
      typeof body?.email === "string"
        ? body.email.trim().toLowerCase()
        : "";
    const role =
      typeof body?.role === "string"
        ? body.role.trim().toLowerCase()
        : "";

    if (fullName.length < 2 || fullName.length > 120) {
      return NextResponse.json(
        { error: "Enter the staff member's full name (2-120 characters)." },
        { status: 400 }
      );
    }

    if (!email || email.length > 254 || !EMAIL_PATTERN.test(email)) {
      return NextResponse.json(
        { error: "A valid email address is required." },
        { status: 400 }
      );
    }

    if (!(STAFF_PORTAL_ROLES as readonly string[]).includes(role)) {
      return NextResponse.json(
        { error: "Role must be either staff or registrar." },
        { status: 400 }
      );
    }

    const staffRole = role as StaffSetupRole;

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

    const { data: existingProfiles, error: profileLookupError } =
      await supabaseAdmin
        .from("profiles")
        .select("id, role")
        .ilike("email", email)
        .limit(1);

    if (profileLookupError) {
      return NextResponse.json(
        { error: `Could not check existing profiles: ${profileLookupError.message}` },
        { status: 500 }
      );
    }

    if (existingProfiles && existingProfiles.length > 0) {
      return NextResponse.json(
        { error: "A profile already exists for this email address." },
        { status: 409 }
      );
    }

    let existingAuthUser: User | null = null;

    try {
      existingAuthUser = await findAuthUserByEmail(supabaseAdmin, email);
    } catch (authLookupError) {
      return NextResponse.json(
        {
          error:
            authLookupError instanceof Error
              ? authLookupError.message
              : "Could not check existing auth accounts.",
        },
        { status: 500 }
      );
    }

    let reusableAuthUser: User | null = null;

    if (existingAuthUser) {
      const { data: existingProfileById, error: existingProfileByIdError } =
        await supabaseAdmin
          .from("profiles")
          .select("id")
          .eq("id", existingAuthUser.id)
          .maybeSingle();

      if (existingProfileByIdError) {
        return NextResponse.json(
          {
            error: `Could not check the existing auth profile: ${existingProfileByIdError.message}`,
          },
          { status: 500 }
        );
      }

      const accountType =
        typeof existingAuthUser.user_metadata?.account_type === "string"
          ? existingAuthUser.user_metadata.account_type
          : "";

      if (existingProfileById || accountType !== "staff") {
        return NextResponse.json(
          {
            error:
              "An auth account already exists for this email address. Use a different email or remove the existing account in Supabase.",
          },
          { status: 409 }
        );
      }

      reusableAuthUser = existingAuthUser;
    }

    const wasRemoved = await isAccountRemoved(email);

    const generatedPassword = `Aa1!${randomBytes(18).toString("base64url")}Z9`;

    let userId = "";

    if (reusableAuthUser) {
      const existingMetadata =
        reusableAuthUser.user_metadata &&
        typeof reusableAuthUser.user_metadata === "object"
          ? reusableAuthUser.user_metadata
          : {};

      const { data: updated, error: updateError } =
        await supabaseAdmin.auth.admin.updateUserById(reusableAuthUser.id, {
          password: generatedPassword,
          email_confirm: true,
          user_metadata: {
            ...existingMetadata,
            full_name: fullName,
            account_type: "staff",
          },
        });

      if (updateError || !updated.user) {
        return NextResponse.json(
          {
            error:
              updateError?.message ||
              "Could not recover the existing staff auth account.",
          },
          { status: 500 }
        );
      }

      userId = updated.user.id;
    } else {
      const { data: created, error: createError } =
        await supabaseAdmin.auth.admin.createUser({
          email,
          password: generatedPassword,
          email_confirm: true,
          user_metadata: {
            full_name: fullName,
            account_type: "staff",
          },
        });

      if (createError || !created.user) {
        const message =
          createError?.message || "Could not create the staff auth account.";
        const isDuplicate = /already|registered|exists|duplicate/i.test(
          message
        );

        return NextResponse.json(
          {
            error: isDuplicate
              ? "An account with this email address already exists."
              : message,
          },
          { status: isDuplicate ? 409 : 400 }
        );
      }

      userId = created.user.id;
    }

    const { data: profileById, error: profileLookupByIdError } =
      await supabaseAdmin
        .from("profiles")
        .select("id, role")
        .eq("id", userId)
        .maybeSingle();

    if (profileLookupByIdError) {
      try {
        await supabaseAdmin.auth.admin.deleteUser(userId);
      } catch (cleanupError) {
        console.warn("Staff auth rollback notice:", cleanupError);
      }

      return NextResponse.json(
        {
          error: `Could not verify the staff profile: ${profileLookupByIdError.message}`,
        },
        { status: 500 }
      );
    }

    const existingRole = String(profileById?.role ?? "")
      .trim()
      .toLowerCase();

    if (["admin", "ict_admin"].includes(existingRole)) {
      try {
        await supabaseAdmin.auth.admin.deleteUser(userId);
      } catch (cleanupError) {
        console.warn("Staff auth rollback notice:", cleanupError);
      }

      return NextResponse.json(
        {
          error:
            "An administrator account already uses this email. Choose a different email.",
        },
        { status: 409 }
      );
    }

    const profileWrite = profileById
      ? await supabaseAdmin
          .from("profiles")
          .update({
            full_name: fullName,
            email,
            role: staffRole,
          })
          .eq("id", userId)
      : await supabaseAdmin.from("profiles").insert({
          id: userId,
          full_name: fullName,
          email,
          role: staffRole,
        });

    if (profileWrite.error) {
      try {
        await supabaseAdmin.auth.admin.deleteUser(userId);
      } catch (cleanupError) {
        console.warn("Staff auth rollback notice:", cleanupError);
      }

      return NextResponse.json(
        {
          error: `Could not create the staff profile: ${profileWrite.error.message}`,
        },
        { status: 500 }
      );
    }

    const staffProfileWrite = await supabaseAdmin
      .from("staff_profiles")
      .upsert(
        {
          id: userId,
          email,
          position: staffRole === "registrar" ? "Registrar" : "Staff",
          updated_at: new Date().toISOString(),
        },
        { onConflict: "id" }
      );

    if (staffProfileWrite.error) {
      console.warn(
        "Could not record staff_profiles row:",
        staffProfileWrite.error.message
      );

      try {
        await supabaseAdmin.from("staff_profiles").delete().eq("id", userId);
        await supabaseAdmin.from("profiles").delete().eq("id", userId);
        await supabaseAdmin.auth.admin.deleteUser(userId);
      } catch (cleanupError) {
        console.warn("Staff auth rollback notice:", cleanupError);
      }

      return NextResponse.json(
        {
          error: `Could not record the staff profile: ${staffProfileWrite.error.message}`,
        },
        { status: 500 }
      );
    }

    await clearRemovedAccount(email);

    const appUrl = resolveAppUrl(request.url);
    const linkResult = await generateStaffSetupLink(
      supabaseAdmin,
      appUrl,
      email
    );

    let emailSent = false;
    let emailError = linkResult.error;

    if (linkResult.setupUrl) {
      const mailResult = await sendStaffSetupEmail({
        to: email,
        fullName,
        role: staffRole,
        setupUrl: linkResult.setupUrl,
        appUrl,
      });

      emailSent = mailResult.sent;
      emailError = mailResult.error;
    }

    try {
      await supabaseAdmin.from("activity_logs").insert({
        user_type: "Admin",
        user_email: adminAuth.user.email || "unknown",
        action: `Created Staff Account: ${email} (${staffRole}) - ${
          emailSent ? "setup email sent" : "setup email failed"
        }${wasRemoved ? " - restored" : ""}`,
        ip_address: getClientIp(request) || null,
      });
    } catch {
      // Activity logging must not block account creation.
    }

    return NextResponse.json(
      {
        success: true,
        message: emailSent
          ? `Staff account created and setup email sent to ${email}.`
          : `Staff account created for ${email}, but the setup email could not be sent.`,
        staff: {
          id: userId,
          fullName,
          email,
          role: staffRole,
        },
        emailSent,
        warning: emailSent ? undefined : emailError,
        setupUrl:
          !emailSent && linkResult.setupUrl ? linkResult.setupUrl : undefined,
        restored: wasRemoved,
      },
      { status: 201 }
    );
  } catch (error) {
    console.error("Error in POST /api/admin/staff:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Internal server error" },
      { status: 500 }
    );
  }
}
