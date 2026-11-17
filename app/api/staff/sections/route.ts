import { NextResponse } from "next/server";
import { createClient, type SupabaseClient, type User } from "@supabase/supabase-js";
import { getAuthContext } from "@/lib/auth/server";
import { hasValidMfaCookie } from "@/lib/auth/mfaCookie";
import { isAdminRole, isStaffRole } from "@/lib/auth/roles";
import { logActivity } from "@/lib/activityLog";
import { syncStudentProfile } from "@/lib/studentProfiles";
import { getTrackForCluster, normalizeTrack } from "@/lib/clusters";

const MAX_NAME_LENGTH = 120;
const MAX_ADVISER_LENGTH = 120;
const MAX_LEVEL_LENGTH = 60;
const MAX_TRACK_LENGTH = 60;
const MAX_STRAND_LENGTH = 60;
const MAX_SCHOOL_YEAR_LENGTH = 40;

type SectionPayload = {
  name?: unknown;
  adviserName?: unknown;
  gradeLevel?: unknown;
  track?: unknown;
  strand?: unknown;
  cluster?: unknown;
  schoolYear?: unknown;
  capacity?: unknown;
};

type SectionBody = SectionPayload & { id?: unknown };

type SectionRow = {
  id: string;
  name: string;
  grade_level: string | null;
  track: string | null;
  strand: string | null;
  cluster: string | null;
  adviser_name: string | null;
  school_year: string | null;
  capacity: number | null;
};

type SupabaseAdmin = SupabaseClient;

type NormalizedSection = {
  name: string;
  adviser_name: string | null;
  grade_level: string | null;
  track: string | null;
  strand: string | null;
  cluster: string | null;
  school_year: string | null;
  capacity: number | null;
};

function text(value: unknown, max: number): string {
  if (typeof value !== "string") return "";
  return value.trim().slice(0, max);
}

function nullableText(value: unknown, max: number): string | null {
  const clean = text(value, max);
  return clean || null;
}

function normalizeCapacity(value: unknown): number | null {
  if (value == null || value === "") return null;
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) return null;
  return Math.floor(parsed);
}

function buildSectionPayload(body: SectionPayload): {
  payload?: NormalizedSection;
  error?: string;
} {
  const name = text(body.name, MAX_NAME_LENGTH);

  if (!name) {
    return { error: "A section name is required." };
  }

  // The live `sections` table uses `cluster` while older deployments use
  // `strand`. Save both so the value survives whichever column exists.
  const cluster = nullableText(body.cluster ?? body.strand, MAX_STRAND_LENGTH);
  const explicitTrack = normalizeTrack(nullableText(body.track, MAX_TRACK_LENGTH));

  return {
    payload: {
      name,
      adviser_name: nullableText(body.adviserName, MAX_ADVISER_LENGTH),
      grade_level: nullableText(body.gradeLevel, MAX_LEVEL_LENGTH),
      track: explicitTrack ?? getTrackForCluster(cluster),
      strand: cluster,
      cluster,
      school_year: nullableText(body.schoolYear, MAX_SCHOOL_YEAR_LENGTH),
      capacity: normalizeCapacity(body.capacity),
    },
  };
}

function getSupabaseAdmin(): SupabaseAdmin | null {
  const supabaseUrl =
    process.env.NEXT_PUBLIC_SUPABASE_URL ||
    "https://tmrimwhwwvojbsztnbxf.supabase.co";
  const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!supabaseKey) return null;

  return createClient(supabaseUrl, supabaseKey, {
    auth: { persistSession: false },
  });
}

async function authorize(): Promise<
  | { authorized: true; user: User; role: string }
  | { authorized: false; status: number; error: string }
> {
  const auth = await getAuthContext();

  if (!auth.user) {
    return {
      authorized: false,
      status: 401,
      error: "Your staff session has expired. Please sign in again.",
    };
  }

  if (!isStaffRole(auth.role) && !isAdminRole(auth.role)) {
    return {
      authorized: false,
      status: 403,
      error: "This account is not authorized to manage sections.",
    };
  }

  const mfaArea = isAdminRole(auth.role) ? "admin" : "staff";
  const mfaValid = await hasValidMfaCookie(mfaArea, auth.user.id);

  if (!mfaValid) {
    return {
      authorized: false,
      status: 403,
      error:
        "Your verification has expired. Sign in again through the portal to continue.",
    };
  }

  return { authorized: true, user: auth.user, role: auth.role };
}

function extractMissingColumn(
  error: { code?: string; message?: string } | null | undefined
): string | null {
  const message = error?.message ?? "";
  if (!message) return null;

  const patterns = [
    /Could not find the '([^']+)' column/i,
    /column "([^"]+)" of relation/i,
    /column "([^"]+)" does not exist/i,
    /column '([^']+)'/i,
  ];

  for (const pattern of patterns) {
    const match = message.match(pattern);
    if (match?.[1]) return match[1];
  }

  return null;
}

/**
 * Insert a section while progressively dropping any column the database does
 * not recognize. This keeps every supported field (adviser, grade level,
 * track, cluster, school year, capacity) saved even when a newer column such
 * as `track` has not been migrated yet.
 */
async function insertSectionResilient(
  supabaseAdmin: SupabaseAdmin,
  id: string,
  payload: NormalizedSection
) {
  const working: Record<string, unknown> = { id, ...payload };
  const dropped: string[] = [];

  let result = await supabaseAdmin
    .from("sections")
    .insert(working)
    .select("*")
    .maybeSingle();

  for (let guard = 0; result.error && guard < 12; guard += 1) {
    const column = extractMissingColumn(result.error);
    if (!column || !(column in working) || column === "id" || column === "name") {
      break;
    }

    console.warn(
      `[staff/sections] Dropping unsupported column "${column}" while inserting a section.`
    );
    delete working[column];
    dropped.push(column);
    result = await supabaseAdmin
      .from("sections")
      .insert(working)
      .select("*")
      .maybeSingle();
  }

  return { result, dropped };
}

/**
 * Update a section using the same progressive column-dropping strategy as
 * {@link insertSectionResilient}.
 */
async function updateSectionResilient(
  supabaseAdmin: SupabaseAdmin,
  id: string,
  payload: NormalizedSection
) {
  const working: Record<string, unknown> = { ...payload };
  const dropped: string[] = [];

  let result = await supabaseAdmin
    .from("sections")
    .update(working)
    .eq("id", id)
    .select("*")
    .maybeSingle();

  for (let guard = 0; result.error && guard < 12; guard += 1) {
    const column = extractMissingColumn(result.error);
    if (!column || !(column in working) || column === "name") {
      break;
    }

    console.warn(
      `[staff/sections] Dropping unsupported column "${column}" while updating a section.`
    );
    delete working[column];
    dropped.push(column);
    result = await supabaseAdmin
      .from("sections")
      .update(working)
      .eq("id", id)
      .select("*")
      .maybeSingle();
  }

  return { result, dropped };
}

function describeDroppedColumns(dropped: string[]): string {
  if (dropped.length === 0) return "";

  const clusterValueSaved = !(
    dropped.includes("cluster") && dropped.includes("strand")
  );

  if (!clusterValueSaved) {
    return " Note: the database has no cluster/strand column, so the cluster was not saved. Apply the latest sections migration in Supabase.";
  }

  const parts: string[] = [];

  if (dropped.includes("track")) {
    parts.push("Track is derived from the selected cluster.");
  }

  const others = dropped.filter(
    (column) => column !== "cluster" && column !== "strand" && column !== "track"
  );

  if (others.length) {
    const list = others.map((column) => `"${column}"`).join(", ");
    parts.push(
      `The database is missing the ${list} column${
        others.length > 1 ? "s" : ""
      }, so that value was not saved. Apply the latest sections migration in Supabase.`
    );
  }

  return parts.length ? ` ${parts.join(" ")}` : "";
}

async function findDuplicate(
  supabaseAdmin: SupabaseAdmin,
  name: string,
  excludeId?: string
): Promise<boolean> {
  const query = supabaseAdmin
    .from("sections")
    .select("id")
    .ilike("name", name)
    .limit(1);

  const { data } = excludeId
    ? await query.neq("id", excludeId)
    : await query;

  return Boolean(data && data.length > 0);
}

async function parseBody(request: Request): Promise<SectionBody | null> {
  try {
    return (await request.json()) as SectionBody;
  } catch {
    return null;
  }
}

export async function POST(request: Request) {
  try {
    const access = await authorize();
    if (!access.authorized) {
      return NextResponse.json(
        { success: false, error: access.error },
        { status: access.status }
      );
    }

    const body = await parseBody(request);
    if (!body) {
      return NextResponse.json(
        { success: false, error: "Invalid request body." },
        { status: 400 }
      );
    }

    const { payload, error } = buildSectionPayload(body);
    if (!payload) {
      return NextResponse.json(
        { success: false, error },
        { status: 400 }
      );
    }

    const supabaseAdmin = getSupabaseAdmin();
    if (!supabaseAdmin) {
      return NextResponse.json(
        { success: false, error: "Supabase service configuration is missing." },
        { status: 500 }
      );
    }

    if (await findDuplicate(supabaseAdmin, payload.name)) {
      return NextResponse.json(
        {
          success: false,
          error: `A section named "${payload.name}" already exists.`,
        },
        { status: 409 }
      );
    }

    const id = `sec-${globalThis.crypto.randomUUID()}`;

    const { result: insertResult, dropped: droppedColumns } =
      await insertSectionResilient(supabaseAdmin, id, payload);

    if (insertResult.error) {
      return NextResponse.json(
        {
          success: false,
          error: `Could not add the section: ${insertResult.error.message}. If the sections table is missing, apply the sections migration in Supabase.`,
        },
        { status: 500 }
      );
    }

    await logActivity({
      userType: isAdminRole(access.role) ? "Admin" : "Staff",
      userEmail: access.user.email || "",
      action: `Created Section: ${payload.name}`,
      details: {
        sectionId: id,
        name: payload.name,
        adviserName: payload.adviser_name,
        gradeLevel: payload.grade_level,
        track: payload.track,
        strand: payload.strand,
        cluster: payload.cluster,
        schoolYear: payload.school_year,
        capacity: payload.capacity,
        timestamp: new Date().toISOString(),
      },
    });

    return NextResponse.json({
      success: true,
      data: insertResult.data as SectionRow,
      message: `Section "${payload.name}" was added successfully.${describeDroppedColumns(
        droppedColumns
      )}`,
    });
  } catch (error: unknown) {
    return NextResponse.json(
      {
        success: false,
        error:
          error instanceof Error ? error.message : "Could not add the section.",
      },
      { status: 500 }
    );
  }
}

export async function PATCH(request: Request) {
  try {
    const access = await authorize();
    if (!access.authorized) {
      return NextResponse.json(
        { success: false, error: access.error },
        { status: access.status }
      );
    }

    const body = await parseBody(request);
    if (!body) {
      return NextResponse.json(
        { success: false, error: "Invalid request body." },
        { status: 400 }
      );
    }

    const id = text(body.id, 200);
    if (!id) {
      return NextResponse.json(
        { success: false, error: "A valid section ID is required." },
        { status: 400 }
      );
    }

    const { payload, error } = buildSectionPayload(body);
    if (!payload) {
      return NextResponse.json(
        { success: false, error },
        { status: 400 }
      );
    }

    const supabaseAdmin = getSupabaseAdmin();
    if (!supabaseAdmin) {
      return NextResponse.json(
        { success: false, error: "Supabase service configuration is missing." },
        { status: 500 }
      );
    }

    if (await findDuplicate(supabaseAdmin, payload.name, id)) {
      return NextResponse.json(
        {
          success: false,
          error: `Another section named "${payload.name}" already exists.`,
        },
        { status: 409 }
      );
    }

    const { result: updateResult, dropped: droppedColumns } =
      await updateSectionResilient(supabaseAdmin, id, payload);

    if (updateResult.error) {
      return NextResponse.json(
        {
          success: false,
          error: `Could not update the section: ${updateResult.error.message}`,
        },
        { status: 500 }
      );
    }

    if (!updateResult.data) {
      return NextResponse.json(
        {
          success: false,
          error:
            "The section was not found. It may be a built-in section that is not saved in the database yet.",
        },
        { status: 404 }
      );
    }

    const { data: sectionApplications } = await supabaseAdmin
      .from("student_applications")
      .select("id")
      .eq("assigned_section_id", id);

    for (const application of sectionApplications ?? []) {
      await syncStudentProfile(supabaseAdmin, String(application.id));
    }

    await logActivity({
      userType: isAdminRole(access.role) ? "Admin" : "Staff",
      userEmail: access.user.email || "",
      action: `Updated Section: ${payload.name}`,
      details: {
        sectionId: id,
        name: payload.name,
        adviserName: payload.adviser_name,
        gradeLevel: payload.grade_level,
        track: payload.track,
        strand: payload.strand,
        cluster: payload.cluster,
        schoolYear: payload.school_year,
        capacity: payload.capacity,
        timestamp: new Date().toISOString(),
      },
    });

    return NextResponse.json({
      success: true,
      data: updateResult.data as SectionRow,
      message: `Section "${payload.name}" was updated successfully.${describeDroppedColumns(
        droppedColumns
      )}`,
    });
  } catch (error: unknown) {
    return NextResponse.json(
      {
        success: false,
        error:
          error instanceof Error
            ? error.message
            : "Could not update the section.",
      },
      { status: 500 }
    );
  }
}

export async function DELETE(request: Request) {
  try {
    const access = await authorize();
    if (!access.authorized) {
      return NextResponse.json(
        { success: false, error: access.error },
        { status: access.status }
      );
    }

    const id = text(new URL(request.url).searchParams.get("id"), 200);
    if (!id) {
      return NextResponse.json(
        { success: false, error: "A valid section ID is required." },
        { status: 400 }
      );
    }

    const supabaseAdmin = getSupabaseAdmin();
    if (!supabaseAdmin) {
      return NextResponse.json(
        { success: false, error: "Supabase service configuration is missing." },
        { status: 500 }
      );
    }

    const { data, error } = await supabaseAdmin
      .from("sections")
      .delete()
      .eq("id", id)
      .select("id, name")
      .maybeSingle();

    if (error) {
      return NextResponse.json(
        {
          success: false,
          error: `Could not delete the section: ${error.message}`,
        },
        { status: 500 }
      );
    }

    if (!data) {
      return NextResponse.json(
        {
          success: false,
          error:
            "The section was not found. It may be a built-in section that is not saved in the database yet.",
        },
        { status: 404 }
      );
    }

    await logActivity({
      userType: isAdminRole(access.role) ? "Admin" : "Staff",
      userEmail: access.user.email || "",
      action: `Deleted Section: ${data.name}`,
      details: {
        sectionId: id,
        name: data.name,
        timestamp: new Date().toISOString(),
      },
    });

    return NextResponse.json({
      success: true,
      data,
      message: `Section "${data.name}" was deleted.`,
    });
  } catch (error: unknown) {
    return NextResponse.json(
      {
        success: false,
        error:
          error instanceof Error
            ? error.message
            : "Could not delete the section.",
      },
      { status: 500 }
    );
  }
}
