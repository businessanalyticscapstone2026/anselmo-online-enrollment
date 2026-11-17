import { NextResponse } from "next/server";
import { MFA_COOKIE_NAMES, type MfaArea } from "@/lib/auth/mfaToken";

export const runtime = "nodejs";

export async function POST(request: Request) {
  const body = await request.json().catch(() => ({}));
  const area = (body as { area?: unknown }).area;

  const response = NextResponse.json({ success: true });

  const areas: MfaArea[] =
    area === "staff" || area === "admin" ? [area] : ["staff", "admin"];

  for (const target of areas) {
    response.cookies.set({
      name: MFA_COOKIE_NAMES[target],
      value: "",
      httpOnly: true,
      sameSite: "lax",
      secure: process.env.NODE_ENV === "production",
      path: "/",
      maxAge: 0,
    });
  }

  return response;
}
