import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { getAuthContext } from "@/lib/auth/server";
import { hasValidMfaCookie } from "@/lib/auth/mfaCookie";
import { isAdminRole, isStaffRole } from "@/lib/auth/roles";
import { logActivity } from "@/lib/activityLog";
import { hasReceivedCredentials } from "@/lib/applicationVisibility";
import { syncStudentProfile } from "@/lib/studentProfiles";
import {
  getEnrollmentStatusLabel,
  isFinalEnrollmentStatus,
  normalizeEnrollmentStatus,
} from "@/lib/enrollmentStatus";
import { getMailConfig } from "@/lib/mailer";
import {
  fetchAssignedSection,
  resolveStudentEmail,
  resolveStudentName,
  sendEnrollmentStatusEmail,
  type ApplicationRecord,
} from "@/lib/enrollmentEmails";

export const maxDuration = 60;

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const MAX_REMARKS_LENGTH = 1000;

type UpdateStatusBody = {
  applicationId?: unknown;
  status?: unknown;
  remarks?: unknown;
};

export async function POST(request: Request) {
  try {
    const auth = await getAuthContext();

    if (!auth.user) {
      return NextResponse.json(
        {
          success: false,
          error: "Your staff session has expired. Please sign in again.",
        },
        { status: 401 }
      );
    }

    if (!isStaffRole(auth.role) && !isAdminRole(auth.role)) {
      return NextResponse.json(
        {
          success: false,
          error: "This account is not authorized to update enrollment status.",
        },
        { status: 403 }
      );
    }

    const mfaArea = isAdminRole(auth.role) ? "admin" : "staff";
    const mfaValid = await hasValidMfaCookie(mfaArea, auth.user.id);

    if (!mfaValid) {
      return NextResponse.json(
        {
          success: false,
          error:
            "Your verification has expired. Sign in again through the portal to continue.",
        },
        { status: 403 }
      );
    }

    let body: UpdateStatusBody;

    try {
      body = (await request.json()) as UpdateStatusBody;
    } catch {
      return NextResponse.json(
        { success: false, error: "Invalid request body." },
        { status: 400 }
      );
    }

    const applicationId =
      typeof body.applicationId === "string"
        ? body.applicationId.trim()
        : "";

    if (!UUID_PATTERN.test(applicationId)) {
      return NextResponse.json(
        { success: false, error: "A valid application ID is required." },
        { status: 400 }
      );
    }

    const targetStatus = normalizeEnrollmentStatus(body.status);
    const rawRemarks =
      typeof body.remarks === "string" ? body.remarks.trim() : "";
    const targetRemark =
      rawRemarks.length > MAX_REMARKS_LENGTH
        ? rawRemarks.slice(0, MAX_REMARKS_LENGTH)
        : rawRemarks;

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
      .eq("id", applicationId)
      .maybeSingle();

    if (fetchError) {
      return NextResponse.json(
        {
          success: false,
          error: `Could not load the application: ${fetchError.message}`,
        },
        { status: 500 }
      );
    }

    if (!application) {
      return NextResponse.json(
        { success: false, error: "The application was not found." },
        { status: 404 }
      );
    }

    const applicationRecord = application as ApplicationRecord;

    if (!hasReceivedCredentials(applicationRecord)) {
      return NextResponse.json(
        {
          success: false,
          error:
            "This application is not available yet because the student has not received their login credentials.",
        },
        { status: 409 }
      );
    }

    const previousStatus = normalizeEnrollmentStatus(applicationRecord.status);
    const now = new Date().toISOString();

    // Only final decisions are locked. "denied" means the student still needs
    // to submit missing/unclear requirements, so staff can review it again
    // after the student resubmits.
    const statusLocked =
      applicationRecord.status_locked === true ||
      isFinalEnrollmentStatus(previousStatus);

    if (statusLocked) {
      return NextResponse.json(
        {
          success: false,
          error:
            "This student's enrollment status has already been finalized and can no longer be changed.",
          data: {
            applicationId,
            status: previousStatus,
            statusLabel: getEnrollmentStatusLabel(previousStatus),
            statusLocked: true,
          },
        },
        { status: 409 }
      );
    }

    if (targetStatus === "pending") {
      return NextResponse.json(
        {
          success: false,
          error:
            "Select Enrolled or Denied. Pending is the default status and cannot be saved as an update.",
        },
        { status: 400 }
      );
    }

    if (targetStatus === "rejected") {
      return NextResponse.json(
        {
          success: false,
          error:
            "Rejected is no longer available. Use Denied when requirements are missing or unclear so the student can resubmit them.",
        },
        { status: 400 }
      );
    }

    const basePayload = {
      status: targetStatus,
      updated_at: now,
    };

    let updateResult = await supabaseAdmin
      .from("student_applications")
      .update({
        ...basePayload,
        registrar_remarks: targetRemark || null,
      })
      .eq("id", applicationId)
      .select("id, status, registrar_remarks")
      .maybeSingle();

    if (
      updateResult.error &&
      (updateResult.error.message?.includes("registrar_remarks") ||
        updateResult.error.code === "PGRST204" ||
        updateResult.error.code === "42703")
    ) {
      updateResult = await supabaseAdmin
        .from("student_applications")
        .update(basePayload)
        .eq("id", applicationId)
        .select("id, status")
        .maybeSingle();
    }

    if (updateResult.error) {
      return NextResponse.json(
        {
          success: false,
          error: `Could not save the status update: ${updateResult.error.message}`,
        },
        { status: 500 }
      );
    }

    if (!updateResult.data) {
      return NextResponse.json(
        {
          success: false,
          error:
            "The application was not found or could not be updated. Please refresh and try again.",
        },
        { status: 404 }
      );
    }

    const savedStatus = normalizeEnrollmentStatus(updateResult.data.status);

    if (savedStatus !== targetStatus) {
      return NextResponse.json(
        {
          success: false,
          error: `The database returned "${getEnrollmentStatusLabel(
            savedStatus
          )}" instead of "${getEnrollmentStatusLabel(
            targetStatus
          )}". The update was not saved.`,
        },
        { status: 409 }
      );
    }

    await syncStudentProfile(supabaseAdmin, applicationId);

    const savedRemark = Object.prototype.hasOwnProperty.call(
      updateResult.data,
      "registrar_remarks"
    )
      ? String(
        (updateResult.data as { registrar_remarks?: string | null })
          .registrar_remarks ?? ""
      )
      : null;

    let emailSent = false;
    const emailConfigured = Boolean(getMailConfig());
    let emailError: string | null = null;

    const statusChanged = true;
    const studentEmail = await resolveStudentEmail(
      supabaseAdmin,
      applicationRecord
    );
    const assignedSection = await fetchAssignedSection(
      supabaseAdmin,
      applicationRecord
    );

    if (statusChanged) {
      if (!studentEmail) {
        emailError =
          "No registered email address is on file for this application.";
      } else if (!emailConfigured) {
        emailError =
          "The email service is not configured (SMTP credentials missing).";
      } else {
        try {
          await sendEnrollmentStatusEmail({
            email: studentEmail,
            studentName: resolveStudentName(applicationRecord),
            status: targetStatus,
            remarks: targetRemark,
            section: assignedSection,
          });
          emailSent = true;
        } catch (err: unknown) {
          console.error("Enrollment status email dispatch error:", err);
          emailError =
            err instanceof Error ? err.message : "SMTP sendMail error";
        }
      }
    }

    await logActivity({
      userType: isAdminRole(auth.role) ? "Admin" : "Staff",
      userEmail: auth.user.email || "",
      action: `Updated Enrollment Status: ${getEnrollmentStatusLabel(
        targetStatus
      )}`,
      details: {
        applicationId,
        previousStatus,
        newStatus: targetStatus,
        studentEmail: studentEmail || null,
        remarks: targetRemark || null,
        statusChanged,
        timestamp: now,
      },
    });

    return NextResponse.json({
      success: true,
      data: {
        applicationId,
        status: targetStatus,
        statusLabel: getEnrollmentStatusLabel(targetStatus),
        registrar_remarks: savedRemark,
        section: assignedSection,
        statusChanged,
        emailSent,
        emailConfigured,
        emailError,
      },
      message: `Enrollment status successfully updated to "${getEnrollmentStatusLabel(
        targetStatus
      )}".${emailSent ? ` A notification email was sent to ${studentEmail}.` : ""}`,
    });
  } catch (error: unknown) {
    console.error("Error in staff update-status route:", error);
    return NextResponse.json(
      {
        success: false,
        error:
          error instanceof Error
            ? error.message
            : "Could not save the status update.",
      },
      { status: 500 }
    );
  }
}
