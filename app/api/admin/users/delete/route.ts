import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { verifyAdminRequest } from "@/lib/auth/adminAuth";
import {
  accountUserTypeForRole,
  recordDeletedAccount,
} from "@/lib/deletedAccounts";
import { recordRemovedAccount } from "@/lib/removedAccounts";
import { getClientIp } from "@/lib/requestIp";

export const runtime = "nodejs";

export async function POST(request: Request) {
  try {
    const adminAuth = await verifyAdminRequest(request);

    if (!adminAuth.authorized || !adminAuth.user) {
      return NextResponse.json(
        { error: adminAuth.error || "Unauthorized. Admin privileges required." },
        { status: 403 }
      );
    }

    const body = await request.json().catch(() => ({}));
    const { userId, email, role } = body;

    if (!userId || typeof userId !== "string") {
      return NextResponse.json(
        { error: "Valid User ID is required." },
        { status: 400 }
      );
    }

    // Prevent administrator from accidentally deleting their own currently logged-in account
    if (adminAuth.user.id === userId) {
      return NextResponse.json(
        { error: "You cannot remove your own administrator account while logged in." },
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

    // Snapshot the account and all related records BEFORE deleting anything so
    // the full account can be retrieved or restored from deleted_accounts.
    const { data: profileSnapshot } = await supabaseAdmin
      .from("profiles")
      .select("*")
      .eq("id", userId)
      .maybeSingle();

    const resolvedEmail = String(
      profileSnapshot?.email || email || ""
    )
      .trim()
      .toLowerCase();

    const resolvedRole = String(profileSnapshot?.role || role || "")
      .trim()
      .toLowerCase();

    const resolvedFullName = String(profileSnapshot?.full_name || "").trim();

    let authSnapshot: Record<string, unknown> = {};
    let authEmail = "";
    try {
      const { data: authLookup } =
        await supabaseAdmin.auth.admin.getUserById(userId);
      const authUser = authLookup?.user;

      if (authUser) {
        authEmail = String(authUser.email || "").trim().toLowerCase();
        authSnapshot = {
          id: authUser.id,
          email: authUser.email,
          created_at: authUser.created_at,
          last_sign_in_at: authUser.last_sign_in_at,
          email_confirmed_at: authUser.email_confirmed_at,
          phone: authUser.phone,
          user_metadata: authUser.user_metadata || {},
          app_metadata: authUser.app_metadata || {},
        };
      }
    } catch (authSnapshotError) {
      console.warn("Could not snapshot auth account:", authSnapshotError);
    }

    const finalEmail = resolvedEmail || authEmail;
    const finalRole = resolvedRole;
    const authMetadata =
      typeof authSnapshot.user_metadata === "object" &&
      authSnapshot.user_metadata !== null
        ? (authSnapshot.user_metadata as Record<string, unknown>)
        : {};
    const finalFullName =
      resolvedFullName || String(authMetadata.full_name || "").trim();

    const roleProfileTable = ["staff", "registrar"].includes(finalRole)
      ? "staff_profiles"
      : finalRole === "student"
        ? "student_profiles"
        : ["admin", "ict_admin"].includes(finalRole)
          ? "admin_profiles"
          : null;

    let roleProfileSnapshot: Record<string, unknown> = {};

    if (roleProfileTable) {
      try {
        const { data: roleProfile } = await supabaseAdmin
          .from(roleProfileTable)
          .select("*")
          .eq("id", userId)
          .maybeSingle();

        if (roleProfile && typeof roleProfile === "object") {
          roleProfileSnapshot = roleProfile as Record<string, unknown>;
        }
      } catch (roleProfileError) {
        console.warn("Could not snapshot role profile:", roleProfileError);
      }
    }

    const applicationMap = new Map<string, unknown>();

    if (finalEmail) {
      try {
        const { data: appsByEmail } = await supabaseAdmin
          .from("student_applications")
          .select("*")
          .ilike("email", finalEmail);

        (appsByEmail || []).forEach((application) => {
          if (
            application &&
            typeof application === "object" &&
            "id" in application
          ) {
            applicationMap.set(
              String((application as { id: unknown }).id),
              application
            );
          }
        });
      } catch (appEmailError) {
        console.warn(
          "Could not snapshot applications by email:",
          appEmailError
        );
      }
    }

    try {
      const { data: appsByUser } = await supabaseAdmin
        .from("student_applications")
        .select("*")
        .eq("user_id", userId);

      (appsByUser || []).forEach((application) => {
        if (application && typeof application === "object" && "id" in application) {
          applicationMap.set(
            String((application as { id: unknown }).id),
            application
          );
        }
      });
    } catch (appUserError) {
      console.warn("Could not snapshot applications by user:", appUserError);
    }

    const archive = await recordDeletedAccount(supabaseAdmin, {
      userId,
      email: finalEmail,
      fullName: finalFullName,
      role: finalRole,
      userType: accountUserTypeForRole(finalRole),
      profileData: (profileSnapshot || {}) as Record<string, unknown>,
      authData: authSnapshot,
      roleProfileData: roleProfileSnapshot,
      applicationsData: Array.from(applicationMap.values()),
      deletedBy: adminAuth.user.email || "unknown",
      deletedById: adminAuth.user.id,
    });

    if (!archive.success) {
      return NextResponse.json(
        {
          error: archive.tableMissing
            ? "The deleted_accounts table does not exist yet. Run supabase/deleted_accounts_migration.sql in the Supabase SQL Editor, then try again."
            : `Could not archive the deleted account: ${
                archive.error || "Unknown error"
              }`,
        },
        { status: 500 }
      );
    }

    // 1. Student accounts: remove their enrollment records entirely so the
    // student disappears from every staff dashboard, report, and analytics
    // list. The full account (including applications) is already archived in
    // deleted_accounts above, and the student may enroll again later.
    if (finalRole === "student") {
      const cleanupErrors: string[] = [];

      if (finalEmail) {
        const { error: emailDeleteError } = await supabaseAdmin
          .from("student_applications")
          .delete()
          .ilike("email", finalEmail);

        if (emailDeleteError) {
          cleanupErrors.push(emailDeleteError.message);
        }
      }

      const { error: userDeleteError } = await supabaseAdmin
        .from("student_applications")
        .delete()
        .eq("user_id", userId);

      if (userDeleteError) {
        cleanupErrors.push(userDeleteError.message);
      }

      await supabaseAdmin.from("student_profiles").delete().eq("id", userId);

      if (cleanupErrors.length > 0) {
        console.error("Student enrollment cleanup errors:", cleanupErrors);
        return NextResponse.json(
          {
            error: `Could not remove the student's enrollment records: ${cleanupErrors.join(
              "; "
            )}`,
          },
          { status: 500 }
        );
      }
    } else {
      // Non-student accounts: keep any linked enrollment records by unlinking
      // user_id so submitted records and documents are preserved.
      const { error: unlinkError } = await supabaseAdmin
        .from("student_applications")
        .update({ user_id: null })
        .eq("user_id", userId);

      if (unlinkError) {
        console.warn(
          "Notice: unlinking student applications:",
          unlinkError.message
        );
      }
    }

    // 2. Delete Auth account via Supabase Auth Admin API
    const { error: authDeleteError } =
      await supabaseAdmin.auth.admin.deleteUser(userId);

    // If already deleted or user not found, treat gracefully and proceed to clean up profile
    if (
      authDeleteError &&
      !authDeleteError.message?.toLowerCase().includes("not found") &&
      authDeleteError.status !== 404
    ) {
      console.error("Auth delete error:", authDeleteError);
      return NextResponse.json(
        { error: `Could not delete auth account: ${authDeleteError.message}` },
        { status: 500 }
      );
    }

    // 3. Delete profile if still present
    await supabaseAdmin.from("staff_profiles").delete().eq("id", userId);
    await supabaseAdmin.from("profiles").delete().eq("id", userId);

    // 4. Record removed account status (ensures login & password-reset are blocked)
    if (finalEmail) {
      await recordRemovedAccount({
        email: finalEmail,
        userId,
        role: finalRole,
        removedBy: adminAuth.user.email || "unknown",
      });
    }

    // 5. Log the administrative action (safely, won't fail if table missing)
    try {
      await supabaseAdmin.from("activity_logs").insert({
        user_type: "Admin",
        user_email: adminAuth.user.email || "unknown",
        action: `Removed User Account: ${
          finalEmail || userId
        } (${finalRole || "user"})`,
        ip_address: getClientIp(request) || null,
      });
    } catch {
      // Ignore background log error
    }

    return NextResponse.json({
      success: true,
      message:
        finalRole === "student"
          ? `Account for ${
              finalEmail || userId
            } was successfully removed and archived. The student's enrollment records were removed from all staff dashboards, and the student may enroll again in the future.`
          : `Account for ${
              finalEmail || userId
            } was successfully removed and archived. Applications and uploaded documents have been preserved.`,
    });
  } catch (err) {
    console.error("Error in POST /api/admin/users/delete:", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Internal server error" },
      { status: 500 }
    );
  }
}
