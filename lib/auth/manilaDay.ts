export const MANILA_TIME_ZONE = "Asia/Manila";

const MANILA_UTC_OFFSET = "+08:00";

export function getManilaDate(now: Date = new Date()): string {
  try {
    const parts = new Intl.DateTimeFormat("en-US", {
      timeZone: MANILA_TIME_ZONE,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).formatToParts(now);

    const get = (type: Intl.DateTimeFormatPartTypes) =>
      parts.find((part) => part.type === type)?.value ?? "";

    const year = get("year");
    const month = get("month");
    const day = get("day");

    if (!year || !month || !day) {
      throw new Error("Missing Manila date parts.");
    }

    return `${year}-${month}-${day}`;
  } catch {
    return now.toISOString().slice(0, 10);
  }
}

/**
 * Seconds remaining until the next Asia/Manila midnight. Used to make the
 * daily verification pass expire exactly when the Manila calendar day rolls
 * over, regardless of when the pass was issued.
 */
export function secondsUntilManilaMidnight(now: Date = new Date()): number {
  const todayManila = getManilaDate(now);
  const startOfToday = new Date(
    `${todayManila}T00:00:00${MANILA_UTC_OFFSET}`
  ).getTime();
  const nextMidnight = startOfToday + 24 * 60 * 60 * 1000;
  const remaining = Math.floor((nextMidnight - now.getTime()) / 1000);

  return Math.max(60, remaining);
}
