export const ENROLLMENT_STATUS_OPTIONS = [
  { value: "pending", label: "Pending" },
  { value: "enrolled", label: "Enrolled" },
  { value: "rejected", label: "Rejected" },
] as const;

export type EnrollmentStatus =
  (typeof ENROLLMENT_STATUS_OPTIONS)[number]["value"];

const STATUS_LABELS: Record<EnrollmentStatus, string> = {
  pending: "Pending",
  enrolled: "Enrolled",
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

  if (status === "rejected") {
    return "rejected";
  }

  return "pending";
}

export function getEnrollmentStatusLabel(value: unknown): string {
  return STATUS_LABELS[normalizeEnrollmentStatus(value)];
}
