import { NextResponse } from "next/server";
import nodemailer from "nodemailer";
import { randomInt } from "node:crypto";
import { createClient, type User } from "@supabase/supabase-js";
import { getAuthContext } from "@/lib/auth/server";
import { hasValidMfaCookie } from "@/lib/auth/mfaCookie";
import { isAdminRole, isStaffRole } from "@/lib/auth/roles";
import { getTrackLabel } from "@/lib/clusters";
import { logActivity } from "@/lib/activityLog";

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const {
      email,
      applicationId = "",
      studentName = "Student",
      track = "Senior High Track",
      cluster = "",
      password: customPassword,
      contactNumber = "",
    } = body;

    if (!email || typeof email !== "string" || !email.includes("@")) {
      return NextResponse.json(
        { success: false, error: "A valid email address is required." },
        { status: 400 }
      );
    }

    const cleanEmail = email.trim().toLowerCase();
    const cleanCluster =
      typeof cluster === "string" ? cluster.trim() : "";
    const trackLabel = getTrackLabel(track);
    const enrollmentSelection = cleanCluster
      ? `${trackLabel} (${cleanCluster})`
      : trackLabel;

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

    const auth = await getAuthContext();
    const staffCaller = Boolean(
      auth.user && (isStaffRole(auth.role) || isAdminRole(auth.role))
    );

    if (staffCaller && auth.user) {
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

    if (!staffCaller) {
      const isUuid =
        /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
          String(applicationId)
        );

      if (!isUuid) {
        return NextResponse.json(
          {
            success: false,
            error:
              "A valid enrollment application is required to create credentials.",
          },
          { status: 401 }
        );
      }

      const { data: application, error: applicationError } =
        await supabaseAdmin
          .from("student_applications")
          .select("*")
          .eq("id", applicationId)
          .maybeSingle();

      if (applicationError || !application) {
        return NextResponse.json(
          { success: false, error: "Enrollment application not found." },
          { status: 404 }
        );
      }

      const applicationRecord = application as Record<string, unknown>;
      const storedDocuments =
        applicationRecord.requirements_documents &&
          typeof applicationRecord.requirements_documents === "object"
          ? (applicationRecord.requirements_documents as Record<
            string,
            unknown
          >)
          : {};
      const storedDetails =
        applicationRecord.student_details &&
          typeof applicationRecord.student_details === "object"
          ? (applicationRecord.student_details as Record<string, unknown>)
          : {};

      let applicationEmail =
        [
          applicationRecord.email,
          storedDocuments.student_email,
          storedDetails.email,
        ]
          .find(
            (value): value is string =>
              typeof value === "string" && value.trim().length > 0
          )
          ?.trim() || "";

      if (!applicationEmail && applicationRecord.user_id) {
        try {
          const { data: linkedUser } =
            await supabaseAdmin.auth.admin.getUserById(
              String(applicationRecord.user_id)
            );

          if (linkedUser?.user?.email) {
            applicationEmail = linkedUser.user.email.trim();
          }
        } catch (lookupError) {
          console.warn("Could not resolve linked auth user email:", lookupError);
        }
      }

      const cleanContact =
        typeof contactNumber === "string" ? contactNumber.trim() : "";
      const storedContact = String(
        applicationRecord.contact_number || ""
      ).trim();
      const contactMatches =
        Boolean(normalizePhone(cleanContact)) &&
        normalizePhone(cleanContact) === normalizePhone(storedContact);

      // No email on file yet (application just created): allow the account
      // email to be set. If an email exists, accept a correction when the
      // contact number confirms ownership.
      if (
        applicationEmail &&
        applicationEmail.toLowerCase() !== cleanEmail &&
        !contactMatches
      ) {
        return NextResponse.json(
          {
            success: false,
            error: "The email does not match this enrollment application.",
          },
          { status: 403 }
        );
      }
    }

    // 1. Generate or use supplied password
    const generatedPassword =
      typeof customPassword === "string" && customPassword.trim().length >= 6
        ? customPassword.trim()
        : `AASMNHS - ${String(randomInt(0, 1_000_000)).padStart(6, "0")}`;

    // 2. Synchronize account in Supabase Auth using Service Role Admin
    let authRegistered = false;
    let authUserId: string | null = null;
    let authNotice: string | null = null;

    try {
      // Find the account across all pages so older students are not missed.
      let existingUser: User | null = null;

      for (let page = 1; page <= 25 && !existingUser; page += 1) {
        const { data: userPage, error: listError } =
          await supabaseAdmin.auth.admin.listUsers({ page, perPage: 200 });

        if (listError) {
          throw new Error(listError.message);
        }

        const users = userPage?.users ?? [];
        existingUser =
          users.find((u) => u.email?.toLowerCase() === cleanEmail) ?? null;

        if (users.length < 200) {
          break;
        }
      }

      if (existingUser) {
        const existingMetadata =
          existingUser.user_metadata &&
            typeof existingUser.user_metadata === "object"
            ? existingUser.user_metadata
            : {};

        // Update the password for the existing user and make sure legacy
        // accounts created before email confirmation was enforced can sign in.
        const { data: updated, error: updateErr } =
          await supabaseAdmin.auth.admin.updateUserById(existingUser.id, {
            password: generatedPassword,
            email_confirm: true,
            user_metadata: {
              ...existingMetadata,
              full_name: studentName,
              track: track,
              cluster: cleanCluster,
            },
          });

        if (updateErr) {
          authNotice = `Update existing user notice: ${updateErr.message}`;
        } else {
          authRegistered = true;
          authUserId = updated?.user?.id || existingUser.id;
        }
      } else {
        // Create a new user with confirmed email
        const { data: created, error: createErr } =
          await supabaseAdmin.auth.admin.createUser({
            email: cleanEmail,
            password: generatedPassword,
            email_confirm: true,
            user_metadata: {
              full_name: studentName,
              track: track,
              cluster: cleanCluster,
            },
          });

        if (createErr) {
          authNotice = `Create user notice: ${createErr.message}`;
        } else {
          authRegistered = true;
          authUserId = created?.user?.id || null;
        }
      }
    } catch (authError) {
      console.warn("Supabase Auth admin operation notice:", authError);
      authNotice =
        authError instanceof Error ? authError.message : "Auth sync error";
    }

    // Never hand out a password that was not actually saved to the account.
    if (!authRegistered || !authUserId) {
      return NextResponse.json(
        {
          success: false,
          error:
            authNotice ||
            "The student portal account could not be created or updated.",
          authRegistered: false,
          authNotice,
        },
        { status: 500 }
      );
    }

    let linkedApplicationId: string | null = null;

    if (authUserId) {
      try {
        const isApplicationUuid =
          /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
            String(applicationId)
          );

        const nowIso = new Date().toISOString();
        const cleanTrack =
          typeof track === "string" && track.trim() ? track.trim() : null;
        const linkPayloads = [
          {
            user_id: authUserId,
            email: cleanEmail,
            track: cleanTrack,
            selected_cluster: cleanCluster || null,
            updated_at: nowIso,
          },
          {
            user_id: authUserId,
            email: cleanEmail,
            track: cleanTrack,
            updated_at: nowIso,
          },
          {
            user_id: authUserId,
            track: cleanTrack,
            updated_at: nowIso,
          },
          {
            user_id: authUserId,
            updated_at: nowIso,
          },
        ];

        const updateById = (payload: Record<string, unknown>) =>
          supabaseAdmin
            .from("student_applications")
            .update(payload)
            .eq("id", applicationId)
            .select("id");

        const updateByEmail = (payload: Record<string, unknown>) =>
          supabaseAdmin
            .from("student_applications")
            .update(payload)
            .ilike("email", cleanEmail)
            .select("id");

        const isMissingColumnError = (
          error: { code?: string; message?: string } | null
        ) =>
          Boolean(
            error &&
            (error.code === "PGRST204" ||
              /column|schema cache|email|track|cluster/i.test(
                error.message || ""
              ))
          );

        let linkResult = isApplicationUuid
          ? await updateById(linkPayloads[0])
          : await updateByEmail(linkPayloads[0]);

        for (const payload of linkPayloads.slice(1)) {
          if (!linkResult.error || !isMissingColumnError(linkResult.error)) {
            break;
          }

          linkResult = isApplicationUuid
            ? await updateById(payload)
            : await updateByEmail(payload);
        }

        if (linkResult.error) {
          authNotice = linkResult.error.message;
        } else if (linkResult.data && linkResult.data.length > 0) {
          linkedApplicationId = String(linkResult.data[0].id);
        }

        const { data: existingProfile } = await supabaseAdmin
          .from("profiles")
          .select("id, role")
          .eq("id", authUserId)
          .maybeSingle();

        if (!existingProfile) {
          await supabaseAdmin.from("profiles").insert({
            id: authUserId,
            full_name: studentName,
            email: cleanEmail,
            role: "student",
          });
        } else {
          const existingRole = String(existingProfile.role ?? "")
            .trim()
            .toLowerCase();

          if (!["staff", "registrar", "admin"].includes(existingRole)) {
            await supabaseAdmin
              .from("profiles")
              .update({
                full_name: studentName,
                email: cleanEmail,
                role: existingRole || "student",
              })
              .eq("id", authUserId);
          }
        }
      } catch (linkError) {
        console.warn("Student application linking notice:", linkError);
      }
    }

    // 3. SMTP email dispatch
    const smtpHost = process.env.SMTP_HOST || "smtp.gmail.com";
    const smtpPort = Number(process.env.SMTP_PORT || 587);
    const placeholderUser = "your-email@example.com";
    const placeholderPass = "your-gmail-app-password";

    // Ignore placeholder values and fall back to the Gmail credentials used by
    // the enrollment form so credential emails are actually delivered.
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

    const isConfigured = Boolean(smtpUser) && Boolean(smtpPass);

    const fromAddress =
      process.env.EMAIL_FROM ||
      (smtpUser
        ? `"AASMNHS Online Enrollment" <${smtpUser}>`
        : '"AASMNHS Online Enrollment" <marknelsoncantos9@gmail.com>');

    const appUrl =
      process.env.NEXT_PUBLIC_APP_URL ||
      process.env.VERCEL_URL ||
      "http://localhost:3000";
    const loginUrl = `${appUrl.startsWith("http") ? appUrl : `https://${appUrl}`}/login`;

    let emailSent = false;
    let emailError: string | null = null;

    if (isConfigured) {
      try {
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

        const htmlTemplate = `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Your Student Account Credentials</title>
</head>
<body style="margin: 0; padding: 0; background-color: #051a0f; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; color: #1f2937;">
  <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background-color: #051a0f; padding: 30px 15px;">
    <tr>
      <td align="center">
        <table role="presentation" width="100%" style="max-width: 600px; background-color: #ffffff; border-radius: 16px; overflow: hidden; box-shadow: 0 10px 25px rgba(0,0,0,0.3);" cellspacing="0" cellpadding="0">
          
          <!-- HEADER -->
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

          <!-- BODY CONTENT -->
          <tr>
            <td style="padding: 32px 30px; background-color: #ffffff;">
              <p style="margin: 0 0 16px 0; font-size: 16px; line-height: 1.5; color: #111827;">
                Dear <strong>${studentName}</strong>,
              </p>
              <p style="margin: 0 0 20px 0; font-size: 14px; line-height: 1.6; color: #4b5563;">
                Your enrollment application for <strong>${enrollmentSelection}</strong> has been received by Anselmo A. Sandoval Memorial National High School.
              </p>
              <p style="margin: 0 0 24px 0; font-size: 14px; line-height: 1.6; color: #4b5563;">
                An official student portal account has been created for you. You can use these credentials to sign in, monitor your application status, and view announcements:
              </p>

              <!-- CREDENTIALS BOX -->
              <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background-color: #f4f9f6; border: 2px solid #c8e6c9; border-left: 6px solid #176b4d; border-radius: 12px; margin-bottom: 24px;">
                <tr>
                  <td style="padding: 20px 24px;">
                    <div style="font-size: 12px; font-weight: 800; text-transform: uppercase; color: #176b4d; letter-spacing: 1px; margin-bottom: 12px;">
                      STUDENT PORTAL LOGIN DETAILS
                    </div>
                    
                    <div style="margin-bottom: 12px;">
                      <span style="display: block; font-size: 12px; color: #6b7280; font-weight: 600;">REGISTERED EMAIL:</span>
                      <span style="font-size: 15px; font-weight: bold; color: #063b2b; font-family: monospace;">${cleanEmail}</span>
                    </div>

                    <div>
                      <span style="display: block; font-size: 12px; color: #6b7280; font-weight: 600;">PASSWORD:</span>
                      <span style="display: inline-block; margin-top: 4px; padding: 6px 14px; background-color: #e8f5e9; border: 1px dashed #176b4d; border-radius: 6px; font-size: 18px; font-weight: 800; color: #063b2b; letter-spacing: 1.5px; font-family: monospace;">
                        ${generatedPassword}
                      </span>
                    </div>
                  </td>
                </tr>
              </table>

              <!-- ACTION BUTTON -->
              <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="margin-bottom: 24px;">
                <tr>
                  <td align="center">
                    <a href="${loginUrl}" target="_blank" style="display: inline-block; background-color: #176b4d; color: #ffffff; text-decoration: none; font-size: 15px; font-weight: bold; padding: 14px 32px; border-radius: 10px; box-shadow: 0 4px 10px rgba(23, 107, 77, 0.3);">
                      Go to Student Login Portal
                    </a>
                  </td>
                </tr>
              </table>

              <!-- SECURITY NOTICE -->
              <div style="background-color: #fffbeb; border: 1px solid #fef3c7; border-left: 4px solid #f59e0b; padding: 14px 16px; border-radius: 8px; font-size: 12px; color: #92400e; line-height: 1.6;">
                <strong>⚠️ Security Notice:</strong> Please keep this password confidential. We strongly recommend changing your password immediately upon your first login.
              </div>

            </td>
          </tr>

          <!-- FOOTER -->
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

        await transporter.sendMail({
          from: fromAddress,
          to: cleanEmail,
          subject: "Your Student Account Credentials - AASMNHS Online Enrollment",
          html: htmlTemplate,
          text: `Dear ${studentName},\n\nYour enrollment application for ${enrollmentSelection} has been received by Anselmo A. Sandoval Memorial National High School.\n\nYour Student Portal Login Credentials:\nRegistered Email: ${cleanEmail}\nPassword: ${generatedPassword}\n\nLogin Portal: ${loginUrl}\n\nPlease keep this password secure.\n\nAnselmo A. Sandoval Memorial National High School\nMabini, Batangas • DepEd Region IV-A`,
        });

        emailSent = true;
      } catch (err: unknown) {
        console.error("Nodemailer SMTP dispatch error:", err);
        emailError =
          err instanceof Error ? err.message : "SMTP sendMail error";
      }
    } else {
      console.log(
        `[SMTP Simulated] Email credentials generated for ${cleanEmail} (Configure SMTP_USER & SMTP_PASS in .env.local to send live emails)`
      );
    }

    await logActivity({
      userType: staffCaller
        ? isAdminRole(auth.role)
          ? "Admin"
          : "Staff"
        : "Student",
      userEmail: staffCaller ? auth.user?.email || "" : cleanEmail,
      action: staffCaller
        ? `Sent Student Account Credentials: ${cleanEmail}`
        : `Generated Student Account: ${cleanEmail}`,
      details: {
        targetEmail: cleanEmail,
        studentName,
        applicationId: applicationId || null,
        linkedApplicationId,
        authUserId,
        emailSent,
        timestamp: new Date().toISOString(),
      },
    });

    return NextResponse.json({
      success: true,
      email: cleanEmail,
      studentName,
      emailSent,
      emailConfigured: isConfigured,
      emailError,
      authRegistered,
      authUserId,
      linkedApplicationId,
      authNotice,
      message: emailSent
        ? `Account confirmation email with your password has been sent to ${cleanEmail}.`
        : isConfigured
          ? `Could not send the email: ${emailError || "Unknown error"}. Please try again or contact the school registrar.`
          : `Password created for ${cleanEmail}. (To send live emails, add your Gmail App Password to SMTP_PASS in .env.local).`,
    });
  } catch (error: unknown) {
    console.error("Error in send-account route:", error);
    return NextResponse.json(
      {
        success: false,
        error:
          error instanceof Error ? error.message : "Server error sending confirmation",
      },
      { status: 500 }
    );
  }
}
