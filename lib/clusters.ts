export type TrackValue = "academic" | "techpro";

export interface TrackConfig {
  value: TrackValue;
  label: string;
  shortLabel: string;
  description: string;
  clusters: readonly string[];
}

export const TRACKS: readonly TrackConfig[] = [
  {
    value: "academic",
    label: "Academic Track",
    shortLabel: "Academic",
    description:
      "Choose academic-focused elective clusters aligned with your interests and future college degree or career goals.",
    clusters: [
      "STEM",
      "Business & Entrepreneurship",
      "Arts, Social Sciences & Humanities",
      "Sports, Health & Wellness",
    ],
  },
  {
    value: "techpro",
    label: "Technical Professional Track",
    shortLabel: "Technical Professional",
    description:
      "Choose technology and skills-oriented elective clusters that support practical competencies and immediate career preparation.",
    clusters: [
      "Construction & Building Technology",
      "Industrial Technology",
      "Hospitality & Tourism",
      "ICT Support",
    ],
  },
] as const;

const TRACK_BY_VALUE = new Map<string, TrackConfig>(
  TRACKS.map((track) => [track.value, track])
);

export function normalizeTrack(value: unknown): TrackValue | null {
  const normalized = String(value ?? "")
    .trim()
    .toLowerCase()
    .replace(/[\s_-]+/g, "");

  if (normalized === "academic" || normalized === "academictrack") {
    return "academic";
  }
  if (
    normalized === "techpro" ||
    normalized === "techprotrack" ||
    normalized === "technicalprofessional" ||
    normalized === "technicalprofessionaltrack" ||
    normalized === "tvl" ||
    normalized === "technicalvocationalivelihood"
  ) {
    return "techpro";
  }

  return null;
}

export function getTrackConfig(value: unknown): TrackConfig | null {
  const track = normalizeTrack(value);
  return track ? TRACK_BY_VALUE.get(track) ?? null : null;
}

export function getTrackLabel(value: unknown): string {
  return getTrackConfig(value)?.label ?? "Senior High Track";
}

export function getClustersForTrack(value: unknown): readonly string[] {
  return getTrackConfig(value)?.clusters ?? [];
}

const CLUSTER_TRACK_OVERRIDES: Record<string, TrackValue> = {
  abm: "academic",
  "accountancy, business & management": "academic",
  "accountancy, business and management": "academic",
  humss: "academic",
  gas: "academic",
  stem: "academic",
  "arts, social sciences & humanities": "academic",
  "business & entrepreneurship": "academic",
  "sports, health & wellness": "academic",
  "construction & building technology": "techpro",
  "industrial technology": "techpro",
  "hospitality & tourism": "techpro",
  "ict support": "techpro",
};

/**
 * Best-effort reverse lookup from a cluster (stored in `sections.cluster` or
 * `sections.strand`) back to its track. Used so the track can still be shown
 * and saved even when the `sections.track` column has not been migrated yet.
 */
export function getTrackForCluster(clusterValue: unknown): TrackValue | null {
  const cluster = String(clusterValue ?? "").trim();
  if (!cluster) return null;

  const lower = cluster.toLowerCase();

  for (const track of TRACKS) {
    if (track.clusters.some((option) => option.toLowerCase() === lower)) {
      return track.value;
    }
  }

  const override = CLUSTER_TRACK_OVERRIDES[lower];
  if (override) return override;

  if (lower.startsWith("tvl")) return "techpro";

  return null;
}

export function isValidClusterForTrack(
  trackValue: unknown,
  clusterValue: unknown
): boolean {
  const cluster = String(clusterValue ?? "").trim();
  if (!cluster) return false;

  return getClustersForTrack(trackValue).some(
    (option) => option.toLowerCase() === cluster.toLowerCase()
  );
}

export function getCanonicalCluster(
  trackValue: unknown,
  clusterValue: unknown
): string {
  const cluster = String(clusterValue ?? "").trim();
  if (!cluster) return "";

  return (
    getClustersForTrack(trackValue).find(
      (option) => option.toLowerCase() === cluster.toLowerCase()
    ) ?? cluster
  );
}
