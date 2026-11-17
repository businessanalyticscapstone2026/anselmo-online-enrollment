export const STAFF_PORTAL_ROLES = ["staff", "registrar"] as const;
export const ADMIN_PORTAL_ROLES = ["admin", "ict_admin"] as const;

export type PortalArea = "staff" | "admin";
export type LoginArea = "student" | PortalArea;

export function normalizeRole(value: unknown): string {
  return String(value ?? "").trim().toLowerCase();
}

export function isStaffRole(role: unknown): boolean {
  return STAFF_PORTAL_ROLES.includes(
    normalizeRole(role) as (typeof STAFF_PORTAL_ROLES)[number]
  );
}

export function isAdminRole(role: unknown): boolean {
  return ADMIN_PORTAL_ROLES.includes(
    normalizeRole(role) as (typeof ADMIN_PORTAL_ROLES)[number]
  );
}

export function isStudentRole(role: unknown): boolean {
  return normalizeRole(role) === "student";
}

export function dashboardPathForRole(role: unknown): string | null {
  if (isAdminRole(role)) return "/admin";
  if (isStaffRole(role)) return "/staff/dashboard";
  return null;
}

/**
 * Maps a verified profile role to the portal it belongs to. Returns null for
 * unknown/empty roles so callers can fail closed instead of assuming Student.
 */
export function portalAreaForRole(role: unknown): LoginArea | null {
  const normalized = normalizeRole(role);

  if (normalized === "admin" || normalized === "ict_admin") return "admin";
  if (normalized === "staff" || normalized === "registrar") return "staff";
  if (normalized === "student") return "student";

  return null;
}

export function loginPathForArea(area: PortalArea): string {
  return `/login?area=${area}`;
}

export function loginPathForAreaWithError(
  area: PortalArea,
  error: "session" | "unauthorized" | "mfa"
): string {
  return `/login?area=${area}&error=${error}`;
}
