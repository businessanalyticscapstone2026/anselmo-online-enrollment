import { NextRequest, NextResponse } from "next/server";
import {
  getProfileRole,
  isMfaArea,
  isRoleAllowedForArea,
  logAuthActivity,
  resolveRequestUser,
} from "@/lib/auth/mfa";
import {
  readDeviceId,
  DeviceError,
  verifyDevice,
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

  const payload = body as { area?: unknown; code?: unknown } | null;
  const area = payload?.area;
  const code = typeof payload?.code === "string" ? payload.code.trim() : "";

  if (!isMfaArea(area)) {
    return NextResponse.json(
      { success: false, error: "Choose a valid portal." },
      { status: 400 }
    );
  }

  if (!/^\d{6}$/.test(code)) {
    return NextResponse.json(
      { success: false, error: "Enter the 6-digit device verification code." },
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
  const role = await getProfileRole(user.id);

  if (!isRoleAllowedForArea(area, role)) {
    return NextResponse.json(
      { success: false, error: "This account cannot access that portal." },
      { status: 403 }
    );
  }

  const deviceId = readDeviceId(request);

  if (!deviceId) {
    return NextResponse.json(
      {
        success: false,
        error:
          "This browser is missing its device identifier. Refresh the page and try again.",
      },
      { status: 400 }
    );
  }

  try {
    await verifyDevice({
      userId: user.id,
      area,
      deviceId,
      code,
      userAgent: request.headers.get("user-agent") || "",
      ipAddress: getClientIp(request),
    });

    await logAuthActivity({
      userType: area,
      userEmail: email,
      action: "device_verified",
    });

    return NextResponse.json({ success: true, trusted: true });
  } catch (error) {
    const deviceError =
      error instanceof DeviceError
        ? error
        : new DeviceError(
            "Unable to verify this device right now. Please try again.",
            500
          );

    return NextResponse.json(
      {
        success: false,
        error: deviceError.message,
        retryAfterSeconds: deviceError.retryAfterSeconds,
      },
      { status: deviceError.status }
    );
  }
}
