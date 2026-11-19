import {
  createHash,
  createHmac,
  randomInt,
  randomUUID,
  timingSafeEqual,
} from "crypto";
import type { NextRequest } from "next/server";
import { createMailTransport, escapeHtml, getMailConfig } from "@/lib/mailer";
import { getServiceClient } from "@/lib/auth/mfa";
import type { MfaArea } from "@/lib/auth/mfaToken";

export const DEVICE_COOKIE_NAME = "aasmnhs_device_id";
export const DEVICE_COOKIE_MAX_AGE = 60 * 60 * 24 * 365;

const DEVICE_TTL_SECONDS = 60 * 10;
const DEVICE_TRUST_DAYS = 180;
const DEVICE_MAX_ATTEMPTS = 5;
const DEVICE_RESEND_SECONDS = 60;

type DbError = { code?: string; message?: string } | null;

export class DeviceError extends Error {
  status: number;
  retryAfterSeconds?: number;

  constructor(message: string, status = 500, retryAfterSeconds?: number) {
    super(message);
    this.name = "DeviceError";
    this.status = status;
    this.retryAfterSeconds = retryAfterSeconds;
  }
}

function isMissingTableError(error: DbError): boolean {
  if (!error) return false;

  const code = error.code || "";
  const message = (error.message || "").toLowerCase();

  return (
    code === "42P01" ||
    code === "PGRST205" ||
    message.includes("could not find the table") ||
    message.includes("does not exist")
  );
}

function getSecuritySecret(): string {
  const secret = process.env.MFA_SESSION_SECRET;

  if (!secret) {
    throw new DeviceError(
      "The security service is not configured. Please contact the ICT administrator.",
      500
    );
  }

  return secret;
}

export function deviceCookieOptions() {
  return {
    httpOnly: true,
    sameSite: "lax" as const,
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: DEVICE_COOKIE_MAX_AGE,
  };
}

export function readDeviceId(request: NextRequest): string | null {
  const value = request.cookies.get(DEVICE_COOKIE_NAME)?.value?.trim();

  if (!value || value.length < 8 || value.length > 128) {
    return null;
  }

  return value;
}

export function createDeviceId(): string {
  return randomUUID();
}

function hashDeviceId(deviceId: string): string {
  return createHash("sha256").update(deviceId).digest("hex");
}

function generateCode(): string {
  return randomInt(0, 1_000_000).toString().padStart(6, "0");
}

function hashCode(params: {
  userId: string;
  area: MfaArea;
  deviceId: string;
  code: string;
}): string {
  return createHmac("sha256", getSecuritySecret())
    .update(
      `${params.userId}:${params.area}:${params.deviceId}:${params.code}`
    )
    .digest("hex");
}

function safeEqual(left: string, right: string): boolean {
  if (left.length !== right.length) return false;

  try {
    return timingSafeEqual(Buffer.from(left), Buffer.from(right));
  } catch {
    return false;
  }
}

export type DeviceCheckResult = {
  trusted: boolean;
  skipped?: boolean;
  email: string;
  retryAfterSeconds?: number;
  expiresInSeconds?: number;
};

export async function checkDevice(params: {
  userId: string;
  email: string;
  area: MfaArea;
  deviceId: string;
  userAgent: string;
  ipAddress: string;
}): Promise<DeviceCheckResult> {
  const supabase = getServiceClient();

  if (!supabase) {
    throw new DeviceError(
      "The security service is not configured. Please contact the ICT administrator.",
      500
    );
  }

  const deviceHash = hashDeviceId(params.deviceId);
  const now = new Date();

  const { data: trustedDevice, error: trustedError } = await supabase
    .from("trusted_login_devices")
    .select("id, trusted_until")
    .eq("user_id", params.userId)
    .eq("area", params.area)
    .eq("device_hash", deviceHash)
    .maybeSingle();

  if (trustedError) {
    if (isMissingTableError(trustedError)) {
      return { trusted: true, skipped: true, email: params.email };
    }

    throw new DeviceError(
      "Unable to check this device right now. Please try again.",
      500
    );
  }

  if (trustedDevice) {
    const trustedUntil = new Date(String(trustedDevice.trusted_until ?? ""));

    if (!Number.isNaN(trustedUntil.getTime()) && trustedUntil > now) {
      await supabase
        .from("trusted_login_devices")
        .update({
          last_seen: now.toISOString(),
          user_agent: params.userAgent || null,
          ip_address: params.ipAddress || null,
        })
        .eq("id", trustedDevice.id);

      return { trusted: true, email: params.email };
    }
  }

  const { data: recentChallenge, error: recentError } = await supabase
    .from("device_verification_challenges")
    .select("created_at")
    .eq("user_id", params.userId)
    .eq("area", params.area)
    .eq("device_hash", deviceHash)
    .is("consumed_at", null)
    .gte("expires_at", now.toISOString())
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (recentError) {
    if (isMissingTableError(recentError)) {
      return { trusted: true, skipped: true, email: params.email };
    }

    throw new DeviceError(
      "Unable to check this device right now. Please try again.",
      500
    );
  }

  if (recentChallenge?.created_at) {
    const created = new Date(String(recentChallenge.created_at));
    const elapsed = Math.floor((now.getTime() - created.getTime()) / 1000);

    if (!Number.isNaN(created.getTime()) && elapsed < DEVICE_RESEND_SECONDS) {
      return {
        trusted: false,
        email: params.email,
        retryAfterSeconds: DEVICE_RESEND_SECONDS - Math.max(0, elapsed),
        expiresInSeconds: DEVICE_TTL_SECONDS,
      };
    }
  }

  const code = generateCode();
  const codeHash = hashCode({
    userId: params.userId,
    area: params.area,
    deviceId: params.deviceId,
    code,
  });
  const expiresAt = new Date(now.getTime() + DEVICE_TTL_SECONDS * 1000);

  await supabase
    .from("device_verification_challenges")
    .update({ consumed_at: now.toISOString() })
    .eq("user_id", params.userId)
    .eq("area", params.area)
    .eq("device_hash", deviceHash)
    .is("consumed_at", null);

  const { error: insertError } = await supabase
    .from("device_verification_challenges")
    .insert({
      user_id: params.userId,
      area: params.area,
      device_hash: deviceHash,
      code_hash: codeHash,
      expires_at: expiresAt.toISOString(),
    });

  if (insertError) {
    if (isMissingTableError(insertError)) {
      return { trusted: true, skipped: true, email: params.email };
    }

    throw new DeviceError(
      "Unable to start device verification right now. Please try again.",
      500
    );
  }

  await sendDeviceCodeEmail({
    email: params.email,
    code,
    area: params.area,
    ttlSeconds: DEVICE_TTL_SECONDS,
    userAgent: params.userAgent,
    ipAddress: params.ipAddress,
  });

  return {
    trusted: false,
    email: params.email,
    expiresInSeconds: DEVICE_TTL_SECONDS,
  };
}

export async function verifyDevice(params: {
  userId: string;
  area: MfaArea;
  deviceId: string;
  code: string;
  userAgent: string;
  ipAddress: string;
}): Promise<{ trusted: true; skipped?: boolean }> {
  const supabase = getServiceClient();

  if (!supabase) {
    throw new DeviceError(
      "The security service is not configured. Please contact the ICT administrator.",
      500
    );
  }

  const deviceHash = hashDeviceId(params.deviceId);
  const now = new Date();

  const { data: challenge, error } = await supabase
    .from("device_verification_challenges")
    .select("id, code_hash, attempts, expires_at")
    .eq("user_id", params.userId)
    .eq("area", params.area)
    .eq("device_hash", deviceHash)
    .is("consumed_at", null)
    .gte("expires_at", now.toISOString())
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) {
    if (isMissingTableError(error)) {
      return { trusted: true, skipped: true };
    }

    throw new DeviceError(
      "Unable to verify this device right now. Please try again.",
      500
    );
  }

  if (!challenge) {
    throw new DeviceError(
      "No active device verification code was found. Request a new code.",
      400
    );
  }

  const attempts = Number(challenge.attempts) || 0;

  if (attempts >= DEVICE_MAX_ATTEMPTS) {
    throw new DeviceError(
      "Too many incorrect codes. Request a new code.",
      429,
      300
    );
  }

  const expected = hashCode({
    userId: params.userId,
    area: params.area,
    deviceId: params.deviceId,
    code: params.code,
  });

  if (!safeEqual(expected, String(challenge.code_hash))) {
    const nextAttempts = attempts + 1;

    await supabase
      .from("device_verification_challenges")
      .update({ attempts: nextAttempts })
      .eq("id", challenge.id);

    const remaining = DEVICE_MAX_ATTEMPTS - nextAttempts;

    if (remaining <= 0) {
      throw new DeviceError(
        "Too many incorrect codes. Request a new code.",
        429,
        300
      );
    }

    throw new DeviceError(
      `Incorrect code. ${remaining} attempt${remaining === 1 ? "" : "s"} remaining.`,
      400
    );
  }

  await supabase
    .from("device_verification_challenges")
    .update({ consumed_at: now.toISOString() })
    .eq("id", challenge.id);

  const trustedUntil = new Date(
    now.getTime() + DEVICE_TRUST_DAYS * 24 * 60 * 60 * 1000
  );

  const { error: trustError } = await supabase
    .from("trusted_login_devices")
    .upsert(
      {
        user_id: params.userId,
        area: params.area,
        device_hash: deviceHash,
        user_agent: params.userAgent || null,
        ip_address: params.ipAddress || null,
        last_seen: now.toISOString(),
        trusted_until: trustedUntil.toISOString(),
      },
      { onConflict: "user_id,area,device_hash" }
    );

  if (trustError) {
    if (isMissingTableError(trustError)) {
      return { trusted: true, skipped: true };
    }

    throw new DeviceError(
      "This device was verified but could not be saved. Please try again.",
      500
    );
  }

  return { trusted: true };
}

async function sendDeviceCodeEmail(params: {
  email: string;
  code: string;
  area: MfaArea;
  ttlSeconds: number;
  userAgent: string;
  ipAddress: string;
}): Promise<void> {
  const mailConfig = getMailConfig();

  if (!mailConfig) {
    throw new DeviceError(
      "The email service is not configured. Please contact the school registrar or ICT administrator.",
      500
    );
  }

  const minutes = Math.max(1, Math.round(params.ttlSeconds / 60));
  const safeEmail = escapeHtml(params.email);
  const areaLabel = params.area === "admin" ? "Administrator" : "Staff";
  const deviceLabel = escapeHtml(
    params.userAgent.trim() || "An unrecognized browser"
  );
  const locationLabel = escapeHtml(
    params.ipAddress.trim() || "an unknown network"
  );

  const html = `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>New device verification code</title>
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
                  New Device Security Check
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
                A sign-in to the ${areaLabel} portal using <strong>${safeEmail}</strong> was attempted from a device we do not recognize.
                Enter the verification code below to trust this device and continue.
              </p>
              <div style="margin: 0 0 22px 0; text-align: center;">
                <div style="display: inline-block; padding: 16px 26px; background-color: #f4f9f6; border: 2px dashed #176b4d; border-radius: 12px; font-size: 34px; font-weight: 800; letter-spacing: 10px; color: #063b2b; font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;">
                  ${params.code}
                </div>
              </div>
              <p style="margin: 0 0 16px 0; font-size: 13px; line-height: 1.6; color: #4b5563;">
                This code expires in <strong>${minutes} minute${minutes === 1 ? "" : "s"}</strong> and can only be used once.
              </p>
              <div style="margin: 0 0 18px 0; background-color: #f9fafb; border: 1px solid #e5e7eb; border-radius: 8px; padding: 12px 14px; font-size: 12px; color: #4b5563; line-height: 1.6;">
                <strong>Device:</strong> ${deviceLabel}<br>
                <strong>Network:</strong> ${locationLabel}
              </div>
              <div style="background-color: #fffbeb; border: 1px solid #fef3c7; border-left: 4px solid #f59e0b; padding: 12px 14px; border-radius: 8px; font-size: 12px; color: #92400e; line-height: 1.6;">
                <strong>Security Notice:</strong> If this was not you, do not share this code. Change your password and contact the ICT administrator immediately.
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
      subject: "Your AASMNHS new device verification code",
      html,
      text: [
        "Hello,",
        "",
        `A sign-in to the ${areaLabel} portal using ${params.email} was attempted from a device we do not recognize.`,
        "",
        `Your device verification code is: ${params.code}`,
        `This code expires in ${minutes} minute${minutes === 1 ? "" : "s"} and can only be used once.`,
        "",
        "If this was not you, do not share this code. Change your password and contact the ICT administrator immediately.",
        "",
        "Anselmo A. Sandoval Memorial National High School",
      ].join("\n"),
    });
  } catch (error) {
    console.error("Device verification email dispatch error:", error);
    throw new DeviceError(
      "We could not send the device verification code right now. Please try again in a moment.",
      502
    );
  }
}
