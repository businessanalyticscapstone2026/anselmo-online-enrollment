import type { SupabaseClient } from "@supabase/supabase-js";
import { createMailTransport, escapeHtml, getMailConfig } from "@/lib/mailer";
import {
  getEnrollmentStatusLabel,
  type EnrollmentStatus,
} from "@/lib/enrollmentStatus";

export type ApplicationRecord = Record<string, unknown> & {
  id?: string | null;
  user_id?: string | null;
  email?: string | null;
  first_name?: string | null;
  middle_name?: string | null;
  last_name?: string | null;
  status?: string | null;
  assigned_section_id?: string | null;
};

export type AssignedSection = {
  id: string;
  name: string;
  gradeLevel: string;
  cluster: string;
  adviser: string;
  schoolYear: string;
};

const STATUS_THEME: Record<
  EnrollmentStatus,
  { color: string; background: string; border: string; intro: string }
> = {
  enrolled: {
    color: "#063b2b",
    background: "#e8f5e9",
    border: "#176b4d",
    intro:
      "Congratulations! Your enrollment application has been approved and you are now officially enrolled at Anselmo A. Sandoval Memorial National High School.",
  },
  rejected: {
    color: "#7f1d1d",
    background: "#fef2f2",
    border: "#b91c1c",
    intro:
      "After careful review, your enrollment application was not approved. Please see the registrar remarks below for the reason and the next steps you may take.",
  },
  pending: {
    color: "#78350f",
    background: "#fffbeb",
    border: "#b45309",
    intro:
      "Your enrollment application is still under review by the registrar. Please monitor your student portal for the final result.",
  },
};

function firstEmail(...values: unknown[]): string {
  for (const value of values) {
    const candidate = String(value ?? "").trim();
    if (candidate.includes("@")) return candidate;
  }
  return "";
}

export async function resolveStudentEmail(
  supabaseAdmin: SupabaseClient,
  application: ApplicationRecord
): Promise<string> {
  const direct = firstEmail(
    application.email,
    (application.student_details as Record<string, unknown> | null)?.email,
    (application.requirements_documents as Record<string, unknown> | null)
      ?.student_email
  );

  if (direct) return direct;

  const userId = application.user_id ? String(application.user_id) : "";

  if (userId) {
    const { data: profile } = await supabaseAdmin
      .from("profiles")
      .select("email")
      .eq("id", userId)
      .maybeSingle();

    const profileEmail = firstEmail(profile?.email);
    if (profileEmail) return profileEmail;

    try {
      const { data: authUser } = await supabaseAdmin.auth.admin.getUserById(
        userId
      );
      const authEmail = firstEmail(authUser?.user?.email);
      if (authEmail) return authEmail;
    } catch {
      // Ignore auth lookup failures; fall through to empty email.
    }
  }

  return "";
}

export function resolveStudentName(application: ApplicationRecord): string {
  const name = [
    application.first_name,
    application.middle_name,
    application.last_name,
  ]
    .map((part) => String(part ?? "").trim())
    .filter(Boolean)
    .join(" ");

  return name || "Student";
}

export async function fetchAssignedSection(
  supabaseAdmin: SupabaseClient,
  application: ApplicationRecord
): Promise<AssignedSection | null> {
  const sectionId = application.assigned_section_id
    ? String(application.assigned_section_id)
    : "";

  if (!sectionId) return null;

  const { data } = await supabaseAdmin
    .from("sections")
    .select("*")
    .eq("id", sectionId)
    .maybeSingle();

  if (!data) return null;

  const name = String(data.name ?? "").trim();
  if (!name) return null;

  return {
    id: String(data.id ?? sectionId),
    name,
    gradeLevel: String(data.grade_level ?? "").trim(),
    cluster: String(data.strand ?? data.cluster ?? "").trim(),
    adviser: String(data.adviser_name ?? "").trim(),
    schoolYear: String(data.school_year ?? "").trim(),
  };
}

function appLoginUrl(): string {
  const appUrl =
    process.env.NEXT_PUBLIC_APP_URL ||
    process.env.VERCEL_URL ||
    "http://localhost:3000";

  return `${appUrl.startsWith("http") ? appUrl : `https://${appUrl}`}/login`;
}

function sectionBlock(section: AssignedSection | null): string {
  if (!section) return "";

  const rows: Array<[string, string]> = [
    ["Section", section.name],
    ["Class Adviser", section.adviser || "To be announced"],
    ["Grade Level", section.gradeLevel || "—"],
    ["Cluster", section.cluster || "—"],
    ["School Year", section.schoolYear || "—"],
  ];

  const cells = rows
    .map(
      ([label, value]) => `
                        <tr>
                          <td style="padding: 8px 0; font-size: 12px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.5px; color: #176b4d; width: 40%;">${escapeHtml(
                            label
                          )}</td>
                          <td style="padding: 8px 0; font-size: 14px; color: #111827;">${escapeHtml(
                            value
                          )}</td>
                        </tr>`
    )
    .join("");

  return `
              <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background-color: #f0fdf4; border: 1px solid #bbf7d0; border-radius: 12px; margin-bottom: 24px;">
                <tr>
                  <td style="padding: 18px 22px;">
                    <div style="font-size: 12px; font-weight: 800; text-transform: uppercase; color: #063b2b; letter-spacing: 1px; margin-bottom: 10px;">
                      YOUR SECTION &amp; ADVISER
                    </div>
                    <table role="presentation" width="100%" cellspacing="0" cellpadding="0">
                      ${cells}
                    </table>
                  </td>
                </tr>
              </table>
`;
}

function buildEmailShell(params: {
  heading: string;
  badge: string;
  intro: string;
  bodyHtml: string;
}): string {
  return `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${escapeHtml(params.heading)}</title>
</head>
<body style="margin: 0; padding: 0; background-color: #051a0f; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; color: #1f2937;">
  <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background-color: #051a0f; padding: 30px 15px;">
    <tr>
      <td align="center">
        <table role="presentation" width="100%" style="max-width: 600px; background-color: #ffffff; border-radius: 16px; overflow: hidden; box-shadow: 0 10px 25px rgba(0,0,0,0.3);" cellspacing="0" cellpadding="0">
          <tr>
            <td style="background: linear-gradient(135deg, #063b2b 0%, #176b4d 100%); padding: 36px 30px; text-align: center;">
              <h1 style="margin: 0; color: #ffffff; font-size: 22px; font-weight: 800; letter-spacing: 0.5px; line-height: 1.3;">
                Anselmo A. Sandoval Memorial<br>National High School
              </h1>
              <div style="margin-top: 10px; display: inline-block; padding: 4px 14px; background-color: rgba(200, 178, 124, 0.25); border: 1px solid rgba(200, 178, 124, 0.5); border-radius: 20px;">
                <span style="color: #f3ebd9; font-size: 13px; font-weight: 600; letter-spacing: 0.5px;">
                  ${escapeHtml(params.badge)}
                </span>
              </div>
            </td>
          </tr>
          <tr>
            <td style="padding: 32px 30px; background-color: #ffffff;">
              ${params.bodyHtml}
              <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="margin-bottom: 24px;">
                <tr>
                  <td align="center">
                    <a href="${appLoginUrl()}" target="_blank" style="display: inline-block; background-color: #176b4d; color: #ffffff; text-decoration: none; font-size: 15px; font-weight: bold; padding: 14px 32px; border-radius: 10px; box-shadow: 0 4px 10px rgba(23, 107, 77, 0.3);">
                      View Your Enrollment
                    </a>
                  </td>
                </tr>
              </table>
              <p style="margin: 0; font-size: 13px; line-height: 1.6; color: #4b5563;">
                If you have questions about this update, please visit the school registrar or contact the school office.
              </p>
            </td>
          </tr>
          <tr>
            <td style="background-color: #f9fafb; padding: 24px 30px; text-align: center; border-top: 1px solid #e5e7eb;">
              <p style="margin: 0 0 6px 0; font-size: 13px; font-weight: bold; color: #374151;">
                Anselmo A. Sandoval Memorial National High School
              </p>
              <p style="margin: 0; font-size: 11px; color: #9ca3af; line-height: 1.5;">
                Mabini, Batangas • DepEd Region IV-A CALABARZON<br>
                This is an automated enrollment notification. Please do not reply directly to this email.
              </p>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>
`;
}

function sendMail(params: {
  to: string;
  subject: string;
  html: string;
  text: string;
}): Promise<void> {
  const mailConfig = getMailConfig();

  if (!mailConfig) {
    throw new Error(
      "The email service is not configured (SMTP credentials missing)."
    );
  }

  const transporter = createMailTransport(mailConfig);

  return transporter
    .sendMail({
      from: mailConfig.from,
      to: params.to,
      subject: params.subject,
      html: params.html,
      text: params.text,
    })
    .then(() => undefined);
}

export async function sendEnrollmentStatusEmail(params: {
  email: string;
  studentName: string;
  status: EnrollmentStatus;
  remarks: string;
  section: AssignedSection | null;
}): Promise<void> {
  const theme = STATUS_THEME[params.status];
  const statusLabel = getEnrollmentStatusLabel(params.status);
  const safeName = escapeHtml(params.studentName);
  const safeRemarks = escapeHtml(params.remarks);

  const remarksSection = params.remarks
    ? `
              <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background-color: #f9fafb; border: 1px solid #e5e7eb; border-left: 6px solid ${theme.border}; border-radius: 12px; margin-bottom: 24px;">
                <tr>
                  <td style="padding: 18px 22px;">
                    <div style="font-size: 12px; font-weight: 800; text-transform: uppercase; color: ${theme.color}; letter-spacing: 1px; margin-bottom: 8px;">
                      REGISTRAR REMARKS
                    </div>
                    <div style="font-size: 14px; line-height: 1.6; color: #374151;">
                      ${safeRemarks}
                    </div>
                  </td>
                </tr>
              </table>
`
    : "";

  const statusBox = `
              <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background-color: ${theme.background}; border: 2px solid ${theme.border}; border-radius: 12px; margin-bottom: 24px;">
                <tr>
                  <td style="padding: 20px 24px; text-align: center;">
                    <div style="font-size: 12px; font-weight: 800; text-transform: uppercase; color: ${theme.color}; letter-spacing: 1px; margin-bottom: 10px;">
                      APPLICATION STATUS
                    </div>
                    <div style="display: inline-block; padding: 10px 28px; background-color: ${theme.border}; border-radius: 24px; font-size: 20px; font-weight: 800; letter-spacing: 1px; color: #ffffff;">
                      ${statusLabel}
                    </div>
                  </td>
                </tr>
              </table>
`;

  const bodyHtml = `
              <p style="margin: 0 0 16px 0; font-size: 16px; line-height: 1.5; color: #111827;">
                Dear <strong>${safeName}</strong>,
              </p>
              <p style="margin: 0 0 24px 0; font-size: 14px; line-height: 1.6; color: #4b5563;">
                ${theme.intro}
              </p>
              ${statusBox}
              ${sectionBlock(params.section)}
              ${remarksSection}
`;

  const html = buildEmailShell({
    heading: "Enrollment Status Update",
    badge: "ENROLLMENT STATUS UPDATE",
    intro: theme.intro,
    bodyHtml,
  });

  const textLines = [
    `Dear ${params.studentName},`,
    "",
    theme.intro,
    "",
    `Application status: ${statusLabel}`,
  ];

  if (params.section) {
    textLines.push(
      "",
      "Your section & adviser:",
      `Section: ${params.section.name}`,
      `Class Adviser: ${params.section.adviser || "To be announced"}`,
      `Grade Level: ${params.section.gradeLevel || "—"}`,
      `Cluster: ${params.section.cluster || "—"}`,
      `School Year: ${params.section.schoolYear || "—"}`
    );
  }

  if (params.remarks) {
    textLines.push("", "Registrar remarks:", params.remarks);
  }

  textLines.push("", `View your enrollment: ${appLoginUrl()}`, "", "Anselmo A. Sandoval Memorial National High School", "Mabini, Batangas • DepEd Region IV-A CALABARZON");

  await sendMail({
    to: params.email,
    subject: `Enrollment Status Update: ${statusLabel} - AASMNHS Online Enrollment`,
    html,
    text: textLines.join("\n"),
  });
}

export async function sendSectionAssignmentEmail(params: {
  email: string;
  studentName: string;
  section: AssignedSection;
}): Promise<void> {
  const safeName = escapeHtml(params.studentName);

  const bodyHtml = `
              <p style="margin: 0 0 16px 0; font-size: 16px; line-height: 1.5; color: #111827;">
                Dear <strong>${safeName}</strong>,
              </p>
              <p style="margin: 0 0 24px 0; font-size: 14px; line-height: 1.6; color: #4b5563;">
                You have been assigned to a section for this school year. Please see your section and class adviser below.
              </p>
              ${sectionBlock(params.section)}
`;

  const html = buildEmailShell({
    heading: "Section Assignment",
    badge: "SECTION & ADVISER ASSIGNMENT",
    intro: "You have been assigned to a section.",
    bodyHtml,
  });

  const textLines = [
    `Dear ${params.studentName},`,
    "",
    "You have been assigned to a section for this school year.",
    "",
    `Section: ${params.section.name}`,
    `Class Adviser: ${params.section.adviser || "To be announced"}`,
    `Grade Level: ${params.section.gradeLevel || "—"}`,
    `Cluster: ${params.section.cluster || "—"}`,
    `School Year: ${params.section.schoolYear || "—"}`,
    "",
    `View your enrollment: ${appLoginUrl()}`,
    "",
    "Anselmo A. Sandoval Memorial National High School",
    "Mabini, Batangas • DepEd Region IV-A CALABARZON",
  ];

  await sendMail({
    to: params.email,
    subject: `Section Assignment: ${params.section.name} - AASMNHS Online Enrollment`,
    html,
    text: textLines.join("\n"),
  });
}
