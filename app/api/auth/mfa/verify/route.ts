import { NextResponse } from "next/server";
import {
  MfaError,
  getProfileRole,
  isMfaArea,
  isRoleAllowedForArea,
  logAuthActivity,
  portalLabelForArea,
  resolveRequestUser,
  verifyOtpForArea,
} from "@/lib/auth/mfa";
import {
  MFA_COOKIE_NAMES,
  adminRequiresTotp,
  createMfaToken,
  mfaCookieMaxAgeSeconds,
} from "@/lib/auth/mfaToken";
import { markEmailVerified } from "@/lib/auth/dailyPass";
import { getClientIp } from "@/lib/requestIp";

export const runtime = "nodejs";

export async function POST(request: Request) {
  try {
    const body = await request.json().catch(() => ({}));
    const { area, code } = body as { area?: unknown; code?: unknown };

    if (!isMfaArea(area)) {
      return NextResponse.json(
        { success: false, error: "Invalid account type." },
        { status: 400 }
      );
    }

    if (typeof code !== "string" || !code.trim()) {
      return NextResponse.json(
        { success: false, error: "Enter the 6-digit verification code." },
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

    await verifyOtpForArea({ userId: user.id, area, code });
    await markEmailVerified(user.id, area);

    const requiresTotp = area === "admin" && adminRequiresTotp();
    const full = !requiresTotp;

    const token = await createMfaToken({ userId: user.id, area, full });
    const maxAge = mfaCookieMaxAgeSeconds();

    const response = NextResponse.json({
      success: true,
      area,
      redirect: area === "admin" ? "/admin" : "/staff/dashboard",
      requiresTotp,
      dailyPass: full,
    });

    response.cookies.set({
      name: MFA_COOKIE_NAMES[area],
      value: token,
      httpOnly: true,
      sameSite: "lax",
      secure: process.env.NODE_ENV === "production",
      path: "/",
      maxAge,
    });

    void logAuthActivity({
      userType: area === "admin" ? "Admin" : "Staff",
      userEmail: (user.email || "").trim() || "unknown",
      action:
        area === "admin"
          ? "ICT Admin Passed Email Verification"
          : "Staff Portal Passed Email Verification",
      details: {
        userId: user.id,
        area,
        ip: getClientIp(request) || null,
        timestamp: new Date().toISOString(),
      },
    });

    return response;
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

    console.error("MFA verify error:", error);
    return NextResponse.json(
      {
        success: false,
        error: "Unable to verify the code right now.",
      },
      { status: 500 }
    );
  }
}
