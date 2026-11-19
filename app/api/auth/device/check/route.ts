import { NextRequest, NextResponse } from "next/server";
import {
  getProfileRole,
  isMfaArea,
  isRoleAllowedForArea,
  logAuthActivity,
  resolveRequestUser,
} from "@/lib/auth/mfa";
import {
  checkDevice,
  createDeviceId,
  DEVICE_COOKIE_NAME,
  deviceCookieOptions,
  DeviceError,
  readDeviceId,
} from "@/lib/auth/device";
import { getClientIp } from "@/lib/requestIp";

export const runtime = "nodejs";
export const maxDuration = 60;

export async function POST(request: NextRequest) {
  let body: unknown;

  try {
    body = await request.json();
  } catch {
    return NextResponse.json(
      { success: false, error: "Invalid request." },
      { status: 400 }
    );
  }

  const area = (body as { area?: unknown } | null)?.area;

  if (!isMfaArea(area)) {
    return NextResponse.json(
      { success: false, error: "Choose a valid portal." },
      { status: 400 }
    );
  }

  const user = await resolveRequestUser(request);

  if (!user) {
    return NextResponse.json(
      { success: false, error: "Your session expired. Please sign in again." },
      { status: 401 }
    );
  }

  const email = (user.email || "").trim();

  if (!email) {
    return NextResponse.json(
      { success: false, error: "This account has no email address." },
      { status: 400 }
    );
  }

  const role = await getProfileRole(user.id);

  if (!isRoleAllowedForArea(area, role)) {
    return NextResponse.json(
      { success: false, error: "This account cannot access that portal." },
      { status: 403 }
    );
  }

  const existingDeviceId = readDeviceId(request);
  const deviceId = existingDeviceId ?? createDeviceId();

  try {
    const result = await checkDevice({
      userId: user.id,
      email,
      area,
      deviceId,
      userAgent: request.headers.get("user-agent") || "",
      ipAddress: getClientIp(request),
    });

    if (!result.trusted) {
      await logAuthActivity({
        userType: area,
        userEmail: email,
        action: "device_challenge_sent",
      });
    }

    const response = NextResponse.json({ success: true, ...result });

    if (!existingDeviceId) {
      response.cookies.set(
        DEVICE_COOKIE_NAME,
        deviceId,
        deviceCookieOptions()
      );
    }

    return response;
  } catch (error) {
    const deviceError =
      error instanceof DeviceError
        ? error
        : new DeviceError(
            "Unable to verify this device right now. Please try again.",
            500
          );

    const response = NextResponse.json(
      {
        success: false,
        error: deviceError.message,
        retryAfterSeconds: deviceError.retryAfterSeconds,
      },
      { status: deviceError.status }
    );

    if (!existingDeviceId) {
      response.cookies.set(
        DEVICE_COOKIE_NAME,
        deviceId,
        deviceCookieOptions()
      );
    }

    return response;
  }
}
