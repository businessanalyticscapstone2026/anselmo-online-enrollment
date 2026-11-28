import { NextResponse } from "next/server";
import type { SupabaseClient } from "@supabase/supabase-js";
import { logActivity } from "@/lib/activityLog";
import { requireStaffApi } from "@/lib/staffApiAuth";
import {
  buildStoragePath,
  pickStorageBucket,
  sanitizeStorageName,
} from "@/lib/enrollRequirements";
import { walkInFullName } from "@/lib/walkInEnrollment";

export const runtime = "nodejs";

type RouteContext = { params: Promise<{ id: string }> };

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const FILE_FIELDS = [
  {
    field: "reportCard",
    folder: "report-cards",
    key: "report_card",
    column: "report_card_url",
  },
  {
    field: "birthCertificate",
    folder: "birth-certificates",
    key: "birth_certificate",
    column: "birth_certificate_url",
  },
  {
    field: "otherRequirement",
    folder: "other-requirements",
    key: "other_requirement",
    column: "other_requirement_url",
  },
] as const;

type JsonRecord = Record<string, unknown>;

function asRecord(value: unknown): JsonRecord {
  if (typeof value === "string") {
    try {
      const parsed: unknown = JSON.parse(value);
      return parsed && typeof parsed === "object" && !Array.isArray(parsed)
        ? (parsed as JsonRecord)
        : {};
    } catch {
      return {};
    }
  }

  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as JsonRecord)
    : {};
}

function text(value: unknown, maxLength = 250): string {
  return typeof value === "string" ? value.trim().slice(0, maxLength) : "";
}

function isUploadedFile(value: FormDataEntryValue | null): value is File {
  return (
    typeof value === "object" &&
    value !== null &&
    typeof (value as File).arrayBuffer === "function" &&
    typeof (value as File).name === "string"
  );
}

function resolveContentType(file: File): string {
  if (file.type) return file.type;

  const extension = file.name.split(".").pop()?.toLowerCase() || "";

  if (extension === "pdf") return "application/pdf";
  if (extension === "png") return "image/png";
  if (extension === "jpg" || extension === "jpeg") return "image/jpeg";
  if (extension === "webp") return "image/webp";
  if (extension === "doc") return "application/msword";
  if (extension === "docx") {
    return "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
  }

  return "application/octet-stream";
}

async function uploadDocument(
  supabase: SupabaseClient,
  bucket: string,
  rowId: string,
  folder: string,
  file: File
) {
  const buffer = Buffer.from(await file.arrayBuffer());
  const filePath = buildStoragePath(rowId, folder, sanitizeStorageName(file.name));

  const { data, error } = await supabase.storage
    .from(bucket)
    .upload(filePath, buffer, {
      contentType: resolveContentType(file),
      upsert: true,
    });

  if (error) {
    throw new Error(`Storage upload failed for ${file.name}: ${error.message}`);
  }

  const { data: publicData } = supabase.storage
    .from(bucket)
    .getPublicUrl(filePath);

  let signedUrl = publicData?.publicUrl || "";

  try {
    const { data: signData } = await supabase.storage
      .from(bucket)
      .createSignedUrl(filePath, 60 * 60 * 24 * 365);

    if (signData?.signedUrl) {
      signedUrl = signData.signedUrl;
    }
  } catch {
    // Fall back to the public URL.
  }

  return {
    path: data?.path || filePath,
    publicUrl: publicData?.publicUrl || "",
    signedUrl: signedUrl || publicData?.publicUrl || "",
    name: file.name,
    size: file.size,
    type: file.type,
    uploaded_at: new Date().toISOString(),
  };
}

export async function POST(request: Request, context: RouteContext) {
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

  const { data: existing, error: fetchError } = await supabase
    .from("student_applications")
    .select("*")
    .eq("id", id)
    .eq("enrollment_type", "walk_in")
    .maybeSingle();

  if (fetchError) {
    return NextResponse.json(
      { success: false, error: fetchError.message },
      { status: 500 }
    );
  }

  if (!existing) {
    return NextResponse.json(
      { success: false, error: "Walk-in record not found." },
      { status: 404 }
    );
  }

  let formData: FormData;
  try {
    formData = await request.formData();
  } catch {
    return NextResponse.json(
      { success: false, error: "Invalid requirements upload." },
      { status: 400 }
    );
  }

  const record = existing as JsonRecord;
  const documents = { ...asRecord(record.requirements_documents) };
  const update: JsonRecord = {};
  const uploaded: string[] = [];

  let bucket: string;
  try {
    bucket = await pickStorageBucket(supabase);
  } catch (error) {
    return NextResponse.json(
      {
        success: false,
        error:
          error instanceof Error
            ? error.message
            : "The requirements storage bucket is unavailable.",
      },
      { status: 500 }
    );
  }

  try {
    for (const definition of FILE_FIELDS) {
      const file = formData.get(definition.field);
      if (!isUploadedFile(file) || file.size === 0) continue;

      const result = await uploadDocument(
        supabase,
        bucket,
        id,
        definition.folder,
        file
      );

      documents[definition.key] = result;
      documents[`${definition.key}_url`] =
        result.signedUrl || result.publicUrl;
      documents[`${definition.key}_path`] = result.path;
      update[definition.column] = result.signedUrl || result.publicUrl;
      uploaded.push(definition.key);
    }
  } catch (error) {
    return NextResponse.json(
      {
        success: false,
        error:
          error instanceof Error
            ? error.message
            : "The requirement files could not be uploaded.",
      },
      { status: 500 }
    );
  }

  const markSubmittedValue = formData.get("markSubmitted");
  const markSubmitted =
    markSubmittedValue === "true" || markSubmittedValue === "on";

  // Completeness is a registrar decision: only the explicit checkbox changes
  // it. Uploading a file on its own must not silently mark the record complete.
  const requirementsSubmitted = markSubmitted
    ? true
    : record.requirements_submitted === true;

  if (uploaded.length === 0 && !markSubmitted) {
    return NextResponse.json(
      {
        success: false,
        error:
          "Select at least one requirement file to upload, or mark the requirements as complete.",
      },
      { status: 400 }
    );
  }

  const nowIso = new Date().toISOString();

  documents.student_name = walkInFullName(record) || null;
  documents.student_contact = text(record.contact_number) || null;
  documents.requirements_submitted = requirementsSubmitted;
  documents.submitted_at = nowIso;
  documents.encoded_by = userId;
  documents.encoded_by_email = email || null;

  update.requirements_documents = documents;
  update.requirements_submitted = requirementsSubmitted;
  update.updated_at = nowIso;

  const { data, error } = await supabase
    .from("student_applications")
    .update(update)
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
    action: "Uploaded Walk-in Requirements",
    details: {
      applicationId: id,
      reference: record.walk_in_reference ?? null,
      uploaded,
      requirementsSubmitted,
    },
  });

  return NextResponse.json({ success: true, record: data });
}
