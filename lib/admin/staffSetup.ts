import type { SupabaseClient, User } from "@supabase/supabase-js";
import {
  createMailTransport,
  escapeHtml,
  getMailConfig,
} from "@/lib/mailer";

export type StaffSetupRole = "staff" | "registrar";

export function resolveAppUrl(requestUrl: string): string {
  const configured = process.env.NEXT_PUBLIC_APP_URL?.trim();

  if (configured) {
    const withScheme = configured.startsWith("http")
      ? configured
      : `https://${configured}`;
    return withScheme.replace(/\/+$/, "");
  }

  return new URL(requestUrl).origin.replace(/\/+$/, "");
}

export async function findAuthUserByEmail(
  supabaseAdmin: SupabaseClient,
  rawEmail: string
): Promise<User | null> {
  const cleanEmail = rawEmail.trim().toLowerCase();
  if (!cleanEmail) return null;

  for (let page = 1; page <= 25; page += 1) {
    const { data, error } = await supabaseAdmin.auth.admin.listUsers({
      page,
      perPage: 200,
    });

    if (error) {
      throw new Error(error.message);
    }

    const users = data?.users ?? [];
    const match =
      users.find((user) => user.email?.toLowerCase() === cleanEmail) ?? null;

    if (match) return match;
    if (users.length < 200) break;
  }

  return null;
}

export function buildStaffSetupUrl(
  appUrl: string,
  hashedToken: string
): string {
  const setupUrl = new URL("/reset-password", appUrl);
  setupUrl.searchParams.set("token_hash", hashedToken);
  setupUrl.searchParams.set("type", "recovery");
  setupUrl.searchParams.set("setup", "staff");
  return setupUrl.toString();
}

export async function generateStaffSetupLink(
  supabaseAdmin: SupabaseClient,
  appUrl: string,
  email: string
): Promise<{ setupUrl: string | null; error?: string }> {
  try {
    const { data, error } = await supabaseAdmin.auth.admin.generateLink({
      type: "recovery",
      email,
      options: { redirectTo: `${appUrl}/reset-password?setup=staff` },
    });

    const hashedToken = data?.properties?.hashed_token;

    if (error || !hashedToken) {
      return {
        setupUrl: null,
        error:
          error?.message ||
          "Could not generate a one-time staff setup link right now.",
      };
    }

    return { setupUrl: buildStaffSetupUrl(appUrl, hashedToken) };
  } catch (error) {
    return {
      setupUrl: null,
      error:
        error instanceof Error
          ? error.message
          : "Could not generate a one-time staff setup link right now.",
    };
  }
}

export async function sendStaffSetupEmail(params: {
  to: string;
  fullName: string;
  role: StaffSetupRole;
  setupUrl: string;
  appUrl: string;
}): Promise<{ sent: boolean; error?: string }> {
  const mailConfig = getMailConfig();

  if (!mailConfig) {
    return {
      sent: false,
      error:
        "The school email service is not configured. Configure SMTP to deliver staff setup links.",
    };
  }

  const roleLabel = params.role === "registrar" ? "Registrar" : "Staff";
  const loginUrl = `${params.appUrl}/login`;
  const safeName = escapeHtml(params.fullName);
  const safeEmail = escapeHtml(params.to);
  const safeRole = escapeHtml(roleLabel);
  const safeSetupUrl = escapeHtml(params.setupUrl);
  const safeLoginUrl = escapeHtml(loginUrl);

  const htmlTemplate = `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Set Up Your Staff Account</title>
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
                  STAFF PORTAL ACCOUNT
                </span>
              </div>
            </td>
          </tr>
          <tr>
            <td style="padding: 32px 30px; background-color: #ffffff;">
              <p style="margin: 0 0 16px 0; font-size: 16px; line-height: 1.5; color: #111827;">
                Hello ${safeName},
              </p>
              <p style="margin: 0 0 20px 0; font-size: 14px; line-height: 1.6; color: #4b5563;">
                An ICT administrator created a <strong>${safeRole}</strong> account for <strong>${safeEmail}</strong> on the AASMNHS .
              </p>
              <p style="margin: 0 0 24px 0; font-size: 14px; line-height: 1.6; color: #4b5563;">
                Use the button below to create your password. This link can only be used once and expires shortly.
              </p>
              <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="margin-bottom: 24px;">
                <tr>
                  <td align="center">
                    <a href="${safeSetupUrl}" target="_blank" style="display: inline-block; background-color: #176b4d; color: #ffffff; text-decoration: none; font-size: 15px; font-weight: bold; padding: 14px 32px; border-radius: 10px; box-shadow: 0 4px 10px rgba(23, 107, 77, 0.3);">
                      Set Up My Account
                    </a>
                  </td>
                </tr>
              </table>
              <p style="margin: 0 0 20px 0; font-size: 12px; line-height: 1.6; color: #6b7280;">
                If the button does not work, copy and paste this link into your browser:<br>
                <a href="${safeSetupUrl}" style="color: #176b4d; word-break: break-all;">${safeSetupUrl}</a>
              </p>
              <p style="margin: 0 0 20px 0; font-size: 13px; line-height: 1.6; color: #4b5563;">
                After setting your password, sign in at <a href="${safeLoginUrl}" style="color: #176b4d;">${safeLoginUrl}</a> and complete the email verification step.
              </p>
              <div style="background-color: #fffbeb; border: 1px solid #fef3c7; border-left: 4px solid #f59e0b; padding: 14px 16px; border-radius: 8px; font-size: 12px; color: #92400e; line-height: 1.6;">
                <strong>Security Notice:</strong> If you did not expect this account, contact the ICT administrator immediately. Never share this link with anyone.
              </div>
            </td>
          </tr>
          <tr>
            <td style="background-color: #f9fafb; padding: 24px 30px; text-align: center; border-top: 1px solid #e5e7eb;">
              <p style="margin: 0 0 6px 0; font-size: 13px; font-weight: bold; color: #374151;">
                Anselmo A. Sandoval Memorial National High School
              </p>
              <p style="margin: 0; font-size: 11px; color: #9ca3af; line-height: 1.5;">
                Mabini, Batangas | DepEd Region IV-A CALABARZON<br>
                This is an automated account notification. Please do not reply directly to this email.
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

  const textTemplate = [
    `Hello ${params.fullName},`,
    "",
    `An ICT administrator created a ${roleLabel} account for ${params.to} on the AASMNHS Online Enrollment System.`,
    "",
    "Create your password using this one-time link:",
    params.setupUrl,
    "",
    "This link can only be used once and expires shortly.",
    `After setting your password, sign in at ${loginUrl} and complete the email verification step.`,
    "",
    "If you did not expect this account, contact the ICT administrator immediately. Never share this link with anyone.",
    "",
    "Anselmo A. Sandoval Memorial National High School",
    "Mabini, Batangas | DepEd Region IV-A",
  ].join("\n");

  try {
    const transporter = createMailTransport(mailConfig);

    await transporter.sendMail({
      from: mailConfig.from,
      to: params.to,
      subject: "Set Up Your AASMNHS Staff Account",
      html: htmlTemplate,
      text: textTemplate,
    });

    return { sent: true };
  } catch (error) {
    console.error("Staff setup email dispatch error:", error);
    return {
      sent: false,
      error:
        "The staff account was created, but the setup email could not be sent.",
    };
  }
}
