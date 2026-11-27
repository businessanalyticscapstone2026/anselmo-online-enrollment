import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { logActivity } from "@/lib/activityLog";
import { normalizeEnrollmentStatus } from "@/lib/enrollmentStatus";
import {
  STORAGE_FOLDERS,
  cleanStorageSegment,
  pickStorageBucket,
  resolveApplicationForUpload,
  type UploadKind,
} from "@/lib/enrollRequirements";

export const runtime = "nodejs";

type CompletedFile = {
  path?: unknown;
  name?: unknown;
  size?: unknown;
  type?: unknown;
};

type CompleteBody = {
  applicationId?: unknown;
  draftId?: unknown;
  email?: unknown;
  contactNumber?: unknown;
  studentName?: unknown;
  files?: unknown;
};

const DRAFT_ID_PATTERN = /^[a-zA-Z0-9-]{8,80}$/;

function draftIdFrom(value: unknown): string {
  if (typeof value !== "string") return "";
  const candidate = value.trim();
  return DRAFT_ID_PATTERN.test(candidate) ? candidate : "";
}

type StoredDocument = {
  path: string;
  publicUrl: string;
  signedUrl: string;
  name: string;
  size: number | null;
  type: string;
};

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function text(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function fileSize(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) && value >= 0
    ? Math.trunc(value)
    : null;
}

export async function POST(request: Request) {
  try {
    const body = (await request.json().catch(() => null)) as CompleteBody | null;

    if (!body || !body.files || typeof body.files !== "object") {
      return NextResponse.json(
        { success: false, error: "The uploaded document details are missing." },
        { status: 400 }
      );
    }

    const files = asRecord(body.files);
    const birthCertificate = asRecord(files.birthCertificate) as CompletedFile;
    const reportCard = asRecord(files.reportCard) as CompletedFile;
    const form137 = asRecord(files.form137) as CompletedFile;

    if (!text(birthCertificate.path) || !text(reportCard.path)) {
      return NextResponse.json(
        {
          success: false,
          error: "Both Birth Certificate and Grade 10 Report Card are required.",
        },
        { status: 400 }
      );
    }

    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

    if (!supabaseUrl || !serviceRoleKey) {
      return NextResponse.json(
        { success: false, error: "Supabase service configuration is missing." },
        { status: 500 }
      );
    }

    const supabaseAdmin = createClient(supabaseUrl, serviceRoleKey, {
      auth: { persistSession: false },
    });

    const draftId = draftIdFrom(body.draftId);

    if (body.draftId !== undefined && body.draftId !== "" && !draftId) {
      return NextResponse.json(
        { success: false, error: "The enrollment draft ID is invalid." },
        { status: 400 }
      );
    }

    let targetRowId = draftId;
    let storedEmail = text(body.email);
    let currentApplication: Record<string, unknown> | null = null;

    if (!draftId) {
      const resolved = await resolveApplicationForUpload(supabaseAdmin, body);

      if ("error" in resolved) {
        return NextResponse.json(
          { success: false, error: resolved.error, code: resolved.code },
          { status: resolved.status }
        );
      }

      currentApplication = resolved.application;
      targetRowId = String(resolved.application.id);
      storedEmail = resolved.storedEmail;
    }

    const bucket = await pickStorageBucket(supabaseAdmin);
    const cleanId = cleanStorageSegment(targetRowId);

    const isOwnedPath = (path: string, kind: UploadKind) =>
      path.startsWith(`${STORAGE_FOLDERS[kind]}/${cleanId}-`) &&
      !path.includes("..");

    const storeFile = async (
      file: CompletedFile,
      kind: UploadKind
    ): Promise<StoredDocument> => {
      const path = text(file.path);
      const name = text(file.name) || path.split("/").pop() || "document";

      if (!isOwnedPath(path, kind)) {
        throw new Error(`The uploaded ${name} does not belong to this application.`);
      }

      const { data: signed, error: signError } = await supabaseAdmin.storage
        .from(bucket)
        .createSignedUrl(path, 60 * 60 * 24 * 365);

      if (signError || !signed?.signedUrl) {
        throw new Error(
          `The uploaded ${name} could not be verified: ${
            signError?.message || "file not found"
          }`
        );
      }

      const { data: publicData } = supabaseAdmin.storage
        .from(bucket)
        .getPublicUrl(path);

      return {
        path,
        publicUrl: publicData?.publicUrl || "",
        signedUrl: signed.signedUrl,
        name,
        size: fileSize(file.size),
        type: text(file.type),
      };
    };

    const [bcResult, rcResult] = await Promise.all([
      storeFile(birthCertificate, "birthCertificate"),
      storeFile(reportCard, "reportCard"),
    ]);

    const otherResult = text(form137.path)
      ? await storeFile(form137, "form137")
      : null;

    const nowIso = new Date().toISOString();
    const studentName = text(body.studentName);
    const providedContact = text(body.contactNumber);

    const requirementsDocuments = {
      student_name: studentName || null,
      student_contact: providedContact || null,
      student_email: storedEmail || null,
      storage_bucket: bucket,
      birth_certificate: bcResult,
      birth_certificate_url: bcResult.signedUrl || bcResult.publicUrl,
      birth_certificate_path: bcResult.path,
      report_card: rcResult,
      report_card_url: rcResult.signedUrl || rcResult.publicUrl,
      report_card_path: rcResult.path,
      other_requirement: otherResult,
      other_requirement_url:
        otherResult?.signedUrl || otherResult?.publicUrl || null,
      other_requirement_path: otherResult?.path || null,
      requirements_submitted: true,
      submitted_at: nowIso,
    };

    // A denied applicant who uploads new documents re-enters the pending
    // review queue. Keep the application row and archive the denial reason so
    // the record is not lost when the status changes back to pending.
    const isDeniedResubmission =
      !draftId &&
      normalizeEnrollmentStatus(currentApplication?.status) === "denied";
    const existingDetails = asRecord(currentApplication?.student_details);
    const previousRemarks =
      typeof currentApplication?.registrar_remarks === "string"
        ? currentApplication.registrar_remarks.trim()
        : "";
    const denialHistory = Array.isArray(existingDetails.denial_remarks_history)
      ? (existingDetails.denial_remarks_history as unknown[])
      : [];
    const baseResubmissionFields = isDeniedResubmission
      ? { status: "pending", registrar_remarks: null }
      : {};
    const fullResubmissionFields = isDeniedResubmission
      ? {
          ...baseResubmissionFields,
          student_details: {
            ...existingDetails,
            denial_remarks_history: previousRemarks
              ? [
                  ...denialHistory,
                  { remarks: previousRemarks, recorded_at: nowIso },
                ]
              : denialHistory,
            requirements_resubmitted_at: nowIso,
          },
        }
      : {};

    if (!draftId) {
      const fullUpdate: Record<string, unknown> = {
        ...fullResubmissionFields,
        requirements_documents: requirementsDocuments,
        birth_certificate_url: bcResult.signedUrl || bcResult.publicUrl,
        report_card_url: rcResult.signedUrl || rcResult.publicUrl,
        other_requirement_url:
          otherResult?.signedUrl || otherResult?.publicUrl || null,
        requirements_submitted: true,
        updated_at: nowIso,
      };

      let updateRes = await supabaseAdmin
        .from("student_applications")
        .update(fullUpdate)
        .eq("id", targetRowId)
        .select("id, requirements_documents");

      // Fallback if extra columns do not exist in the table.
      if (updateRes.error) {
        updateRes = await supabaseAdmin
          .from("student_applications")
          .update({
            ...baseResubmissionFields,
            requirements_documents: requirementsDocuments,
            updated_at: nowIso,
          })
          .eq("id", targetRowId)
          .select("id, requirements_documents");
      }

      if (updateRes.error) {
        throw new Error(
          `Failed to record requirements in student_applications: ${updateRes.error.message}`
        );
      }

      await logActivity({
        userType: "Student",
        userEmail: text(body.email) || storedEmail || "",
        action: isDeniedResubmission
          ? "Resubmitted Enrollment Requirements"
          : "Uploaded Enrollment Requirements",
        details: {
          applicationId: targetRowId,
          studentName: studentName || null,
          documents: {
            birthCertificate: bcResult.name,
            reportCard: rcResult.name,
            form137: otherResult?.name || null,
          },
          previousRemarks: previousRemarks || null,
          timestamp: nowIso,
        },
      });
    }

    return NextResponse.json({
      success: true,
      message: draftId
        ? "Requirements uploaded. They will be recorded when the account step is completed."
        : isDeniedResubmission
          ? "Your requirements were resubmitted. Your application is back in the pending review queue."
          : "Requirements uploaded and recorded successfully.",
      data: {
        applicationId: draftId ? null : targetRowId,
        draftId: draftId || null,
        status: isDeniedResubmission ? "pending" : undefined,
        requirements_documents: requirementsDocuments,
        storageBucket: bucket,
      },
    });
  } catch (error: unknown) {
    console.error("Complete requirements upload error:", error);

    return NextResponse.json(
      {
        success: false,
        error:
          error instanceof Error
            ? error.message
            : "Document upload failed.",
      },
      { status: 500 }
    );
  }
}
