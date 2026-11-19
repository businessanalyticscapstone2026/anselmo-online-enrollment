import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { randomUUID } from "node:crypto";

export const runtime = "nodejs";

const BUCKET = "enrollment-documents.";
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

function getExtension(name: string) {
  return name.split(".").pop()?.toLowerCase() || "";
}

function isAllowedFile(file: File) {
  const type = (file.type || "").toLowerCase();
  return (
    type.startsWith("image/") ||
    type === "application/pdf" ||
    ALLOWED_EXTENSIONS.has(getExtension(file.name))
  );
}

function resolveContentType(file: File) {
  if (file.type) return file.type;
  return (
    CONTENT_TYPE_BY_EXTENSION[getExtension(file.name)] ||
    "application/octet-stream"
  );
}

function getAdminClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error("Server Supabase configuration is missing.");

  return createClient(url, key, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}

function jsonError(error: string, status: number) {
  return NextResponse.json({ success: false, error }, { status });
}

export async function POST(request: Request) {
  const uploadedPaths: string[] = [];
  let supabase: ReturnType<typeof getAdminClient> | null = null;

  try {
    const form = await request.formData();
    const applicationId = String(form.get("applicationId") ?? "").trim();
    const email = String(form.get("email") ?? "").trim().toLowerCase();
    const birthCertificate = form.get("birthCertificate");
    const reportCard = form.get("reportCard");
    const form137 = form.get("form137");

    if (
      !applicationId ||
      !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(applicationId)
    ) {
      return jsonError("A valid application ID is required.", 400);
    }

    if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return jsonError("A valid applicant email is required.", 400);
    }

    if (!(birthCertificate instanceof File) || !(reportCard instanceof File)) {
      return jsonError("Birth certificate and Grade 10 report card are required.", 400);
    }

    const files = [
      { field: "birthCertificate", file: birthCertificate },
      { field: "reportCard", file: reportCard },
      ...(form137 instanceof File && form137.size > 0
        ? [{ field: "form137", file: form137 }]
        : []),
    ];

    for (const item of files) {
      if (item.file.size <= 0 || item.file.size > MAX_FILE_SIZE) {
        return jsonError(`${item.file.name} must be between 1 byte and 10 MB.`, 400);
      }
      if (!isAllowedFile(item.file)) {
        return jsonError(
          `${item.file.name} must be an image (JPG, PNG, GIF, WEBP, HEIC, etc.) or a PDF file.`,
          400
        );
      }
    }

    supabase = getAdminClient();

    // The enrollment API stores email inside student_details JSONB.
    const { data: application, error: lookupError } = await supabase
      .from("student_applications")
      .select("id, status, student_details")
      .eq("id", applicationId)
      .maybeSingle();

    if (lookupError) {
      console.error("Application lookup failed:", lookupError);
      return jsonError("Could not verify the enrollment application.", 500);
    }

    if (!application) {
      console.error("No application found for ID:", applicationId);

      return jsonError(
        "No matching enrollment application was found. Please check your application ID.",
        404
      );
    }

    const savedEmail =
      typeof application.student_details?.email === "string"
        ? application.student_details.email.trim().toLowerCase()
        : "";

    if (savedEmail !== email) {
      return jsonError(
        "The email does not match this enrollment application.",
        403
      );
    }

    if (["enrolled", "approved"].includes(String(application.status ?? "").toLowerCase())) {
      return jsonError("This application is already approved or enrolled.", 409);
    }

    const paths: Record<string, string | null> = {
      psa_birth_certificate: null,
      grade_10_report_card: null,
      form_137: null,
    };

    for (const item of files) {
      const safeName =
        item.file.name.replace(/[^a-zA-Z0-9._-]/g, "_").slice(-120) || "document";
      const path = `${applicationId}/${randomUUID()}-${safeName}`;
      const bytes = Buffer.from(await item.file.arrayBuffer());

      const { data, error } = await supabase.storage
        .from(BUCKET)
        .upload(path, bytes, {
          contentType: resolveContentType(item.file),
          upsert: false,
        });

      if (error) {
        console.error("Storage upload failed:", error.message);
        throw new Error(`Could not upload ${item.file.name}: ${error.message}`);
      }

      uploadedPaths.push(data.path);
      if (item.field === "birthCertificate") paths.psa_birth_certificate = data.path;
      else if (item.field === "reportCard") paths.grade_10_report_card = data.path;
      else if (item.field === "form137") paths.form_137 = data.path;
    }

    // Do not filter by `email`: that column is not in the confirmed table schema.
    const { error: updateError } = await supabase
      .from("student_applications")
      .update({
        requirements_documents: paths,
        status: "pending",
        updated_at: new Date().toISOString(),
      })
      .eq("id", applicationId);

    if (updateError) {
      console.error("Application update failed:", updateError.message);
      throw new Error(`Documents uploaded, but the application could not be updated: ${updateError.message}`);
    }

    return NextResponse.json({
      success: true,
      message: "Enrollment documents uploaded successfully.",
      data: {
        applicationId: application.id,
        requirements_documents: paths,
      },
    });
  } catch (error) {
    console.error("Requirements upload route failed:", error);

    if (supabase && uploadedPaths.length > 0) {
      try {
        const { error: cleanupError } = await supabase.storage
          .from(BUCKET)
          .remove(uploadedPaths);
        if (cleanupError) console.error("Upload cleanup failed:", cleanupError.message);
      } catch (cleanupError) {
        console.error("Upload cleanup failed:", cleanupError);
      }
    }

    return jsonError(
      error instanceof Error ? error.message : "Unexpected upload error.",
      500
    );
  }
}
