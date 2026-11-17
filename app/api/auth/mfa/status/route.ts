import { NextResponse } from "next/server";
import {
  getProfileRole,
  isMfaArea,
  isRoleAllowedForArea,
  portalLabelForArea,
  resolveRequestUser,
} from "@/lib/auth/mfa";
import {
  hasEmailVerifiedToday,
  hasFullDailyPass,
} from "@/lib/auth/dailyPass";
import {
  MFA_COOKIE_NAMES,
  adminRequiresTotp,
  createMfaToken,
  mfaCookieMaxAgeSeconds,
} from "@/lib/auth/mfaToken";

export const runtime = "nodejs";

export async function POST(request: Request) {
  try {
    const body = await request.json().catch(() => ({}));
    const { area } = body as { area?: unknown };

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

    const full = await hasFullDailyPass(user.id, area);
    const emailVerified = full || (await hasEmailVerifiedToday(user.id, area));
    const status = full ? "full" : emailVerified ? "email" : "none";

    const response = NextResponse.json({
      success: true,
      area,
      status,
      requiresTotp: area === "admin" && adminRequiresTotp(),
    });

    if (status !== "none") {
      const token = await createMfaToken({ userId: user.id, area, full });

      response.cookies.set({
        name: MFA_COOKIE_NAMES[area],
        value: token,
        httpOnly: true,
        sameSite: "lax",
        secure: process.env.NODE_ENV === "production",
        path: "/",
        maxAge: mfaCookieMaxAgeSeconds(),
      });
    }

    return response;
  } catch (error) {
    console.error("MFA status error:", error);
    return NextResponse.json(
      {
        success: false,
        error: "Unable to check your verification status right now.",
      },
      { status: 500 }
    );
  }
}
