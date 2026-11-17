import { NextResponse } from "next/server";
import { getAuthContext } from "@/lib/auth/server";
import { isStudentRole } from "@/lib/auth/roles";
import { getTrackForCluster, getTrackLabel } from "@/lib/clusters";
import { normalizeEnrollmentStatus } from "@/lib/enrollmentStatus";
import { generateEnrollmentSlipPdf } from "@/lib/enrollmentSlipPdf";
import { getStudentDashboardData } from "@/lib/studentDashboardData";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type AnyRecord = Record<string, unknown>;

function text(record: AnyRecord | null | undefined, keys: string[]): string {
  if (!record) return "";

  for (const key of keys) {
    const value = record[key];

    if (typeof value === "string" || typeof value === "number") {
      const result = String(value).trim();
      if (result) return result;
    }
  }

  return "";
}

function objectValue(value: unknown): AnyRecord | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as AnyRecord)
    : null;
}

function safeFileName(value: string): string {
  const cleaned = value
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-zA-Z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");

  return cleaned || "Student";
}

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
    const { application, section, studentProfile } =
      await getStudentDashboardData({
        userId: auth.user.id,
        email,
      });

    const details = objectValue(application?.student_details);
    const rawStatus =
      text(application, ["status", "application_status", "enrollment_status"]) ||
      text(details, ["status", "application_status"]) ||
      text(studentProfile, ["status"]);
    const normalizedStatus = normalizeEnrollmentStatus(rawStatus);

    if (normalizedStatus !== "enrolled") {
      return NextResponse.json(
        {
          success: false,
          error:
            "Your enrollment slip will be available once your application is approved or enrolled.",
        },
        { status: 403 }
      );
    }

    const fullName =
      text(studentProfile, ["full_name"]) ||
      [
        text(application, ["first_name"]),
        text(application, ["middle_name"]),
        text(application, ["last_name"]),
      ]
        .filter(Boolean)
        .join(" ") ||
      auth.profile?.full_name ||
      "Student";

    const cluster =
      text(studentProfile, ["selected_cluster"]) ||
      text(application, ["selected_cluster", "cluster", "cluster_name"]) ||
      text(details, ["selected_cluster", "cluster"]) ||
      text(section, ["cluster", "strand"]);

    const rawTrack =
      text(studentProfile, ["track"]) ||
      text(application, ["track", "selected_track"]) ||
      text(details, ["selected_track", "track"]) ||
      text(section, ["track"]) ||
      getTrackForCluster(cluster) ||
      "";

    const trackLabel = rawTrack ? getTrackLabel(rawTrack) : "";
    const track =
      trackLabel === "Senior High Track" && rawTrack ? rawTrack : trackLabel;
    const sectionName =
      text(studentProfile, ["assigned_section"]) ||
      text(section, ["name", "section_name"]);
    const adviser =
      text(studentProfile, ["adviser"]) ||
      text(section, ["adviser_name", "adviser"]);
    const applicationNumber =
      text(application, ["id"]) ||
      text(studentProfile, ["application_number"]) ||
      auth.user.id;
    const displayStatus = /approved/i.test(rawStatus)
      ? "Approved"
      : "Enrolled";
    const issuedAt = new Date().toLocaleDateString("en-PH", {
      year: "numeric",
      month: "long",
      day: "numeric",
    });

    const pdf = generateEnrollmentSlipPdf({
      fullName,
      email,
      status: displayStatus,
      track,
      cluster,
      section: sectionName,
      adviser,
      applicationNumber,
      issuedAt,
    });

    const fileName = `${safeFileName(fullName)}-Enrollment-Slip.pdf`;

    return new NextResponse(new Blob([new Uint8Array(pdf)], { type: "application/pdf" }), {
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `attachment; filename="${fileName}"`,
        "Cache-Control": "no-store",
      },
    });
  } catch (error: unknown) {
    console.error("Enrollment slip generation failed:", error);

    return NextResponse.json(
      {
        success: false,
        error: "Unable to generate your enrollment slip right now.",
      },
      { status: 500 }
    );
  }
}
