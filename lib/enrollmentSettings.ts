export const PHILIPPINE_TIME_ZONE = "Asia/Manila";

export type EnrollmentSettings = {
  id?: number | null;
  enrollment_start_date?: string | null;
  enrollment_end_date?: string | null;
  updated_at?: string | null;
  updated_by?: string | null;
};

export type EnrollmentAvailabilityReason =
  | "open"
  | "not_configured"
  | "not_started"
  | "ended"
  | "unavailable";

export type EnrollmentAvailability = {
  isOpen: boolean;
  reason: EnrollmentAvailabilityReason;
  message: string;
  currentManilaDate: string;
  currentManilaTime: string;
  startDate: string | null;
  endDate: string | null;
};

export type ManilaNow = {
  date: string;
  time: string;
};

const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

function pad2(value: number): string {
  return String(value).padStart(2, "0");
}

export function getManilaNow(now: Date = new Date()): ManilaNow {
  try {
    const parts = new Intl.DateTimeFormat("en-US", {
      timeZone: PHILIPPINE_TIME_ZONE,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hour12: false,
    }).formatToParts(now);

    const get = (type: Intl.DateTimeFormatPartTypes) =>
      parts.find((part) => part.type === type)?.value ?? "";

    const year = get("year");
    const month = get("month");
    const day = get("day");
    let hour = get("hour");

    if (hour === "24") hour = "00";

    return {
      date: `${year}-${month}-${day}`,
      time: `${pad2(Number(hour) || 0)}:${get("minute") || "00"}:${get("second") || "00"}`,
    };
  } catch {
    const iso = now.toISOString();
    return {
      date: iso.slice(0, 10),
      time: iso.slice(11, 19),
    };
  }
}

export function normalizeEnrollmentDate(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return DATE_PATTERN.test(trimmed) ? trimmed : null;
}

export function formatManilaDate(date: string | null | undefined): string {
  const normalizedDate = normalizeEnrollmentDate(date);
  if (!normalizedDate) return "Not set";

  const parsed = new Date(`${normalizedDate}T00:00:00+08:00`);
  if (Number.isNaN(parsed.getTime())) return normalizedDate;

  return new Intl.DateTimeFormat("en-PH", {
    timeZone: PHILIPPINE_TIME_ZONE,
    year: "numeric",
    month: "long",
    day: "numeric",
  }).format(parsed);
}

export function formatManilaDateTime(
  date: string | null | undefined,
  time: string | null | undefined
): string {
  const normalizedDate = normalizeEnrollmentDate(date);
  if (!normalizedDate) return "Not set";

  const normalizedTime =
    typeof time === "string" && /^\d{2}:\d{2}(:\d{2})?/.test(time.trim())
      ? time.trim().slice(0, 8).padEnd(8, ":00")
      : "00:00:00";

  const parsed = new Date(`${normalizedDate}T${normalizedTime}+08:00`);
  if (Number.isNaN(parsed.getTime())) {
    return `${normalizedDate} ${normalizedTime.slice(0, 5)}`;
  }

  return new Intl.DateTimeFormat("en-PH", {
    timeZone: PHILIPPINE_TIME_ZONE,
    year: "numeric",
    month: "long",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hour12: true,
  }).format(parsed);
}

export function formatManilaTimestamp(
  value: string | null | undefined
): string {
  if (!value) return "Not available";

  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return value;

  return new Intl.DateTimeFormat("en-PH", {
    timeZone: PHILIPPINE_TIME_ZONE,
    year: "numeric",
    month: "long",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: true,
  }).format(parsed);
}

export function evaluateEnrollmentAvailability(
  settings: EnrollmentSettings | null | undefined,
  now: Date = new Date()
): EnrollmentAvailability {
  const manilaNow = getManilaNow(now);
  const startDate = normalizeEnrollmentDate(settings?.enrollment_start_date);
  const endDate = normalizeEnrollmentDate(settings?.enrollment_end_date);

  const base = {
    currentManilaDate: manilaNow.date,
    currentManilaTime: manilaNow.time,
    startDate,
    endDate,
  };

  if (!startDate || !endDate) {
    return {
      ...base,
      isOpen: false,
      reason: "not_configured",
      message:
        "The enrollment schedule has not been configured yet. Please check back later.",
    };
  }

  if (manilaNow.date < startDate) {
    return {
      ...base,
      isOpen: false,
      reason: "not_started",
      message: `Enrollment has not started yet. It will open on ${formatManilaDate(
        startDate
      )} (Philippine Standard Time).`,
    };
  }

  if (manilaNow.date > endDate) {
    return {
      ...base,
      isOpen: false,
      reason: "ended",
      message:
        "Enrollment is now closed. The enrollment period has ended.",
    };
  }

  return {
    ...base,
    isOpen: true,
    reason: "open",
    message: "Enrollment is open. New applications are now being accepted.",
  };
}

export type PublicEnrollmentSettings = {
  id: number | null;
  enrollment_start_date: string | null;
  enrollment_end_date: string | null;
};

export function toPublicEnrollmentSettings(
  settings: EnrollmentSettings | null | undefined
): PublicEnrollmentSettings | null {
  if (!settings) return null;

  return {
    id: settings.id ?? null,
    enrollment_start_date: settings.enrollment_start_date ?? null,
    enrollment_end_date: settings.enrollment_end_date ?? null,
  };
}
