import { NextResponse } from "next/server";
import { isAccountRemoved } from "@/lib/removedAccounts";

export const runtime = "nodejs";

export async function POST(request: Request) {
  try {
    const body = await request.json().catch(() => ({}));
    const email =
      typeof body.email === "string" ? body.email.trim().toLowerCase() : "";

    if (!email) {
      return NextResponse.json({ isRemoved: false });
    }

    const removed = await isAccountRemoved(email);

    if (removed) {
      return NextResponse.json({
        isRemoved: true,
        message:
          "Your account has been removed by the administrator. Please contact the school registrar or ICT administrator for assistance.",
      });
    }

    return NextResponse.json({ isRemoved: false });
  } catch (err) {
    console.error("Error in check-account-status:", err);
    return NextResponse.json({ isRemoved: false });
  }
}
