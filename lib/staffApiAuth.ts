import { NextResponse } from "next/server";
import type { SupabaseClient } from "@supabase/supabase-js";
import { getAuthContext } from "@/lib/auth/server";
import { hasValidMfaCookie } from "@/lib/auth/mfaCookie";
import { isAdminRole, isStaffRole } from "@/lib/auth/roles";
import { getServiceClient } from "@/lib/auth/mfa";

export type StaffApiSession = {
  userId: string;
  email: string;
  role: string;
  supabase: SupabaseClient;
};

type StaffApiAuthResult =
  | { session: StaffApiSession }
  | { response: NextResponse };

/**
 * Shared guard for the staff-only API routes added by the walk-in module.
 * Mirrors the checks used by /api/staff/update-status and assign-section:
 * authenticated user, staff/admin role, and a valid staff MFA cookie.
 */
export async function requireStaffApi(): Promise<StaffApiAuthResult> {
  const auth = await getAuthContext();

  if (!auth.user) {
    return {
      response: NextResponse.json(
        {
          success: false,
          error: "Your staff session has expired. Please sign in again.",
        },
        { status: 401 }
      ),
    };
  }

  if (!isStaffRole(auth.role) && !isAdminRole(auth.role)) {
    return {
      response: NextResponse.json(
        {
          success: false,
          error: "This account is not authorized to manage walk-in students.",
        },
        { status: 403 }
      ),
    };
  }

  const mfaArea = isAdminRole(auth.role) ? "admin" : "staff";
  const mfaValid = await hasValidMfaCookie(mfaArea, auth.user.id);

  if (!mfaValid) {
    return {
      response: NextResponse.json(
        {
          success: false,
          error:
            "Your verification has expired. Sign in again through the portal to continue.",
        },
        { status: 403 }
      ),
    };
  }

  const supabase = getServiceClient();

  if (!supabase) {
    return {
      response: NextResponse.json(
        {
          success: false,
          error: "Supabase service configuration is missing.",
        },
        { status: 500 }
      ),
    };
  }

  return {
    session: {
      userId: auth.user.id,
      email: auth.user.email || "",
      role: auth.role,
      supabase,
    },
  };
}

export function isMissingWalkInSchema(error: {
  code?: string;
  message?: string;
} | null): boolean {
  if (!error) return false;

  const message = String(error.message || "");

  return (
    error.code === "PGRST204" ||
    error.code === "42703" ||
    /enrollment_type|walk_in_reference|encoded_by|encoded_at/i.test(message)
  );
}

export function walkInSchemaHint(): string {
  return "The walk-in database columns are missing. Run supabase/walk_in_enrollment_migration.sql in the Supabase SQL editor, then refresh the schema cache.";
}
