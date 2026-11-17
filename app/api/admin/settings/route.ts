import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { verifyAdminRequest } from "@/lib/auth/adminAuth";
import {
  evaluateEnrollmentAvailability,
  normalizeEnrollmentDate,
  type EnrollmentSettings,
} from "@/lib/enrollmentSettings";
import { getClientIp } from "@/lib/requestIp";
import { supabaseAnonKey, supabaseUrl } from "@/lib/supabase/config";
import {
  RELOAD_SCHEMA_SQL,
  classifyDatabaseError,
  toDatabaseErrorInfo,
  type DatabaseErrorLike,
  type DatabaseIssue,
} from "@/lib/supabase/errors";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const TABLE_NAME = "enrollment_settings";
const SETTINGS_ID = 1;
const SETTINGS_COLUMNS =
  "id, enrollment_start_date, enrollment_end_date, updated_at, updated_by";
const EXPECTED_COLUMNS = [
  "id",
  "enrollment_start_date",
  "enrollment_end_date",
  "updated_at",
  "updated_by",
];
const NO_STORE_HEADERS = { "Cache-Control": "no-store" };
const MIGRATION_FILE = "supabase/enrollment_settings_schedule_migration.sql";

function noStoreFetch(input: RequestInfo | URL, init?: RequestInit) {
  return fetch(input, { ...init, cache: "no-store" });
}

function createSupabaseClient(key: string) {
  return createClient(supabaseUrl, key, {
    auth: { persistSession: false },
    global: { fetch: noStoreFetch },
  });
}

function databaseErrorResponse(
  issue: DatabaseIssue,
  error: DatabaseErrorLike,
  status = 503
) {
  const databaseError = toDatabaseErrorInfo(error);

  if (issue === "table_missing") {
    return NextResponse.json(
      {
        error: `The '${TABLE_NAME}' table does not exist in the Supabase API schema cache. Expected table '${TABLE_NAME}' with columns: ${EXPECTED_COLUMNS.join(
          ", "
        )}. If the table exists in the SQL Editor, run the schema cache reload SQL below.`,
        code: "TABLE_MISSING",
        table: TABLE_NAME,
        expectedColumns: EXPECTED_COLUMNS,
        databaseError,
        migration: MIGRATION_FILE,
        reloadSchemaSql: RELOAD_SCHEMA_SQL,
      },
      { status, headers: NO_STORE_HEADERS }
    );
  }

  if (issue === "column_mismatch") {
    return NextResponse.json(
      {
        error: `The '${TABLE_NAME}' table exists but its columns do not match. Expected columns: ${EXPECTED_COLUMNS.join(
          ", "
        )}. Database error: ${databaseError.message}`,
        code: "SCHEMA_MISMATCH",
        table: TABLE_NAME,
        expectedColumns: EXPECTED_COLUMNS,
        databaseError,
        migration: MIGRATION_FILE,
      },
      { status, headers: NO_STORE_HEADERS }
    );
  }

  if (issue === "permission_denied") {
    return NextResponse.json(
      {
        error: `Supabase denied access to '${TABLE_NAME}'. The signed-in admin must be allowed to SELECT and UPDATE the settings row. Database error: ${databaseError.message}`,
        code: "PERMISSION_DENIED",
        table: TABLE_NAME,
        databaseError,
        migration: MIGRATION_FILE,
      },
      { status: 403, headers: NO_STORE_HEADERS }
    );
  }

  if (issue === "network") {
    return NextResponse.json(
      {
        error: `Unable to reach Supabase. Check NEXT_PUBLIC_SUPABASE_URL and network connectivity. Database error: ${databaseError.message}`,
        code: "NETWORK_ERROR",
        databaseError,
      },
      { status: 502, headers: NO_STORE_HEADERS }
    );
  }

  if (issue === "config") {
    return NextResponse.json(
      {
        error: `Supabase configuration is missing or invalid. Database error: ${databaseError.message}`,
        code: "CONFIG_ERROR",
        databaseError,
      },
      { status: 500, headers: NO_STORE_HEADERS }
    );
  }

  return NextResponse.json(
    {
      error: `Database error while accessing '${TABLE_NAME}': ${databaseError.message}`,
      code: "DATABASE_ERROR",
      table: TABLE_NAME,
      databaseError,
    },
    { status, headers: NO_STORE_HEADERS }
  );
}

export async function GET(request: Request) {
  try {
    const adminAuth = await verifyAdminRequest(request);

    if (!adminAuth.authorized || !adminAuth.user) {
      return NextResponse.json(
        { error: adminAuth.error || "Unauthorized. Admin privileges required." },
        { status: 403, headers: NO_STORE_HEADERS }
      );
    }

    const key = supabaseAnonKey;

    if (!key) {
      return databaseErrorResponse("config", {
        code: "CONFIG_ERROR",
        message: "NEXT_PUBLIC_SUPABASE_ANON_KEY is not configured.",
      });
    }

    const supabase = createSupabaseClient(key);

    const { data, error } = await supabase
      .from(TABLE_NAME)
      .select(SETTINGS_COLUMNS)
      .eq("id", SETTINGS_ID)
      .maybeSingle();

    if (error) {
      console.error("Failed to load enrollment settings:", {
        code: error.code,
        message: error.message,
        details: error.details,
        hint: error.hint,
      });

      return databaseErrorResponse(classifyDatabaseError(error), error);
    }

    const settings = (data as EnrollmentSettings | null) ?? null;

    return NextResponse.json(
      {
        settings,
        exists: Boolean(data),
        availability: evaluateEnrollmentAvailability(settings),
        schema: {
          table: TABLE_NAME,
          columns: EXPECTED_COLUMNS,
        },
      },
      { headers: NO_STORE_HEADERS }
    );
  } catch (err) {
    const message =
      err instanceof Error ? err.message : "Internal server error";
    console.error("Error in GET /api/admin/settings:", err);
    return databaseErrorResponse(
      "unknown",
      { code: "UNEXPECTED_ERROR", message },
      500
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

    const startDate = normalizeEnrollmentDate(body?.enrollment_start_date);
    const endDate = normalizeEnrollmentDate(body?.enrollment_end_date);

    if (!startDate || !endDate) {
      return NextResponse.json(
        {
          error:
            "Both enrollment_start_date and enrollment_end_date are required in YYYY-MM-DD format.",
        },
        { status: 400, headers: NO_STORE_HEADERS }
      );
    }

    if (endDate < startDate) {
      return NextResponse.json(
        {
          error:
            "The enrollment end date cannot be earlier than the enrollment start date.",
        },
        { status: 400, headers: NO_STORE_HEADERS }
      );
    }

    const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

    if (!serviceRoleKey) {
      return databaseErrorResponse("config", {
        code: "CONFIG_ERROR",
        message: "SUPABASE_SERVICE_ROLE_KEY is not configured.",
      });
    }

    const supabaseAdmin = createSupabaseClient(serviceRoleKey);

    const payload = {
      id: SETTINGS_ID,
      enrollment_start_date: startDate,
      enrollment_end_date: endDate,
      updated_at: new Date().toISOString(),
      updated_by: adminAuth.user.id,
    };

    const { data: saved, error: upsertError } = await supabaseAdmin
      .from(TABLE_NAME)
      .upsert(payload, { onConflict: "id" })
      .select(SETTINGS_COLUMNS)
      .maybeSingle();

    if (upsertError) {
      console.error("Failed to save enrollment settings:", {
        code: upsertError.code,
        message: upsertError.message,
        details: upsertError.details,
        hint: upsertError.hint,
      });

      return databaseErrorResponse(
        classifyDatabaseError(upsertError),
        upsertError
      );
    }

    if (!saved) {
      return databaseErrorResponse(
        "unknown",
        {
          code: "NO_ROW_RETURNED",
          message:
            "The database did not return the saved settings. Please reload and verify the values.",
        },
        500
      );
    }

    try {
      await supabaseAdmin.from("activity_logs").insert({
        user_type: "Admin",
        user_email: adminAuth.user.email || "unknown",
        action: `Updated Enrollment Period: ${startDate} to ${endDate}`,
        ip_address: getClientIp(request) || null,
      });
    } catch (logError) {
      console.warn("Could not record settings activity log:", logError);
    }

    return NextResponse.json(
      {
        success: true,
        message: "Enrollment dates saved successfully.",
        settings: saved,
        availability: evaluateEnrollmentAvailability(
          saved as EnrollmentSettings
        ),
        schema: {
          table: TABLE_NAME,
          columns: EXPECTED_COLUMNS,
        },
      },
      { headers: NO_STORE_HEADERS }
    );
  } catch (err) {
    const message =
      err instanceof Error ? err.message : "Internal server error";
    console.error("Error in POST /api/admin/settings:", err);
    return databaseErrorResponse(
      "unknown",
      { code: "UNEXPECTED_ERROR", message },
      500
    );
  }
}
