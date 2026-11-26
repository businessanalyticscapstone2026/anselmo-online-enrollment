export const ENROLLMENT_STATUS_OPTIONS = [
  { value: "pending", label: "Pending" },
  { value: "enrolled", label: "Enrolled" },
  { value: "denied", label: "Denied" },
] as const;

// `rejected` is kept only for legacy records. New decisions use `denied`,
// which means the student can resubmit requirements for another review.
export type EnrollmentStatus =
  | "pending"
  | "enrolled"
  | "denied"
  | "rejected";

const STATUS_LABELS: Record<EnrollmentStatus, string> = {
  pending: "Pending",
  enrolled: "Enrolled",
  denied: "Denied",
  rejected: "Rejected",
};

export function normalizeEnrollmentStatus(value: unknown): EnrollmentStatus {
  const status = String(value ?? "")
    .toLowerCase()
    .trim()
    .replace(/[\s-]+/g, "_");

  if (status === "enrolled" || status === "approved") {
    return "enrolled";
  }

  if (status === "denied") {
    return "denied";
  }

  if (status === "rejected") {
    return "rejected";
  }

  return "pending";
}

/**
 * Final statuses can no longer be changed. `denied` is intentionally not
 * final because the student may resubmit requirements and be reviewed again.
 */
export function isFinalEnrollmentStatus(value: unknown): boolean {
  const status = normalizeEnrollmentStatus(value);
  return status === "enrolled" || status === "rejected";
}

export function isDeniedEnrollmentStatus(value: unknown): boolean {
  return normalizeEnrollmentStatus(value) === "denied";
}

export function getEnrollmentStatusLabel(value: unknown): string {
  return STATUS_LABELS[normalizeEnrollmentStatus(value)];
}
