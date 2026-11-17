import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { supabaseUrl } from "@/lib/supabase/config";
import { getManilaDate } from "./manilaDay";
import { adminRequiresTotp, type MfaArea } from "./mfaToken";

export type DailyPass = {
  user_id: string;
  area: MfaArea;
  pass_date: string;
  email_verified_at: string | null;
  totp_verified_at: string | null;
};

function getServiceClient(): SupabaseClient | null {
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!serviceKey) return null;

  return createClient(supabaseUrl, serviceKey, {
    auth: { persistSession: false },
  });
}

function isMissingTableError(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const code = (error as { code?: string }).code;
  return code === "42P01" || code === "PGRST205";
}

export async function getDailyPass(
  userId: string,
  area: MfaArea
): Promise<DailyPass | null> {
  const client = getServiceClient();
  if (!client) return null;

  const { data, error } = await client
    .from("login_daily_passes")
    .select("user_id, area, pass_date, email_verified_at, totp_verified_at")
    .eq("user_id", userId)
    .eq("area", area)
    .eq("pass_date", getManilaDate())
    .maybeSingle();

  if (error) {
    if (!isMissingTableError(error)) {
      console.warn("Daily MFA pass lookup failed:", error);
    }
    return null;
  }

  return (data as DailyPass | null) ?? null;
}

export async function hasEmailVerifiedToday(
  userId: string,
  area: MfaArea
): Promise<boolean> {
  const pass = await getDailyPass(userId, area);
  return Boolean(pass?.email_verified_at);
}

/**
 * A full pass means the user can skip verification for the rest of the Manila
 * day. Staff only need the email code; admins also need TOTP when it is
 * enforced.
 */
export async function hasFullDailyPass(
  userId: string,
  area: MfaArea
): Promise<boolean> {
  const pass = await getDailyPass(userId, area);
  if (!pass?.email_verified_at) return false;
  if (area === "staff") return true;
  if (!adminRequiresTotp()) return true;
  return Boolean(pass.totp_verified_at);
}

export async function markEmailVerified(
  userId: string,
  area: MfaArea
): Promise<void> {
  const client = getServiceClient();
  if (!client) return;

  const pass = await getDailyPass(userId, area);
  const now = new Date().toISOString();

  if (!pass) {
    const { error } = await client.from("login_daily_passes").insert({
      user_id: userId,
      area,
      pass_date: getManilaDate(),
      email_verified_at: now,
      totp_verified_at: null,
    });

    if (error && !isMissingTableError(error)) {
      console.warn("Daily MFA pass insert failed:", error);
    }
    return;
  }

  if (pass.email_verified_at) return;

  const { error } = await client
    .from("login_daily_passes")
    .update({ email_verified_at: now })
    .eq("user_id", userId)
    .eq("area", area)
    .eq("pass_date", pass.pass_date);

  if (error) {
    console.warn("Daily MFA pass email update failed:", error);
  }
}

export async function markTotpVerified(
  userId: string,
  area: MfaArea
): Promise<void> {
  const client = getServiceClient();
  if (!client) return;

  const pass = await getDailyPass(userId, area);
  const now = new Date().toISOString();

  if (!pass) {
    const { error } = await client.from("login_daily_passes").insert({
      user_id: userId,
      area,
      pass_date: getManilaDate(),
      email_verified_at: now,
      totp_verified_at: now,
    });

    if (error && !isMissingTableError(error)) {
      console.warn("Daily MFA pass insert failed:", error);
    }
    return;
  }

  const { error } = await client
    .from("login_daily_passes")
    .update({
      email_verified_at: pass.email_verified_at ?? now,
      totp_verified_at: pass.totp_verified_at ?? now,
    })
    .eq("user_id", userId)
    .eq("area", area)
    .eq("pass_date", pass.pass_date);

  if (error) {
    console.warn("Daily MFA pass TOTP update failed:", error);
  }
}
