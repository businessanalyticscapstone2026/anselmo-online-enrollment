import { NextResponse } from "next/server";
import {
  MfaError,
  getProfileRole,
  isMfaArea,
  isRoleAllowedForArea,
  portalLabelForArea,
  resolveRequestUser,
  sendOtpForArea,
} from "@/lib/auth/mfa";
import { logActivity } from "@/lib/activityLog";
import { getClientIp } from "@/lib/requestIp";

export const runtime = "nodejs";
export const maxDuration = 60;

export async function POST(request: Request) {
  try {
    const body = await request.json().catch(() => ({}));
    const area = (body as { area?: unknown }).area;

    if (!isMfaArea(area)) {
      return NextResponse.json(
        { success: false, error: "Invalid account type." },
        { status: 400 }
      );
    }

    const user = await resolveRequestUser(request);

    if (!user) {
      return NextResponse.json(
        {
          success: false,
          error: "Your session has expired. Please sign in again.",
        },
        { status: 401 }
      );
    }

    const role = await getProfileRole(user.id);

    if (!isRoleAllowedForArea(area, role)) {
      return NextResponse.json(
        {
          success: false,
          error: `This account is not authorized for the ${portalLabelForArea(
            area
          )}.`,
        },
        { status: 403 }
      );
    }

    const email = (user.email || "").trim();

    if (!email) {
      return NextResponse.json(
        {
          success: false,
          error:
            "This account does not have a verified email address. Contact the ICT administrator.",
        },
        { status: 400 }
      );
    }

    const result = await sendOtpForArea({ userId: user.id, email, area });

    await logActivity({
      userType: area === "admin" ? "Admin" : "Staff",
      userEmail: email,
      action:
        area === "admin"
          ? "ICT Admin Requested Email Verification Code"
          : "Staff Requested Email Verification Code",
      details: {
        userId: user.id,
        area,
        ip: getClientIp(request) || null,
        timestamp: new Date().toISOString(),
      },
    });

    return NextResponse.json({
      success: true,
      area,
      email,
      expiresInSeconds: result.expiresInSeconds,
    });
  } catch (error: unknown) {
    if (error instanceof MfaError) {
      return NextResponse.json(
        {
          success: false,
          error: error.message,
          retryAfterSeconds: error.retryAfterSeconds,
        },
        {
          status: error.status,
          headers: error.retryAfterSeconds
            ? { "Retry-After": String(error.retryAfterSeconds) }
            : undefined,
        }
      );
    }

    console.error("MFA send error:", error);
    return NextResponse.json(
      {
        success: false,
        error: "Unable to send a verification code right now.",
      },
      { status: 500 }
    );
  }
}
