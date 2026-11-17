import { createClient, type User } from "@supabase/supabase-js";
import { getAuthContext } from "@/lib/auth/server";
import { hasValidMfaCookie } from "@/lib/auth/mfaCookie";
import { adminRequiresTotp } from "@/lib/auth/mfaToken";
import { isAdminRole } from "@/lib/auth/roles";
import { readJwtAal } from "@/lib/auth/jwt";

export type AdminAuthResult = {
  authorized: boolean;
  user: User | null;
  error?: string;
};

/**
 * Verifies that an incoming request originates from an authenticated ICT
 * Administrator who has completed email OTP (and, when required, TOTP MFA).
 *
 * Checks both the Authorization: Bearer <access_token> header and cookie-based
 * session, and validates the role using the Service Role Admin client to avoid
 * RLS recursion. Role metadata on the auth user is intentionally NOT trusted;
 * only public.profiles.role authorizes admin access.
 */
export async function verifyAdminRequest(request: Request): Promise<AdminAuthResult> {
  const supabaseUrl =
    process.env.NEXT_PUBLIC_SUPABASE_URL ||
    "https://tmrimwhwwvojbsztnbxf.supabase.co";
  const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  const supabaseAdmin = supabaseKey
    ? createClient(supabaseUrl, supabaseKey, {
        auth: { persistSession: false },
      })
    : null;

  let user: User | null = null;
  let userRole = "";
  let aalLevel = "";

  // 1. Check Authorization: Bearer <token> header from client
  const authHeader = request.headers.get("authorization") || "";
  const bearerToken = authHeader.replace(/^Bearer\s+/i, "").trim();

  if (bearerToken && supabaseAdmin) {
    try {
      const { data, error } = await supabaseAdmin.auth.getUser(bearerToken);
      if (!error && data?.user) {
        user = data.user;
        aalLevel = readJwtAal(bearerToken);
      }
    } catch (tokenErr) {
      console.warn("Notice: Bearer token verification:", tokenErr);
    }
  }

  // 2. Fall back to cookie session if bearer token was not present or valid
  if (!user) {
    try {
      const cookieAuth = await getAuthContext();
      if (cookieAuth.user) {
        user = cookieAuth.user;
        userRole = cookieAuth.role;

        if (adminRequiresTotp()) {
          try {
            const { data, error } =
              await cookieAuth.supabase.auth.mfa.getAuthenticatorAssuranceLevel();
            aalLevel = error ? "" : data?.currentLevel || "";
          } catch {
            aalLevel = "";
          }
        }
      }
    } catch (cookieErr) {
      console.warn("Notice: Cookie session verification:", cookieErr);
    }
  }

  if (!user) {
    return {
      authorized: false,
      user: null,
      error: "Unauthorized. Admin privileges required.",
    };
  }

  // 3. Resolve role from public.profiles using Service Role (bypasses RLS)
  if (!userRole && supabaseAdmin) {
    try {
      const { data: profile } = await supabaseAdmin
        .from("profiles")
        .select("role")
        .eq("id", user.id)
        .maybeSingle();

      if (profile?.role) {
        userRole = String(profile.role).trim().toLowerCase();
      }
    } catch (profileErr) {
      console.warn("Notice: Profile role lookup:", profileErr);
    }
  }

  if (!isAdminRole(userRole)) {
    return {
      authorized: false,
      user,
      error: "Unauthorized. Admin privileges required.",
    };
  }

  // 4. Require the signed MFA cookie issued after email OTP verification.
  const mfaValid = await hasValidMfaCookie("admin", user.id);

  if (!mfaValid) {
    return {
      authorized: false,
      user,
      error:
        "Administrator verification expired. Sign in again to continue.",
    };
  }

  // 5. When TOTP is required, either the session must be at AAL2 or the
  // administrator must hold a full daily pass issued after TOTP today.
  if (adminRequiresTotp() && aalLevel !== "aal2") {
    const fullPass = await hasValidMfaCookie("admin", user.id, {
      requireFull: true,
    });

    if (!fullPass) {
      return {
        authorized: false,
        user,
        error:
          "Two-factor authentication is required. Complete the authenticator step to continue.",
      };
    }
  }

  return { authorized: true, user };
}
