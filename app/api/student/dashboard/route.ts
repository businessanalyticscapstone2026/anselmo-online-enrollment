import { NextResponse } from "next/server";
import { getAuthContext } from "@/lib/auth/server";
import { isStudentRole } from "@/lib/auth/roles";
import { getStudentDashboardData } from "@/lib/studentDashboardData";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const auth = await getAuthContext();

    if (!auth.user) {
      return NextResponse.json(
        { success: false, error: "Your session has expired. Please sign in again." },
        { status: 401 }
      );
    }

    if (!isStudentRole(auth.role)) {
      return NextResponse.json(
        { success: false, error: "This account is not authorized." },
        { status: 403 }
      );
    }

    const email = auth.profile?.email || auth.user.email || "";

    const data = await getStudentDashboardData({
      userId: auth.user.id,
      email,
    });

    return NextResponse.json({ success: true, data });
  } catch (error: unknown) {
    console.error("Error in student dashboard route:", error);
    return NextResponse.json(
      {
        success: false,
        error:
          error instanceof Error
            ? error.message
            : "Could not load your enrollment details.",
      },
      { status: 500 }
    );
  }
}
