import { NextResponse } from "next/server";
import {
  activityLabelForRole,
  logActivity,
  userTypeForRole,
} from "@/lib/activityLog";
import {
  getProfileRole,
  resolveRequestUser,
} from "@/lib/auth/mfa";
import { getClientIp } from "@/lib/requestIp";

export const runtime = "nodejs";

type SessionEvent = "signin" | "signout" | "password-reset";

/**
 * Records portal sign-in / sign-out / password-reset events for every role.
 * Identity is derived from the verified session so the client cannot attribute
 * an event to another account.
 */
export async function POST(request: Request) {
  try {
    const body = await request.json().catch(() => ({}));
    const event = (body as { event?: SessionEvent }).event;

    if (
      event !== "signin" &&
      event !== "signout" &&
      event !== "password-reset"
    ) {
      return NextResponse.json(
        { success: false, error: "A valid session event is required." },
        { status: 400 }
      );
    }

    const user = await resolveRequestUser(request);

    if (!user) {
      return NextResponse.json({ success: true, skipped: true });
    }

    const role = await getProfileRole(user.id);
    const label = activityLabelForRole(role);
    const action =
      event === "password-reset"
        ? `${label} Reset Password`
        : `${label} Signed ${event === "signout" ? "Out" : "In"}`;

    await logActivity({
      userType: userTypeForRole(role),
      userEmail: user.email || "",
      action,
      details: {
        userId: user.id,
        role: role || null,
        event,
        ip: getClientIp(request) || null,
        userAgent: request.headers.get("user-agent") || null,
        timestamp: new Date().toISOString(),
      },
    });

    return NextResponse.json({ success: true });
  } catch (error) {
    console.warn("Notice in POST /api/auth/activity:", error);
    return NextResponse.json({ success: true });
  }
}
