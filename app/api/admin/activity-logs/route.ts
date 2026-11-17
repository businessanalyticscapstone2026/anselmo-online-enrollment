import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { verifyAdminRequest } from "@/lib/auth/adminAuth";
import { getClientIp } from "@/lib/requestIp";

export const runtime = "nodejs";

type ActivityLogRow = {
  id: string;
  created_at: string;
  user_type: string | null;
  user_email: string | null;
  action: string;
  ip_address?: string | null;
};

type LegacyActivityLogRow = ActivityLogRow & {
  details?: { ip?: unknown } | null;
};

function isMissingColumnError(
  err: { code?: string; message?: string } | null,
  column: string
): boolean {
  if (!err) return false;
  return (
    err.code === "PGRST204" ||
    err.code === "42703" ||
    String(err.message || "").toLowerCase().includes(column.toLowerCase())
  );
}

function isTableMissingError(err: { code?: string; message?: string } | null): boolean {
  if (!err) return false;
  const msg = String(err.message || "").toLowerCase();
  const code = String(err.code || "");
  return (
    code === "42P01" ||
    code === "PGRST205" ||
    msg.includes("schema cache") ||
    msg.includes("does not exist") ||
    msg.includes("not found")
  );
}

function legacyIp(row: LegacyActivityLogRow): string | null {
  const ip = row.details?.ip;
  return typeof ip === "string" && ip.trim() ? ip.trim() : null;
}

export async function GET(request: Request) {
  try {
    const adminAuth = await verifyAdminRequest(request);

    if (!adminAuth.authorized || !adminAuth.user) {
      return NextResponse.json(
        { error: adminAuth.error || "Unauthorized. Admin privileges required." },
        { status: 403 }
      );
    }

    const supabaseUrl =
      process.env.NEXT_PUBLIC_SUPABASE_URL ||
      "https://tmrimwhwwvojbsztnbxf.supabase.co";
    const supabaseKey =
      process.env.SUPABASE_SERVICE_ROLE_KEY ||
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

    if (!supabaseKey) {
      return NextResponse.json(
        { error: "Missing database configuration." },
        { status: 500 }
      );
    }

    const supabase = createClient(supabaseUrl, supabaseKey, {
      auth: { persistSession: false },
    });

    let logs: ActivityLogRow[] | null = null;
    let error: { code?: string; message?: string } | null = null;

    const current = await supabase
      .from("activity_logs")
      .select("id, created_at, user_type, user_email, action, ip_address")
      .order("created_at", { ascending: false })
      .limit(200);

    if (current.error && isMissingColumnError(current.error, "ip_address")) {
      // Fallback for databases that have not run simplify_activity_logs.sql.
      const legacy = await supabase
        .from("activity_logs")
        .select("id, created_at, user_type, user_email, action, details")
        .order("created_at", { ascending: false })
        .limit(200);

      logs = ((legacy.data || []) as LegacyActivityLogRow[]).map((row) => ({
        id: row.id,
        created_at: row.created_at,
        user_type: row.user_type,
        user_email: row.user_email,
        action: row.action,
        ip_address: legacyIp(row),
      }));
      error = legacy.error;
    } else {
      logs = (current.data || []) as ActivityLogRow[];
      error = current.error;
    }

    if (error) {
      if (isTableMissingError(error)) {
        // Table has not yet been created in Supabase SQL editor; handle gracefully
        return NextResponse.json({
          logs: [],
          tableMissing: true,
          message: "Activity logs table not yet created in Supabase.",
        });
      }

      return NextResponse.json(
        { error: `Failed to fetch activity logs: ${error.message}` },
        { status: 500 }
      );
    }

    return NextResponse.json({ logs, tableMissing: false });
  } catch (err) {
    console.error("Error in GET /api/admin/activity-logs:", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Internal server error" },
      { status: 500 }
    );
  }
}

export async function POST(request: Request) {
  try {
    const adminAuth = await verifyAdminRequest(request);

    if (!adminAuth.authorized || !adminAuth.user) {
      return NextResponse.json(
        { error: adminAuth.error || "Unauthorized. Admin privileges required." },
        { status: 403 }
      );
    }

    const body = await request.json().catch(() => ({}));
    const { action } = body;

    // Identity is derived from the authenticated admin session, never from the
    // client payload, so logs cannot be attributed to a different account.
    const userEmail =
      (adminAuth.user.email || "").trim() || "unknown";

    if (!action) {
      return NextResponse.json(
        { error: "action is required." },
        { status: 400 }
      );
    }

    const supabaseUrl =
      process.env.NEXT_PUBLIC_SUPABASE_URL ||
      "https://tmrimwhwwvojbsztnbxf.supabase.co";
    const supabaseKey =
      process.env.SUPABASE_SERVICE_ROLE_KEY ||
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

    if (!supabaseKey) {
      return NextResponse.json({ success: true, tableMissing: true });
    }

    const supabase = createClient(supabaseUrl, supabaseKey, {
      auth: { persistSession: false },
    });

    const basePayload = {
      user_type: "Admin",
      user_email: userEmail,
      action: action,
    };
    const ipAddress = getClientIp(request) || null;

    const { error } = await supabase
      .from("activity_logs")
      .insert({ ...basePayload, ip_address: ipAddress });

    if (error && isMissingColumnError(error, "ip_address")) {
      const { error: fallbackError } = await supabase
        .from("activity_logs")
        .insert({ ...basePayload, details: { ip: ipAddress } });

      if (!fallbackError) {
        return NextResponse.json({ success: true });
      }

      return NextResponse.json(
        { error: `Database error: ${fallbackError.message}` },
        { status: 500 }
      );
    }

    if (error) {
      if (isTableMissingError(error)) {
        return NextResponse.json({ success: true, tableMissing: true });
      }
      return NextResponse.json(
        { error: `Database error: ${error.message}` },
        { status: 500 }
      );
    }

    return NextResponse.json({ success: true });
  } catch (err) {
    console.warn("Notice in POST /api/admin/activity-logs:", err);
    return NextResponse.json({ success: true });
  }
}

export async function DELETE(request: Request) {
  try {
    const adminAuth = await verifyAdminRequest(request);

    if (!adminAuth.authorized || !adminAuth.user) {
      return NextResponse.json(
        { error: adminAuth.error || "Unauthorized. Admin privileges required." },
        { status: 403 }
      );
    }

    const supabaseUrl =
      process.env.NEXT_PUBLIC_SUPABASE_URL ||
      "https://tmrimwhwwvojbsztnbxf.supabase.co";
    const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

    if (!supabaseKey) {
      return NextResponse.json(
        { error: "Server configuration missing: SUPABASE_SERVICE_ROLE_KEY." },
        { status: 500 }
      );
    }

    const supabaseAdmin = createClient(supabaseUrl, supabaseKey, {
      auth: { persistSession: false },
    });

    const { error } = await supabaseAdmin
      .from("activity_logs")
      .delete()
      .neq("id", "00000000-0000-0000-0000-000000000000");

    if (error) {
      if (isTableMissingError(error)) {
        return NextResponse.json({
          success: true,
          message: "Activity logs are clean.",
          tableMissing: true,
        });
      }

      return NextResponse.json(
        { error: `Failed to clear activity logs: ${error.message}` },
        { status: 500 }
      );
    }

    // Try recording the clear action
    try {
      const ipAddress = getClientIp(request) || null;
      const { error: logError } = await supabaseAdmin
        .from("activity_logs")
        .insert({
          user_type: "Admin",
          user_email: adminAuth.user.email || "unknown",
          action: "Cleared All Activity Logs",
          ip_address: ipAddress,
        });

      if (logError && isMissingColumnError(logError, "ip_address")) {
        await supabaseAdmin.from("activity_logs").insert({
          user_type: "Admin",
          user_email: adminAuth.user.email || "unknown",
          action: "Cleared All Activity Logs",
          details: { ip: ipAddress },
        });
      }
    } catch {
      // Ignore background log error
    }

    return NextResponse.json({
      success: true,
      message: "Activity logs have been successfully cleared.",
    });
  } catch (err) {
    console.error("Error in DELETE /api/admin/activity-logs:", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Internal server error" },
      { status: 500 }
    );
  }
}
