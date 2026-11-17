import { supabase } from "@/lib/supabaseClient";

type AssuranceLevel = "aal1" | "aal2" | null;

function decodeAssuranceLevel(accessToken: string): AssuranceLevel {
  try {
    const payload = accessToken.split(".")[1];
    if (!payload) return null;

    const normalized = payload.replace(/-/g, "+").replace(/_/g, "/");
    const padded = normalized.padEnd(
      normalized.length + ((4 - (normalized.length % 4)) % 4),
      "="
    );
    const parsed = JSON.parse(atob(padded)) as { aal?: unknown };

    if (parsed.aal === "aal2") return "aal2";
    if (parsed.aal === "aal1") return "aal1";
    return null;
  } catch {
    return null;
  }
}

export async function hasVerifiedTotpFactor(): Promise<boolean> {
  const { data, error } = await supabase.auth.mfa.listFactors();

  if (error) return false;

  return (data?.all ?? []).some(
    (factor) => factor.factor_type === "totp" && factor.status === "verified"
  );
}

/**
 * Returns true when the current session belongs to an account with a verified
 * TOTP factor but has not yet reached AAL2.
 *
 * `getAuthenticatorAssuranceLevel()` derives the next level from
 * `session.user.factors`, which is frequently empty on password-recovery
 * sessions. `listFactors()` queries the Auth server directly, so it is the
 * reliable source of truth here.
 */
export async function needsMfaStepUp(accessToken: string): Promise<boolean> {
  const { data, error } = await supabase.auth.mfa.listFactors();

  if (error) {
    const { data: aalData } =
      await supabase.auth.mfa.getAuthenticatorAssuranceLevel(accessToken);

    return (
      aalData?.nextLevel === "aal2" && aalData?.currentLevel !== "aal2"
    );
  }

  const hasVerifiedTotp = (data?.all ?? []).some(
    (factor) => factor.factor_type === "totp" && factor.status === "verified"
  );

  if (!hasVerifiedTotp) return false;

  const currentLevel = decodeAssuranceLevel(accessToken);

  if (currentLevel === "aal2") return false;
  if (currentLevel === "aal1") return true;

  const { data: aalData } =
    await supabase.auth.mfa.getAuthenticatorAssuranceLevel(accessToken);

  return aalData?.currentLevel !== "aal2";
}
