export type ActivityLog = {
  id: string;
  created_at: string;
  user_type: string;
  user_email: string;
  action: string;
  details?: Record<string, unknown>;
};

/**
 * Returns today's date in Asia/Manila (Philippines) timezone formatted as YYYY-MM-DD.
 */
export function getManilaToday(): string {
  try {
    const parts = new Intl.DateTimeFormat("en-CA", {
      timeZone: "Asia/Manila",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).format(new Date());
    return parts; // YYYY-MM-DD format
  } catch {
    return new Date().toISOString().slice(0, 10);
  }
}

/**
 * Formats an ISO date string into readable Philippine time (Asia/Manila).
 * e.g., "Nov 6, 2026, 02:30 PM"
 */
export function formatPhilippineDateTime(isoString?: string | null): string {
  if (!isoString) return "—";
  try {
    const date = new Date(isoString);
    if (isNaN(date.getTime())) return String(isoString);

    return new Intl.DateTimeFormat("en-PH", {
      timeZone: "Asia/Manila",
      year: "numeric",
      month: "short",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hour12: true,
    }).format(date);
  } catch {
    return String(isoString);
  }
}

