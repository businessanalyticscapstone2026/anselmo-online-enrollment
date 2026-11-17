import { cookies } from "next/headers";
import { MFA_COOKIE_NAMES, verifyMfaToken, type MfaArea } from "./mfaToken";

/**
 * Reads the signed, HttpOnly MFA cookie for a portal and verifies that it was
 * issued for this exact user and area. Must only be used in server contexts
 * (route handlers, server components, server actions).
 */
export async function hasValidMfaCookie(
  area: MfaArea,
  userId: string,
  options?: { requireFull?: boolean }
): Promise<boolean> {
  const cookieStore = await cookies();
  const token = cookieStore.get(MFA_COOKIE_NAMES[area])?.value;
  return verifyMfaToken(token, { userId, area }, options);
}
