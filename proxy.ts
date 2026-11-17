import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import type { SupabaseClient } from "@supabase/supabase-js";
import { supabaseAnonKey, supabaseUrl } from "@/lib/supabase/config";
import {
  dashboardPathForRole,
  isAdminRole,
  isStaffRole,
  isStudentRole,
  normalizeRole,
} from "@/lib/auth/roles";
import {
  MFA_COOKIE_NAMES,
  adminRequiresTotp,
  verifyMfaToken,
  type MfaArea,
} from "@/lib/auth/mfaToken";
import {
  evaluateEnrollmentAvailability,
  type EnrollmentSettings,
} from "@/lib/enrollmentSettings";

const LOGIN = "/login";
const ADMIN_HOME = "/admin";
const ADMIN_SECURITY = "/admin/security";
const STAFF_HOME = "/staff/dashboard";
const ADMIN_RECOVERY = ["/admin/forgot-password", "/admin/reset-password"];
const STAFF_PUBLIC = [
  "/staff/login",
  "/staff/forgot-password",
  "/staff/reset-password",
];

function redirectWithCookies(
  request: NextRequest,
  target: string,
  response: NextResponse
) {
  const parsed = new URL(target, request.nextUrl.origin);
  const url = request.nextUrl.clone();
  url.pathname = parsed.pathname;
  url.search = parsed.search;

  const redirectResponse = NextResponse.redirect(url);

  response.cookies.getAll().forEach((cookie) => {
    redirectResponse.cookies.set(cookie);
  });

  const cacheControl = response.headers.get("Cache-Control");
  if (cacheControl) {
    redirectResponse.headers.set("Cache-Control", cacheControl);
  }

  return redirectResponse;
}

async function hasValidMfaCookie(
  request: NextRequest,
  area: MfaArea,
  userId: string,
  options?: { requireFull?: boolean }
): Promise<boolean> {
  const token = request.cookies.get(MFA_COOKIE_NAMES[area])?.value;
  return verifyMfaToken(token, { userId, area }, options);
}

async function isSessionAal2(supabase: SupabaseClient): Promise<boolean> {
  try {
    const { data, error } = await supabase.auth.mfa.getAuthenticatorAssuranceLevel();
    return !error && data?.currentLevel === "aal2";
  } catch {
    return false;
  }
}

export async function proxy(request: NextRequest) {
  const pathname = request.nextUrl.pathname;
  const isAdminArea = pathname === "/admin" || pathname.startsWith("/admin/");
  const isStaffArea = pathname === "/staff" || pathname.startsWith("/staff/");
  const isStudentArea =
    pathname === "/student" || pathname.startsWith("/student/");
  const isLogin = pathname === LOGIN;

  // Block direct access to the enrollment flow when the enrollment window is
  // closed or the system availability switch is OFF. The /enroll landing page
  // stays reachable so it can display the closed announcement, and the unified
  // login page is never touched here.
  const isEnrollmentFlow =
    pathname.startsWith("/enroll/") ||
    pathname === "/form" ||
    pathname === "/requirements";

  if (isEnrollmentFlow) {
    const enrollmentSupabase = createServerClient(supabaseUrl, supabaseAnonKey, {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll() {
          // Read-only availability check.
        },
      },
    });

    const { data, error } = await enrollmentSupabase
      .from("enrollment_settings")
      .select("id, enrollment_start_date, enrollment_end_date")
      .eq("id", 1)
      .maybeSingle();

    const availability = evaluateEnrollmentAvailability(
      error ? null : ((data as EnrollmentSettings | null) ?? null)
    );

    if (!availability.isOpen) {
      const url = request.nextUrl.clone();
      url.pathname = "/enroll";
      url.search = `?notice=${availability.reason}`;
      return NextResponse.redirect(url);
    }

    return NextResponse.next({ request });
  }

  if (!isLogin && !isAdminArea && !isStaffArea && !isStudentArea) {
    return NextResponse.next({ request });
  }

  const isAdminLoginAlias = pathname === "/admin/login";
  const isAdminRecovery = ADMIN_RECOVERY.includes(pathname);
  const isAdminSecurity = pathname === ADMIN_SECURITY;
  const isStaffPublic = STAFF_PUBLIC.includes(pathname);

  let response = NextResponse.next({ request });

  const supabase = createServerClient(supabaseUrl, supabaseAnonKey, {
    cookies: {
      getAll() {
        return request.cookies.getAll();
      },
      setAll(cookiesToSet) {
        cookiesToSet.forEach(({ name, value }) => {
          request.cookies.set(name, value);
        });

        response = NextResponse.next({ request });

        cookiesToSet.forEach(({ name, value, options }) => {
          response.cookies.set(name, value, options);
        });
      },
    },
  });

  const {
    data: { user },
    error: userError,
  } = await supabase.auth.getUser();

  if (userError || !user) {
    if (isAdminLoginAlias) {
      return redirectWithCookies(request, `${LOGIN}?area=admin`, response);
    }

    if (pathname === "/staff/login") {
      return redirectWithCookies(request, `${LOGIN}?area=staff`, response);
    }

    if (isLogin || isAdminRecovery || isStaffPublic) {
      return response;
    }

    if (isStudentArea) {
      return redirectWithCookies(
        request,
        `${LOGIN}?area=student&error=session`,
        response
      );
    }

    if (isAdminArea) {
      return redirectWithCookies(
        request,
        `${LOGIN}?area=admin&error=session`,
        response
      );
    }

    return redirectWithCookies(
      request,
      `${LOGIN}?area=staff&error=session`,
      response
    );
  }

  const { data: profile, error: profileError } = await supabase
    .from("profiles")
    .select("role")
    .eq("id", user.id)
    .maybeSingle();

  const role = profileError ? "" : normalizeRole(profile?.role);

  // Legacy login URLs always resolve to the unified page.
  if (isAdminLoginAlias) {
    return redirectWithCookies(request, `${LOGIN}?area=admin`, response);
  }

  if (pathname === "/staff/login") {
    return redirectWithCookies(request, `${LOGIN}?area=staff`, response);
  }

  if (isAdminRecovery || isStaffPublic) {
    return response;
  }

  // Unified login always shows the form. A previous session must never bring
  // the visitor straight back into the account they used before closing the
  // tab, pressing Back, or navigating away without logging out.
  if (isLogin) {
    return response;
  }

  if (isStudentArea) {
    if (isAdminRole(role)) {
      return redirectWithCookies(request, ADMIN_HOME, response);
    }

    if (isStaffRole(role)) {
      return redirectWithCookies(request, STAFF_HOME, response);
    }

    if (!isStudentRole(role)) {
      return redirectWithCookies(
        request,
        `${LOGIN}?area=student&error=unauthorized`,
        response
      );
    }

    return response;
  }

  if (isAdminSecurity) {
    if (!isAdminRole(role)) {
      const ownDashboard = dashboardPathForRole(role);

      if (ownDashboard) {
        return redirectWithCookies(request, ownDashboard, response);
      }

      return redirectWithCookies(
        request,
        `${LOGIN}?area=admin&error=unauthorized`,
        response
      );
    }

    const mfaValid = await hasValidMfaCookie(request, "admin", user.id);

    if (!mfaValid) {
      return redirectWithCookies(
        request,
        `${LOGIN}?area=admin&error=mfa`,
        response
      );
    }

    return response;
  }

  if (isAdminArea) {
    if (!isAdminRole(role)) {
      const ownDashboard = dashboardPathForRole(role);

      if (ownDashboard) {
        return redirectWithCookies(request, ownDashboard, response);
      }

      return redirectWithCookies(
        request,
        `${LOGIN}?area=admin&error=unauthorized`,
        response
      );
    }

    const fullPass = await hasValidMfaCookie(request, "admin", user.id, {
      requireFull: true,
    });

    if (!fullPass) {
      const mfaValid = await hasValidMfaCookie(request, "admin", user.id);

      if (!mfaValid) {
        return redirectWithCookies(
          request,
          `${LOGIN}?area=admin&error=mfa`,
          response
        );
      }

      if (adminRequiresTotp() && !(await isSessionAal2(supabase))) {
        return redirectWithCookies(request, ADMIN_SECURITY, response);
      }
    }

    return response;
  }

  if (isStaffArea) {
    if (!isStaffRole(role)) {
      if (isAdminRole(role)) {
        return redirectWithCookies(request, ADMIN_HOME, response);
      }

      return redirectWithCookies(
        request,
        `${LOGIN}?area=staff&error=unauthorized`,
        response
      );
    }

    const mfaValid = await hasValidMfaCookie(request, "staff", user.id);

    if (!mfaValid) {
      return redirectWithCookies(
        request,
        `${LOGIN}?area=staff&error=mfa`,
        response
      );
    }

    return response;
  }

  return response;
}

export const config = {
  matcher: [
    "/login",
    "/admin/:path*",
    "/staff/:path*",
    "/student/:path*",
    "/enroll/cluster",
    "/enroll/form",
    "/enroll/requirements",
    "/enroll/account",
    "/form",
    "/requirements",
  ],
};
