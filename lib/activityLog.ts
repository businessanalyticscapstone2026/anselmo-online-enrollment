import {
  getProfileRole,
  getServiceClient,
  resolveRequestUser,
} from "@/lib/auth/mfa";
import { isAdminRole, isStaffRole, isStudentRole } from "@/lib/auth/roles";
import { getClientIp } from "@/lib/requestIp";

export type ActivityUserType = "Student" | "Staff" | "Admin" | "User";

export function userTypeForRole(role: unknown): ActivityUserType {
  if (isAdminRole(role)) return "Admin";
  if (isStaffRole(role)) return "Staff";
  if (isStudentRole(role)) return "Student";
  return "User";
}

export function activityLabelForRole(role: unknown): string {
  if (isAdminRole(role)) return "ICT Admin";
  if (isStaffRole(role)) return "Staff";
  if (isStudentRole(role)) return "Student";
  return "User";
}

function ipFromDetails(details?: Record<string, unknown>): string | null {
  const ip = details?.ip;
  return typeof ip === "string" && ip.trim() ? ip.trim() : null;
}

function isMissingColumn(
  error: { code?: string; message?: string } | null,
  column: string
): boolean {
  if (!error) return false;
  return (
    error.code === "PGRST204" ||
    error.code === "42703" ||
    String(error.message || "").toLowerCase().includes(column.toLowerCase())
  );
}

/**
 * Writes a single row to public.activity_logs using the service role so the
 * log is never blocked by RLS. Logging is best-effort and never throws.
 *
 * The live schema stores the IP in ip_address. The details fallback keeps
 * logging working on databases that have not run simplify_activity_logs.sql
 * yet.
 */
export async function logActivity(params: {
  userType: ActivityUserType | string;
  userEmail: string;
  action: string;
  details?: Record<string, unknown>;
}): Promise<boolean> {
  const serviceClient = getServiceClient();
  if (!serviceClient) return false;

  const email = (params.userEmail || "").trim();
  if (!email) return false;

  const basePayload = {
    user_type: params.userType,
    user_email: email,
    action: params.action,
  };

  try {
    const { error } = await serviceClient.from("activity_logs").insert({
      ...basePayload,
      ip_address: ipFromDetails(params.details),
    });

    if (error && isMissingColumn(error, "ip_address")) {
      const { error: fallbackError } = await serviceClient
        .from("activity_logs")
        .insert({
          ...basePayload,
          details: params.details || {},
        });

      if (fallbackError) {
        console.warn("Activity log insert failed:", fallbackError.message);
        return false;
      }

      return true;
    }

    if (error) {
      console.warn("Activity log insert failed:", error.message);
      return false;
    }

    return true;
  } catch (error) {
    console.warn("Activity log insert failed:", error);
    return false;
  }
}

/**
 * Resolves the caller from the request (bearer token or cookie session), then
 * records the action with identity derived server-side. If no session exists
 * and an explicit email was supplied (e.g. a guest action), that email is used.
 */
export async function logRequestActivity(
  request: Request,
  params: {
    action: string;
    details?: Record<string, unknown>;
    userType?: ActivityUserType | string;
    userEmail?: string;
  }
): Promise<boolean> {
  const user = await resolveRequestUser(request);

  if (!user) {
    if (!params.userEmail) return false;

    return logActivity({
      userType: params.userType || "User",
      userEmail: params.userEmail,
      action: params.action,
      details: {
        ip: getClientIp(request) || null,
        ...params.details,
      },
    });
  }

  const role = await getProfileRole(user.id);

  return logActivity({
    userType: params.userType || userTypeForRole(role),
    userEmail: user.email || params.userEmail || "",
    action: params.action,
    details: {
      userId: user.id,
      role: role || null,
      ip: getClientIp(request) || null,
      ...params.details,
    },
  });
}
