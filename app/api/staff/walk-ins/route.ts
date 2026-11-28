import { NextResponse } from "next/server";
import type { SupabaseClient } from "@supabase/supabase-js";
import { logActivity } from "@/lib/activityLog";
import {
  isMissingWalkInSchema,
  requireStaffApi,
  walkInSchemaHint,
} from "@/lib/staffApiAuth";
import {
  buildWalkInInsertRow,
  normalizeWalkInInput,
  validateWalkInInput,
  walkInFullName,
  type WalkInInput,
} from "@/lib/walkInEnrollment";

export const runtime = "nodejs";

const MAX_PAGE_SIZE = 100;

function text(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function clampInt(value: unknown, fallback: number, min: number, max: number) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(max, Math.max(min, Math.trunc(parsed)));
}

function currentManilaYear(): string {
  try {
    return new Intl.DateTimeFormat("en-CA", {
      timeZone: "Asia/Manila",
      year: "numeric",
    }).format(new Date());
  } catch {
    return String(new Date().getFullYear());
  }
}

async function nextWalkInReference(supabase: SupabaseClient): Promise<string> {
  try {
    const { data, error } = await supabase.rpc("next_walk_in_reference");

    if (!error && typeof data === "string" && data.trim()) {
      return data.trim();
    }
  } catch (error) {
    console.warn("next_walk_in_reference RPC unavailable:", error);
  }

  return `WI-${currentManilaYear()}-${String(Date.now()).slice(-6)}`;
}

async function findDuplicate(
  supabase: SupabaseClient,
  input: WalkInInput
): Promise<{
  id: string;
  reference: string | null;
  name: string;
  walkIn: boolean;
} | null> {
  if (input.lrn) {
    const { data } = await supabase
      .from("student_applications")
      .select("id, walk_in_reference, first_name, last_name, enrollment_type")
      .eq("lrn", input.lrn)
      .limit(1);

    const row = (data ?? [])[0] as
      | {
          id: string;
          walk_in_reference: string | null;
          first_name: string | null;
          last_name: string | null;
          enrollment_type: string | null;
        }
      | undefined;

    if (row) {
      return {
        id: row.id,
        reference: row.walk_in_reference,
        name: [row.first_name, row.last_name].filter(Boolean).join(" "),
        walkIn: row.enrollment_type === "walk_in",
      };
    }
  }

  if (input.birthDate) {
    const { data } = await supabase
      .from("student_applications")
      .select("id, walk_in_reference, first_name, last_name, enrollment_type")
      .ilike("first_name", input.firstName)
      .ilike("last_name", input.lastName)
      .eq("birth_date", input.birthDate)
      .limit(1);

    const row = (data ?? [])[0] as
      | {
          id: string;
          walk_in_reference: string | null;
          first_name: string | null;
          last_name: string | null;
          enrollment_type: string | null;
        }
      | undefined;

    if (row) {
      return {
        id: row.id,
        reference: row.walk_in_reference,
        name: [row.first_name, row.last_name].filter(Boolean).join(" "),
        walkIn: row.enrollment_type === "walk_in",
      };
    }
  }

  return null;
}

export async function GET(request: Request) {
  const auth = await requireStaffApi();
  if ("response" in auth) return auth.response;

  const { supabase } = auth.session;
  const { searchParams } = new URL(request.url);

  const search = text(searchParams.get("search")).replace(/[(),%]/g, " ").trim();
  const track = text(searchParams.get("track"));
  const cluster = text(searchParams.get("cluster"));
  const status = text(searchParams.get("status"));
  const section = text(searchParams.get("section"));
  const limit = clampInt(searchParams.get("limit"), 50, 1, MAX_PAGE_SIZE);
  const page = clampInt(searchParams.get("page"), 1, 1, 1000);
  const from = (page - 1) * limit;

  let query = supabase
    .from("student_applications")
    .select("*", { count: "exact" })
    .eq("enrollment_type", "walk_in");

  if (search) {
    query = query.or(
      [
        `first_name.ilike.%${search}%`,
        `last_name.ilike.%${search}%`,
        `lrn.ilike.%${search}%`,
        `walk_in_reference.ilike.%${search}%`,
      ].join(",")
    );
  }

  if (track) query = query.eq("track", track);
  if (cluster) query = query.eq("selected_cluster", cluster);
  if (status) query = query.ilike("status", status);
  if (section) query = query.eq("assigned_section_id", section);

  const { data, error, count } = await query
    .order("submitted_at", { ascending: false })
    .range(from, from + limit - 1);

  if (error) {
    if (isMissingWalkInSchema(error)) {
      return NextResponse.json(
        { success: false, error: walkInSchemaHint() },
        { status: 500 }
      );
    }

    return NextResponse.json(
      { success: false, error: error.message },
      { status: 500 }
    );
  }

  const countBase = () =>
    supabase
      .from("student_applications")
      .select("id", { count: "exact", head: true })
      .eq("enrollment_type", "walk_in");

  const [totalResult, pendingResult, enrolledResult, incompleteResult] =
    await Promise.all([
      countBase(),
      countBase().ilike("status", "pending"),
      countBase().ilike("status", "enrolled"),
      countBase().eq("requirements_submitted", false),
    ]);

  return NextResponse.json({
    success: true,
    records: data ?? [],
    total: count ?? 0,
    page,
    limit,
    counts: {
      total: totalResult.count ?? 0,
      pending: pendingResult.count ?? 0,
      enrolled: enrolledResult.count ?? 0,
      incomplete: incompleteResult.count ?? 0,
    },
  });
}

export async function POST(request: Request) {
  const auth = await requireStaffApi();
  if ("response" in auth) return auth.response;

  const { supabase, userId, email } = auth.session;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json(
      { success: false, error: "Invalid request body." },
      { status: 400 }
    );
  }

  const input = normalizeWalkInInput(body);
  const errors = validateWalkInInput(input);

  if (Object.keys(errors).length > 0) {
    return NextResponse.json(
      {
        success: false,
        error: "Please complete the required walk-in details.",
        errors,
      },
      { status: 400 }
    );
  }

  const duplicate = await findDuplicate(supabase, input);

  if (duplicate) {
    return NextResponse.json(
      {
        success: false,
        error: duplicate.walkIn
          ? `A walk-in record already exists for ${
              duplicate.name || "this student"
            }${
              duplicate.reference ? ` (${duplicate.reference})` : ""
            }. Open the existing walk-in record instead.`
          : `An online enrollment already exists for ${
              duplicate.name || "this student"
            }. Review it under Student Applications instead of creating a walk-in record.`,
        duplicate,
      },
      { status: 409 }
    );
  }

  const nowIso = new Date().toISOString();
  let reference = await nextWalkInReference(supabase);
  let payload = buildWalkInInsertRow(input, {
    staffId: userId,
    staffEmail: email,
    reference,
    nowIso,
  });

  let insertResult = await supabase
    .from("student_applications")
    .insert(payload)
    .select("*")
    .single();

  // A rare unique collision on the reference should not lose the record.
  if (
    insertResult.error?.code === "23505" &&
    /walk_in_reference/i.test(insertResult.error.message || "")
  ) {
    reference = await nextWalkInReference(supabase);
    payload = buildWalkInInsertRow(input, {
      staffId: userId,
      staffEmail: email,
      reference,
      nowIso,
    });
    insertResult = await supabase
      .from("student_applications")
      .insert(payload)
      .select("*")
      .single();
  }

  if (insertResult.error) {
    if (isMissingWalkInSchema(insertResult.error)) {
      return NextResponse.json(
        { success: false, error: walkInSchemaHint() },
        { status: 500 }
      );
    }

    return NextResponse.json(
      { success: false, error: insertResult.error.message },
      { status: 500 }
    );
  }

  const record = insertResult.data as Record<string, unknown>;

  await logActivity({
    userType: "Staff",
    userEmail: email,
    action: `Created Walk-in Enrollment: ${reference}`,
    details: {
      applicationId: record.id ?? null,
      reference,
      studentName: walkInFullName(record),
      lrn: input.lrn,
      track: input.track,
      cluster: input.selectedCluster,
      gradeLevel: input.gradeLevel,
    },
  });

  return NextResponse.json(
    {
      success: true,
      message: `Walk-in enrollment ${reference} saved.`,
      record,
    },
    { status: 201 }
  );
}
