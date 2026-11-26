import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { getAuthContext } from "@/lib/auth/server";
import { isStudentRole } from "@/lib/auth/roles";
import { logActivity } from "@/lib/activityLog";
import { syncStudentProfile } from "@/lib/studentProfiles";
import {
  STORAGE_FOLDERS,
  buildStoragePath,
  pickStorageBucket,
} from "@/lib/enrollRequirements";
import { normalizeEnrollmentStatus } from "@/lib/enrollmentStatus";

export const runtime = "nodejs";
export const maxDuration = 60;

const MAX_FILE_SIZE = 10 * 1024 * 1024;

const ALLOWED_EXTENSIONS = new Set([
  "jpg",
  "jpeg",
  "jpe",
  "jfif",
  "png",
  "gif",
  "webp",
  "bmp",
  "tif",
  "tiff",
  "heic",
  "heif",
  "avif",
  "svg",
  "ico",
  "pdf",
]);

const CONTENT_TYPE_BY_EXTENSION: Record<string, string> = {
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  jpe: "image/jpeg",
  jfif: "image/jpeg",
  png: "image/png",
  gif: "image/gif",
  webp: "image/webp",
  bmp: "image/bmp",
  tif: "image/tiff",
  tiff: "image/tiff",
  heic: "image/heic",
  heif: "image/heif",
  avif: "image/avif",
  svg: "image/svg+xml",
  ico: "image/x-icon",
  pdf: "application/pdf",
};

function asRecord(value: unknown): Record<string, unknown> {
  if (typeof value === "string") {
    try {
      const parsed: unknown = JSON.parse(value);
      return parsed && typeof parsed === "object" && !Array.isArray(parsed)
        ? (parsed as Record<string, unknown>)
        : {};
    } catch {
      return {};
    }
  }

  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function getExtension(file: File): string {
  return file.name.split(".").pop()?.toLowerCase() || "";
}

function isAllowedFile(file: File): boolean {
  const type = (file.type || "").toLowerCase();
  const extension = getExtension(file);

  return (
    type.startsWith("image/") ||
    type === "application/pdf" ||
    ALLOWED_EXTENSIONS.has(extension)
  );
}

function resolveContentType(file: File): string {
  if (file.type) return file.type;
  return (
    CONTENT_TYPE_BY_EXTENSION[getExtension(file)] || "application/octet-stream"
  );
}

export async function POST(request: Request) {
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

    const formData = await request.formData();
    const birthCert = formData.get("birthCertificate") as File | null;
    const reportCard = formData.get("reportCard") as File | null;
    const form137 = formData.get("form137") as File | null;

    if (!birthCert || !reportCard) {
      return NextResponse.json(
        {
          success: false,
          error: "Both Birth Certificate and Grade 10 Report Card are required.",
        },
        { status: 400 }
      );
    }

    const files = [birthCert, reportCard, form137].filter(
      (file): file is File => Boolean(file)
    );

    for (const file of files) {
      if (!isAllowedFile(file)) {
        return NextResponse.json(
          {
            success: false,
            error: `${file.name}: only image files or PDF files are accepted.`,
          },
          { status: 400 }
        );
      }

      if (file.size > MAX_FILE_SIZE) {
        return NextResponse.json(
          {
            success: false,
            error: `${file.name}: the maximum file size is 10 MB.`,
          },
          { status: 400 }
        );
      }
    }

    const supabaseUrl =
      process.env.NEXT_PUBLIC_SUPABASE_URL ||
      "https://tmrimwhwwvojbsztnbxf.supabase.co";
    const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

    if (!supabaseKey) {
      return NextResponse.json(
        { success: false, error: "Supabase service configuration is missing." },
        { status: 500 }
      );
    }

    const supabaseAdmin = createClient(supabaseUrl, supabaseKey, {
      auth: { persistSession: false },
    });

    const { data: application, error: fetchError } = await supabaseAdmin
      .from("student_applications")
      .select("*")
      .eq("user_id", auth.user.id)
      .order("submitted_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (fetchError) {
      return NextResponse.json(
        {
          success: false,
          error: `Could not load your application: ${fetchError.message}`,
        },
        { status: 500 }
      );
    }

    if (!application) {
      return NextResponse.json(
        { success: false, error: "No enrollment application was found for this account." },
        { status: 404 }
      );
    }

    if (normalizeEnrollmentStatus(application.status) !== "denied") {
      return NextResponse.json(
        {
          success: false,
          error:
            "Requirements can only be resubmitted when your application is marked as Denied.",
        },
        { status: 409 }
      );
    }

    const applicationId = String(application.id);
    const bucket = await pickStorageBucket(supabaseAdmin);

    const uploadFile = async (file: File, kind: keyof typeof STORAGE_FOLDERS) => {
      const path = buildStoragePath(
        applicationId,
        STORAGE_FOLDERS[kind],
        file.name
      );
      const buffer = Buffer.from(await file.arrayBuffer());

      const { error: uploadError } = await supabaseAdmin.storage
        .from(bucket)
        .upload(path, buffer, {
          contentType: resolveContentType(file),
          upsert: true,
        });

      if (uploadError) {
        throw new Error(
          `Storage upload failed for ${file.name}: ${uploadError.message}`
        );
      }

      const { data: publicData } = supabaseAdmin.storage
        .from(bucket)
        .getPublicUrl(path);

      let signedUrl = publicData?.publicUrl || "";

      try {
        const { data: signedData } = await supabaseAdmin.storage
          .from(bucket)
          .createSignedUrl(path, 60 * 60 * 24 * 365);

        if (signedData?.signedUrl) {
          signedUrl = signedData.signedUrl;
        }
      } catch {
        // Fall back to the public URL.
      }

      return {
        path,
        publicUrl: publicData?.publicUrl || "",
        signedUrl: signedUrl || publicData?.publicUrl || "",
        name: file.name,
        size: file.size,
        type: file.type,
      };
    };

    const [bcResult, rcResult] = await Promise.all([
      uploadFile(birthCert, "birthCertificate"),
      uploadFile(reportCard, "reportCard"),
    ]);

    const otherResult = form137
      ? await uploadFile(form137, "form137")
      : null;

    const nowIso = new Date().toISOString();
    const existingDocuments = asRecord(application.requirements_documents);
    const studentDetails = asRecord(application.student_details);
    const previousRemarks =
      typeof application.registrar_remarks === "string"
        ? application.registrar_remarks
        : "";

    const history = Array.isArray(studentDetails.denial_remarks_history)
      ? (studentDetails.denial_remarks_history as unknown[])
      : [];

    const updatedStudentDetails = {
      ...studentDetails,
      denial_remarks_history: previousRemarks
        ? [
            ...history,
            {
              remarks: previousRemarks,
              recorded_at: nowIso,
            },
          ]
        : history,
      requirements_resubmitted_at: nowIso,
    };

    const requirementsDocuments = {
      ...existingDocuments,
      student_name: existingDocuments.student_name ?? null,
      student_contact: existingDocuments.student_contact ?? null,
      student_email: existingDocuments.student_email ?? application.email ?? null,
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
      resubmitted_at: nowIso,
      submitted_at: nowIso,
    };

    const fullUpdate: Record<string, unknown> = {
      status: "pending",
      requirements_documents: requirementsDocuments,
      birth_certificate_url: bcResult.signedUrl || bcResult.publicUrl,
      report_card_url: rcResult.signedUrl || rcResult.publicUrl,
      other_requirement_url:
        otherResult?.signedUrl || otherResult?.publicUrl || null,
      requirements_submitted: true,
      registrar_remarks: null,
      student_details: updatedStudentDetails,
      updated_at: nowIso,
    };

    let updateResult = await supabaseAdmin
      .from("student_applications")
      .update(fullUpdate)
      .eq("id", applicationId)
      .select("id, status, requirements_documents");

    if (updateResult.error) {
      updateResult = await supabaseAdmin
        .from("student_applications")
        .update({
          status: "pending",
          requirements_documents: requirementsDocuments,
          requirements_submitted: true,
          registrar_remarks: null,
          updated_at: nowIso,
        })
        .eq("id", applicationId)
        .select("id, status, requirements_documents");
    }

    if (updateResult.error) {
      throw new Error(
        `Could not save your resubmitted requirements: ${updateResult.error.message}`
      );
    }

    await syncStudentProfile(supabaseAdmin, applicationId);

    await logActivity({
      userType: "Student",
      userEmail: auth.user.email || String(application.email || ""),
      action: "Resubmitted Enrollment Requirements",
      details: {
        applicationId,
        documents: {
          birthCertificate: birthCert.name,
          reportCard: reportCard.name,
          form137: form137?.name || null,
        },
        previousRemarks: previousRemarks || null,
        timestamp: nowIso,
      },
    });

    return NextResponse.json({
      success: true,
      message:
        "Your requirements were resubmitted. Your application is back in the pending review queue.",
      data: {
        applicationId,
        status: "pending",
        requirements_documents: requirementsDocuments,
        storageBucket: bucket,
      },
    });
  } catch (error: unknown) {
    console.error("Student resubmit requirements error:", error);
    return NextResponse.json(
      {
        success: false,
        error:
          error instanceof Error
            ? error.message
            : "Could not resubmit your requirements.",
      },
      { status: 500 }
    );
  }
}
