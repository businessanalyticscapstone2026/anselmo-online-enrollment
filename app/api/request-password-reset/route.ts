import { NextResponse } from "next/server";
import nodemailer from "nodemailer";
import { createClient } from "@supabase/supabase-js";
import { isAccountRemoved } from "@/lib/removedAccounts";
import { logActivity } from "@/lib/activityLog";

export const runtime = "nodejs";

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (character) => {
    const entities: Record<string, string> = {
      "&": "&amp;",
      "<": "&lt;",
      ">": "&gt;",
      '"': "&quot;",
      "'": "&#39;",
    };
    return entities[character];
  });
}

function resolveAppUrl(requestUrl: string): string {
  const configured = process.env.NEXT_PUBLIC_APP_URL?.trim();

  if (configured) {
    const withScheme = configured.startsWith("http")
      ? configured
      : `https://${configured}`;
    return withScheme.replace(/\/+$/, "");
  }

  return new URL(requestUrl).origin.replace(/\/+$/, "");
}

export async function POST(request: Request) {
  try {
    const body = await request.json().catch(() => null);
    const email =
      body && typeof body.email === "string"
        ? body.email.trim().toLowerCase()
        : "";

    if (!email || email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return NextResponse.json(
        { success: false, error: "A valid email address is required." },
        { status: 400 }
      );
    }

    // Check if account was removed by the administrator
    const accountRemoved = await isAccountRemoved(email);
    if (accountRemoved) {
      return NextResponse.json(
        {
          success: false,
          isRemoved: true,
          error:
            "Your account has been removed by the administrator. Please contact the school registrar or ICT administrator for assistance.",
        },
        { status: 403 }
      );
    }

    const supabaseUrl =
      process.env.NEXT_PUBLIC_SUPABASE_URL ||
      "https://tmrimwhwwvojbsztnbxf.supabase.co";
    const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

    if (!supabaseKey) {
      return NextResponse.json(
        {
          success: false,
          error: "Supabase service role configuration is missing.",
        },
        { status: 500 }
      );
    }

    const supabaseAdmin = createClient(supabaseUrl, supabaseKey, {
      auth: { persistSession: false },
    });

    const appUrl = resolveAppUrl(request.url);

    const { data: linkData, error: linkError } =
      await supabaseAdmin.auth.admin.generateLink({
        type: "recovery",
        email,
        options: { redirectTo: `${appUrl}/reset-password` },
      });

    if (linkError || !linkData?.properties?.hashed_token) {
      const message = linkError?.message || "";

      // Do not reveal whether an account exists for this email address.
      if (/not found|no user|does not exist/i.test(message)) {
        return NextResponse.json({
          success: true,
          message:
            "If an account exists for this email, a password reset link has been sent. Check your inbox and spam folder.",
        });
      }

      console.error("Password reset link generation failed:", linkError);
      return NextResponse.json(
        {
          success: false,
          error: "Unable to create a password reset link right now. Please try again later.",
        },
        { status: 500 }
      );
    }

    const resetUrl = `${appUrl}/reset-password?token_hash=${encodeURIComponent(
      linkData.properties.hashed_token
    )}&type=recovery`;

    const smtpHost = process.env.SMTP_HOST || "smtp.gmail.com";
    const smtpPort = Number(process.env.SMTP_PORT || 587);
    const placeholderUser = "your-email@example.com";
    const placeholderPass = "your-gmail-app-password";

    const configuredSmtpUser = process.env.SMTP_USER?.trim() || "";
    const smtpUser =
      configuredSmtpUser && configuredSmtpUser !== placeholderUser
        ? configuredSmtpUser
        : process.env.GMAIL_USER?.trim() || "";

    const configuredSmtpPass = (process.env.SMTP_PASS || "")
      .replace(/\s+/g, "")
      .trim();
    const smtpPass =
      configuredSmtpPass && configuredSmtpPass !== placeholderPass
        ? configuredSmtpPass
        : (process.env.GMAIL_APP_PASSWORD || "").replace(/\s+/g, "").trim();

    if (!smtpUser || !smtpPass) {
      return NextResponse.json(
        {
          success: false,
          error:
            "The email service is not configured. Please contact the school registrar.",
        },
        { status: 500 }
      );
    }

    const fromAddress =
      process.env.EMAIL_FROM ||
      `"AASMNHS Online Enrollment" <${smtpUser}>`;

    const isGmail =
      smtpHost.toLowerCase().includes("gmail") ||
      smtpUser.toLowerCase().includes("gmail.com");

    const transporter = nodemailer.createTransport(
      isGmail
        ? {
          service: "gmail",
          auth: {
            user: smtpUser,
            pass: smtpPass,
          },
        }
        : {
          host: smtpHost,
          port: smtpPort,
          secure: smtpPort === 465,
          auth: {
            user: smtpUser,
            pass: smtpPass,
          },
          connectionTimeout: 10000,
          greetingTimeout: 10000,
        }
    );

    const safeEmail = escapeHtml(email);

    const htmlTemplate = `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Reset Your Password</title>
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
                  ONLINE ENROLLMENT SYSTEM
                </span>
              </div>
            </td>
          </tr>
          <tr>
            <td style="padding: 32px 30px; background-color: #ffffff;">
              <p style="margin: 0 0 16px 0; font-size: 16px; line-height: 1.5; color: #111827;">
                Hello,
              </p>
              <p style="margin: 0 0 20px 0; font-size: 14px; line-height: 1.6; color: #4b5563;">
                We received a request to reset the password for the AASMNHS account registered to <strong>${safeEmail}</strong>.
              </p>
              <p style="margin: 0 0 24px 0; font-size: 14px; line-height: 1.6; color: #4b5563;">
                Click the button below to set a new password. This link can only be used once and will expire shortly.
              </p>
              <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="margin-bottom: 24px;">
                <tr>
                  <td align="center">
                    <a href="${resetUrl}" target="_blank" style="display: inline-block; background-color: #176b4d; color: #ffffff; text-decoration: none; font-size: 15px; font-weight: bold; padding: 14px 32px; border-radius: 10px; box-shadow: 0 4px 10px rgba(23, 107, 77, 0.3);">
                      Reset My Password
                    </a>
                  </td>
                </tr>
              </table>
              <p style="margin: 0 0 20px 0; font-size: 12px; line-height: 1.6; color: #6b7280;">
                If the button does not work, copy and paste this link into your browser:<br>
                <a href="${resetUrl}" style="color: #176b4d; word-break: break-all;">${resetUrl}</a>
              </p>
              <div style="background-color: #fffbeb; border: 1px solid #fef3c7; border-left: 4px solid #f59e0b; padding: 14px 16px; border-radius: 8px; font-size: 12px; color: #92400e; line-height: 1.6;">
                <strong>⚠️ Security Notice:</strong> If you did not request a password reset, you can safely ignore this email. Your password will not change.
              </div>
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

    try {
      await transporter.sendMail({
        from: fromAddress,
        to: email,
        subject: "Reset Your AASMNHS Account Password",
        html: htmlTemplate,
        text: [
          "Hello,",
          "",
          `We received a request to reset the password for the AASMNHS account registered to ${email}.`,
          "",
          "Set a new password using this link (works once and expires shortly):",
          resetUrl,
          "",
          "If you did not request a password reset, you can safely ignore this email.",
          "",
          "Anselmo A. Sandoval Memorial National High School",
          "Mabini, Batangas • DepEd Region IV-A",
        ].join("\n"),
      });
    } catch (mailError) {
      console.error("Password reset email dispatch error:", mailError);
      return NextResponse.json(
        {
          success: false,
          error:
            "We could not send the password reset email right now. Please try again later or contact the school registrar.",
        },
        { status: 502 }
      );
    }

    await logActivity({
      userType: "User",
      userEmail: email,
      action: "Requested Password Reset",
      details: {
        timestamp: new Date().toISOString(),
      },
    });

    return NextResponse.json({
      success: true,
      message:
        "If an account exists for this email, a password reset link has been sent. Check your inbox and spam folder.",
    });
  } catch (error: unknown) {
    console.error("Password reset request error:", error);
    return NextResponse.json(
      {
        success: false,
        error: "Unable to process the password reset request right now.",
      },
      { status: 500 }
    );
  }
}
