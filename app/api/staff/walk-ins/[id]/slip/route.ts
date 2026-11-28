import { NextResponse } from "next/server";
import { getTrackForCluster, getTrackLabel } from "@/lib/clusters";
import {
  getEnrollmentStatusLabel,
  normalizeEnrollmentStatus,
} from "@/lib/enrollmentStatus";
import { generateEnrollmentSlipPdf } from "@/lib/enrollmentSlipPdf";
import { requireStaffApi } from "@/lib/staffApiAuth";
import { walkInFullName } from "@/lib/walkInEnrollment";

export const runtime = "nodejs";

type RouteContext = { params: Promise<{ id: string }> };

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function text(value: unknown, maxLength = 250): string {
  return typeof value === "string" ? value.trim().slice(0, maxLength) : "";
}

function safeFileName(value: string): string {
  return (
    value
      .replace(/[^a-zA-Z0-9._-]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 80) || "Walk-in-Student"
  );
}

export async function GET(_request: Request, context: RouteContext) {
  const auth = await requireStaffApi();
  if ("response" in auth) return auth.response;

  const { supabase } = auth.session;
  const { id } = await context.params;

  if (!UUID_PATTERN.test(id)) {
    return NextResponse.json(
      { success: false, error: "A valid walk-in record ID is required." },
      { status: 400 }
    );
  }

  const { data, error } = await supabase
    .from("student_applications")
    .select("*")
    .eq("id", id)
    .eq("enrollment_type", "walk_in")
    .maybeSingle();

  if (error) {
    return NextResponse.json(
      { success: false, error: error.message },
      { status: 500 }
    );
  }

  if (!data) {
    return NextResponse.json(
      { success: false, error: "Walk-in record not found." },
      { status: 404 }
    );
  }

  const record = data as Record<string, unknown>;
  const status = normalizeEnrollmentStatus(record.status);

  if (status !== "enrolled") {
    return NextResponse.json(
      {
        success: false,
        error:
          "Mark the walk-in student as Enrolled before printing the enrollment slip.",
      },
      { status: 409 }
    );
  }

  let sectionName = "";
  let adviser = "";

  if (record.assigned_section_id) {
    const { data: section } = await supabase
      .from("sections")
      .select("name, adviser_name")
      .eq("id", record.assigned_section_id)
      .maybeSingle();

    if (section) {
      const sectionRecord = section as Record<string, unknown>;
      sectionName = text(sectionRecord.name);
      adviser = text(sectionRecord.adviser_name);
    }
  }

  const fullName = walkInFullName(record) || "Walk-in Student";
  const cluster = text(record.selected_cluster) || text(record.strand);
  const rawTrack = text(record.track) || getTrackForCluster(cluster) || "";
  const track = rawTrack ? getTrackLabel(rawTrack) : "";
  const issuedAt = new Date().toLocaleDateString("en-PH", {
    year: "numeric",
    month: "long",
    day: "numeric",
  });

  const pdf = generateEnrollmentSlipPdf({
    fullName,
    email: text(record.email) || "Walk-in enrollee (no email)",
    status: getEnrollmentStatusLabel(status),
    track,
    cluster,
    section: sectionName,
    adviser,
    issuedAt,
  });

  const fileName = `${safeFileName(fullName)}-Walk-in-Enrollment-Slip.pdf`;

  return new NextResponse(
    new Blob([new Uint8Array(pdf)], { type: "application/pdf" }),
    {
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `attachment; filename="${fileName}"`,
        "Cache-Control": "no-store",
      },
    }
  );
}
