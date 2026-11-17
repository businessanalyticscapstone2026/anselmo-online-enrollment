import nodemailer from "nodemailer";

export type MailConfig = {
  host: string;
  port: number;
  user: string;
  pass: string;
  from: string;
};

const PLACEHOLDER_USER = "your-email@example.com";
const PLACEHOLDER_PASS = "your-gmail-app-password";

export function getMailConfig(): MailConfig | null {
  const smtpHost = process.env.SMTP_HOST || "smtp.gmail.com";
  const smtpPort = Number(process.env.SMTP_PORT || 587);

  const configuredUser = (process.env.SMTP_USER || "").trim();
  const user =
    configuredUser && configuredUser !== PLACEHOLDER_USER
      ? configuredUser
      : (process.env.GMAIL_USER || "").trim();

  const configuredPass = (process.env.SMTP_PASS || "")
    .replace(/\s+/g, "")
    .trim();
  const pass =
    configuredPass && configuredPass !== PLACEHOLDER_PASS
      ? configuredPass
      : (process.env.GMAIL_APP_PASSWORD || "").replace(/\s+/g, "").trim();

  if (!user || !pass) return null;

  const from =
    process.env.EMAIL_FROM ||
    `"AASMNHS Online Enrollment" <${user}>`;

  return {
    host: smtpHost,
    port: smtpPort,
    user,
    pass,
    from,
  };
}

export function createMailTransport(config: MailConfig) {
  const secure = config.port === 465;

  return nodemailer.createTransport({
    host: config.host,
    port: config.port,
    secure,
    requireTLS: config.port === 587,
    auth: { user: config.user, pass: config.pass },
    connectionTimeout: 15000,
    greetingTimeout: 15000,
    socketTimeout: 25000,
  });
}

export function escapeHtml(value: string): string {
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
