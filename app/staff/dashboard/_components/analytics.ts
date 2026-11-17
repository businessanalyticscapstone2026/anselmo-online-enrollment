import {
  TRACKS,
  getTrackConfig,
  normalizeTrack,
  type TrackValue,
} from "@/lib/clusters";

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

export type WeeklyBucket = {
  key: string;
  label: string;
  start: Date;
  end: Date;
};

export type TrackSeries = {
  track: TrackValue;
  label: string;
  color: string;
  values: number[];
  total: number;
};

export type WeeklyTrackTrend = {
  buckets: WeeklyBucket[];
  series: TrackSeries[];
  maxValue: number;
  plottedCount: number;
  trackedCount: number;
  untrackedCount: number;
  outsideWindowCount: number;
};

const GENDER_COLORS: Record<string, string> = {
  Male: "#6ba8c7",
  Female: "#d58aa1",
  Other: "#c8b27c",
};

const GENDER_ORDER = ["Male", "Female", "Other"] as const;

const TRACK_COLORS: Record<TrackValue, string> = {
  academic: "#c8b27c",
  techpro: "#6ba8c7",
};

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

function startOfWeek(date: Date): Date {
  const result = new Date(
    date.getFullYear(),
    date.getMonth(),
    date.getDate()
  );
  const day = result.getDay();
  result.setDate(result.getDate() - ((day + 6) % 7));
  return result;
}

function addDays(date: Date, days: number): Date {
  const result = new Date(date);
  result.setDate(result.getDate() + days);
  return result;
}

function formatWeekLabel(date: Date): string {
  return date.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
  });
}

export function buildWeeklyTrackTrend(
  applications: ApplicationRecord[],
  weekCount = 8,
  now = new Date()
): WeeklyTrackTrend {
  const currentWeekStart = startOfWeek(now);
  const firstWeekStart = addDays(currentWeekStart, -(weekCount - 1) * 7);

  const buckets: WeeklyBucket[] = Array.from(
    { length: weekCount },
    (_, index) => {
      const start = addDays(firstWeekStart, index * 7);
      const end = addDays(start, 7);

      return {
        key: start.toISOString(),
        label: formatWeekLabel(start),
        start,
        end,
      };
    }
  );

  const series: TrackSeries[] = TRACKS.map((track) => ({
    track: track.value,
    label: track.shortLabel,
    color: TRACK_COLORS[track.value],
    values: Array.from({ length: weekCount }, () => 0),
    total: 0,
  }));

  let trackedCount = 0;
  let plottedCount = 0;
  let outsideWindowCount = 0;

  for (const application of applications) {
    const track = getTrack(application);
    if (!track) continue;

    trackedCount += 1;

    const date = getSubmittedDate(application);
    if (!date) {
      outsideWindowCount += 1;
      continue;
    }

    const bucketIndex = buckets.findIndex(
      (bucket) => date >= bucket.start && date < bucket.end
    );

    if (bucketIndex === -1) {
      outsideWindowCount += 1;
      continue;
    }

    const matchingSeries = series.find((item) => item.track === track);
    if (!matchingSeries) continue;

    matchingSeries.values[bucketIndex] += 1;
    matchingSeries.total += 1;
    plottedCount += 1;
  }

  const maxValue = Math.max(
    0,
    ...series.flatMap((item) => item.values)
  );

  return {
    buckets,
    series,
    maxValue,
    plottedCount,
    trackedCount,
    untrackedCount: Math.max(applications.length - trackedCount, 0),
    outsideWindowCount,
  };
}

export function getTrackLabelShort(track: TrackValue): string {
  return getTrackConfig(track)?.shortLabel ?? track;
}
