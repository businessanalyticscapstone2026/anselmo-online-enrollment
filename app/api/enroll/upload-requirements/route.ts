import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { logActivity } from "@/lib/activityLog";

const MAX_FILE_SIZE = 10 * 1024 * 1024;
const ALLOWED_TYPES = ["image/jpeg", "image/png"];
const ALLOWED_EXTENSIONS = ["jpg", "jpeg", "png"];

function isAllowedFile(file: File) {
  const extension = file.name.split(".").pop()?.toLowerCase() || "";
  return (
    ALLOWED_TYPES.includes(file.type) ||
    ALLOWED_EXTENSIONS.includes(extension)
  );
}

export async function POST(request: Request) {
  try {
    const formData = await request.formData();
    const applicationId = (formData.get("applicationId") as string) || "";
    const email = ((formData.get("email") as string) || "").trim();
    const contactNumber = (
      (formData.get("contactNumber") as string) || ""
    ).trim();
    const studentName = (formData.get("studentName") as string) || "";
    const birthCert = formData.get("birthCertificate") as File | null;
    const reportCard = formData.get("reportCard") as File | null;
    const form137 = formData.get("form137") as File | null;

    if (!applicationId && (!email || !contactNumber)) {
      return NextResponse.json(
        {
          success: false,
          error:
            "An application ID or a matching email and contact number are required.",
        },
        { status: 400 }
      );
    }

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
            error: `${file.name}: only JPG, JPEG, and PNG image files are accepted.`,
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

    const isUuid =
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
        applicationId
      );

    const providedEmail = email.trim();
    const providedContact = contactNumber.trim();

    const asRecord = (value: unknown): Record<string, unknown> =>
      value && typeof value === "object"
        ? (value as Record<string, unknown>)
        : {};

    // Numbers are often entered as 09..., +63..., or with spaces/dashes.
    // Compare them as digits so a formatting difference is not treated as a
    // different applicant.
    const normalizePhone = (value: unknown): string => {
      if (typeof value !== "string") return "";
      let digits = value.replace(/\D+/g, "");
      if (digits.startsWith("63") && digits.length >= 12) {
        digits = `0${digits.slice(2)}`;
      } else if (digits.length === 10 && digits.startsWith("9")) {
        digits = `0${digits}`;
      }
      return digits;
    };

    const maskEmail = (value: string): string => {
      const [localPart, domain] = value.split("@");
      if (!domain) return "***";
      const visible = localPart.slice(0, 2);
      return `${visible}***@${domain}`;
    };

    const resolveStoredEmail = async (
      record: Record<string, unknown>
    ): Promise<string> => {
      const documents = asRecord(record.requirements_documents);
      const details = asRecord(record.student_details);
      const candidate = [record.email, documents.student_email, details.email]
        .find(
          (value): value is string =>
            typeof value === "string" && value.trim().length > 0
        );

      if (candidate) return candidate.trim();

      if (record.user_id) {
        try {
          const { data: linkedUser } =
            await supabaseAdmin.auth.admin.getUserById(String(record.user_id));
          if (linkedUser?.user?.email) {
            return linkedUser.user.email.trim();
          }
        } catch (lookupError) {
          console.warn("Could not resolve linked auth user email:", lookupError);
        }
      }

      return "";
    };

    const getStoredContact = (record: Record<string, unknown>) =>
      typeof record.contact_number === "string"
        ? record.contact_number.trim()
        : "";

    const findApplicationByEmail = async (
      targetEmail: string,
      targetContact: string
    ): Promise<Record<string, unknown> | null> => {
      if (!targetEmail) return null;

      const normalizedContact = normalizePhone(targetContact);

      // 1. Direct lookup once the email column exists.
      let lookup = supabaseAdmin
        .from("student_applications")
        .select("*")
        .ilike("email", targetEmail);

      if (targetContact) {
        lookup = lookup.eq("contact_number", targetContact);
      }

      const { data, error } = await lookup.limit(1).maybeSingle();

      if (!error && data) {
        return data as Record<string, unknown>;
      }

      if (error) {
        console.warn(
          "[upload-requirements] Email column lookup failed:",
          error.message
        );
      }

      // 2. Fallback for databases without the email column: resolve the linked
      // auth user, then verify the phone number with normalization.
      try {
        const { data: userList } = await supabaseAdmin.auth.admin.listUsers({
          page: 1,
          perPage: 1000,
        });

        const matches = (userList?.users || []).filter(
          (user) =>
            user.email?.trim().toLowerCase() === targetEmail.toLowerCase()
        );

        for (const user of matches) {
          const { data: rows, error: rowError } = await supabaseAdmin
            .from("student_applications")
            .select("*")
            .eq("user_id", user.id)
            .order("submitted_at", { ascending: false });

          if (rowError || !rows) continue;

          const typedRows = rows as Record<string, unknown>[];

          if (!normalizedContact) {
            return typedRows[0] || null;
          }

          const contactRow = typedRows.find(
            (row) => normalizePhone(row.contact_number) === normalizedContact
          );

          if (contactRow) {
            return contactRow;
          }
        }
      } catch (lookupError) {
        console.warn(
          "[upload-requirements] Auth user lookup failed:",
          lookupError
        );
      }

      return null;
    };

    let application: Record<string, unknown> | null = null;

    if (isUuid) {
      const { data, error } = await supabaseAdmin
        .from("student_applications")
        .select("*")
        .eq("id", applicationId)
        .maybeSingle();

      if (error) {
        return NextResponse.json(
          { success: false, error: error.message },
          { status: 500 }
        );
      }

      application = (data as Record<string, unknown>) || null;
    }

    // Missing/stale application ID: recover the application by email.
    if (!application) {
      application = await findApplicationByEmail(providedEmail, providedContact);
    }

    if (!application) {
      console.warn("[upload-requirements] No application matched", {
        applicationId: applicationId || "(missing)",
        email: maskEmail(providedEmail),
        contact: normalizePhone(providedContact),
      });

      return NextResponse.json(
        {
          success: false,
          code: "APPLICATION_NOT_FOUND",
          error:
            "No matching enrollment application was found. Please return to the enrollment form and try again.",
        },
        { status: 404 }
      );
    }

    let storedEmail = await resolveStoredEmail(application);
    let storedContact = getStoredContact(application);
    const contactMatches =
      Boolean(normalizePhone(providedContact)) &&
      normalizePhone(providedContact) === normalizePhone(storedContact);

    if (
      storedEmail &&
      providedEmail &&
      storedEmail.toLowerCase() !== providedEmail.toLowerCase()
    ) {
      // A stale applicationId can point at another applicant. Re-link to the
      // application that actually owns the submitted email before rejecting.
      const relinked = await findApplicationByEmail(
        providedEmail,
        providedContact
      );

      if (relinked) {
        application = relinked;
        storedEmail = await resolveStoredEmail(application);
        storedContact = getStoredContact(application);
      } else if (!contactMatches) {
        console.warn("[upload-requirements] Email mismatch", {
          applicationId: String(application.id),
          providedEmail: maskEmail(providedEmail),
          storedEmail: maskEmail(storedEmail),
          providedContact: normalizePhone(providedContact),
          storedContact: normalizePhone(storedContact),
        });

        return NextResponse.json(
          {
            success: false,
            code: "EMAIL_MISMATCH",
            error: "The email does not match this enrollment application.",
          },
          { status: 403 }
        );
      }
    }

    if (
      !storedEmail &&
      normalizePhone(storedContact) &&
      normalizePhone(providedContact) !== normalizePhone(storedContact)
    ) {
      return NextResponse.json(
        {
          success: false,
          code: "CONTACT_MISMATCH",
          error:
            "This application has no email on file and the contact number does not match. Please contact the school registrar.",
        },
        { status: 403 }
      );
    }

    const targetRowId = String(application.id);

    // 1. Determine available storage bucket
    let targetBucket = "enrollment-documents.";
    try {
      const { data: buckets } = await supabaseAdmin.storage.listBuckets();
      if (buckets && buckets.length > 0) {
        const found =
          buckets.find((b) => b.name === "enrollment-documents.") ||
          buckets.find((b) => b.name === "enrollment-documents") ||
          buckets.find((b) => b.name === "requirements");

        targetBucket = found ? found.name : buckets[0].name;
      }
    } catch (listErr) {
      console.warn("Could not list buckets, falling back to default:", listErr);
    }

    const cleanId = targetRowId.replace(/[^a-zA-Z0-9_-]/g, "_");

    const uploadFile = async (file: File, folder: string) => {
      const buffer = Buffer.from(await file.arrayBuffer());
      const cleanName = file.name.replace(/[^a-zA-Z0-9._-]/g, "_");
      const filePath = `${folder}/${cleanId}-${Date.now()}-${cleanName}`;

      const { data, error } = await supabaseAdmin.storage
        .from(targetBucket)
        .upload(filePath, buffer, {
          contentType: file.type || "application/octet-stream",
          upsert: true,
        });

      if (error) {
        throw new Error(
          `Storage upload failed for ${file.name}: ${error.message}`
        );
      }

      const { data: pubData } = supabaseAdmin.storage
        .from(targetBucket)
        .getPublicUrl(filePath);

      let signedUrl = pubData?.publicUrl || "";

      try {
        const { data: signData } = await supabaseAdmin.storage
          .from(targetBucket)
          .createSignedUrl(filePath, 60 * 60 * 24 * 365);

        if (signData?.signedUrl) {
          signedUrl = signData.signedUrl;
        }
      } catch {
        // Fall back to the public URL.
      }

      return {
        path: data?.path || filePath,
        publicUrl: pubData?.publicUrl || "",
        signedUrl: signedUrl || pubData?.publicUrl || "",
        name: file.name,
        size: file.size,
        type: file.type,
      };
    };

    // 2. Upload requirement files to Supabase Storage
    const [bcResult, rcResult] = await Promise.all([
      uploadFile(birthCert, "birth-certificates"),
      uploadFile(reportCard, "report-cards"),
    ]);

    let otherResult: Awaited<ReturnType<typeof uploadFile>> | null = null;
    if (form137) {
      otherResult = await uploadFile(form137, "other-requirements");
    }

    // 3. Construct requirements_documents jsonb
    const nowIso = new Date().toISOString();
    const requirementsDocuments = {
      student_name: studentName || null,
      student_email: email || null,
      student_contact: contactNumber || null,
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

    // 4. Update student_applications table in Supabase
    const fullUpdate: Record<string, unknown> = {
      requirements_documents: requirementsDocuments,
      birth_certificate_url: bcResult.signedUrl || bcResult.publicUrl,
      report_card_url: rcResult.signedUrl || rcResult.publicUrl,
      other_requirement_url:
        otherResult?.signedUrl || otherResult?.publicUrl || null,
      requirements_submitted: true,
      updated_at: nowIso,
    };

    if (providedEmail) {
      fullUpdate.email = providedEmail;
    }

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
      userEmail: providedEmail || storedEmail || "",
      action: "Uploaded Enrollment Requirements",
      details: {
        applicationId: targetRowId,
        studentName: studentName || null,
        documents: {
          birthCertificate: birthCert.name,
          reportCard: reportCard.name,
          form137: form137?.name || null,
        },
        timestamp: nowIso,
      },
    });

    return NextResponse.json({
      success: true,
      message: "Requirements uploaded and recorded successfully in Supabase.",
      data: {
        applicationId: targetRowId,
        requirements_documents: requirementsDocuments,
        storageBucket: targetBucket,
      },
    });
  } catch (err: unknown) {
    console.error("Requirement upload error:", err);
    const errorMsg =
      err instanceof Error ? err.message : "Document upload failed.";

    return NextResponse.json(
      { success: false, error: errorMsg },
      { status: 500 }
    );
  }
}
