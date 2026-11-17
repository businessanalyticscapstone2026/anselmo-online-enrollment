import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import {
  evaluateEnrollmentAvailability,
  toPublicEnrollmentSettings,
} from "@/lib/enrollmentSettings";
import { supabaseAnonKey, supabaseUrl } from "@/lib/supabase/config";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const NO_STORE_HEADERS = { "Cache-Control": "no-store" };
const TABLE_NAME = "enrollment_settings";
const SETTINGS_COLUMNS = "id, enrollment_start_date, enrollment_end_date";

function noStoreFetch(input: RequestInfo | URL, init?: RequestInit) {
  return fetch(input, { ...init, cache: "no-store" });
}

export async function GET() {
  try {
    const key = supabaseAnonKey;

    if (!key) {
      return NextResponse.json(
        {
          settings: null,
          availability: evaluateEnrollmentAvailability(null),
          error: "Database configuration missing.",
        },
        { headers: NO_STORE_HEADERS }
      );
    }

    const supabase = createClient(supabaseUrl, key, {
      auth: { persistSession: false },
      global: { fetch: noStoreFetch },
    });

    const { data, error } = await supabase
      .from(TABLE_NAME)
      .select(SETTINGS_COLUMNS)
      .eq("id", 1)
      .maybeSingle();

    if (error) {
      console.error("Could not load public enrollment status:", {
        code: error.code,
        message: error.message,
        details: error.details,
        hint: error.hint,
      });
      return NextResponse.json(
        {
          settings: null,
          availability: evaluateEnrollmentAvailability(null),
          error:
            "Enrollment settings could not be read. Please contact the school registrar.",
        },
        { headers: NO_STORE_HEADERS }
      );
    }

    const publicSettings = toPublicEnrollmentSettings(data);

    return NextResponse.json(
      {
        settings: publicSettings,
        availability: evaluateEnrollmentAvailability(publicSettings),
      },
      { headers: NO_STORE_HEADERS }
    );
  } catch (err) {
    console.error("Error in GET /api/enrollment-status:", err);
    return NextResponse.json(
      {
        settings: null,
        availability: evaluateEnrollmentAvailability(null),
        error: "Unable to determine enrollment availability.",
      },
      { headers: NO_STORE_HEADERS }
    );
  }
}
