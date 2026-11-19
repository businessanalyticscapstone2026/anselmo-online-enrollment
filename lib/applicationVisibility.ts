import { normalizeEnrollmentStatus } from "@/lib/enrollmentStatus";

type ApplicationVisibilityRecord = {
  status?: unknown;
  requirements_submitted?: unknown;
  student_details?: unknown;
};

function readStudentDetails(value: unknown): Record<string, unknown> {
  if (typeof value === "string") {
    try {
      const parsed: unknown = JSON.parse(value);
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
        return parsed as Record<string, unknown>;
      }
    } catch {
      return {};
    }
  }

  if (value && typeof value === "object" && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }

  return {};
}

/**
 * Staff and admin records are only visible after the student's credentials
 * have actually been emailed. New applications store `credentials_sent`
 * inside `student_details`; legacy rows that predate that flag fall back to
 * their completed requirements/status so existing records remain visible.
 */
export function hasReceivedCredentials(
  record: ApplicationVisibilityRecord
): boolean {
  const details = readStudentDetails(record.student_details);

  if (Object.prototype.hasOwnProperty.call(details, "credentials_sent")) {
    return (
      details.credentials_sent === true || details.credentials_sent === "true"
    );
  }

  const status = normalizeEnrollmentStatus(record.status);

  if (status !== "pending") {
    return true;
  }

  return record.requirements_submitted === true;
}

export function filterVisibleApplications<T extends ApplicationVisibilityRecord>(
  records: T[]
): T[] {
  return records.filter(hasReceivedCredentials);
}
