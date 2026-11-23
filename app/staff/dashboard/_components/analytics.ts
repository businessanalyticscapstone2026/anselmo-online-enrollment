import {
  TRACKS,
  normalizeTrack,
  type TrackValue,
} from "@/lib/clusters";
import {
  normalizeEnrollmentStatus,
  type EnrollmentStatus,
} from "@/lib/enrollmentStatus";

export type ApplicationRecord = Record<string, unknown> & {
  id?: string | number;
  status?: string | null;
};

export type GenderDatum = {
  key: string;
  label: string;
  value: number;
  percentage: number;
  color: string;
};

export type ClusterDatum = {
  name: string;
  value: number;
  percentage: number;
};

const GENDER_COLORS: Record<string, string> = {
  Male: "#6ba8c7",
  Female: "#d58aa1",
  Other: "#c8b27c",
};

const GENDER_ORDER = ["Male", "Female", "Other"] as const;

const AGE_BANDS: { label: string; min: number; max: number }[] = [
  { label: "15 and below", min: 0, max: 15 },
  { label: "16", min: 16, max: 16 },
  { label: "17", min: 17, max: 17 },
  { label: "18", min: 18, max: 18 },
  { label: "19", min: 19, max: 19 },
  { label: "20 and above", min: 20, max: 120 },
];

const ALL_CLUSTERS = TRACKS.flatMap((track) => [...track.clusters]);

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function readText(
  record: Record<string, unknown> | null,
  keys: string[]
): string {
  if (!record) return "";

  for (const key of keys) {
    const value = record[key];

    if (typeof value === "string" || typeof value === "number") {
      const text = String(value).trim();
      if (text) return text;
    }
  }

  return "";
}

function roundPercentage(value: number, total: number): number {
  return total > 0 ? Math.round((value / total) * 1000) / 10 : 0;
}

export function getGender(record: ApplicationRecord): string | null {
  const details = asRecord(record.student_details);
  const raw =
    readText(record, ["sex", "gender", "sex_at_birth", "student_gender"]) ||
    readText(details, ["sex", "gender"]);

  if (!raw) return null;

  const normalized = raw.toLowerCase().replace(/\s+/g, " ").trim();

  if (["m", "male", "man", "boy"].includes(normalized)) return "Male";
  if (["f", "female", "woman", "girl"].includes(normalized)) return "Female";

  return "Other";
}

export function getAge(record: ApplicationRecord): number | null {
  const details = asRecord(record.student_details);
  const raw = readText(record, ["age"]) || readText(details, ["age"]);

  if (raw) {
    const parsed = Number(raw);
    if (Number.isFinite(parsed) && parsed >= 0 && parsed <= 120) {
      return Math.trunc(parsed);
    }
  }

  const birth =
    readText(record, ["birth_date", "birthDate"]) ||
    readText(details, ["birth_date", "birthDate"]);

  if (!birth) return null;

  const date = new Date(birth.length === 10 ? `${birth}T00:00:00` : birth);
  if (Number.isNaN(date.getTime())) return null;

  const today = new Date();
  let age = today.getFullYear() - date.getFullYear();
  const monthDiff = today.getMonth() - date.getMonth();

  if (monthDiff < 0 || (monthDiff === 0 && today.getDate() < date.getDate())) {
    age -= 1;
  }

  return age >= 0 && age <= 120 ? age : null;
}

export function getClusterOnly(record: ApplicationRecord): string {
  const details = asRecord(record.student_details);
  const raw =
    readText(record, [
      "selected_cluster",
      "cluster",
      "cluster_name",
      "preferred_cluster",
    ]) || readText(details, ["selected_cluster", "cluster"]);

  if (!raw) return "";

  const canonical = ALL_CLUSTERS.find(
    (cluster) => cluster.toLowerCase() === raw.toLowerCase()
  );

  return canonical ?? raw;
}

export function getTrack(record: ApplicationRecord): TrackValue | null {
  const details = asRecord(record.student_details);
  const raw =
    readText(record, [
      "track",
      "selected_track",
      "preferred_track",
      "track_name",
    ]) || readText(details, ["selected_track", "track", "preferred_track"]);

  const normalized = normalizeTrack(raw);
  if (normalized) return normalized;

  const cluster = getClusterOnly(record);
  if (!cluster) return null;

  const match = TRACKS.find((track) =>
    track.clusters.some(
      (option) => option.toLowerCase() === cluster.toLowerCase()
    )
  );

  return match?.value ?? null;
}

export function getSubmittedDate(record: ApplicationRecord): Date | null {
  const raw = readText(record, [
    "submitted_at",
    "created_at",
    "application_date",
    "created_on",
    "date_submitted",
  ]);

  if (!raw) return null;

  const date = new Date(raw);
  return Number.isNaN(date.getTime()) ? null : date;
}

export function buildGenderBreakdown(applications: ApplicationRecord[]) {
  const counts = new Map<string, number>();

  for (const application of applications) {
    const gender = getGender(application);
    if (gender) {
      counts.set(gender, (counts.get(gender) ?? 0) + 1);
    }
  }

  const total = Array.from(counts.values()).reduce(
    (sum, value) => sum + value,
    0
  );

  const data: GenderDatum[] = GENDER_ORDER.filter((label) =>
    counts.has(label)
  ).map((label) => {
    const value = counts.get(label) ?? 0;

    return {
      key: label.toLowerCase(),
      label,
      value,
      percentage: roundPercentage(value, total),
      color: GENDER_COLORS[label],
    };
  });

  return {
    data,
    total,
    unrecorded: Math.max(applications.length - total, 0),
  };
}

export function buildAgeBreakdown(applications: ApplicationRecord[]) {
  const counts = new Map<string, number>();
  let sum = 0;
  let recorded = 0;

  for (const application of applications) {
    const age = getAge(application);
    if (age === null) continue;

    recorded += 1;
    sum += age;

    const band = AGE_BANDS.find(
      (item) => age >= item.min && age <= item.max
    );
    if (band) {
      counts.set(band.label, (counts.get(band.label) ?? 0) + 1);
    }
  }

  const data: CountDatum[] = AGE_BANDS.filter((band) =>
    counts.has(band.label)
  ).map((band) => {
    const value = counts.get(band.label) ?? 0;

    return {
      label: band.label,
      value,
      percentage: roundPercentage(value, recorded),
    };
  });

  return {
    data,
    total: recorded,
    unrecorded: Math.max(applications.length - recorded, 0),
    average: recorded > 0 ? Math.round((sum / recorded) * 10) / 10 : 0,
  };
}

export function buildClusterBreakdown(applications: ApplicationRecord[]) {
  const counts = new Map<string, number>();

  for (const application of applications) {
    const cluster = getClusterOnly(application);
    if (cluster) {
      counts.set(cluster, (counts.get(cluster) ?? 0) + 1);
    }
  }

  const total = Array.from(counts.values()).reduce(
    (sum, value) => sum + value,
    0
  );

  const data: ClusterDatum[] = Array.from(counts.entries())
    .map(([name, value]) => ({
      name,
      value,
      percentage: roundPercentage(value, total),
    }))
    .sort(
      (a, b) => b.value - a.value || a.name.localeCompare(b.name)
    );

  return {
    data,
    total,
    unrecorded: Math.max(applications.length - total, 0),
  };
}

export function getStatus(record: ApplicationRecord): EnrollmentStatus {
  return normalizeEnrollmentStatus(record.status);
}

export function getBarangay(record: ApplicationRecord): string {
  const details = asRecord(record.student_details);
  return (
    readText(record, ["current_barangay", "barangay"]) ||
    readText(details, ["current_barangay", "barangay"])
  );
}

export function getMunicipality(record: ApplicationRecord): string {
  const details = asRecord(record.student_details);
  return (
    readText(record, ["current_municipality", "municipality", "city"]) ||
    readText(details, ["current_municipality", "municipality", "city"])
  );
}

export function getCollegeCourse(record: ApplicationRecord): string {
  const details = asRecord(record.student_details);
  return (
    readText(record, ["college_course", "collegeCourse"]) ||
    readText(details, ["college_course"])
  );
}

export function hasRequirements(record: ApplicationRecord): boolean {
  if (record.requirements_submitted === true) return true;

  const urls = [
    "report_card_url",
    "birth_certificate_url",
    "other_requirement_url",
  ];

  if (
    urls.some((key) => {
      const value = record[key];
      return typeof value === "string" && value.trim().length > 0;
    })
  ) {
    return true;
  }

  const documents = asRecord(record.requirements_documents);
  if (!documents) return false;

  return Object.entries(documents).some(
    ([key, value]) =>
      key !== "student_email" &&
      typeof value === "string" &&
      value.trim().length > 0
  );
}

export function hasIpCommunity(record: ApplicationRecord): boolean {
  const details = asRecord(record.student_details);
  return Boolean(
    readText(record, ["ip_community_type"]) ||
      readText(details, ["ip_community_type"])
  );
}

export function hasFourPs(record: ApplicationRecord): boolean {
  const details = asRecord(record.student_details);
  return Boolean(
    readText(record, ["four_ps_household_id"]) ||
      readText(details, ["four_ps_household_id"])
  );
}

export function hasSpecialNeeds(record: ApplicationRecord): boolean {
  return record.special_needs_program === true;
}

export function hasPwdId(record: ApplicationRecord): boolean {
  return record.has_pwd_id === true;
}

export type CountDatum = {
  label: string;
  value: number;
  percentage: number;
};

export function buildCountBreakdown(
  applications: ApplicationRecord[],
  getValue: (record: ApplicationRecord) => string,
  limit = 8
): { data: CountDatum[]; total: number; other: number } {
  const counts = new Map<string, number>();

  for (const application of applications) {
    const value = getValue(application).trim();
    if (!value) continue;
    counts.set(value, (counts.get(value) ?? 0) + 1);
  }

  const total = Array.from(counts.values()).reduce(
    (sum, value) => sum + value,
    0
  );

  const sorted = Array.from(counts.entries()).sort(
    (a, b) => b[1] - a[1] || a[0].localeCompare(b[0])
  );

  const data = sorted.slice(0, limit).map(([label, value]) => ({
    label,
    value,
    percentage: roundPercentage(value, total),
  }));

  const other = sorted
    .slice(limit)
    .reduce((sum, [, value]) => sum + value, 0);

  return { data, total, other };
}

function manilaDateKey(date: Date): string {
  return date.toLocaleDateString("en-CA", { timeZone: "Asia/Manila" });
}

export type ClusterTrendPoint = {
  key: string;
  label: string;
  values: Record<string, number>;
};

export type ClusterTrend = {
  keys: string[];
  points: ClusterTrendPoint[];
  total: number;
  otherKey: string | null;
};

export function buildClusterDailyTrend(
  applications: ApplicationRecord[],
  days = 14,
  now = new Date(),
  maxClusters = 4
): ClusterTrend {
  const counts = new Map<string, number>();

  for (const application of applications) {
    const cluster = getClusterOnly(application);
    if (cluster) {
      counts.set(cluster, (counts.get(cluster) ?? 0) + 1);
    }
  }

  const ranked = Array.from(counts.entries()).sort(
    (a, b) => b[1] - a[1] || a[0].localeCompare(b[0])
  );
  const top = ranked.slice(0, Math.max(1, maxClusters)).map(([name]) => name);
  const topSet = new Set(top);
  const hasOther = ranked.length > top.length;
  const otherKey = hasOther ? "Other clusters" : null;
  const keys = otherKey ? [...top, otherKey] : [...top];

  const safeDays = Math.max(1, Math.min(365, Math.floor(days)));
  const points: ClusterTrendPoint[] = [];
  const indexByKey = new Map<string, number>();

  for (let offset = safeDays - 1; offset >= 0; offset -= 1) {
    const date = new Date(now.getTime() - offset * 24 * 60 * 60 * 1000);
    const key = manilaDateKey(date);
    const values: Record<string, number> = {};
    for (const cluster of keys) values[cluster] = 0;

    indexByKey.set(key, points.length);
    points.push({
      key,
      label: date.toLocaleDateString("en-US", {
        month: "short",
        day: "numeric",
        timeZone: "Asia/Manila",
      }),
      values,
    });
  }

  let total = 0;

  for (const application of applications) {
    const submitted = getSubmittedDate(application);
    if (!submitted) continue;

    const index = indexByKey.get(manilaDateKey(submitted));
    if (index === undefined) continue;

    const cluster = getClusterOnly(application);
    if (!cluster) continue;

    const seriesKey = topSet.has(cluster) ? cluster : otherKey;
    if (!seriesKey || !(seriesKey in points[index].values)) continue;

    points[index].values[seriesKey] += 1;
    total += 1;
  }

  return { keys, points, total, otherKey };
}
