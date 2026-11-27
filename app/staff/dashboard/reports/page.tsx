"use client";

import { useEffect, useMemo, useState, useCallback, useRef } from "react";
import { getClustersForTrack, getTrackLabel, TRACKS } from "@/lib/clusters";
import {
  getEnrollmentStatusLabel,
  normalizeEnrollmentStatus,
} from "@/lib/enrollmentStatus";
import {
  resolveSectionList,
  type SectionRecord,
} from "@/lib/sections";
import { filterVisibleApplications } from "@/lib/applicationVisibility";
import { supabase } from "@/lib/supabaseClient";
import {
  Download,
  Printer,
  RefreshCw,
  AlertCircle,
  FileSpreadsheet,
  Users,
  UserRound,
  BarChart3,
} from "lucide-react";

type Row = Record<string, unknown>;

type Gender = "Male" | "Female" | "Unspecified";

type ReportView = "summary" | "gender" | "analytics";

type GenderStudent = {
  id: string;
  name: string;
  gender: Gender;
  status: string;
};

type SectionGenderGroup = {
  id: string;
  name: string;
  adviser: string;
  gradeLevel: string;
  strand: string;
  male: number;
  female: number;
  unspecified: number;
  total: number;
  students: GenderStudent[];
};

const GENDER_ORDER: Record<Gender, number> = {
  Male: 0,
  Female: 1,
  Unspecified: 2,
};

function getRowCluster(row: Row): string {
  const direct = [
    row.selected_cluster,
    row.cluster,
    row.cluster_name,
    row.preferred_cluster,
  ].find((value) => typeof value === "string" && value.trim());

  if (typeof direct === "string") return direct.trim();

  const details = row.student_details;
  if (details && typeof details === "object" && !Array.isArray(details)) {
    const nested = [
      (details as Row).selected_cluster,
      (details as Row).cluster,
    ].find((value) => typeof value === "string" && value.trim());

    if (typeof nested === "string") return nested.trim();
  }

  return "";
}

function getStudentName(row: Row): string {
  return (
    [row.first_name, row.middle_name, row.last_name]
      .filter((part) => typeof part === "string" && part.trim())
      .join(" ") || "Unnamed applicant"
  );
}

function getRowGender(row: Row): Gender {
  const details =
    row.student_details &&
      typeof row.student_details === "object" &&
      !Array.isArray(row.student_details)
      ? (row.student_details as Row)
      : {};

  const raw = [row.gender, row.sex, details.gender, details.sex].find(
    (value) => typeof value === "string" && value.trim()
  );

  const value = String(raw ?? "")
    .trim()
    .toLowerCase();

  if (value === "male" || value === "m" || value === "boy") return "Male";
  if (value === "female" || value === "f" || value === "girl") return "Female";
  return "Unspecified";
}

function normalizeTrack(value: unknown): "Academic" | "Tech Professional" | "" {
  const track = String(value ?? "").trim().toLowerCase().replace(/[_-]+/g, " ");
  if (track === "academic" || track === "academic track") return "Academic";
  if (
    track === "techpro" ||
    track === "tech pro" ||
    track === "tech professional" ||
    track === "technical vocational livelihood" ||
    track === "technical vocational livelihod" ||
    track === "tvl"
  ) {
    return "Tech Professional";
  }
  return "";
}

function getRowTrack(row: Row): "Academic" | "Tech Professional" | "" {
  const details =
    row.student_details &&
      typeof row.student_details === "object" &&
      !Array.isArray(row.student_details)
      ? (row.student_details as Row)
      : {};
  const candidates = [
    row.selected_track,
    row.track,
    row.program,
    row.track_name,
    details.selected_track,
    details.track,
    details.program,
  ];
  for (const c of candidates) {
    const normalized = normalizeTrack(c);
    if (normalized) return normalized;
  }
  const cluster = getRowCluster(row).toLowerCase();
  if (/tvl|techpro|technical|vocational|ict|home economics|industrial|agri|afa|he|ia/.test(cluster)) {
    return "Tech Professional";
  }
  if (/academic|stem|abm|humss|gas/.test(cluster)) return "Academic";
  return "";
}

function getSelectedTrack(row: Row): string {
  const details =
    row.student_details &&
      typeof row.student_details === "object" &&
      !Array.isArray(row.student_details)
      ? (row.student_details as Row)
      : {};

  const raw = [
    row.selected_track,
    details.selected_track,
    row.track,
    details.track,
  ].find((value) => typeof value === "string" && value.trim());

  const text = String(raw ?? "").trim();
  if (!text) return "Not provided";

  const label = getTrackLabel(text);
  return label === "Senior High Track" ? text : label;
}

function formatClusterName(value: string): string {
  if (!value) return "Not provided";
  const normalized = value.toLowerCase().trim();
  if (normalized === "academic") return "Academic Track";
  if (normalized === "techpro" || normalized === "tvl") {
    return "Technical-Vocational-Livelihood";
  }
  return value;
}

type RosterTone = "male" | "female" | "neutral";

const ROSTER_TONES: Record<
  RosterTone,
  { header: string; badge: string; bullet: string }
> = {
  male: {
    header: "text-sky-700 print:text-emerald-950",
    badge:
      "bg-sky-50 text-sky-700 ring-1 ring-sky-200 print:bg-gray-100 print:text-emerald-950 print:ring-gray-400",
    bullet: "text-sky-400 print:text-gray-500",
  },
  female: {
    header: "text-pink-700 print:text-emerald-950",
    badge:
      "bg-pink-50 text-pink-700 ring-1 ring-pink-200 print:bg-gray-100 print:text-emerald-950 print:ring-gray-400",
    bullet: "text-pink-400 print:text-gray-500",
  },
  neutral: {
    header: "text-gray-600 print:text-emerald-950",
    badge:
      "bg-gray-100 text-gray-600 ring-1 ring-gray-200 print:bg-gray-100 print:text-emerald-950 print:ring-gray-400",
    bullet: "text-gray-400 print:text-gray-500",
  },
};

function GenderRosterColumn({
  label,
  students,
  tone,
  className = "",
}: {
  label: string;
  students: GenderStudent[];
  tone: RosterTone;
  className?: string;
}) {
  const styles = ROSTER_TONES[tone];

  return (
    <div className={`px-5 py-4 ${className}`}>
      <div className="flex items-center justify-between">
        <h4
          className={`text-xs font-extrabold uppercase tracking-[0.14em] ${styles.header}`}
        >
          {label}
        </h4>
        <span
          className={`inline-flex min-w-7 items-center justify-center rounded-full px-2 py-0.5 text-[11px] font-bold ${styles.badge}`}
        >
          {students.length}
        </span>
      </div>

      {students.length > 0 ? (
        <ol className="mt-3 space-y-1.5">
          {students.map((student, index) => (
            <li
              key={student.id || `${label}-${index}`}
              className="flex gap-2 text-sm text-emerald-950 print:text-xs"
            >
              <span
                className={`w-5 shrink-0 text-right text-[11px] font-semibold ${styles.bullet}`}
              >
                {index + 1}.
              </span>
              <span className="font-medium leading-snug">{student.name}</span>
            </li>
          ))}
        </ol>
      ) : (
        <p className="mt-3 text-xs italic text-emerald-700 print:text-gray-500">
          No {label.toLowerCase()} students
        </p>
      )}
    </div>
  );
}

const ISO_DATE_PATTERN =
  /^\d{4}-\d{2}-\d{2}(?:[T ]\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?(?:Z|[+-]\d{2}:?\d{2})?)?$/;

function csvCell(value: unknown) {
  const text =
    value == null
      ? ""
      : typeof value === "object"
        ? JSON.stringify(value)
        : String(value);

  // Prefix date-like values with a tab so Excel keeps them as text instead of
  // auto-formatting them as dates (which renders as "####" in narrow columns).
  const guarded = ISO_DATE_PATTERN.test(text) ? `\t${text}` : text;

  return `"${guarded.replaceAll('"', '""')}"`;
}

function formatDate(value: unknown): string {
  if (!value) return "—";
  const date = new Date(String(value));
  if (Number.isNaN(date.getTime())) return "—";
  return date.toLocaleDateString("en-PH", {
    year: "numeric",
    month: "short",
    day: "numeric",
    timeZone: "Asia/Manila",
  });
}

type DonutSegment = { label: string; value: number; color: string };

function DonutChart({
  segments,
  size = 144,
  thickness = 30,
  label = "Distribution chart",
}: {
  segments: DonutSegment[];
  size?: number;
  thickness?: number;
  label?: string;
}) {
  const total = segments.reduce((sum, segment) => sum + segment.value, 0);
  const radius = (size - thickness) / 2;
  const circumference = 2 * Math.PI * radius;
  let offset = 0;

  return (
    <svg
      width={size}
      height={size}
      viewBox={`0 0 ${size} ${size}`}
      className="shrink-0"
      role="img"
      aria-label={label}
    >
      <g transform={`rotate(-90 ${size / 2} ${size / 2})`}>
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          fill="none"
          stroke="#d1fae5"
          strokeWidth={thickness}
        />
        {total > 0 &&
          segments.map((segment) => {
            const length = (segment.value / total) * circumference;
            const circle = (
              <circle
                key={segment.label}
                cx={size / 2}
                cy={size / 2}
                r={radius}
                fill="none"
                stroke={segment.color}
                strokeWidth={thickness}
                strokeDasharray={`${length} ${circumference - length}`}
                strokeDashoffset={-offset}
              />
            );
            offset += length;
            return circle;
          })}
      </g>
    </svg>
  );
}

export default function ReportsPage() {
  const [rows, setRows] = useState<Row[]>([]);
  const [sections, setSections] = useState<SectionRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [status, setStatus] = useState("all");
  const [summaryStatus, setSummaryStatus] = useState<"enrolled" | "pending">(
    "enrolled"
  );
  const [track, setTrack] = useState("all");
  const [cluster, setCluster] = useState("all");
  const [reportView, setReportView] = useState<ReportView>("summary");
  const [printSectionId, setPrintSectionId] = useState<string | null>(null);
  const printTimestampRef = useRef<HTMLSpanElement>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError("");

    try {
      const [appsRes, sectionsRes] = await Promise.all([
        supabase
          .from("student_applications")
          .select("*")
          .order("submitted_at", { ascending: false })
          .limit(5000),
        supabase.from("sections").select("*").order("name"),
      ]);

      if (appsRes.error) {
        setError(appsRes.error.message);
      } else {
        setRows(
          filterVisibleApplications((appsRes.data ?? []) as Row[])
        );
      }

      setSections(
        resolveSectionList(
          !sectionsRes.error
            ? ((sectionsRes.data ?? []) as SectionRecord[])
            : null
        )
      );
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Error generating reports");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    const run = async () => { try { await load(); } catch (e) { console.error(e); } }; run();
  }, [load]);

  useEffect(() => {
    const updateTimestamp = () => {
      if (printTimestampRef.current) {
        printTimestampRef.current.textContent = new Date().toLocaleString();
      }
    };
    window.addEventListener("beforeprint", updateTimestamp);
    return () => window.removeEventListener("beforeprint", updateTimestamp);
  }, []);

  useEffect(() => {
    if (!printSectionId) return;

    const reset = () => setPrintSectionId(null);
    window.addEventListener("afterprint", reset);
    const timer = window.setTimeout(() => window.print(), 60);

    return () => {
      window.clearTimeout(timer);
      window.removeEventListener("afterprint", reset);
    };
  }, [printSectionId]);

  const statusFilter = reportView === "summary" ? summaryStatus : status;

  const clusterOptions = useMemo(
    () =>
      track === "all"
        ? TRACKS.flatMap((trackConfig) => trackConfig.clusters)
        : getClustersForTrack(track),
    [track]
  );

  const filtered = useMemo(() => {
    const targetCluster = cluster.trim().toLowerCase();

    return rows.filter((r) => {
      const rowStatus = normalizeEnrollmentStatus(r.status);
      const statusMatches = statusFilter === "all" || rowStatus === statusFilter;

      const trackString = `${r.track ?? ""} ${r.selected_track ?? ""} ${getRowCluster(
        r
      )}`.toLowerCase();

      let trackMatches = true;
      if (track === "academic") {
        trackMatches =
          /academic|stem|abm|humss|gas/i.test(trackString) ||
          (!/tvl|techpro|technical|vocational/i.test(trackString) &&
            trackString.length > 0);
      } else if (track === "techpro") {
        trackMatches = /tvl|techpro|technical|vocational|ict|home economics|industrial/i.test(
          trackString
        );
      }

      const clusterMatches =
        cluster === "all" ||
        getRowCluster(r).trim().toLowerCase() === targetCluster;

      return statusMatches && trackMatches && clusterMatches;
    });
  }, [rows, statusFilter, track, cluster]);

  // The enrollment summary respects the selected status filter
  // (Enrolled or Pending); `filtered` already applies that filter.
  const summaryRows = filtered;

  const genderGroups = useMemo<SectionGenderGroup[]>(() => {
    const sectionsById = new Map<string, SectionRecord>();
    sections.forEach((section) =>
      sectionsById.set(String(section.id), section)
    );

    const groups = new Map<string, SectionGenderGroup>();

    const ensureGroup = (id: string): SectionGenderGroup => {
      const existing = groups.get(id);
      if (existing) return existing;

      const section = sectionsById.get(id);
      const group: SectionGenderGroup = {
        id,
        name: section?.name ?? "Unassigned / Unknown Section",
        adviser: section?.adviser_name ?? "",
        gradeLevel: section?.grade_level ?? "",
        strand: section?.strand ?? section?.cluster ?? "",
        male: 0,
        female: 0,
        unspecified: 0,
        total: 0,
        students: [],
      };
      groups.set(id, group);
      return group;
    };

    filtered.forEach((row) => {
      const sectionId = String(row.assigned_section_id ?? "").trim();
      const group = ensureGroup(sectionId || "__unassigned__");
      const gender = getRowGender(row);

      if (gender === "Male") group.male += 1;
      else if (gender === "Female") group.female += 1;
      else group.unspecified += 1;

      group.total += 1;
      group.students.push({
        id: String(row.id ?? ""),
        name: getStudentName(row),
        gender,
        status: normalizeEnrollmentStatus(row.status),
      });
    });

    groups.forEach((group) => {
      group.students.sort(
        (a, b) =>
          GENDER_ORDER[a.gender] - GENDER_ORDER[b.gender] ||
          a.name.localeCompare(b.name)
      );
    });

    return Array.from(groups.values()).sort((a, b) => {
      if (a.id === "__unassigned__") return 1;
      if (b.id === "__unassigned__") return -1;
      return a.name.localeCompare(b.name);
    });
  }, [filtered, sections]);

  const genderTotals = useMemo(() => {
    return genderGroups.reduce(
      (acc, group) => {
        if (group.id !== "__unassigned__") acc.sections += 1;
        acc.male += group.male;
        acc.female += group.female;
        acc.unspecified += group.unspecified;
        acc.total += group.total;
        return acc;
      },
      { sections: 0, male: 0, female: 0, unspecified: 0, total: 0 }
    );
  }, [genderGroups]);

  const analytics = useMemo(() => {
    const total = filtered.length;
    const byStatus = { pending: 0, enrolled: 0, denied: 0 };
    const clusterCounts: Record<string, number> = {};
    const genderCounts = { Male: 0, Female: 0, Unspecified: 0 };
    const trackCounts = { Academic: 0, "Tech Professional": 0 };

    filtered.forEach((row) => {
      const s = normalizeEnrollmentStatus(row.status) as keyof typeof byStatus;
      if (s in byStatus) byStatus[s] += 1;

      const cluster = formatClusterName(getRowCluster(row));
      if (cluster && cluster !== "Not provided") {
        clusterCounts[cluster] = (clusterCounts[cluster] ?? 0) + 1;
      }

      const g = getRowGender(row);
      genderCounts[g] += 1;

      const t = getRowTrack(row);
      if (t) trackCounts[t] += 1;
    });

    const clusters = Object.entries(clusterCounts).sort((a, b) => b[1] - a[1]);
    const maxCluster = Math.max(1, ...clusters.map(([, v]) => v));
    const trackTotal = trackCounts.Academic + trackCounts["Tech Professional"];
    const genderTotal = genderCounts.Male + genderCounts.Female + genderCounts.Unspecified;

    const pct = (n: number, d: number) => (d > 0 ? (n / d) * 100 : 0);

    const malePct = pct(genderCounts.Male, genderTotal);
    const acadPct = pct(trackCounts.Academic, trackTotal);

    const statusReport =
      total === 0
        ? "No applications recorded for the selected filters. Promote the enrollment schedule and monitor incoming submissions to plan staffing and sectioning early."
        : byStatus.pending >= Math.max(byStatus.enrolled, byStatus.denied)
          ? `Prioritize review: ${byStatus.pending} pending application${byStatus.pending === 1 ? "" : "s"} (${pct(byStatus.pending, total).toFixed(1)}%) need action. Assign reviewers and set daily targets to reduce backlog and speed up enrollment decisions.`
          : byStatus.denied > byStatus.enrolled
            ? `Review quality signals: ${byStatus.denied} denied application${byStatus.denied === 1 ? "" : "s"} (${pct(byStatus.denied, total).toFixed(1)}%). Audit common denial reasons and improve applicant guidance/requirements communication.`
            : `Enrollment flow is healthy with ${byStatus.enrolled} enrolled (${pct(byStatus.enrolled, total).toFixed(1)}%). Continue timely processing of remaining ${byStatus.pending} pending item${byStatus.pending === 1 ? "" : "s"} to sustain completion rates.`;

    const clusterReport =
      clusters.length === 0
        ? "No cluster values found for the selected filters. Ensure cluster/track fields are captured to guide section and resource planning."
        : (() => {
          const [topName, topValue] = clusters[0];
          return `Highest demand: ${topName} with ${topValue} applicant${topValue === 1 ? "" : "s"} (${pct(topValue, total).toFixed(1)}% of total). Plan sections, teachers, and rooms proportionally and monitor lower-demand clusters for consolidation or targeted orientation.`;
        })();

    const genderReport =
      genderTotal === 0
        ? "No gender values found for the selected filters. Capture sex/gender data to support balanced planning and support services."
        : (() => {
          const gap = Math.abs(malePct - pct(genderCounts.Female, genderTotal));
          if (gap <= 10) return `Gender distribution is relatively balanced (gap ${gap.toFixed(1)}%). Maintain equitable support services, facilities planning, and class assignments.`;
          const dominant = [
            { label: "Male", value: genderCounts.Male, pct: malePct },
            { label: "Female", value: genderCounts.Female, pct: pct(genderCounts.Female, genderTotal) },
            { label: "Unspecified", value: genderCounts.Unspecified, pct: pct(genderCounts.Unspecified, genderTotal) },
          ].sort((a, b) => b.value - a.value)[0];
          return `${dominant.label} applicants are higher at ${dominant.pct.toFixed(1)}%. Ensure balanced class composition, inclusive activities, and targeted outreach where participation is lower.`;
        })();

    const trackReport =
      trackTotal === 0
        ? "No recognized track values found for the selected filters. Capture Academic/Tech Professional track data for capacity planning."
        : (() => {
          const techPct = pct(trackCounts["Tech Professional"], trackTotal);
          const gap = Math.abs(acadPct - techPct);
          if (gap <= 10) return `Track demand is balanced (gap ${gap.toFixed(1)}%). Allocate sections and resources fairly across both tracks and monitor shifts.`;
          const preferred = trackCounts.Academic >= trackCounts["Tech Professional"]
            ? { label: "Academic", value: trackCounts.Academic, pct: acadPct }
            : { label: "Tech Professional", value: trackCounts["Tech Professional"], pct: techPct };
          return `${preferred.label} track has higher demand (${preferred.value}, ${preferred.pct.toFixed(1)}%). Prepare additional sections/resources for this track while maintaining capacity and guidance for the other.`;
        })();

    return {
      total,
      byStatus,
      clusters,
      maxCluster,
      genderCounts,
      genderTotal,
      trackCounts,
      trackTotal,
      pct,
      reports: { status: statusReport, cluster: clusterReport, gender: genderReport, track: trackReport },
    };
  }, [filtered]);

  function exportAnalyticsCsv() {
    if (!filtered.length && analytics.total === 0) return;
    const date = new Date().toISOString().slice(0, 10);
    const clusterSlug =
      cluster === "all"
        ? ""
        : `-${cluster
          .replace(/[^a-z0-9]+/gi, "-")
          .replace(/^-|-$/g, "")
          .toLowerCase()}`;
    const filterLabel =
      status === "all" && track === "all" && cluster === "all"
        ? "all-records"
        : `${status}-${track}${clusterSlug}`;
    const lines: string[] = [];
    const push = (cells: unknown[]) => lines.push(cells.map(csvCell).join(","));

    push(["AASMNHS DASHBOARD ANALYTICS EXPORT"]);
    push(["Generated", new Date().toLocaleString()]);
    push(["Status filter", status]);
    push(["Track filter", track]);
    push(["Cluster filter", cluster]);
    push([]);

    push(["SUMMARY METRICS"]);
    push(["Metric", "Value", "Percent of total"]);
    push(["Total Applications", analytics.total, "100.0%"]);
    push(["Pending", analytics.byStatus.pending, `${analytics.pct(analytics.byStatus.pending, Math.max(analytics.total, 1)).toFixed(1)}%`]);
    push(["Enrolled", analytics.byStatus.enrolled, `${analytics.pct(analytics.byStatus.enrolled, Math.max(analytics.total, 1)).toFixed(1)}%`]);
    push(["Denied", analytics.byStatus.denied, `${analytics.pct(analytics.byStatus.denied, Math.max(analytics.total, 1)).toFixed(1)}%`]);
    push([]);

    push(["PRESCRIPTIVE ANALYTICS - APPLICATION STATUS"]);
    push([analytics.reports.status]);
    push([]);

    push(["APPLICATIONS BY CLUSTER"]);
    push(["Cluster", "Applicants", "Percent of total"]);
    analytics.clusters.forEach(([name, value]) => push([name, value, `${analytics.pct(value, Math.max(analytics.total, 1)).toFixed(1)}%`]));
    if (!analytics.clusters.length) push(["No cluster data", 0, "0.0%"]);
    push([]);
    push(["PRESCRIPTIVE ANALYTICS - CLUSTER"]);
    push([analytics.reports.cluster]);
    push([]);

    push(["GENDER DISTRIBUTION"]);
    push(["Gender", "Count", "Percent of known gender"]);
    (Object.entries(analytics.genderCounts) as [string, number][]).forEach(([label, value]) =>
      push([label, value, `${analytics.pct(value, Math.max(analytics.genderTotal, 1)).toFixed(1)}%`])
    );
    push(["Total (with gender data)", analytics.genderTotal, "100.0%"]);
    push([]);
    push(["PRESCRIPTIVE ANALYTICS - GENDER"]);
    push([analytics.reports.gender]);
    push([]);

    push(["TRACK DISTRIBUTION"]);
    push(["Track", "Count", "Percent of known track"]);
    (Object.entries(analytics.trackCounts) as [string, number][]).forEach(([label, value]) =>
      push([label, value, `${analytics.pct(value, Math.max(analytics.trackTotal, 1)).toFixed(1)}%`])
    );
    push(["Total (with track data)", analytics.trackTotal, "100.0%"]);
    push([]);
    push(["PRESCRIPTIVE ANALYTICS - TRACK"]);
    push([analytics.reports.track]);

    downloadCsv(`AASMNHS-dashboard-analytics-${filterLabel}-${date}.csv`, lines.join("\r\n"));
  }

  function downloadCsv(filename: string, content: string) {
    const blob = new Blob(["\uFEFF" + content], {
      type: "text/csv;charset=utf-8;",
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(url);
  }

  function exportGenderCsv() {
    if (!genderGroups.length) return;

    const sectionLabel = (group: SectionGenderGroup) =>
      group.id === "__unassigned__"
        ? "Unassigned / Unknown Section"
        : group.name;

    const lines: string[] = [];

    lines.push([csvCell("GENDER DISTRIBUTION BY SECTION")].join(","));
    lines.push("");

    lines.push(
      [
        "Section",
        "Adviser",
        "Grade Level",
        "Cluster",
        "Male",
        "Female",
        "Unspecified",
        "Total",
      ]
        .map(csvCell)
        .join(",")
    );

    genderGroups.forEach((group) => {
      lines.push(
        [
          sectionLabel(group),
          group.adviser,
          group.gradeLevel,
          group.strand,
          group.male,
          group.female,
          group.unspecified,
          group.total,
        ]
          .map(csvCell)
          .join(",")
      );
    });

    lines.push(
      [
        "TOTAL",
        "",
        "",
        "",
        genderTotals.male,
        genderTotals.female,
        genderTotals.unspecified,
        genderTotals.total,
      ]
        .map(csvCell)
        .join(",")
    );

    lines.push("");
    lines.push([csvCell("STUDENT LIST BY SECTION AND GENDER")].join(","));
    lines.push("");

    lines.push(
      ["Section", "Adviser", "Gender", "No.", "Student Name", "Status"]
        .map(csvCell)
        .join(",")
    );

    const categories: Gender[] = ["Male", "Female", "Unspecified"];

    genderGroups.forEach((group) => {
      categories.forEach((gender) => {
        group.students
          .filter((student) => student.gender === gender)
          .forEach((student, index) => {
            lines.push(
              [
                sectionLabel(group),
                group.adviser,
                gender,
                index + 1,
                student.name,
                getEnrollmentStatusLabel(student.status),
              ]
                .map(csvCell)
                .join(",")
            );
          });
      });
    });

    const date = new Date().toISOString().slice(0, 10);
    const clusterSlug =
      cluster === "all"
        ? ""
        : `-${cluster
          .replace(/[^a-z0-9]+/gi, "-")
          .replace(/^-|-$/g, "")
          .toLowerCase()}`;
    const filterLabel =
      status === "all" && track === "all" && cluster === "all"
        ? "all-records"
        : `${status}-${track}${clusterSlug}`;

    downloadCsv(
      `AASMNHS-gender-by-section-${filterLabel}-${date}.csv`,
      lines.join("\r\n")
    );
  }

  function exportSectionCsv(group: SectionGenderGroup) {
    const sectionLabel =
      group.id === "__unassigned__"
        ? "Unassigned / Unknown Section"
        : group.name;

    const categories: Gender[] = ["Male", "Female", "Unspecified"];
    const lines: string[] = [];

    lines.push(
      [csvCell("ANSELMO A. SANDOVAL MEMORIAL NATIONAL HIGH SCHOOL")].join(",")
    );
    lines.push([csvCell("Class List by Section and Gender")].join(","));
    lines.push("");
    lines.push([csvCell("Section"), csvCell(sectionLabel)].join(","));
    lines.push(
      [csvCell("Adviser"), csvCell(group.adviser || "Not assigned")].join(",")
    );
    lines.push(
      [csvCell("Grade Level"), csvCell(group.gradeLevel || "—")].join(",")
    );
    lines.push([csvCell("Cluster"), csvCell(group.strand || "—")].join(","));
    lines.push([csvCell("Generated"), csvCell(new Date().toLocaleString())].join(","));
    lines.push("");

    categories.forEach((gender) => {
      const students = group.students.filter(
        (student) => student.gender === gender
      );

      if (gender === "Unspecified" && students.length === 0) return;

      lines.push([csvCell(gender.toUpperCase())].join(","));
      lines.push(
        [csvCell("No."), csvCell("Student Name"), csvCell("Status")].join(",")
      );

      if (students.length > 0) {
        students.forEach((student, index) => {
          lines.push(
            [
              csvCell(index + 1),
              csvCell(student.name),
              csvCell(getEnrollmentStatusLabel(student.status)),
            ].join(",")
          );
        });
      } else {
        lines.push(
          [
            csvCell(""),
            csvCell(`No ${gender.toLowerCase()} students`),
            csvCell(""),
          ].join(",")
        );
      }

      lines.push("");
    });

    lines.push([csvCell("SUMMARY")].join(","));
    lines.push(
      [csvCell("Male"), csvCell("Female"), csvCell("Unspecified"), csvCell("Total")]
        .map(csvCell)
        .join(",")
    );
    lines.push(
      [group.male, group.female, group.unspecified, group.total]
        .map(csvCell)
        .join(",")
    );

    const slug =
      sectionLabel
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/^-+|-+$/g, "") || "section";
    const date = new Date().toISOString().slice(0, 10);

    downloadCsv(
      `AASMNHS-${slug}-class-list-${date}.csv`,
      lines.join("\r\n")
    );
  }

  function exportCsv() {
    if (reportView === "analytics") {
      exportAnalyticsCsv();
      return;
    }
    if (reportView === "gender") {
      exportGenderCsv();
      return;
    }

    if (!summaryRows.length) return;

    // Prioritized columns for clean spreadsheet export
    const primaryCols = [
      "id",
      "first_name",
      "middle_name",
      "last_name",
      "email",
      "contact_number",
      "track",
      "selected_cluster",
      "status",
      "submitted_at",
      "birth_date",
      "sex",
      "address",
    ];

    const hiddenExportColumns = new Set([
      "lrn",
      "learner_reference_number",
      "grade_level",
      "strand",
      "selected_strand",
      "preferred_strand_id",
      "student_details",
      "requirements_documents",
    ]);

    const exportRows: Row[] = summaryRows.map((r) => ({
      ...r,
      status: normalizeEnrollmentStatus(r.status),
    }));
    const allKeys = Array.from(
      new Set(exportRows.flatMap((r) => Object.keys(r)))
    );
    const otherKeys = allKeys.filter(
      (k) => !primaryCols.includes(k) && !hiddenExportColumns.has(k)
    );
    const finalCols = [
      ...primaryCols.filter((k) => allKeys.includes(k)),
      ...otherKeys,
    ];

    const content = [
      finalCols.map(csvCell).join(","),
      ...exportRows.map((r) =>
        finalCols.map((k) => csvCell(r[k])).join(",")
      ),
    ].join("\r\n");

    downloadCsv(
      `AASMNHS-enrollment-report-${new Date()
        .toISOString()
        .slice(0, 10)}.csv`,
      content
    );
  }

  const printTitle =
    reportView === "gender"
      ? "Gender Distribution by Assigned Section Report"
      : reportView === "analytics"
        ? "Dashboard Analytics Report"
        : "Official Senior High School Enrollment Summary Report";

  const activePrintGroup = printSectionId
    ? genderGroups.find((group) => group.id === printSectionId) ?? null
    : null;

  const activePrintSectionLabel = activePrintGroup
    ? activePrintGroup.id === "__unassigned__"
      ? "Unassigned / Unknown Section"
      : activePrintGroup.name
    : "";

  const exportDisabled =
    loading ||
    (reportView === "gender"
      ? genderGroups.length === 0
      : reportView === "analytics"
        ? false
        : summaryRows.length === 0);

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between print:hidden">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.18em] text-emerald-700">
            Registrar Workspace
          </p>
          <h1 className="mt-2 text-3xl font-extrabold">Generate Reports</h1>
          <p className="mt-2 text-sm text-emerald-900">
            Filter, summarize, print, or export official enrollment records.
          </p>
        </div>
        <button
          onClick={load}
          className="inline-flex items-center justify-center gap-2 rounded-lg border border-emerald-200 px-4 py-2.5 text-xs font-semibold hover:bg-emerald-50"
        >
          <RefreshCw size={14} className={loading ? "animate-spin" : ""} />
          Refresh
        </button>
      </div>

      {/* Official Header for Print */}
      <div className="hidden print:block text-center border-b pb-4 mb-6 text-emerald-950">
        <h2 className="text-xl font-bold tracking-wide">
          ANSELMO A. SANDOVAL MEMORIAL NATIONAL HIGH SCHOOL
        </h2>
        <p className="text-xs text-gray-600">
          Mabini, Batangas · DepEd Region IV-A CALABARZON
        </p>
        <p className="mt-2 text-sm font-semibold uppercase tracking-wider">
          {activePrintGroup
            ? `Class List — ${activePrintSectionLabel}`
            : printTitle}
        </p>
        {activePrintGroup && (
          <p className="text-xs font-semibold text-emerald-950">
            Adviser: {activePrintGroup.adviser || "Not assigned"}
          </p>
        )}
        <p className="text-[11px] text-gray-500">
          Generated: <span ref={printTimestampRef} suppressHydrationWarning />
        </p>
      </div>

      {/* Report View Tabs */}
      <div className="inline-flex flex-wrap rounded-lg border border-emerald-200 bg-white p-1 text-xs print:hidden">
        <button
          onClick={() => setReportView("summary")}
          className={`inline-flex items-center gap-1.5 rounded-md px-4 py-2 font-semibold transition ${reportView === "summary"
              ? "bg-yellow-300 text-emerald-950"
              : "text-emerald-900 hover:text-emerald-950"
            }`}
        >
          <FileSpreadsheet size={14} />
          Enrollment Summary
        </button>
        <button
          onClick={() => setReportView("gender")}
          className={`inline-flex items-center gap-1.5 rounded-md px-4 py-2 font-semibold transition ${reportView === "gender"
              ? "bg-yellow-300 text-emerald-950"
              : "text-emerald-900 hover:text-emerald-950"
            }`}
        >
          <Users size={14} />
          Gender by Section
        </button>
        <button
          onClick={() => setReportView("analytics")}
          className={`inline-flex items-center gap-1.5 rounded-md px-4 py-2 font-semibold transition ${reportView === "analytics"
              ? "bg-yellow-300 text-emerald-950"
              : "text-emerald-900 hover:text-emerald-950"
            }`}
        >
          <BarChart3 size={14} />
          Dashboard Analytics
        </button>
      </div>

      {error && (
        <p className="flex gap-2 rounded-lg border border-red-200 bg-red-400/10 p-3 text-sm text-red-700 print:hidden">
          <AlertCircle size={18} className="shrink-0" />
          <span>{error}</span>
        </p>
      )}

      {/* Summary KPI Cards */}
      {reportView === "summary" && (
        <div
          className={`grid gap-4 sm:grid-cols-4 print:grid-cols-4 ${printSectionId ? "print:hidden" : ""
            }`}
        >
          {[
            {
              label:
                summaryStatus === "pending"
                  ? "Pending students"
                  : "Enrolled students",
              value: summaryRows.length,
            },
            {
              label: "Academic",
              value: summaryRows.filter((r) => getRowTrack(r) === "Academic")
                .length,
            },
            {
              label: "Tech Professional",
              value: summaryRows.filter(
                (r) => getRowTrack(r) === "Tech Professional"
              ).length,
            },
            {
              label: "Assigned to section",
              value: summaryRows.filter((r) =>
                String(r.assigned_section_id ?? "").trim()
              ).length,
            },
          ].map((k) => (
            <div
              key={k.label}
              className="rounded-2xl border border-emerald-200 bg-emerald-50 p-5 shadow-lg shadow-black/10 print:border-gray-300 print:bg-white print:text-emerald-950"
            >
              <p className="text-sm text-emerald-900 print:text-gray-600">{k.label}</p>
              <p className="mt-3 text-3xl font-bold text-emerald-700 print:text-emerald-950">
                {loading ? "…" : k.value.toLocaleString()}
              </p>
            </div>
          ))}
        </div>
      )}
      {reportView === "gender" && (
        <div
          className={`grid gap-4 sm:grid-cols-4 print:grid-cols-4 ${printSectionId ? "print:hidden" : ""
            }`}
        >
          {[
            { label: "Sections Assigned", value: genderTotals.sections },
            { label: "Male", value: genderTotals.male },
            { label: "Female", value: genderTotals.female },
            { label: "Total Students", value: genderTotals.total },
          ].map((k) => (
            <div
              key={k.label}
              className="rounded-2xl border border-emerald-200 bg-emerald-50 p-5 shadow-lg shadow-black/10 print:border-gray-300 print:bg-white print:text-emerald-950"
            >
              <p className="text-sm text-emerald-900 print:text-gray-600">{k.label}</p>
              <p className="mt-3 text-3xl font-bold text-emerald-700 print:text-emerald-950">
                {loading ? "…" : k.value.toLocaleString()}
              </p>
            </div>
          ))}
        </div>
      )}
      {reportView === "analytics" && (
        <div
          className={`mx-auto grid w-full max-w-5xl gap-4 text-center sm:grid-cols-4 print:grid-cols-4 ${printSectionId ? "print:hidden" : ""
            }`}
        >
          {[
            { label: "Records in report", value: analytics.total },
            { label: "Pending", value: analytics.byStatus.pending },
            { label: "Enrolled", value: analytics.byStatus.enrolled },
            { label: "Denied", value: analytics.byStatus.denied },
          ].map((k) => (
            <div
              key={k.label}
              className="rounded-2xl border border-emerald-200 bg-emerald-50 p-5 shadow-lg shadow-black/10 print:border-gray-300 print:bg-white print:text-emerald-950"
            >
              <p className="text-sm text-emerald-900 print:text-gray-600">{k.label}</p>
              <p className="mt-3 text-3xl font-bold text-emerald-700 print:text-emerald-950">
                {loading ? "…" : k.value.toLocaleString()}
              </p>
            </div>
          ))}
        </div>
      )}

      {/* Filters & Export Options */}
      <section className="rounded-2xl border border-emerald-200 bg-emerald-50 p-5 print:hidden">
        <div className="flex items-center gap-3">
          <div className="rounded-lg bg-amber-50 p-3">
            <FileSpreadsheet className="text-emerald-700" />
          </div>
          <div>
            <h2 className="font-bold">Report Filters</h2>
            <p className="mt-1 text-xs text-emerald-800">
              {reportView === "gender"
                ? "Gender distribution is grouped by each student's assigned section. Use the filters to narrow the report."
                : reportView === "analytics"
                  ? "Analytics are computed from current filters. Export includes charts summary and prescriptive insights."
                  : "Enrollment summary includes Enrolled or Pending students. Choose a status, track category, and cluster before exporting."}
            </p>
          </div>
        </div>

        <div className="mt-5 grid gap-3 md:grid-cols-2 xl:grid-cols-4">
          {reportView === "summary" ? (
            <label className="text-xs text-emerald-900">
              Enrollment status
              <select
                value={summaryStatus}
                onChange={(e) =>
                  setSummaryStatus(e.target.value as "enrolled" | "pending")
                }
                className="mt-2 block w-full rounded-lg border border-emerald-200 bg-white px-3 py-3 text-sm text-emerald-700 outline-none focus:border-emerald-200"
              >
                <option value="enrolled">Enrolled</option>
                <option value="pending">Pending</option>
              </select>
            </label>
          ) : (
            <label className="text-xs text-emerald-900">
              Enrollment status
              <select
                value={status}
                onChange={(e) => setStatus(e.target.value)}
                className="mt-2 block w-full rounded-lg border border-emerald-200 bg-white px-3 py-3 text-sm text-emerald-700 outline-none focus:border-emerald-200"
              >
                <option value="all">All status</option>
                <option value="pending">Pending</option>
                <option value="enrolled">Enrolled</option>
                <option value="denied">Denied</option>
              </select>
            </label>
          )}

          <label className="text-xs text-emerald-900">
            Track category
            <select
              value={track}
              onChange={(e) => {
                setTrack(e.target.value);
                setCluster("all");
              }}
              className="mt-2 block w-full rounded-lg border border-emerald-200 bg-white px-3 py-3 text-sm text-emerald-700 outline-none focus:border-emerald-200"
            >
              <option value="all">All tracks</option>
              <option value="academic">Academic</option>
              <option value="techpro">TechPro</option>
            </select>
          </label>

          <label className="text-xs text-emerald-900">
            Cluster
            <select
              value={cluster}
              onChange={(e) => setCluster(e.target.value)}
              className="mt-2 block w-full rounded-lg border border-emerald-200 bg-white px-3 py-3 text-sm text-emerald-700 outline-none focus:border-emerald-200"
            >
              <option value="all">All clusters</option>
              {clusterOptions.map((option) => (
                <option key={option} value={option}>
                  {option}
                </option>
              ))}
            </select>
          </label>

          <div className="flex items-end gap-2">
            <button
              onClick={load}
              className="inline-flex flex-1 items-center justify-center gap-2 rounded-lg border border-emerald-200 px-3 py-3 text-xs font-semibold hover:bg-emerald-50"
            >
              <RefreshCw size={14} className={loading ? "animate-spin" : ""} />
              Refresh
            </button>
            <button
              onClick={exportCsv}
              disabled={exportDisabled}
              className="inline-flex flex-1 items-center justify-center gap-2 rounded-lg bg-yellow-300 px-3 py-3 text-xs font-bold text-emerald-950 hover:bg-yellow-300 disabled:opacity-50"
            >
              <Download size={14} />
              {reportView === "gender"
                ? "Export Gender CSV"
                : reportView === "analytics"
                  ? "Export Analytics CSV"
                  : "Export CSV"}
            </button>
          </div>
        </div>

        <div className="mt-4 flex flex-wrap items-center justify-between gap-3 border-t border-emerald-200 pt-4">
          <p className="text-xs text-emerald-800">
            {reportView === "gender"
              ? "CSV lists each section with its adviser and students grouped Male • Female • Unspecified. PDF opens the print dialog (choose Save as PDF)."
              : reportView === "analytics"
                ? "CSV exports dashboard analytics (status, cluster, gender, track) and prescriptive insights. PDF prints this analytics report."
                : "Exports the selected status (Enrolled or Pending) with full student details including submitted credentials. PDF opens the print dialog (choose Save as PDF)."}
          </p>
          <button
            onClick={() => window.print()}
            className="inline-flex items-center gap-2 rounded-lg border border-emerald-200 px-3 py-2 text-xs hover:bg-emerald-50"
          >
            <Printer size={14} />
            Export PDF
          </button>
        </div>
      </section>

      {/* Preview */}
      {reportView === "summary" ? (
        <section className="overflow-hidden rounded-2xl border border-emerald-200 bg-emerald-50 print:border-gray-300 print:bg-white print:text-emerald-950">
          <div className="flex flex-col gap-2 border-b border-emerald-200 px-5 py-4 print:border-gray-300 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <h2 className="font-semibold">Report Preview</h2>
              <p className="mt-1 text-xs text-emerald-800 print:text-gray-500">
                Showing {summaryStatus} students for the selected track and cluster.
              </p>
            </div>
            <span className="text-xs text-emerald-700 font-mono print:text-emerald-950">
              {summaryRows.length} {summaryStatus} student
              {summaryRows.length === 1 ? "" : "s"}
            </span>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full table-fixed text-left text-sm print:text-xs">
              <colgroup>
                <col className="w-[26%]" />
                <col className="w-[30%]" />
                <col className="w-[12%]" />
                <col className="w-[20%]" />
                <col className="w-[12%]" />
              </colgroup>
              <thead className="bg-emerald-50 text-[10px] uppercase tracking-wider text-emerald-900 print:bg-gray-100 print:text-gray-700">
                <tr>
                  <th className="px-3 py-3">Student Name</th>
                  <th className="px-3 py-3">Track / Cluster</th>
                  <th className="px-3 py-3">Status</th>
                  <th className="px-3 py-3">Contact</th>
                  <th className="px-3 py-3">Submitted</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-emerald-200/10 print:divide-gray-200">
                {summaryRows.slice(0, 100).map((r) => (
                  <tr key={String(r.id)} className="hover:bg-emerald-50">
                    <td className="wrap-break-word px-3 py-4 font-medium print:py-2">
                      {[r.first_name, r.middle_name, r.last_name]
                        .filter(Boolean)
                        .join(" ") || "Unnamed applicant"}
                    </td>
                    <td className="wrap-break-word px-3 py-4 text-xs text-emerald-700 print:py-2 print:text-emerald-950">
                      {getSelectedTrack(r)}
                      {getRowCluster(r) ? ` • ${getRowCluster(r)}` : ""}
                    </td>
                    <td className="px-3 py-4 text-xs capitalize print:py-2">
                      <span className="inline-block rounded-full border border-emerald-200 bg-emerald-50 px-2.5 py-1 text-[10px] print:border-gray-400 print:text-emerald-950">
                        {getEnrollmentStatusLabel(r.status)}
                      </span>
                    </td>
                    <td className="wrap-break-word px-3 py-4 text-xs text-emerald-900 print:py-2 print:text-gray-700">
                      {String(r.email || r.contact_number || "—")}
                    </td>
                    <td className="wrap-break-word px-3 py-4 text-xs text-emerald-900 print:py-2 print:text-gray-700">
                      {formatDate(r.submitted_at)}
                    </td>
                  </tr>
                ))}
                {!loading && summaryRows.length === 0 && (
                  <tr>
                    <td
                      colSpan={5}
                      className="px-3 py-10 text-center text-emerald-900 print:text-gray-500"
                    >
                      No {summaryStatus} students match the selected filters.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </section>
      ) : reportView === "analytics" ? (
        <section className="print-color-exact mx-auto w-full max-w-5xl space-y-4">
          <div className="mx-auto grid w-full gap-4 lg:grid-cols-2 print:grid-cols-2">
            <div className="break-inside-avoid rounded-2xl border border-emerald-200 bg-emerald-50 p-5 print:break-inside-avoid print:border-gray-300 print:bg-white print:text-emerald-950">
              <div className="mb-4 flex items-center justify-between gap-3">
                <h2 className="text-lg font-bold">Application Status</h2>
                <span className="rounded-lg bg-emerald-100 px-2.5 py-1 text-xs font-semibold text-emerald-800 print:bg-gray-100 print:text-gray-700">{analytics.total.toLocaleString()} total</span>
              </div>
              <div className="flex flex-col items-center justify-center gap-4 sm:flex-row">
                <div className="relative h-36 w-36 shrink-0">
                  <DonutChart
                    label="Application status distribution"
                    segments={[
                      { label: "Pending", value: analytics.byStatus.pending, color: "#6ee7b7" },
                      { label: "Enrolled", value: analytics.byStatus.enrolled, color: "#10b981" },
                      { label: "Denied", value: analytics.byStatus.denied, color: "#c2410c" },
                    ]}
                  />
                  <div className="absolute inset-0 flex items-center justify-center text-center">
                    <div>
                      <p className="text-[11px] text-emerald-800">Total</p>
                      <p className="text-lg font-bold text-emerald-900">{analytics.total}</p>
                    </div>
                  </div>
                </div>
                <div className="w-full flex-1 space-y-2 text-sm">
                  {([
                    { label: "Pending", value: analytics.byStatus.pending, color: "bg-emerald-300" },
                    { label: "Enrolled", value: analytics.byStatus.enrolled, color: "bg-emerald-500" },
                    { label: "Denied", value: analytics.byStatus.denied, color: "bg-orange-700" },
                  ] as const).map((item) => (
                    <div key={item.label} className="flex items-center justify-between gap-3">
                      <span className="flex items-center gap-2 text-emerald-900"><span className={`h-2.5 w-2.5 rounded-full ${item.color}`} />{item.label}</span>
                      <span className="font-semibold">{item.value} <span className="text-xs font-normal text-emerald-700">({analytics.pct(item.value, Math.max(analytics.total, 1)).toFixed(1)}%)</span></span>
                    </div>
                  ))}
                </div>
              </div>
              <div className="mt-4 rounded-lg border border-emerald-200 bg-white p-3 print:border-gray-300">
                <p className="text-xs font-semibold uppercase tracking-wide text-emerald-700">Prescriptive Analytics Report</p>
                <p className="mt-1 text-sm text-emerald-950">{analytics.reports.status}</p>
              </div>
            </div>

            <div className="break-inside-avoid rounded-2xl border border-emerald-200 bg-emerald-50 p-5 print:break-inside-avoid print:border-gray-300 print:bg-white print:text-emerald-950">
              <div className="mb-4 flex items-center justify-between gap-3">
                <h2 className="text-lg font-bold">Applications by Cluster</h2>
                <span className="rounded-lg bg-emerald-100 px-2.5 py-1 text-xs font-semibold text-emerald-800 print:bg-gray-100 print:text-gray-700">{analytics.clusters.length} clusters</span>
              </div>
              {analytics.clusters.length === 0 ? (
                <p className="text-sm text-emerald-800">No cluster data available.</p>
              ) : (
                <div className="space-y-2.5">
                  {analytics.clusters.slice(0, 8).map(([name, value]) => (
                    <div key={name}>
                      <div className="mb-1 flex items-center justify-between gap-3 text-xs">
                        <span className="font-medium text-emerald-950">{name}</span>
                        <span className="text-emerald-800">{value} ({analytics.pct(value, Math.max(analytics.total, 1)).toFixed(1)}%)</span>
                      </div>
                      <div className="h-2.5 overflow-hidden rounded-full bg-emerald-100 print:bg-gray-200">
                        <div className="h-full rounded-full bg-emerald-600" style={{ width: `${(value / analytics.maxCluster) * 100}%` }} />
                      </div>
                    </div>
                  ))}
                </div>
              )}
              <div className="mt-4 rounded-lg border border-emerald-200 bg-white p-3 print:border-gray-300">
                <p className="text-xs font-semibold uppercase tracking-wide text-emerald-700">Prescriptive Analytics Report</p>
                <p className="mt-1 text-sm text-emerald-950">{analytics.reports.cluster}</p>
              </div>
            </div>

            <div className="break-inside-avoid rounded-2xl border border-emerald-200 bg-emerald-50 p-5 print:break-inside-avoid print:border-gray-300 print:bg-white print:text-emerald-950">
              <div className="mb-4 flex items-center justify-between gap-3">
                <h2 className="text-lg font-bold">Gender Distribution</h2>
                <span className="rounded-lg bg-emerald-100 px-2.5 py-1 text-xs font-semibold text-emerald-800 print:bg-gray-100 print:text-gray-700">{analytics.genderTotal.toLocaleString()} with data</span>
              </div>
              <div className="flex flex-col items-center justify-center gap-4 sm:flex-row">
                <div className="relative h-36 w-36 shrink-0">
                  <DonutChart
                    label="Gender distribution"
                    segments={[
                      { label: "Male", value: analytics.genderCounts.Male, color: "#065f46" },
                      { label: "Female", value: analytics.genderCounts.Female, color: "#10b981" },
                      { label: "Unspecified", value: analytics.genderCounts.Unspecified, color: "#6ee7b7" },
                    ]}
                  />
                </div>
                <div className="w-full flex-1 space-y-2 text-sm">
                  {([
                    { label: "Male", value: analytics.genderCounts.Male, color: "bg-emerald-800" },
                    { label: "Female", value: analytics.genderCounts.Female, color: "bg-emerald-500" },
                    { label: "Unspecified", value: analytics.genderCounts.Unspecified, color: "bg-emerald-300" },
                  ] as const).map((item) => (
                    <div key={item.label} className="flex items-center justify-between gap-3">
                      <span className="flex items-center gap-2 text-emerald-900"><span className={`h-2.5 w-2.5 rounded-full ${item.color}`} />{item.label}</span>
                      <span className="font-semibold">{item.value} <span className="text-xs font-normal text-emerald-700">({analytics.pct(item.value, Math.max(analytics.genderTotal, 1)).toFixed(1)}%)</span></span>
                    </div>
                  ))}
                </div>
              </div>
              <div className="mt-4 rounded-lg border border-emerald-200 bg-white p-3 print:border-gray-300">
                <p className="text-xs font-semibold uppercase tracking-wide text-emerald-700">Prescriptive Analytics Report</p>
                <p className="mt-1 text-sm text-emerald-950">{analytics.reports.gender}</p>
              </div>
            </div>

            <div className="break-inside-avoid rounded-2xl border border-emerald-200 bg-emerald-50 p-5 print:break-inside-avoid print:border-gray-300 print:bg-white print:text-emerald-950">
              <div className="mb-4 flex items-center justify-between gap-3">
                <h2 className="text-lg font-bold">Track Distribution</h2>
                <span className="rounded-lg bg-emerald-100 px-2.5 py-1 text-xs font-semibold text-emerald-800 print:bg-gray-100 print:text-gray-700">{analytics.trackTotal.toLocaleString()} with data</span>
              </div>
              <div className="flex flex-col items-center justify-center gap-4 sm:flex-row">
                <div className="relative h-36 w-36 shrink-0">
                  <DonutChart
                    label="Track distribution"
                    segments={[
                      { label: "Academic", value: analytics.trackCounts.Academic, color: "#065f46" },
                      { label: "Tech Professional", value: analytics.trackCounts["Tech Professional"], color: "#6ee7b7" },
                    ]}
                  />
                </div>
                <div className="w-full flex-1 space-y-2 text-sm">
                  {([
                    { label: "Academic", value: analytics.trackCounts.Academic, color: "bg-emerald-800" },
                    { label: "Tech Professional", value: analytics.trackCounts["Tech Professional"], color: "bg-emerald-300" },
                  ] as const).map((item) => (
                    <div key={item.label} className="flex items-center justify-between gap-3">
                      <span className="flex items-center gap-2 text-emerald-900"><span className={`h-2.5 w-2.5 rounded-full ${item.color}`} />{item.label}</span>
                      <span className="font-semibold">{item.value} <span className="text-xs font-normal text-emerald-700">({analytics.pct(item.value, Math.max(analytics.trackTotal, 1)).toFixed(1)}%)</span></span>
                    </div>
                  ))}
                </div>
              </div>
              <div className="mt-4 rounded-lg border border-emerald-200 bg-white p-3 print:border-gray-300">
                <p className="text-xs font-semibold uppercase tracking-wide text-emerald-700">Prescriptive Analytics Report</p>
                <p className="mt-1 text-sm text-emerald-950">{analytics.reports.track}</p>
              </div>
            </div>
          </div>
        </section>
      ) : (
        <section className="space-y-4">
          <div
            className={`rounded-2xl border border-emerald-200 bg-emerald-50 px-5 py-4 print:border-gray-300 print:bg-white print:text-emerald-950 ${printSectionId ? "print:hidden" : ""
              }`}
          >
            <div className="flex items-center gap-3">
              <Users size={18} className="text-emerald-700 print:text-emerald-950" />
              <div>
                <h2 className="font-semibold">Gender Distribution by Section</h2>
                <p className="mt-1 text-xs text-emerald-800 print:text-gray-500">
                  Each section shows its adviser and two rosters — male and
                  female students sorted by name. Students without a recorded
                  gender appear under Unspecified.
                </p>
              </div>
            </div>
          </div>

          {loading ? (
            <div className="rounded-2xl border border-emerald-200 bg-emerald-50 px-5 py-10 text-center text-sm text-emerald-900 print:border-gray-300 print:bg-white">
              Loading assigned sections…
            </div>
          ) : genderGroups.length === 0 ? (
            <div className="rounded-2xl border border-emerald-200 bg-emerald-50 px-5 py-10 text-center text-sm text-emerald-900 print:border-gray-300 print:bg-white">
              No students match the current filters. Assign sections first in the
              Section &amp; Adviser module.
            </div>
          ) : (
            genderGroups.map((group) => {
              const isUnassigned = group.id === "__unassigned__";
              const maleStudents = group.students.filter(
                (student) => student.gender === "Male"
              );
              const femaleStudents = group.students.filter(
                (student) => student.gender === "Female"
              );
              const unspecifiedStudents = group.students.filter(
                (student) => student.gender === "Unspecified"
              );

              return (
                <div
                  key={group.id}
                  className={`overflow-hidden rounded-2xl border border-emerald-200 bg-emerald-50 break-inside-avoid print:break-inside-avoid print:border-gray-300 print:bg-white print:text-emerald-950 ${printSectionId && printSectionId !== group.id
                      ? "print:hidden"
                      : ""
                    }`}
                >
                  <div className="flex flex-col gap-3 border-b border-emerald-200 px-5 py-4 print:border-gray-300 sm:flex-row sm:items-center sm:justify-between">
                    <div>
                      <div className="flex items-center gap-2">
                        <UserRound size={16} className="text-emerald-700 print:text-emerald-950" />
                        <h3 className="font-bold">
                          {isUnassigned ? "Unassigned / Unknown Section" : group.name}
                        </h3>
                      </div>
                      <p className="mt-1 text-xs text-emerald-800 print:text-gray-600">
                        {[group.gradeLevel, group.strand]
                          .filter(Boolean)
                          .join(" · ") || "No grade level / cluster on record"}
                      </p>
                      <p className="mt-0.5 text-xs font-semibold text-emerald-900 print:text-emerald-950">
                        Adviser: {group.adviser || "Not assigned"}
                      </p>
                    </div>

                    <div className="flex flex-col items-start gap-2 sm:items-end">
                      <div className="flex flex-wrap items-center gap-2 text-[11px] font-semibold">
                        <span className="rounded-full border border-sky-200 bg-sky-50 px-2.5 py-1 text-sky-700 print:border-gray-400 print:bg-white print:text-emerald-950">
                          Male: {group.male}
                        </span>
                        <span className="rounded-full border border-pink-200 bg-pink-50 px-2.5 py-1 text-pink-700 print:border-gray-400 print:bg-white print:text-emerald-950">
                          Female: {group.female}
                        </span>
                        {group.unspecified > 0 && (
                          <span className="rounded-full border border-gray-200 bg-gray-100 px-2.5 py-1 text-gray-600 print:border-gray-400 print:bg-white print:text-emerald-950">
                            Unspecified: {group.unspecified}
                          </span>
                        )}
                        <span className="rounded-full border border-emerald-200 bg-white px-2.5 py-1 text-emerald-700 print:border-gray-400 print:text-emerald-950">
                          Total: {group.total}
                        </span>
                      </div>

                      <div className="flex flex-wrap items-center gap-2 print:hidden">
                        <button
                          onClick={() => exportSectionCsv(group)}
                          className="inline-flex items-center gap-1.5 rounded-lg border border-emerald-200 bg-white px-3 py-1.5 text-[11px] font-semibold text-emerald-900 hover:bg-emerald-50"
                        >
                          <Download size={13} />
                          Export CSV
                        </button>
                        <button
                          onClick={() => setPrintSectionId(group.id)}
                          className="inline-flex items-center gap-1.5 rounded-lg bg-yellow-300 px-3 py-1.5 text-[11px] font-bold text-emerald-950 hover:bg-yellow-300"
                        >
                          <Printer size={13} />
                          Print Section
                        </button>
                      </div>
                    </div>
                  </div>

                  <div className="grid md:grid-cols-2 print:grid-cols-2">
                    <GenderRosterColumn
                      label="Male"
                      students={maleStudents}
                      tone="male"
                      className="border-b border-emerald-200 md:border-b-0 md:border-r print:border-b-0 print:border-gray-300 print:border-r"
                    />
                    <GenderRosterColumn
                      label="Female"
                      students={femaleStudents}
                      tone="female"
                      className="border-b border-emerald-200 md:border-b-0 print:border-b-0 print:border-gray-300"
                    />
                  </div>

                  {unspecifiedStudents.length > 0 && (
                    <div className="border-t border-emerald-200 print:border-gray-300">
                      <GenderRosterColumn
                        label="Unspecified"
                        students={unspecifiedStudents}
                        tone="neutral"
                      />
                    </div>
                  )}
                </div>
              );
            })
          )}
        </section>
      )}

      {/* Print Signature Section */}
      <div className="hidden print:grid grid-cols-2 gap-10 mt-12 pt-8 text-emerald-950 text-xs">
        <div>
          <p className="font-semibold">Prepared by:</p>
          <div className="mt-8 border-b border-black w-48" />
          <p className="mt-1">School Registrar / Staff</p>
        </div>
        <div>
          <p className="font-semibold">Noted by:</p>
          <div className="mt-8 border-b border-black w-48" />
          <p className="mt-1">School Principal / Administrator</p>
        </div>
      </div>
    </div>
  );
}
