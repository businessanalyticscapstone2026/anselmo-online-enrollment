import { cache } from "react";
import { redirect } from "next/navigation";
import type { SupabaseClient, User } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/server";
import { hasValidMfaCookie } from "@/lib/auth/mfaCookie";
import {
  adminRequiresTotp,
  MFA_COOKIE_NAMES,
  verifyMfaToken,
} from "@/lib/auth/mfaToken";
import { cookies } from "next/headers";
import {
  isAdminRole,
  isStaffRole,
  isStudentRole,
  loginPathForAreaWithError,
  normalizeRole,
  type PortalArea,
} from "@/lib/auth/roles";

export type ProfileSummary = {
  id: string;
  full_name: string | null;
  email: string | null;
  role: string | null;
};

export type AuthContext = {
  supabase: SupabaseClient;
  user: User | null;
  profile: ProfileSummary | null;
  role: string;
};

export const getAuthContext = cache(async (): Promise<AuthContext> => {
  const supabase = await createClient();

  const {
    data: { user },
    error: userError,
  } = await supabase.auth.getUser();

  if (userError || !user) {
    return { supabase, user: null, profile: null, role: "" };
  }

  const { data: profile, error: profileError } = await supabase
    .from("profiles")
    .select("id, full_name, email, role")
    .eq("id", user.id)
    .maybeSingle();

  if (profileError || !profile) {
    return { supabase, user, profile: null, role: "" };
  }

  return {
    supabase,
    user,
    profile: profile as ProfileSummary,
    role: normalizeRole(profile.role),
  };
});

async function hasAdminAal2(supabase: SupabaseClient): Promise<boolean> {
  try {
    const { data, error } = await supabase.auth.mfa.getAuthenticatorAssuranceLevel();
    return !error && data?.currentLevel === "aal2";
  } catch {
    return false;
  }
}

export async function requireStudentAccess() {
  const context = await getAuthContext();

  if (!context.user) {
    redirect("/login?area=student&error=session");
  }

  if (isAdminRole(context.role)) {
    redirect("/admin");
  }

  if (isStaffRole(context.role)) {
    redirect("/staff/dashboard");
  }

  if (!isStudentRole(context.role)) {
    redirect("/login?area=student&error=unauthorized");
  }

  return context;
}

export async function requirePortalAccess(area: PortalArea) {
  const context = await getAuthContext();
  const loginPath = loginPathForAreaWithError(area, "unauthorized");

  if (!context.user) {
    redirect(loginPathForAreaWithError(area, "session"));
  }

  if (area === "admin" && !isAdminRole(context.role)) {
    if (isStaffRole(context.role)) {
      redirect("/staff/dashboard");
    }

    redirect(loginPath);
  }

  if (area === "staff" && !isStaffRole(context.role)) {
    if (isAdminRole(context.role)) {
      redirect("/admin");
    }

    redirect(loginPath);
  }

  const mfaValid = await hasValidMfaCookie(area, context.user.id);

  if (!mfaValid) {
    redirect(loginPathForAreaWithError(area, "mfa"));
  }

  if (area === "admin" && adminRequiresTotp()) {
    const fullPass = await hasValidMfaCookie("admin", context.user.id, {
      requireFull: true,
    });

    if (!fullPass && !(await hasAdminAal2(context.supabase))) {
      redirect("/admin/security");
    }
  }

  return context;
}

/**
 * Access guard for /admin/security. The administrator must have passed email
 * OTP verification, but is intentionally allowed in before reaching AAL2 so
 * they can enroll an authenticator app.
 */
export async function requireAdminSetupAccess() {
  const context = await getAuthContext();

  if (!context.user) {
    redirect(loginPathForAreaWithError("admin", "session"));
  }

  if (!isAdminRole(context.role)) {
    if (isStaffRole(context.role)) {
      redirect("/staff/dashboard");
    }

    redirect(loginPathForAreaWithError("admin", "unauthorized"));
  }

  const cookieStore = await cookies();
  const token = cookieStore.get(MFA_COOKIE_NAMES.admin)?.value;
  const mfaValid = await verifyMfaToken(token, {
    userId: context.user.id,
    area: "admin",
  });

  if (!mfaValid) {
    redirect(loginPathForAreaWithError("admin", "mfa"));
  }

  return context;
}
