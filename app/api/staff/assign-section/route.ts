import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { getAuthContext } from "@/lib/auth/server";
import { hasValidMfaCookie } from "@/lib/auth/mfaCookie";
import { isAdminRole, isStaffRole } from "@/lib/auth/roles";
import { logActivity } from "@/lib/activityLog";
import { syncStudentProfile } from "@/lib/studentProfiles";
import { getMailConfig } from "@/lib/mailer";
import {
  fetchAssignedSection,
  resolveStudentEmail,
  resolveStudentName,
  sendSectionAssignmentEmail,
  type ApplicationRecord,
} from "@/lib/enrollmentEmails";

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

type AssignSectionBody = {
  applicationId?: unknown;
  sectionId?: unknown;
};

type SectionRecord = {
  id: string;
  name: string | null;
  adviser_name: string | null;
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
          error: "This account is not authorized to assign sections.",
        },
        { status: 403 }
      );
    }

    if (auth.user) {
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
    }

    let body: AssignSectionBody;

    try {
      body = (await request.json()) as AssignSectionBody;
    } catch {
      return NextResponse.json(
        { success: false, error: "Invalid request body." },
        { status: 400 }
      );
    }

    const applicationId =
      typeof body.applicationId === "string" ? body.applicationId.trim() : "";
    const rawSectionId = body.sectionId;
    const sectionId =
      rawSectionId == null || rawSectionId === ""
        ? null
        : String(rawSectionId).trim();

    if (!UUID_PATTERN.test(applicationId)) {
      return NextResponse.json(
        { success: false, error: "A valid application ID is required." },
        { status: 400 }
      );
    }

    if (sectionId !== null && !sectionId) {
      return NextResponse.json(
        { success: false, error: "A valid section is required." },
        { status: 400 }
      );
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

    let section: SectionRecord | null = null;

    if (sectionId) {
      const { data, error: sectionError } = await supabaseAdmin
        .from("sections")
        .select("id, name, adviser_name")
        .eq("id", sectionId)
        .maybeSingle();

      if (sectionError) {
        return NextResponse.json(
          {
            success: false,
            error: `Could not verify the selected section: ${sectionError.message}`,
          },
          { status: 500 }
        );
      }

      if (!data) {
        return NextResponse.json(
          {
            success: false,
            error:
              "The selected section no longer exists. Refresh and try again.",
          },
          { status: 400 }
        );
      }

      section = data as SectionRecord;
    }

    const { data: application, error: applicationError } = await supabaseAdmin
      .from("student_applications")
      .select("*")
      .eq("id", applicationId)
      .maybeSingle();

    if (applicationError) {
      return NextResponse.json(
        {
          success: false,
          error: `Could not load the application: ${applicationError.message}`,
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

    const previousSectionId =
      application.assigned_section_id != null
        ? String(application.assigned_section_id)
        : null;

    const now = new Date().toISOString();

    let updateResult = await supabaseAdmin
      .from("student_applications")
      .update({
        assigned_section_id: sectionId,
        updated_at: now,
      })
      .eq("id", applicationId)
      .select("id, assigned_section_id")
      .maybeSingle();

    if (
      updateResult.error &&
      (updateResult.error.code === "PGRST204" ||
        updateResult.error.code === "42703")
    ) {
      updateResult = await supabaseAdmin
        .from("student_applications")
        .update({ assigned_section_id: sectionId })
        .eq("id", applicationId)
        .select("id, assigned_section_id")
        .maybeSingle();
    }

    if (updateResult.error) {
      return NextResponse.json(
        {
          success: false,
          error: `Could not save the section assignment: ${updateResult.error.message}`,
        },
        { status: 500 }
      );
    }

    if (!updateResult.data) {
      return NextResponse.json(
        {
          success: false,
          error: "The application was not found or could not be updated.",
        },
        { status: 404 }
      );
    }

    const savedSectionId =
      updateResult.data.assigned_section_id != null
        ? String(updateResult.data.assigned_section_id)
        : null;

    if (savedSectionId !== sectionId) {
      return NextResponse.json(
        {
          success: false,
          error:
            "The database did not keep the selected section. Please try again.",
        },
        { status: 409 }
      );
    }

    await syncStudentProfile(supabaseAdmin, applicationId);

    const applicationRecord = application as ApplicationRecord;
    const sectionChanged = savedSectionId !== previousSectionId;

    let emailSent = false;
    const emailConfigured = Boolean(getMailConfig());
    let emailError: string | null = null;

    if (sectionChanged && sectionId) {
      const studentEmail = await resolveStudentEmail(
        supabaseAdmin,
        applicationRecord
      );

      if (!studentEmail) {
        emailError =
          "No registered email address is on file for this application.";
      } else if (!emailConfigured) {
        emailError =
          "The email service is not configured (SMTP credentials missing).";
      } else {
        try {
          const assigned = await fetchAssignedSection(supabaseAdmin, {
            assigned_section_id: sectionId,
          });

          if (assigned) {
            await sendSectionAssignmentEmail({
              email: studentEmail,
              studentName: resolveStudentName(applicationRecord),
              section: assigned,
            });
            emailSent = true;
          } else {
            emailError =
              "The assigned section details could not be loaded for the email.";
          }
        } catch (err: unknown) {
          console.error("Section assignment email dispatch error:", err);
          emailError =
            err instanceof Error ? err.message : "SMTP sendMail error";
        }
      }
    }

    await logActivity({
      userType: isAdminRole(auth.role) ? "Admin" : "Staff",
      userEmail: auth.user.email || "",
      action: sectionId
        ? `Assigned Section: ${section?.name || savedSectionId}`
        : "Cleared Section Assignment",
      details: {
        applicationId,
        previousSectionId,
        assignedSectionId: savedSectionId,
        sectionName: section?.name || null,
        sectionChanged,
        timestamp: now,
      },
    });

    return NextResponse.json({
      success: true,
      data: {
        applicationId,
        assigned_section_id: savedSectionId,
        section,
        sectionChanged,
        emailSent,
        emailConfigured,
        emailError,
      },
      message: emailSent
        ? "Section and adviser saved. A notification email was sent to the student."
        : undefined,
    });
  } catch (error: unknown) {
    return NextResponse.json(
      {
        success: false,
        error:
          error instanceof Error
            ? error.message
            : "Could not save the section assignment.",
      },
      { status: 500 }
    );
  }
}
