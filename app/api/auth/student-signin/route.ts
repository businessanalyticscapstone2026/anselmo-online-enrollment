import { NextResponse } from "next/server";
import {
  getProfileRole,
  getServiceClient,
  resolveRequestUser,
} from "@/lib/auth/mfa";
import { classifyDatabaseError } from "@/lib/supabase/errors";
import { getClientIp } from "@/lib/requestIp";

export const runtime = "nodejs";

/**
 * Records a successful student sign-in in the activity log.
 *
 * Students authenticate client-side, and RLS only allows staff/admin sessions
 * to insert into activity_logs, so this route verifies the session server-side
 * and writes the row with the service role. Identity and action are derived
 * from the verified user so clients cannot forge log entries.
 */
export async function POST(request: Request) {
  try {
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

    if (role !== "student") {
      return NextResponse.json(
        {
          success: false,
          error: "This endpoint is only available to student accounts.",
        },
        { status: 403 }
      );
    }

    const email = (user.email || "").trim();

    if (!email) {
      return NextResponse.json({ success: true, skipped: true });
    }

    const serviceClient = getServiceClient();

    if (!serviceClient) {
      return NextResponse.json({ success: true, skipped: true });
    }

    const { error } = await serviceClient.from("activity_logs").insert({
      user_type: "Student",
      user_email: email,
      action: "Student Signed In",
      ip_address: getClientIp(request) || null,
    });

    if (error) {
      if (classifyDatabaseError(error) === "table_missing") {
        return NextResponse.json({ success: true, tableMissing: true });
      }

      console.warn("Student sign-in activity log failed:", error);
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    console.warn("Notice in POST /api/auth/student-signin:", error);
    return NextResponse.json({ success: true });
  }
}
