import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import {
  STORAGE_FOLDERS,
  buildStoragePath,
  pickStorageBucket,
  resolveApplicationForUpload,
  type UploadKind,
} from "@/lib/enrollRequirements";

export const runtime = "nodejs";

type PrepareFile = {
  kind?: unknown;
  name?: unknown;
};

type PrepareBody = {
  applicationId?: unknown;
  email?: unknown;
  contactNumber?: unknown;
  files?: unknown;
};

function isUploadKind(value: unknown): value is UploadKind {
  return (
    typeof value === "string" &&
    Object.prototype.hasOwnProperty.call(STORAGE_FOLDERS, value)
  );
}

export async function POST(request: Request) {
  try {
    const body = (await request.json().catch(() => null)) as PrepareBody | null;

    if (!body || !Array.isArray(body.files) || body.files.length === 0) {
      return NextResponse.json(
        { success: false, error: "No documents were provided for upload." },
        { status: 400 }
      );
    }

    const files = (body.files as PrepareFile[]).filter(
      (file): file is PrepareFile & { kind: UploadKind } =>
        Boolean(file) && isUploadKind(file.kind)
    );

    if (files.length === 0) {
      return NextResponse.json(
        { success: false, error: "No valid documents were provided." },
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

    const resolved = await resolveApplicationForUpload(supabaseAdmin, body);

    if ("error" in resolved) {
      return NextResponse.json(
        { success: false, error: resolved.error, code: resolved.code },
        { status: resolved.status }
      );
    }

    const targetRowId = String(resolved.application.id);
    const bucket = await pickStorageBucket(supabaseAdmin);

    const uploads: Record<
      UploadKind,
      { name: string; path: string; token: string }
    > = {} as Record<
      UploadKind,
      { name: string; path: string; token: string }
    >;

    for (const file of files) {
      const name =
        typeof file.name === "string" && file.name.trim()
          ? file.name.trim()
          : "document";
      const path = buildStoragePath(
        targetRowId,
        STORAGE_FOLDERS[file.kind],
        name
      );

      const signed = await supabaseAdmin.storage
        .from(bucket)
        .createSignedUploadUrl(path, { upsert: true });

      if (signed.error || !signed.data) {
        return NextResponse.json(
          {
            success: false,
            error: `Could not prepare the upload for ${name}: ${
              signed.error?.message || "Unknown storage error"
            }`,
          },
          { status: 500 }
        );
      }

      uploads[file.kind] = {
        name,
        path,
        token: signed.data.token,
      };
    }

    return NextResponse.json({
      success: true,
      bucket,
      applicationId: targetRowId,
      uploads,
    });
  } catch (error: unknown) {
    console.error("Prepare requirements upload error:", error);

    return NextResponse.json(
      {
        success: false,
        error:
          error instanceof Error
            ? error.message
            : "Could not prepare the document upload.",
      },
      { status: 500 }
    );
  }
}
