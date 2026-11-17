import { createClient, type User } from "@supabase/supabase-js";
import { supabaseUrl } from "@/lib/supabase/config";
import { createClient as createServerSupabase } from "@/lib/supabase/server";
import { isAdminRole, isStaffRole, normalizeRole } from "@/lib/auth/roles";
import { createMailTransport, escapeHtml, getMailConfig } from "@/lib/mailer";
import type { MfaArea } from "./mfaToken";

export class MfaError extends Error {
  status: number;
  retryAfterSeconds?: number;

  constructor(message: string, status = 400, retryAfterSeconds?: number) {
    super(message);
    this.name = "MfaError";
    this.status = status;
    this.retryAfterSeconds = retryAfterSeconds;
  }
}

function isMissingTableError(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;

  const code = String((error as { code?: unknown }).code || "");
  const message = String(
    (error as { message?: unknown }).message || ""
  ).toLowerCase();

  return (
    code === "42P01" ||
    code === "PGRST205" ||
    message.includes("schema cache") ||
    message.includes("does not exist")
  );
}

function missingOtpTableError(): MfaError {
  console.error(
    "MFA OTP table is missing. Run supabase/unified_login_mfa_migration.sql in the Supabase SQL Editor."
  );

  return new MfaError(
    "Email verification is not set up yet. Please contact the ICT administrator.",
    503
  );
}

function mailErrorCode(error: unknown): string {
  if (!error || typeof error !== "object") return "";
  return String((error as { code?: unknown }).code || "");
}

type OtpChallengeRow = {
  id: string;
  user_id: string;
  email: string;
  area: MfaArea;
  code_hash: string;
  attempts: number;
  consumed_at: string | null;
  expires_at: string;
  created_at: string;
};

const AREA_POLICY: Record<
  MfaArea,
  {
    ttlSeconds: number;
    maxAttempts: number;
    maxPerHour: number;
    lockoutSeconds: number;
    label: string;
  }
> = {
  staff: {
    ttlSeconds: 10 * 60,
    maxAttempts: 5,
    maxPerHour: 6,
    lockoutSeconds: 5 * 60,
    label: "Staff Portal",
  },
  admin: {
    ttlSeconds: 5 * 60,
    maxAttempts: 3,
    maxPerHour: 4,
    lockoutSeconds: 5 * 60,
    label: "ICT Admin Portal",
  },
};

type OtpLockoutRow = {
  attempts: number;
  consumed_at: string | null;
};

function lockoutRemainingSeconds(
  row: OtpLockoutRow | null,
  policy: (typeof AREA_POLICY)[MfaArea]
): number {
  if (!row || !row.consumed_at || row.attempts < policy.maxAttempts) {
    return 0;
  }

  const lockedUntil =
    Date.parse(row.consumed_at) + policy.lockoutSeconds * 1000;

  if (!Number.isFinite(lockedUntil)) return 0;

  return Math.max(0, Math.ceil((lockedUntil - Date.now()) / 1000));
}

function lockoutError(remainingSeconds: number): MfaError {
  const minutes = Math.max(1, Math.ceil(remainingSeconds / 60));

  return new MfaError(
    `Too many incorrect verification attempts. Please try again in ${minutes} minute${
      minutes === 1 ? "" : "s"
    }.`,
    429,
    remainingSeconds
  );
}

export function isMfaArea(value: unknown): value is MfaArea {
  return value === "staff" || value === "admin";
}

export function isRoleAllowedForArea(area: MfaArea, role: unknown): boolean {
  return area === "admin" ? isAdminRole(role) : isStaffRole(role);
}

export function portalLabelForArea(area: MfaArea): string {
  return AREA_POLICY[area].label;
}

function getMfaSecret(): string {
  return (process.env.MFA_SESSION_SECRET || "").trim();
}

export function getServiceClient() {
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!serviceKey) return null;

  return createClient(supabaseUrl, serviceKey, {
    auth: { persistSession: false },
  });
}

export async function resolveRequestUser(request: Request): Promise<User | null> {
  const authHeader = request.headers.get("authorization") || "";
  const bearerToken = authHeader.replace(/^Bearer\s+/i, "").trim();

  if (bearerToken) {
    const serviceClient = getServiceClient();
    if (serviceClient) {
      try {
        const { data, error } = await serviceClient.auth.getUser(bearerToken);
        if (!error && data?.user) return data.user;
      } catch (error) {
        console.warn("Notice: MFA bearer verification failed:", error);
      }
    }
  }

  try {
    const supabase = await createServerSupabase();
    const { data, error } = await supabase.auth.getUser();
    if (!error && data.user) return data.user;
  } catch (error) {
    console.warn("Notice: MFA cookie verification failed:", error);
  }

  return null;
}

export async function getProfileRole(userId: string): Promise<string> {
  const serviceClient = getServiceClient();
  if (!serviceClient) return "";

  const { data, error } = await serviceClient
    .from("profiles")
    .select("role")
    .eq("id", userId)
    .maybeSingle();

  if (error) {
    console.warn("Notice: MFA profile role lookup failed:", error);
    return "";
  }

  return normalizeRole(data?.role);
}

function generateOtpCode(length = 6): string {
  const values = new Uint32Array(length);
  crypto.getRandomValues(values);

  let code = "";
  for (let index = 0; index < length; index += 1) {
    code += String(values[index] % 10);
  }
  return code;
}

async function hashOtp(params: {
  challengeId: string;
  code: string;
  area: MfaArea;
  userId: string;
}): Promise<string> {
  const secret = getMfaSecret();
  if (!secret) {
    throw new MfaError(
      "Verification is unavailable because MFA_SESSION_SECRET is not configured.",
      500
    );
  }

  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );

  const payload = `${params.challengeId}:${params.area}:${params.userId}:${params.code}`;
  const signature = await crypto.subtle.sign(
    "HMAC",
    key,
    new TextEncoder().encode(payload)
  );

  return Array.from(new Uint8Array(signature))
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

function constantTimeEqual(left: string, right: string): boolean {
  if (left.length !== right.length) return false;

  let mismatch = 0;
  for (let index = 0; index < left.length; index += 1) {
    mismatch |= left.charCodeAt(index) ^ right.charCodeAt(index);
  }
  return mismatch === 0;
}

async function sendOtpEmail(params: {
  email: string;
  code: string;
  area: MfaArea;
  ttlSeconds: number;
}): Promise<void> {
  const mailConfig = getMailConfig();
  if (!mailConfig) {
    throw new MfaError(
      "The email service is not configured. Please contact the school registrar or ICT administrator.",
      500
    );
  }

  const policy = AREA_POLICY[params.area];
  const minutes = Math.max(1, Math.round(params.ttlSeconds / 60));
  const safeEmail = escapeHtml(params.email);
  const safeLabel = escapeHtml(policy.label);

  const html = `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Your AASMNHS verification code</title>
</head>
<body style="margin: 0; padding: 0; background-color: #051a0f; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; color: #1f2937;">
  <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background-color: #051a0f; padding: 30px 15px;">
    <tr>
      <td align="center">
        <table role="presentation" width="100%" style="max-width: 560px; background-color: #ffffff; border-radius: 16px; overflow: hidden; box-shadow: 0 10px 25px rgba(0,0,0,0.3);" cellspacing="0" cellpadding="0">
          <tr>
            <td style="background: linear-gradient(135deg, #063b2b 0%, #176b4d 100%); padding: 32px 28px; text-align: center;">
              <h1 style="margin: 0; color: #ffffff; font-size: 20px; font-weight: 800; line-height: 1.35;">
                Anselmo A. Sandoval Memorial<br>National High School
              </h1>
              <div style="margin-top: 10px; display: inline-block; padding: 4px 14px; background-color: rgba(200, 178, 124, 0.25); border: 1px solid rgba(200, 178, 124, 0.5); border-radius: 20px;">
                <span style="color: #f3ebd9; font-size: 12px; font-weight: 700; letter-spacing: 0.5px; text-transform: uppercase;">
                  ${safeLabel} Security Check
                </span>
              </div>
            </td>
          </tr>
          <tr>
            <td style="padding: 30px 28px; background-color: #ffffff;">
              <p style="margin: 0 0 14px 0; font-size: 15px; line-height: 1.6; color: #111827;">
                Hello,
              </p>
              <p style="margin: 0 0 20px 0; font-size: 14px; line-height: 1.6; color: #4b5563;">
                A sign-in attempt was made for the ${safeLabel} using <strong>${safeEmail}</strong>.
                Enter the one-time verification code below to continue.
              </p>
              <div style="margin: 0 0 22px 0; text-align: center;">
                <div style="display: inline-block; padding: 16px 26px; background-color: #f4f9f6; border: 2px dashed #176b4d; border-radius: 12px; font-size: 34px; font-weight: 800; letter-spacing: 10px; color: #063b2b; font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;">
                  ${params.code}
                </div>
              </div>
              <p style="margin: 0 0 20px 0; font-size: 13px; line-height: 1.6; color: #4b5563;">
                This code expires in <strong>${minutes} minute${minutes === 1 ? "" : "s"}</strong> and can only be used once.
                If you did not try to sign in, do not share this code and contact the ICT administrator immediately.
              </p>
              <div style="background-color: #fffbeb; border: 1px solid #fef3c7; border-left: 4px solid #f59e0b; padding: 12px 14px; border-radius: 8px; font-size: 12px; color: #92400e; line-height: 1.6;">
                <strong>Security Notice:</strong> School staff will never ask you for this code. Never share it.
              </div>
            </td>
          </tr>
          <tr>
            <td style="background-color: #f9fafb; padding: 20px 28px; text-align: center; border-top: 1px solid #e5e7eb;">
              <p style="margin: 0 0 4px 0; font-size: 12px; font-weight: 700; color: #374151;">
                Anselmo A. Sandoval Memorial National High School
              </p>
              <p style="margin: 0; font-size: 11px; color: #9ca3af; line-height: 1.5;">
                Mabini, Batangas • DepEd Region IV-A CALABARZON<br>
                This is an automated security notification. Please do not reply.
              </p>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>
  `;

  const transporter = createMailTransport(mailConfig);

  try {
    await transporter.sendMail({
      from: mailConfig.from,
      to: params.email,
      subject: `Your AASMNHS ${policy.label} verification code`,
      html,
      text: [
        "Hello,",
        "",
        `A sign-in attempt was made for the ${policy.label} using ${params.email}.`,
        "",
        `Your one-time verification code is: ${params.code}`,
        `This code expires in ${minutes} minute${minutes === 1 ? "" : "s"} and can only be used once.`,
        "",
        "If you did not try to sign in, do not share this code and contact the ICT administrator immediately.",
        "",
        "Anselmo A. Sandoval Memorial National High School",
      ].join("\n"),
    });
  } catch (error) {
    console.error("MFA OTP email dispatch error:", error);

    const code = mailErrorCode(error);
    const message = String(
      (error as { message?: unknown }).message || ""
    ).toLowerCase();

    if (
      code === "EAUTH" ||
      code === "535" ||
      message.includes("invalid login") ||
      message.includes("username and password not accepted")
    ) {
      throw new MfaError(
        "The school email account could not authenticate. Please contact the ICT administrator.",
        502
      );
    }

    if (
      code === "ETIMEDOUT" ||
      code === "ESOCKET" ||
      code === "ECONNECTION" ||
      code === "ECONNRESET" ||
      code === "EHOSTUNREACH"
    ) {
      throw new MfaError(
        "The email server did not respond. Please try again in a moment.",
        502
      );
    }

    throw new MfaError(
      "We could not send the verification code right now. Please try again in a moment.",
      502
    );
  }
}

export async function sendOtpForArea(params: {
  userId: string;
  email: string;
  area: MfaArea;
}): Promise<{ expiresInSeconds: number }> {
  const policy = AREA_POLICY[params.area];
  const serviceClient = getServiceClient();

  if (!serviceClient) {
    throw new MfaError(
      "Verification is unavailable because the server is not configured.",
      500
    );
  }

  if (!getMfaSecret()) {
    throw new MfaError(
      "Verification is unavailable because MFA_SESSION_SECRET is not configured.",
      500
    );
  }

  // Make sure the mail service is usable before creating a challenge row.
  if (!getMailConfig()) {
    throw new MfaError(
      "The email service is not configured. Please contact the school registrar or ICT administrator.",
      500
    );
  }

  const now = Date.now();
  const nowIso = new Date(now).toISOString();
  const oneMinuteAgo = new Date(now - 60 * 1000).toISOString();
  const oneHourAgo = new Date(now - 60 * 60 * 1000).toISOString();

  const { data: latestChallenge, error: latestError } = await serviceClient
    .from("login_otp_challenges")
    .select("attempts, consumed_at")
    .eq("user_id", params.userId)
    .eq("area", params.area)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (latestError) {
    console.error("MFA lockout lookup failed:", latestError);
    if (isMissingTableError(latestError)) {
      throw missingOtpTableError();
    }
    throw new MfaError("Unable to start verification right now.", 500);
  }

  const remainingLockout = lockoutRemainingSeconds(
    latestChallenge as OtpLockoutRow | null,
    policy
  );

  if (remainingLockout > 0) {
    throw lockoutError(remainingLockout);
  }

  const { data: recentChallenge, error: recentError } = await serviceClient
    .from("login_otp_challenges")
    .select("id")
    .eq("user_id", params.userId)
    .eq("area", params.area)
    .gte("created_at", oneMinuteAgo)
    .limit(1);

  if (recentError) {
    console.error("MFA rate-limit lookup failed:", recentError);
    if (isMissingTableError(recentError)) {
      throw missingOtpTableError();
    }
    throw new MfaError("Unable to start verification right now.", 500);
  }

  if (recentChallenge && recentChallenge.length > 0) {
    throw new MfaError(
      "A code was just sent. Please wait at least 60 seconds before requesting another.",
      429
    );
  }

  const { count, error: countError } = await serviceClient
    .from("login_otp_challenges")
    .select("id", { count: "exact", head: true })
    .eq("user_id", params.userId)
    .eq("area", params.area)
    .gte("created_at", oneHourAgo);

  if (countError) {
    console.error("MFA hourly-limit lookup failed:", countError);
    if (isMissingTableError(countError)) {
      throw missingOtpTableError();
    }
    throw new MfaError("Unable to start verification right now.", 500);
  }

  if ((count ?? 0) >= policy.maxPerHour) {
    throw new MfaError(
      "Too many verification codes were requested. Please try again later.",
      429
    );
  }

  const challengeId = crypto.randomUUID();
  const code = generateOtpCode(6);
  const codeHash = await hashOtp({
    challengeId,
    code,
    area: params.area,
    userId: params.userId,
  });
  const expiresAt = new Date(now + policy.ttlSeconds * 1000).toISOString();

  const { error: insertError } = await serviceClient
    .from("login_otp_challenges")
    .insert({
      id: challengeId,
      user_id: params.userId,
      email: params.email,
      area: params.area,
      code_hash: codeHash,
      expires_at: expiresAt,
    });

  if (insertError) {
    console.error("MFA challenge insert failed:", insertError);
    if (isMissingTableError(insertError)) {
      throw missingOtpTableError();
    }
    throw new MfaError("Unable to start verification right now.", 500);
  }

  // Only the newest code may remain usable. Otherwise a student could keep an
  // older code active and use it to bypass the attempt limit on a newer code.
  const { error: supersedeError } = await serviceClient
    .from("login_otp_challenges")
    .update({ consumed_at: nowIso })
    .eq("user_id", params.userId)
    .eq("area", params.area)
    .is("consumed_at", null)
    .neq("id", challengeId);

  if (supersedeError) {
    console.warn("MFA old challenge cleanup failed:", supersedeError);
  }

  try {
    await sendOtpEmail({
      email: params.email,
      code,
      area: params.area,
      ttlSeconds: policy.ttlSeconds,
    });
  } catch (error) {
    await serviceClient
      .from("login_otp_challenges")
      .delete()
      .eq("id", challengeId);
    throw error;
  }

  // Best-effort cleanup of stale challenges for this user.
  void serviceClient
    .from("login_otp_challenges")
    .delete()
    .eq("user_id", params.userId)
    .lt("created_at", new Date(now - 2 * 24 * 60 * 60 * 1000).toISOString());

  return { expiresInSeconds: policy.ttlSeconds };
}

export async function verifyOtpForArea(params: {
  userId: string;
  area: MfaArea;
  code: string;
}): Promise<void> {
  const policy = AREA_POLICY[params.area];
  const serviceClient = getServiceClient();

  if (!serviceClient) {
    throw new MfaError(
      "Verification is unavailable because the server is not configured.",
      500
    );
  }

  const code = params.code.replace(/\D+/g, "").trim();
  if (!/^\d{6}$/.test(code)) {
    throw new MfaError("Enter the 6-digit verification code from your email.", 400);
  }

  const nowIso = new Date().toISOString();

  const { data: latestChallenge, error: latestError } = await serviceClient
    .from("login_otp_challenges")
    .select("attempts, consumed_at")
    .eq("user_id", params.userId)
    .eq("area", params.area)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (latestError) {
    console.error("MFA lockout lookup failed:", latestError);
    if (isMissingTableError(latestError)) {
      throw missingOtpTableError();
    }
    throw new MfaError("Unable to verify the code right now.", 500);
  }

  const remainingLockout = lockoutRemainingSeconds(
    latestChallenge as OtpLockoutRow | null,
    policy
  );

  if (remainingLockout > 0) {
    throw lockoutError(remainingLockout);
  }

  const { data, error } = await serviceClient
    .from("login_otp_challenges")
    .select(
      "id, user_id, email, area, code_hash, attempts, consumed_at, expires_at, created_at"
    )
    .eq("user_id", params.userId)
    .eq("area", params.area)
    .is("consumed_at", null)
    .gt("expires_at", nowIso)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) {
    console.error("MFA challenge lookup failed:", error);
    if (isMissingTableError(error)) {
      throw missingOtpTableError();
    }
    throw new MfaError("Unable to verify the code right now.", 500);
  }

  const challenge = data as OtpChallengeRow | null;

  if (!challenge) {
    throw new MfaError(
      "That code has expired or no active code was found. Please request a new code.",
      400
    );
  }

  if (challenge.attempts >= policy.maxAttempts) {
    await serviceClient
      .from("login_otp_challenges")
      .update({
        attempts: policy.maxAttempts + 1,
        consumed_at: nowIso,
      })
      .eq("id", challenge.id);

    throw lockoutError(policy.lockoutSeconds);
  }

  const expectedHash = await hashOtp({
    challengeId: challenge.id,
    code,
    area: params.area,
    userId: params.userId,
  });

  const isMatch = constantTimeEqual(expectedHash, challenge.code_hash);
  const nextAttempts = challenge.attempts + 1;

  if (!isMatch) {
    const reachedLimit = nextAttempts >= policy.maxAttempts;
    const storedAttempts = reachedLimit
      ? policy.maxAttempts + 1
      : nextAttempts;

    const { error: updateError } = await serviceClient
      .from("login_otp_challenges")
      .update({
        attempts: storedAttempts,
        consumed_at: reachedLimit ? nowIso : null,
      })
      .eq("id", challenge.id);

    if (updateError) {
      console.error("MFA attempt update failed:", updateError);
      throw new MfaError("Unable to verify the code right now.", 500);
    }

    if (reachedLimit) {
      throw lockoutError(policy.lockoutSeconds);
    }

    const remaining = Math.max(0, policy.maxAttempts - nextAttempts);

    throw new MfaError(
      `Incorrect code. ${remaining} attempt${remaining === 1 ? "" : "s"} remaining.`,
      400
    );
  }

  const { error: consumeError } = await serviceClient
    .from("login_otp_challenges")
    .update({ attempts: 0, consumed_at: nowIso })
    .eq("id", challenge.id);

  if (consumeError) {
    console.error("MFA challenge consume failed:", consumeError);
    throw new MfaError("Unable to verify the code right now.", 500);
  }
}

export async function logAuthActivity(params: {
  userType: string;
  userEmail: string;
  action: string;
  details?: Record<string, unknown>;
}): Promise<void> {
  const serviceClient = getServiceClient();
  if (!serviceClient) return;

  const ip =
    typeof params.details?.ip === "string" && params.details.ip.trim()
      ? params.details.ip.trim()
      : null;

  const basePayload = {
    user_type: params.userType,
    user_email: params.userEmail,
    action: params.action,
  };

  try {
    const { error } = await serviceClient
      .from("activity_logs")
      .insert({ ...basePayload, ip_address: ip });

    if (error && (error.code === "PGRST204" || error.code === "42703")) {
      await serviceClient.from("activity_logs").insert({
        ...basePayload,
        details: params.details || {},
      });
      return;
    }

    if (error) {
      console.warn("Notice: auth activity log failed:", error.message);
    }
  } catch (error) {
    console.warn("Notice: auth activity log failed:", error);
  }
}
