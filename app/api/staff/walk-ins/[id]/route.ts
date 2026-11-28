import { NextResponse } from "next/server";
import { logActivity } from "@/lib/activityLog";
import { normalizeRole } from "@/lib/auth/roles";
import {
  isMissingWalkInSchema,
  requireStaffApi,
  walkInSchemaHint,
} from "@/lib/staffApiAuth";
import { normalizeTrack } from "@/lib/clusters";
import { pickStorageBucket } from "@/lib/enrollRequirements";
import {
  getEnrollmentStatusLabel,
  normalizeEnrollmentStatus,
} from "@/lib/enrollmentStatus";
import {
  buildWalkInUpdateRow,
  isWalkInRecord,
  normalizeWalkInInput,
  validateWalkInInput,
  walkInFullName,
} from "@/lib/walkInEnrollment";

export const runtime = "nodejs";

type RouteContext = { params: Promise<{ id: string }> };

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const ALLOWED_STATUSES = new Set(["pending", "enrolled", "denied"]);

function text(value: unknown, maxLength = 1000): string {
  return typeof value === "string" ? value.trim().slice(0, maxLength) : "";
}

function normalizeStatusInput(value: unknown): string {
  return text(value, 40).toLowerCase().replace(/[\s-]+/g, "_");
}

function storedDocumentPaths(value: unknown): string[] {
  if (!value || typeof value !== "object" || Array.isArray(value)) return [];

  const documents = value as Record<string, unknown>;
  const paths: string[] = [];

  for (const key of ["report_card", "birth_certificate", "other_requirement"]) {
    const document = documents[key];

    if (document && typeof document === "object" && !Array.isArray(document)) {
      const path = text((document as Record<string, unknown>).path, 500);
      if (path) paths.push(path);
    }
  }

  return paths;
}

export async function GET(_request: Request, context: RouteContext) {
  const auth = await requireStaffApi();
  if ("response" in auth) return auth.response;

  const { id } = await context.params;

  if (!UUID_PATTERN.test(id)) {
    return NextResponse.json(
      { success: false, error: "A valid walk-in record ID is required." },
      { status: 400 }
    );
  }

  const { data, error } = await auth.session.supabase
    .from("student_applications")
    .select("*")
    .eq("id", id)
    .eq("enrollment_type", "walk_in")
    .maybeSingle();

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

  if (!data || !isWalkInRecord(data as Record<string, unknown>)) {
    return NextResponse.json(
      { success: false, error: "Walk-in record not found." },
      { status: 404 }
    );
  }

  return NextResponse.json({ success: true, record: data });
}

export async function PATCH(request: Request, context: RouteContext) {
  const auth = await requireStaffApi();
  if ("response" in auth) return auth.response;

  const { supabase, userId, email } = auth.session;
  const { id } = await context.params;

  if (!UUID_PATTERN.test(id)) {
    return NextResponse.json(
      { success: false, error: "A valid walk-in record ID is required." },
      { status: 400 }
    );
  }

  let body: Record<string, unknown>;
  try {
    const parsed: unknown = await request.json();
    body =
      parsed && typeof parsed === "object" && !Array.isArray(parsed)
        ? (parsed as Record<string, unknown>)
        : {};
  } catch {
    return NextResponse.json(
      { success: false, error: "Invalid request body." },
      { status: 400 }
    );
  }

  const { data: existing, error: fetchError } = await supabase
    .from("student_applications")
    .select("*")
    .eq("id", id)
    .eq("enrollment_type", "walk_in")
    .maybeSingle();

  if (fetchError) {
    if (isMissingWalkInSchema(fetchError)) {
      return NextResponse.json(
        { success: false, error: walkInSchemaHint() },
        { status: 500 }
      );
    }

    return NextResponse.json(
      { success: false, error: fetchError.message },
      { status: 500 }
    );
  }

  const record = existing as Record<string, unknown> | null;

  if (!record || !isWalkInRecord(record)) {
    return NextResponse.json(
      { success: false, error: "Walk-in record not found." },
      { status: 404 }
    );
  }

  const action = text(body.action, 40) || "details";
  const nowIso = new Date().toISOString();

  if (action === "details") {
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

    const updateRow = buildWalkInUpdateRow(input, {
      staffId: userId,
      staffEmail: email,
      existingDetails: record.student_details,
      existingRequirementsSubmitted: record.requirements_submitted === true,
      nowIso,
    });

    if (input.lrn) {
      const { data: duplicateRows } = await supabase
        .from("student_applications")
        .select("id, walk_in_reference")
        .eq("lrn", input.lrn)
        .neq("id", id)
        .limit(1);

      const duplicate = (duplicateRows ?? [])[0] as
        | { id: string; walk_in_reference: string | null }
        | undefined;

      if (duplicate) {
        return NextResponse.json(
          {
            success: false,
            error: `Another student record already uses LRN ${input.lrn}${
              duplicate.walk_in_reference
                ? ` (${duplicate.walk_in_reference})`
                : ""
            }.`,
          },
          { status: 409 }
        );
      }
    }

    const { data, error } = await supabase
      .from("student_applications")
      .update(updateRow)
      .eq("id", id)
      .eq("enrollment_type", "walk_in")
      .select("*")
      .single();

    if (error) {
      return NextResponse.json(
        { success: false, error: error.message },
        { status: 500 }
      );
    }

    await logActivity({
      userType: "Staff",
      userEmail: email,
      action: `Updated Walk-in Details: ${walkInFullName(data as Record<string, unknown>)}`,
      details: {
        applicationId: id,
        reference: record.walk_in_reference ?? null,
      },
    });

    return NextResponse.json({ success: true, record: data });
  }

  if (action === "status") {
    const rawStatus = normalizeStatusInput(body.status);

    if (!ALLOWED_STATUSES.has(rawStatus)) {
      return NextResponse.json(
        {
          success: false,
          error: "Select Pending, Enrolled, or Denied as the walk-in status.",
        },
        { status: 400 }
      );
    }

    const status = normalizeEnrollmentStatus(rawStatus);
    const remarks = text(body.remarks, 1000);

    const { data, error } = await supabase
      .from("student_applications")
      .update({
        status,
        registrar_remarks: remarks || null,
        updated_at: nowIso,
      })
      .eq("id", id)
      .eq("enrollment_type", "walk_in")
      .select("*")
      .single();

    if (error) {
      return NextResponse.json(
        { success: false, error: error.message },
        { status: 500 }
      );
    }

    await logActivity({
      userType: "Staff",
      userEmail: email,
      action: `Updated Walk-in Status: ${getEnrollmentStatusLabel(status)}`,
      details: {
        applicationId: id,
        reference: record.walk_in_reference ?? null,
        previousStatus: record.status ?? null,
        newStatus: status,
        remarks: remarks || null,
      },
    });

    return NextResponse.json({ success: true, record: data });
  }

  if (action === "section") {
    const rawSectionId = body.sectionId;
    const sectionId =
      rawSectionId == null || rawSectionId === ""
        ? null
        : text(rawSectionId, 80);

    if (sectionId) {
      const { data: section, error: sectionError } = await supabase
        .from("sections")
        .select("id, name, grade_level, track, strand, cluster, capacity")
        .eq("id", sectionId)
        .maybeSingle();

      if (sectionError) {
        return NextResponse.json(
          { success: false, error: sectionError.message },
          { status: 500 }
        );
      }

      if (!section) {
        return NextResponse.json(
          { success: false, error: "The selected section no longer exists." },
          { status: 404 }
        );
      }

      const sectionRecord = section as Record<string, unknown>;
      const recordTrack = normalizeTrack(record.track);
      const sectionTrack = normalizeTrack(sectionRecord.track);

      if (recordTrack && sectionTrack && recordTrack !== sectionTrack) {
        return NextResponse.json(
          {
            success: false,
            error: "The selected section belongs to a different track.",
          },
          { status: 400 }
        );
      }

      const recordGrade = text(record.grade_level, 40).toLowerCase();
      const sectionGrade = text(sectionRecord.grade_level, 40).toLowerCase();

      if (recordGrade && sectionGrade && recordGrade !== sectionGrade) {
        return NextResponse.json(
          {
            success: false,
            error: "The selected section belongs to a different grade level.",
          },
          { status: 400 }
        );
      }

      const capacity = Number(sectionRecord.capacity);

      if (Number.isFinite(capacity) && capacity > 0) {
        const { count } = await supabase
          .from("student_applications")
          .select("id", { count: "exact", head: true })
          .eq("assigned_section_id", sectionId)
          .neq("status", "denied");

        if (
          (count ?? 0) >= capacity &&
          String(record.assigned_section_id ?? "") !== sectionId
        ) {
          return NextResponse.json(
            {
              success: false,
              error: `Section ${sectionRecord.name ?? sectionId} is already full (${capacity} students).`,
            },
            { status: 409 }
          );
        }
      }
    }

    const { data, error } = await supabase
      .from("student_applications")
      .update({
        assigned_section_id: sectionId,
        updated_at: nowIso,
      })
      .eq("id", id)
      .eq("enrollment_type", "walk_in")
      .select("*")
      .single();

    if (error) {
      return NextResponse.json(
        { success: false, error: error.message },
        { status: 500 }
      );
    }

    await logActivity({
      userType: "Staff",
      userEmail: email,
      action: sectionId
        ? "Assigned Walk-in Section"
        : "Cleared Walk-in Section",
      details: {
        applicationId: id,
        reference: record.walk_in_reference ?? null,
        assignedSectionId: sectionId,
      },
    });

    return NextResponse.json({ success: true, record: data });
  }

  if (action === "requirements") {
    const submitted = body.requirementsSubmitted === true;

    const { data, error } = await supabase
      .from("student_applications")
      .update({
        requirements_submitted: submitted,
        updated_at: nowIso,
      })
      .eq("id", id)
      .eq("enrollment_type", "walk_in")
      .select("*")
      .single();

    if (error) {
      return NextResponse.json(
        { success: false, error: error.message },
        { status: 500 }
      );
    }

    await logActivity({
      userType: "Staff",
      userEmail: email,
      action: submitted
        ? "Marked Walk-in Requirements Complete"
        : "Marked Walk-in Requirements Incomplete",
      details: {
        applicationId: id,
        reference: record.walk_in_reference ?? null,
      },
    });

    return NextResponse.json({ success: true, record: data });
  }

  return NextResponse.json(
    { success: false, error: "Unsupported walk-in update action." },
    { status: 400 }
  );
}

export async function DELETE(_request: Request, context: RouteContext) {
  const auth = await requireStaffApi();
  if ("response" in auth) return auth.response;

  const { supabase, email, role } = auth.session;
  const { id } = await context.params;

  if (normalizeRole(role) === "registrar") {
    return NextResponse.json(
      {
        success: false,
        error:
          "Registrars can add walk-in records but cannot remove saved walk-in records.",
      },
      { status: 403 }
    );
  }

  if (!UUID_PATTERN.test(id)) {
    return NextResponse.json(
      { success: false, error: "A valid walk-in record ID is required." },
      { status: 400 }
    );
  }

  const { data: existing } = await supabase
    .from("student_applications")
    .select("id, walk_in_reference, first_name, last_name, requirements_documents")
    .eq("id", id)
    .eq("enrollment_type", "walk_in")
    .maybeSingle();

  if (!existing) {
    return NextResponse.json(
      { success: false, error: "Walk-in record not found." },
      { status: 404 }
    );
  }

  // Best-effort cleanup so deleting a record does not orphan uploaded files.
  try {
    const paths = storedDocumentPaths(existing.requirements_documents);
    if (paths.length > 0) {
      const bucket = await pickStorageBucket(supabase);
      await supabase.storage.from(bucket).remove(paths);
    }
  } catch (cleanupError) {
    console.warn("Could not remove walk-in requirement files:", cleanupError);
  }

  const { error } = await supabase
    .from("student_applications")
    .delete()
    .eq("id", id)
    .eq("enrollment_type", "walk_in");

  if (error) {
    return NextResponse.json(
      { success: false, error: error.message },
      { status: 500 }
    );
  }

  await logActivity({
    userType: "Staff",
    userEmail: email,
    action: "Deleted Walk-in Enrollment",
    details: {
      applicationId: id,
      reference: existing.walk_in_reference ?? null,
      studentName: [existing.first_name, existing.last_name]
        .filter(Boolean)
        .join(" "),
    },
  });

  return NextResponse.json({ success: true });
}
