import type { SupabaseClient } from "@supabase/supabase-js";

export type DeletedAccountUserType = "Student" | "Staff" | "Admin" | "User";

export interface DeletedAccountSnapshot {
  userId?: string | null;
  email?: string | null;
  fullName?: string | null;
  role?: string | null;
  userType?: DeletedAccountUserType | string;
  profileData?: Record<string, unknown> | null;
  authData?: Record<string, unknown> | null;
  roleProfileData?: Record<string, unknown> | null;
  applicationsData?: unknown[] | null;
  deletedBy?: string | null;
  deletedById?: string | null;
  notes?: string | null;
}

export function accountUserTypeForRole(role: unknown): DeletedAccountUserType {
  const value = String(role || "").trim().toLowerCase();
  if (["admin", "ict_admin"].includes(value)) return "Admin";
  if (["staff", "registrar"].includes(value)) return "Staff";
  if (value === "student") return "Student";
  return "User";
}

function isMissingTableError(
  error: { code?: string; message?: string } | null
): boolean {
  if (!error) return false;
  const message = String(error.message || "").toLowerCase();
  const code = String(error.code || "");
  return (
    code === "42P01" ||
    code === "PGRST205" ||
    message.includes("schema cache") ||
    message.includes("does not exist") ||
    message.includes("not found")
  );
}

/**
 * Stores a full snapshot of a deleted account so it can be retrieved or
 * restored later. Uses the service role client and never trusts client data.
 */
export async function recordDeletedAccount(
  supabaseAdmin: SupabaseClient,
  snapshot: DeletedAccountSnapshot
): Promise<{ success: boolean; error?: string; tableMissing?: boolean }> {
  const email = String(snapshot.email || "").trim().toLowerCase() || "unknown";

  try {
    const { error } = await supabaseAdmin.from("deleted_accounts").insert({
      user_id: snapshot.userId || null,
      email,
      full_name: snapshot.fullName || null,
      role: snapshot.role || null,
      user_type:
        snapshot.userType || accountUserTypeForRole(snapshot.role),
      profile_data: snapshot.profileData || {},
      auth_data: snapshot.authData || {},
      role_profile_data: snapshot.roleProfileData || {},
      applications_data: snapshot.applicationsData || [],
      deleted_by: snapshot.deletedBy || null,
      deleted_by_id: snapshot.deletedById || null,
      notes: snapshot.notes || null,
    });

    if (error) {
      return {
        success: false,
        error: error.message,
        tableMissing: isMissingTableError(error),
      };
    }

    return { success: true };
  } catch (error) {
    return {
      success: false,
      error:
        error instanceof Error
          ? error.message
          : "Unknown error while archiving the account.",
      tableMissing: isMissingTableError(
        error as { code?: string; message?: string }
      ),
    };
  }
}
