"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { normalizeEnrollmentStatus } from "@/lib/enrollmentStatus";
import { filterVisibleApplications } from "@/lib/applicationVisibility";
import { supabase } from "@/lib/supabaseClient";
import {
  Users,
  Clock3,
  GraduationCap,
  ArrowUpRight,
  RefreshCw,
  AlertCircle,
  Layers3,
  XCircle,
  PieChart,
} from "lucide-react";

type Application = {
  id?: string | number;
  status?: string | null;
  student_details?: unknown;
  [key: string]: unknown;
};

const statusColors: Record<string, string> = {
  pending: "bg-amber-50 text-amber-700 border-amber-200",
  enrolled: "bg-emerald-50 text-emerald-700 border-emerald-200",
  denied: "bg-orange-50 text-orange-700 border-orange-200",
  rejected: "bg-red-50 text-red-700 border-red-200",
};

function getText(record: Application, keys: string[]): string {
  for (const key of keys) {
    const value = record[key];

    if (typeof value === "string" || typeof value === "number") {
      const text = String(value).trim();
      if (text) return text;
    }
  }

  return "";
}

function getNestedDetails(app: Application): Application | null {
  const details = app.student_details;

  if (details && typeof details === "object" && !Array.isArray(details)) {
    return details as Application;
  }

  return null;
}

function getStatus(app: Application): string {
  return normalizeEnrollmentStatus(
    getText(app, ["status", "application_status", "enrollment_status"])
  );
}

function getStudentName(app: Application): string {
  const fullName = getText(app, [
    "full_name",
    "student_name",
    "applicant_name",
    "name",
  ]);

  if (fullName) return fullName;

  const first = getText(app, ["first_name", "firstname", "given_name"]);
  const middle = getText(app, ["middle_name", "middlename"]);
  const last = getText(app, [
    "last_name",
    "lastname",
    "surname",
    "family_name",
  ]);

  return [first, middle, last].filter(Boolean).join(" ") ||
    "Applicant name unavailable";
}

function getSubmittedDate(app: Application): string {
  const raw = getText(app, [
    "submitted_at",
    "created_at",
    "application_date",
    "created_on",
    "date_submitted",
  ]);

  if (!raw) return "—";

  const date = new Date(raw);

  return Number.isNaN(date.getTime())
    ? "—"
    : date.toLocaleDateString();
}

function getCluster(app: Application): string {
  const direct = getText(app, [
    "selected_cluster",
    "cluster",
    "cluster_name",
    "preferred_cluster",
  ]);

  if (direct) return direct;

  const details = getNestedDetails(app);

  if (details) {
    const nested = getText(details, [
      "selected_cluster",
      "cluster",
      "cluster_name",
      "preferred_cluster",
    ]);

    if (nested) return nested;
  }

  return getText(app, ["selected_track", "track", "program"]);
}

function getGender(app: Application): string {
  const direct = getText(app, [
    "sex",
    "gender",
    "student_gender",
  ]);

  if (direct) return direct;

  const details = getNestedDetails(app);

  if (details) {
    return getText(details, ["sex", "gender", "student_gender"]);
  }

  return "";
}

function getTrack(app: Application): string {
  const direct = getText(app, [
    "selected_track",
    "track",
    "program",
    "track_name",
  ]);

  if (direct) return direct;

  const details = getNestedDetails(app);

  if (details) {
    return getText(details, [
      "selected_track",
      "track",
      "program",
      "track_name",
    ]);
  }

  return "";
}

function normalizeTrack(value: string): "Academic" | "Tech Professional" | "" {
  const track = value.trim().toLowerCase().replace(/[_-]+/g, " ");

  if (track === "academic" || track === "academic track") {
    return "Academic";
  }

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

function normalizeGender(value: string): string {
  const gender = value.trim().toLowerCase();

  if (["male", "m"].includes(gender)) return "Male";
  if (["female", "f"].includes(gender)) return "Female";

  return "";
}

function formatCluster(value: string): string {
  if (!value) return "Not provided";

  const normalized = value.toLowerCase().trim();

  if (normalized === "academic") return "Academic Track";

  if (normalized === "techpro" || normalized === "tvl") {
    return "Technical-Vocational-Livelihood";
  }

  return value;
}

export default function StaffDashboardPage() {
  const [applications, setApplications] = useState<Application[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState("");
  const [loadedAt, setLoadedAt] = useState("");

  const loadData = useCallback(async () => {
    setRefreshing(true);
    setError("");

    try {
      const {
        data: { session },
        error: sessionError,
      } = await supabase.auth.getSession();

      if (sessionError) {
        throw new Error(
          `Could not check your login session: ${sessionError.message}`
        );
      }

      if (!session) {
        setApplications([]);
        setError(
          "Your staff session is missing or expired. Please sign in again."
        );
        return;
      }

      const { data, error: queryError } = await supabase
        .from("student_applications")
        .select("*")
        .limit(1000);

      if (queryError) {
        console.error(
          "Failed to fetch student applications:",
          queryError.message,
          queryError.code
        );

        throw new Error(
          `Could not load student applications: ${queryError.message}` +
          (queryError.code ? ` (Code: ${queryError.code})` : "")
        );
      }

      const records = filterVisibleApplications(
        (data ?? []) as Application[]
      );

      const dateKeys = [
        "submitted_at",
        "created_at",
        "application_date",
        "created_on",
        "date_submitted",
      ];

      records.sort((a, b) => {
        const getTime = (record: Application) => {
          for (const key of dateKeys) {
            const value = record[key];

            if (typeof value === "string") {
              const time = new Date(value).getTime();
              if (!Number.isNaN(time)) return time;
            }
          }

          return 0;
        };

        return getTime(b) - getTime(a);
      });

      setApplications(records);
      setLoadedAt(new Date().toLocaleTimeString());
    } catch (err: unknown) {
      const message =
        err instanceof Error
          ? err.message
          : "An unexpected error occurred while loading the dashboard.";

      setError(message);
      setApplications([]);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    let cancelled = false;
    let reloadTimeout: number | undefined;

    const startLoading = async () => {
      if (cancelled) return;
      await loadData();
    };

    const scheduleReload = () => {
      if (cancelled) return;

      if (reloadTimeout) {
        window.clearTimeout(reloadTimeout);
      }

      reloadTimeout = window.setTimeout(() => {
        reloadTimeout = undefined;
        void startLoading();
      }, 400);
    };

    void startLoading();

    const interval = window.setInterval(() => {
      if (!cancelled) {
        void startLoading();
      }
    }, 30000);

    const channel = supabase
      .channel(`staff-dashboard-live-${Date.now()}`)
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "student_applications",
        },
        scheduleReload
      )
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "sections",
        },
        scheduleReload
      )
      .subscribe();

    return () => {
      cancelled = true;
      window.clearInterval(interval);

      if (reloadTimeout) {
        window.clearTimeout(reloadTimeout);
      }

      supabase.removeChannel(channel);
    };
  }, [loadData]);

  const count = (status: string) =>
    applications.filter((app) => getStatus(app) === status).length;

  const total = applications.length;
  const pending = count("pending");
  const enrolled = count("enrolled");
  const denied = count("denied");

  // Applications per cluster.
  const clusterCounts = applications.reduce<Record<string, number>>(
    (result, app) => {
      const cluster = formatCluster(getCluster(app));

      if (cluster && cluster !== "Not provided") {
        result[cluster] = (result[cluster] ?? 0) + 1;
      }

      return result;
    },
    {}
  );

  const clusters = Object.entries(clusterCounts).sort(
    (a, b) => b[1] - a[1]
  );

  const maxCluster = Math.max(
    1,
    ...clusters.map(([, value]) => value)
  );

  // Track distribution: Academic versus Tech Professional.
  const trackCounts = applications.reduce<Record<string, number>>(
    (result, app) => {
      const track = normalizeTrack(getTrack(app));

      if (track) {
        result[track] = (result[track] ?? 0) + 1;
      }

      return result;
    },
    {}
  );

  const academicCount = trackCounts.Academic ?? 0;
  const techProfessionalCount = trackCounts["Tech Professional"] ?? 0;
  const trackTotal = academicCount + techProfessionalCount;
  const academicPercent = trackTotal > 0
    ? (academicCount / trackTotal) * 100
    : 0;
  const techProfessionalPercent = trackTotal > 0
    ? (techProfessionalCount / trackTotal) * 100
    : 0;

  const trackPie = `conic-gradient(
    #065f46 0% ${academicPercent}%,
    #6ee7b7 ${academicPercent}% 100%
  )`;

  // Gender distribution.
  const genderCounts = applications.reduce<Record<string, number>>(
    (result, app) => {
      const gender = normalizeGender(getGender(app));

      if (gender) {
        result[gender] = (result[gender] ?? 0) + 1;
      }

      return result;
    },
    {}
  );

  const male = genderCounts.Male ?? 0;
  const female = genderCounts.Female ?? 0;
  const genderTotal = male + female;

  const malePercent = genderTotal > 0 ? (male / genderTotal) * 100 : 0;
  const femalePercent =
    genderTotal > 0 ? (female / genderTotal) * 100 : 0;

  const genderPie = `conic-gradient(
    #065f46 0% ${malePercent}%,
    #10b981 ${malePercent}% 100%
  )`;

  // Existing application-status chart.
  const pieTotal = Math.max(total, 1);
  const p1 = (pending / pieTotal) * 100;
  const p2 = (enrolled / pieTotal) * 100;

  const statusPie = `conic-gradient(
    #6ee7b7 0% ${p1}%,
    #10b981 ${p1}% ${p1 + p2}%,
    #065f46 ${p1 + p2}% 100%
  )`;

  const metricCards = [
    {
      label: "Total Applications",
      value: total,
      icon: Users,
      tone: "text-emerald-700",
      note: "Submitted learner records",
    },
    {
      label: "Pending Review",
      value: pending,
      icon: Clock3,
      tone: "text-amber-700",
      note: "Awaiting registrar action",
    },
    {
      label: "Enrolled Students",
      value: enrolled,
      icon: GraduationCap,
      tone: "text-sky-700",
      note: "Officially registered",
    },
    {
      label: "Denied Applications",
      value: denied,
      icon: XCircle,
      tone: "text-orange-700",
      note: "Missing or unclear requirements",
    },
  ];

  return (
    <div className="space-y-7 text-emerald-700">
      {/* Page heading */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.18em] text-emerald-700">
            Registrar Overview
          </p>

          <h1 className="mt-2 text-3xl font-extrabold tracking-tight sm:text-4xl">
            Dashboard
          </h1>

          <p className="mt-2 text-sm text-emerald-900">
            Monitor student applications, enrollment progress, and cluster distribution.
          </p>

          {loadedAt && (
            <p className="mt-2 text-xs text-emerald-800">
              Last updated: {loadedAt}
            </p>
          )}
        </div>

        <button
          type="button"
          onClick={() => void loadData()}
          disabled={refreshing}
          className="inline-flex items-center justify-center gap-2 self-start rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-2.5 text-xs font-semibold hover:bg-emerald-100 disabled:cursor-not-allowed disabled:opacity-60"
        >
          <RefreshCw
            size={14}
            className={refreshing ? "animate-spin" : ""}
          />
          {refreshing ? "Refreshing..." : "Refresh data"}
        </button>
      </div>

      {/* Errors */}
      {error && (
        <div
          role="alert"
          className="flex gap-3 rounded-xl border border-red-200 bg-red-400/10 p-4 text-sm text-red-700"
        >
          <AlertCircle size={19} className="mt-0.5 shrink-0" />
          <div>
            <p className="font-semibold">
              Dashboard data could not be loaded
            </p>
            <p className="mt-1 wrap-break-word">{error}</p>
            <p className="mt-2 text-xs text-red-700/80">
              Check your staff login session, Supabase query permissions, and
              the student_applications table.
            </p>
          </div>
        </div>
      )}

      {/* Summary cards */}
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {metricCards.map((card) => {
          const Icon = card.icon;

          return (
            <div
              key={card.label}
              className="rounded-2xl border border-emerald-200 bg-emerald-50/90 p-5 shadow-lg shadow-black/10"
            >
              <div className="flex items-start justify-between gap-3">
                <p className="text-sm text-emerald-900">{card.label}</p>
                <Icon size={20} className={card.tone} />
              </div>

              <p className="mt-4 text-3xl font-bold tabular-nums">
                {loading ? "—" : card.value.toLocaleString()}
              </p>

              <p className="mt-2 text-xs text-emerald-800">{card.note}</p>
            </div>
          );
        })}
      </div>

      {/* Existing application status chart and cluster bar graph */}
      <div className="grid gap-5 xl:grid-cols-2">
        {/* Application Status */}
        <section className="rounded-2xl border border-emerald-200 bg-emerald-50/90 p-5 sm:p-6">
          <div className="flex items-start justify-between gap-3">
            <div>
              <h2 className="text-lg font-bold">Application Status</h2>
              <p className="mt-1 text-xs text-emerald-800">
                Distribution of student applications
              </p>
            </div>

            <span className="rounded-full border border-emerald-200 px-3 py-1 text-[10px] text-emerald-700">
              Live data
            </span>
          </div>

          <div className="mt-6 flex flex-col items-center justify-center gap-6 sm:flex-row sm:items-center sm:justify-center">
            <div
              className="relative mx-auto h-44 w-44 shrink-0 rounded-full sm:h-48 sm:w-48"
              style={{ background: loading ? "#d1fae5" : statusPie }}
            >
              <div className="absolute inset-7 flex flex-col items-center justify-center rounded-full border border-emerald-200 bg-emerald-50">
                <span className="text-3xl font-extrabold">
                  {loading ? "—" : total}
                </span>
                <span className="mt-1 text-center text-[10px] text-emerald-900">
                  Applications
                </span>
              </div>
            </div>

            <div className="w-full max-w-sm space-y-4">
              {[
                {
                  label: "Pending",
                  value: pending,
                  color: "bg-emerald-300",
                },
                {
                  label: "Enrolled",
                  value: enrolled,
                  color: "bg-emerald-500",
                },
                {
                  label: "Denied",
                  value: denied,
                  color: "bg-orange-400",
                },
              ].map((item) => (
                <div key={item.label} className="flex items-center gap-3">
                  <span
                    className={`h-2.5 w-2.5 rounded-full ${item.color}`}
                  />
                  <span className="flex-1 text-xs text-emerald-900">
                    {item.label}
                  </span>
                  <span className="text-sm font-bold tabular-nums">
                    {loading ? "—" : item.value}
                  </span>
                </div>
              ))}
            </div>
          </div>

          {!loading && (
            <div className="mt-6 rounded-xl border border-emerald-200 bg-white/70 p-4">
              <p className="text-xs font-bold uppercase tracking-wider text-emerald-800">
                Prescriptive Analytics Report
              </p>
              <p className="mt-2 text-sm leading-6 text-emerald-900">
                {total === 0
                  ? "No applications recorded yet. Promote the enrollment schedule and monitor incoming submissions to plan staffing and sectioning early."
                  : pending >= Math.max(enrolled, denied)
                    ? `Prioritize review: ${pending} pending application${pending === 1 ? "" : "s"} (${((pending / Math.max(total, 1)) * 100).toFixed(1)}%) need action. Assign reviewers and set daily targets to reduce backlog and speed up enrollment decisions.`
                    : denied > enrolled
                      ? `Review quality signals: ${denied} application${denied === 1 ? "" : "s"} denied (${((denied / Math.max(total, 1)) * 100).toFixed(1)}%) because requirements were missing or unclear. Improve applicant guidance and requirements communication so students can resubmit correctly.`
                      : `Enrollment flow is healthy with ${enrolled} enrolled (${((enrolled / Math.max(total, 1)) * 100).toFixed(1)}%). Continue timely processing of remaining ${pending} pending item${pending === 1 ? "" : "s"} to sustain completion rates.`}
              </p>
            </div>
          )}
        </section>

        {/* Applications by Cluster - Bar Graph */}
        <section className="rounded-2xl border border-emerald-200 bg-emerald-50/90 p-5 sm:p-6">
          <div className="flex items-center gap-3">
            <Layers3 size={21} className="text-emerald-700" />
            <div>
              <h2 className="text-lg font-bold">
                Applications by Cluster
              </h2>
              <p className="mt-1 text-xs text-emerald-800">
                Number of applicants in each cluster
              </p>
            </div>
          </div>

          {loading ? (
            <p className="mt-7 animate-pulse-soft text-sm text-emerald-800">
              Loading cluster data...
            </p>
          ) : clusters.length > 0 ? (
            <div className="mt-7 overflow-x-auto pb-1">
              <div className="mx-auto w-full max-w-3xl">
                <div className="flex h-56 items-end justify-center gap-4 border-b border-l border-emerald-200 px-4 pb-2 sm:h-60">
                  {clusters.map(([name, value]) => (
                    <div
                      key={name}
                      className="flex h-full min-w-0 flex-1 flex-col items-center justify-end gap-2"
                      title={`${name}: ${value} applicants`}
                    >
                      <span className="text-xs font-bold tabular-nums text-emerald-700">
                        {value}
                      </span>

                      <div
                        className="mx-auto w-full max-w-14 rounded-t-lg bg-linear-to-t from-emerald-700 to-emerald-400 transition-all duration-500 sm:max-w-16"
                        style={{
                          height: `${Math.max(
                            (value / maxCluster) * 100,
                            8
                          )}%`,
                        }}
                      />
                    </div>
                  ))}
                </div>

                <div className="mt-3 flex justify-center gap-4 px-4">
                  {clusters.map(([name]) => (
                    <span
                      key={name}
                      className="min-w-0 flex-1 wrap-break-word text-center text-[10px] leading-snug text-emerald-900"
                    >
                      {name}
                    </span>
                  ))}
                </div>
              </div>
            </div>
          ) : (
            <p className="mt-7 rounded-lg border border-emerald-200 p-4 text-sm text-emerald-800">
              No cluster values were found in the loaded applications. Check
              which column stores the selected cluster.
            </p>
          )}

          {!loading && clusters.length > 0 && (
            <div className="mt-6 rounded-xl border border-emerald-200 bg-white/70 p-4">
              <p className="text-xs font-bold uppercase tracking-wider text-emerald-800">
                Prescriptive Analytics Report
              </p>
              <p className="mt-2 text-sm leading-6 text-emerald-900">
                {(() => {
                  const [topName, topValue] = clusters[0];
                  const share = (topValue / Math.max(total, 1)) * 100;
                  return `Highest demand: ${topName} with ${topValue} applicant${topValue === 1 ? "" : "s"} (${share.toFixed(1)}% of total). Plan sections, teachers, and rooms proportionally to this demand, and monitor lower-demand clusters for possible consolidation or targeted orientation.`;
                })()}
              </p>
            </div>
          )}

          <div className="mt-6 flex items-center justify-between border-t border-emerald-200 pt-4 text-xs">
            <span className="text-emerald-800">
              Distinct clusters: {clusters.length}
            </span>

            <Link
              href="/staff/dashboard/sections"
              className="font-semibold text-emerald-700 hover:underline"
            >
              Assign sections
            </Link>
          </div>
        </section>
      </div>

      {/* Gender Distribution and Track Distribution */}
      <div className="grid gap-5 xl:grid-cols-2">
        {/* Gender Distribution */}
        <section className="rounded-2xl border border-emerald-200 bg-emerald-50/90 p-5 sm:p-6">
          <div className="flex items-center gap-3">
            <PieChart size={21} className="text-emerald-700" />
            <div>
              <h2 className="text-lg font-bold">Gender Distribution</h2>
              <p className="mt-1 text-xs text-emerald-800">
                Gender breakdown of applicants
              </p>
            </div>
          </div>

          {loading ? (
            <p className="mt-7 animate-pulse-soft text-sm text-emerald-800">
              Loading gender data...
            </p>
          ) : genderTotal > 0 ? (
            <div className="mt-6 flex flex-col items-center justify-center gap-7 sm:flex-row sm:items-center sm:justify-center">
              <div
                className="relative mx-auto h-44 w-44 shrink-0 rounded-full sm:h-48 sm:w-48"
                style={{ background: genderPie }}
              >
                <div className="absolute inset-7 flex flex-col items-center justify-center rounded-full border border-emerald-200 bg-emerald-50">
                  <span className="text-3xl font-extrabold">
                    {genderTotal}
                  </span>
                  <span className="mt-1 text-center text-[10px] text-emerald-900">
                    With gender data
                  </span>
                </div>
              </div>

              <div className="w-full max-w-sm space-y-4">
                {[
                  {
                    label: "Male",
                    value: male,
                    percentage: malePercent,
                    color: "bg-emerald-800",
                  },
                  {
                    label: "Female",
                    value: female,
                    percentage: femalePercent,
                    color: "bg-emerald-500",
                  },
                ].map((item) => (
                  <div key={item.label}>
                    <div className="mb-2 flex items-center gap-3">
                      <span
                        className={`h-2.5 w-2.5 rounded-full ${item.color}`}
                      />
                      <span className="flex-1 text-xs text-emerald-900">
                        {item.label}
                      </span>
                      <span className="text-xs font-bold tabular-nums">
                        {item.value} ({item.percentage.toFixed(1)}%)
                      </span>
                    </div>

                    <div className="h-2 overflow-hidden rounded-full bg-emerald-100">
                      <div
                        className={`h-full rounded-full ${item.color}`}
                        style={{ width: `${item.percentage}%` }}
                      />
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ) : (
            <p className="mt-7 rounded-lg border border-emerald-200 p-4 text-sm text-emerald-800">
              No gender values were found. Check whether the application
              records contain a sex or gender value.
            </p>
          )}

          {!loading && genderTotal > 0 && (
            <div className="mt-6 rounded-xl border border-emerald-200 bg-white/70 p-4">
              <p className="text-xs font-bold uppercase tracking-wider text-emerald-800">
                Prescriptive Analytics Report
              </p>
              <p className="mt-2 text-sm leading-6 text-emerald-900">
                {(() => {
                  const dominant = [
                    { label: "Male", value: male, pct: malePercent },
                    { label: "Female", value: female, pct: femalePercent },
                  ].sort((a, b) => b.value - a.value)[0];
                  const gap = Math.abs(malePercent - femalePercent);
                  if (gap <= 10) {
                    return `Gender distribution is relatively balanced (gap ${gap.toFixed(1)}%). Maintain equitable support services, facilities planning, and class assignments across groups.`;
                  }
                  return `${dominant.label} applicants are currently higher at ${dominant.pct.toFixed(1)}%. Ensure balanced class composition, inclusive activities, and targeted outreach where participation is lower.`;
                })()}
              </p>
            </div>
          )}

          <p className="mt-5 border-t border-emerald-200 pt-4 text-xs text-emerald-800">
            Applicants without a recorded gender are excluded from this chart.
          </p>
        </section>

        {/* Track Distribution */}
        <section className="rounded-2xl border border-emerald-200 bg-emerald-50/90 p-5 sm:p-6">
          <div className="flex items-center gap-3">
            <PieChart size={21} className="text-emerald-700" />
            <div>
              <h2 className="text-lg font-bold">Track Distribution</h2>
              <p className="mt-1 text-xs text-emerald-800">
                Applicants grouped by selected track
              </p>
            </div>
          </div>

          {loading ? (
            <p className="mt-7 animate-pulse-soft text-sm text-emerald-800">
              Loading track data...
            </p>
          ) : trackTotal > 0 ? (
            <div className="mt-6 flex flex-col items-center justify-center gap-7 sm:flex-row sm:items-center sm:justify-center">
              <div
                className="relative mx-auto h-44 w-44 shrink-0 rounded-full sm:h-48 sm:w-48"
                style={{ background: trackPie }}
              >
                <div className="absolute inset-7 flex flex-col items-center justify-center rounded-full border border-emerald-200 bg-emerald-50">
                  <span className="text-3xl font-extrabold">
                    {trackTotal}
                  </span>
                  <span className="mt-1 text-center text-[10px] text-emerald-900">
                    With track data
                  </span>
                </div>
              </div>

              <div className="w-full max-w-sm space-y-5">
                {[
                  {
                    label: "Academic",
                    value: academicCount,
                    percentage: academicPercent,
                    color: "bg-emerald-800",
                  },
                  {
                    label: "Tech Professional",
                    value: techProfessionalCount,
                    percentage: techProfessionalPercent,
                    color: "bg-emerald-300",
                  },
                ].map((item) => (
                  <div key={item.label}>
                    <div className="mb-2 flex items-center gap-3">
                      <span
                        className={`h-2.5 w-2.5 rounded-full ${item.color}`}
                      />
                      <span className="flex-1 text-xs text-emerald-900">
                        {item.label}
                      </span>
                      <span className="text-xs font-bold tabular-nums">
                        {item.value} ({item.percentage.toFixed(1)}%)
                      </span>
                    </div>

                    <div className="h-2 overflow-hidden rounded-full bg-emerald-100">
                      <div
                        className={`h-full rounded-full ${item.color}`}
                        style={{ width: `${item.percentage}%` }}
                      />
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ) : (
            <p className="mt-7 rounded-lg border border-emerald-200 p-4 text-sm text-emerald-800">
              No recognized track values were found. Check whether applications
              contain Academic or TechPro track values.
            </p>
          )}

          {!loading && trackTotal > 0 && (
            <div className="mt-6 rounded-xl border border-emerald-200 bg-white/70 p-4">
              <p className="text-xs font-bold uppercase tracking-wider text-emerald-800">
                Prescriptive Analytics Report
              </p>
              <p className="mt-2 text-sm leading-6 text-emerald-900">
                {(() => {
                  const preferred =
                    academicCount >= techProfessionalCount
                      ? { label: "Academic", value: academicCount, pct: academicPercent }
                      : { label: "Tech Professional", value: techProfessionalCount, pct: techProfessionalPercent };
                  const gap = Math.abs(academicPercent - techProfessionalPercent);
                  if (gap <= 10) {
                    return `Track demand is balanced (gap ${gap.toFixed(1)}%). Allocate sections and learning resources fairly across both tracks and monitor shifts as applications continue.`;
                  }
                  return `${preferred.label} track has higher demand (${preferred.value} applicants, ${preferred.pct.toFixed(1)}%). Prepare additional sections/resources for this track while maintaining adequate capacity and guidance for the other.`;
                })()}
              </p>
            </div>
          )}

          <p className="mt-5 border-t border-emerald-200 pt-4 text-xs text-emerald-800">
            Only Academic and Tech Professional track records are included.
          </p>
        </section>
      </div>

      {/* Recent applications */}
      <section className="overflow-hidden rounded-2xl border border-emerald-200 bg-emerald-50/90">
        <div className="flex items-center justify-between gap-3 border-b border-emerald-200 px-5 py-5 sm:px-6">
          <div>
            <h2 className="text-lg font-bold">Recent Applications</h2>
            <p className="mt-1 text-xs text-emerald-800">
              Latest student submissions
            </p>
          </div>

          <Link
            href="/staff/dashboard/applications"
            className="inline-flex items-center gap-1 text-xs font-semibold text-emerald-700 hover:text-emerald-700"
          >
            View all <ArrowUpRight size={14} />
          </Link>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full table-fixed text-left text-sm">
            <colgroup>
              <col className="w-[32%]" />
              <col className="w-[26%]" />
              <col className="w-[22%]" />
              <col className="w-[20%]" />
            </colgroup>
            <thead className="bg-emerald-50 text-[10px] uppercase tracking-wider text-emerald-900">
              <tr>
                <th className="px-4 py-3 font-semibold">Student</th>
                <th className="px-4 py-3 font-semibold">Cluster</th>
                <th className="px-4 py-3 font-semibold">Submitted</th>
                <th className="px-4 py-3 font-semibold">Status</th>
              </tr>
            </thead>

            <tbody className="divide-y divide-emerald-200/10">
              {loading ? (
                <tr>
                  <td
                    colSpan={4}
                    className="animate-pulse-soft px-4 py-10 text-center text-emerald-900"
                  >
                    Loading applications...
                  </td>
                </tr>
              ) : applications.length > 0 ? (
                applications.slice(0, 6).map((app, index) => {
                  const status = getStatus(app);
                  const applicationId = String(app.id ?? "No ID");

                  return (
                    <tr
                      key={applicationId === "No ID" ? index : applicationId}
                      className="hover:bg-emerald-50"
                    >
                      <td className="wrap-break-word px-4 py-4 font-medium">
                        {getStudentName(app)}
                      </td>

                      <td className="wrap-break-word px-4 py-4 text-xs font-semibold text-emerald-700">
                        {formatCluster(getCluster(app))}
                      </td>

                      <td className="wrap-break-word px-4 py-4 text-xs text-emerald-900">
                        {getSubmittedDate(app)}
                      </td>

                      <td className="px-4 py-4">
                        <span
                          className={`inline-block rounded-full border px-2.5 py-1 text-[10px] font-semibold capitalize ${statusColors[status] ?? statusColors.pending
                            }`}
                        >
                          {status.replace(/_/g, " ")}
                        </span>
                      </td>
                    </tr>
                  );
                })
              ) : (
                <tr>
                  <td
                    colSpan={4}
                    className="px-4 py-10 text-center text-emerald-900"
                  >
                    {error
                      ? "Applications could not be loaded. See the error above."
                      : "No applications were returned by Supabase."}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>

        <div className="border-t border-emerald-200 px-6 py-3 text-xs text-emerald-800">
          Showing {Math.min(applications.length, 6)} of {applications.length}{" "}
          loaded applications
        </div>
      </section>
    </div>
  );
}
