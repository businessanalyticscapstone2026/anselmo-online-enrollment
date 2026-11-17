import { NextResponse } from "next/server";
import {
  getProfileRole,
  isRoleAllowedForArea,
  portalLabelForArea,
  resolveRequestUser,
} from "@/lib/auth/mfa";
import { logActivity } from "@/lib/activityLog";
import { getClientIp } from "@/lib/requestIp";
import {
  hasEmailVerifiedToday,
  markTotpVerified,
} from "@/lib/auth/dailyPass";
import { hasValidMfaCookie } from "@/lib/auth/mfaCookie";
import {
  MFA_COOKIE_NAMES,
  createMfaToken,
  mfaCookieMaxAgeSeconds,
} from "@/lib/auth/mfaToken";
import { readJwtAal } from "@/lib/auth/jwt";

export const runtime = "nodejs";

export async function POST(request: Request) {
  try {
    const body = await request.json().catch(() => ({}));
    const { area } = body as { area?: unknown };

    if (area !== "admin") {
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

    if (!isRoleAllowedForArea("admin", role)) {
      return NextResponse.json(
        {
          success: false,
          error: `This account is not authorized for the ${portalLabelForArea(
            "admin"
          )}.`,
        },
        { status: 403 }
      );
    }

    const authHeader = request.headers.get("authorization") || "";
    const bearerToken = authHeader.replace(/^Bearer\s+/i, "").trim();

    if (readJwtAal(bearerToken) !== "aal2") {
      return NextResponse.json(
        {
          success: false,
          error: "Complete the authenticator step before continuing.",
        },
        { status: 403 }
      );
    }

    const emailVerified =
      (await hasEmailVerifiedToday(user.id, "admin")) ||
      (await hasValidMfaCookie("admin", user.id));

    if (!emailVerified) {
      return NextResponse.json(
        { success: false, error: "Complete email verification first." },
        { status: 400 }
      );
    }

    await markTotpVerified(user.id, "admin");

    await logActivity({
      userType: "Admin",
      userEmail: user.email || "",
      action: "ICT Admin Completed Two-Factor Authentication",
      details: {
        userId: user.id,
        area: "admin",
        ip: getClientIp(request) || null,
        timestamp: new Date().toISOString(),
      },
    });

    const token = await createMfaToken({
      userId: user.id,
      area: "admin",
      full: true,
    });

    const response = NextResponse.json({
      success: true,
      area: "admin",
      redirect: "/admin",
      dailyPass: true,
    });

    response.cookies.set({
      name: MFA_COOKIE_NAMES.admin,
      value: token,
      httpOnly: true,
      sameSite: "lax",
      secure: process.env.NODE_ENV === "production",
      path: "/",
      maxAge: mfaCookieMaxAgeSeconds(),
    });

    return response;
  } catch (error) {
    console.error("MFA complete error:", error);
    return NextResponse.json(
      { success: false, error: "Unable to finish verification right now." },
      { status: 500 }
    );
  }
}
