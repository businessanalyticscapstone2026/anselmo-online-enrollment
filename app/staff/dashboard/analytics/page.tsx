"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  AlertTriangle,
  BarChart3,
  CheckCircle2,
  Clock,
  Download,
  Lightbulb,
  MapPin,
  RefreshCw,
  TrendingUp,
  Users,
} from "lucide-react";
import { supabase } from "@/lib/supabaseClient";
import { filterVisibleApplications } from "@/lib/applicationVisibility";
import type { EnrollmentStatus } from "@/lib/enrollmentStatus";
import {
  evaluateEnrollmentAvailability,
  type EnrollmentSettings,
} from "@/lib/enrollmentSettings";
import {
  buildAgeBreakdown,
  buildClusterBreakdown,
  buildClusterDailyTrend,
  buildCountBreakdown,
  buildGenderBreakdown,
  getBarangay,
  getCollegeCourse,
  getMunicipality,
  getStatus,
  getSubmittedDate,
  getTrack,
  hasFourPs,
  hasIpCommunity,
  hasPwdId,
  hasRequirements,
  hasSpecialNeeds,
  type ApplicationRecord,
} from "../_components/analytics";
import {
  BarList,
  DonutChart,
  LineTrendChart,
} from "../_components/AnalyticsCharts";

type RangeKey = "7" | "30" | "90" | "all";
type TrackFilter = "all" | "academic" | "techpro";
type InsightTone = "good" | "warn" | "critical" | "info";

type Insight = {
  tone: InsightTone;
  title: string;
  detail: string;
};

const RANGE_LABELS: Record<RangeKey, string> = {
  "7": "Last 7 days",
  "30": "Last 30 days",
  "90": "Last 90 days",
  all: "All time",
};

const TRACK_FILTER_LABELS: Record<TrackFilter, string> = {
  all: "All tracks",
  academic: "Academic track",
  techpro: "Technical Professional",
};

const TREND_COLORS = ["#176b4d", "#6ba8c7", "#c8b27c", "#d58aa1", "#94a3b8"];

const INSIGHT_STYLES: Record<
  InsightTone,
  { container: string; icon: string; title: string }
> = {
  good: {
    container: "border-emerald-300 bg-emerald-100/70",
    icon: "text-emerald-700",
    title: "text-emerald-950",
  },
  warn: {
    container: "border-amber-300 bg-amber-50",
    icon: "text-amber-600",
    title: "text-amber-950",
  },
  critical: {
    container: "border-rose-300 bg-rose-50",
    icon: "text-rose-600",
    title: "text-rose-950",
  },
  info: {
    container: "border-sky-300 bg-sky-50",
    icon: "text-sky-600",
    title: "text-sky-950",
  },
};

function csvCell(value: string | number): string {
  return `"${String(value).replace(/"/g, '""')}"`;
}

function downloadCsv(
  filename: string,
  rows: (string | number)[][]
): void {
  const csv = rows.map((row) => row.map(csvCell).join(",")).join("\r\n");
  const blob = new Blob([`\uFEFF${csv}`], {
    type: "text/csv;charset=utf-8;",
  });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
}

function formatPercent(value: number): string {
  return `${value.toLocaleString(undefined, {
    minimumFractionDigits: 0,
    maximumFractionDigits: 1,
  })}%`;
}

export default function AnalyticsPage() {
  const [records, setRecords] = useState<ApplicationRecord[]>([]);
  const [settings, setSettings] = useState<EnrollmentSettings | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState("");
  const [range, setRange] = useState<RangeKey>("30");
  const [trackFilter, setTrackFilter] = useState<TrackFilter>("all");
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);
  const [now, setNow] = useState(() => new Date());

  const load = useCallback(async (showSpinner = true) => {
    if (showSpinner) {
      setLoading(true);
    } else {
      setRefreshing(true);
    }

    setError("");

    try {
      const [applicationsResult, settingsResult] = await Promise.all([
        supabase
          .from("student_applications")
          .select("*")
          .order("submitted_at", { ascending: false })
          .limit(5000),
        supabase
          .from("enrollment_settings")
          .select("id, enrollment_start_date, enrollment_end_date")
          .eq("id", 1)
          .maybeSingle(),
      ]);

      if (applicationsResult.error) {
        setError(applicationsResult.error.message);
      } else {
        const visible = filterVisibleApplications(
          (applicationsResult.data ?? []) as ApplicationRecord[]
        );
        setRecords(
          visible.filter((record) => getStatus(record) !== "rejected")
        );
      }

      if (!settingsResult.error) {
        setSettings((settingsResult.data ?? null) as EnrollmentSettings | null);
      }

      const stamp = new Date();
      setNow(stamp);
      setLastUpdated(stamp);
    } catch (loadError) {
      console.error("Analytics load error:", loadError);
      setError(
        "Unable to load analytics right now. Check your connection and try again."
      );
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load();
  }, [load]);

  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | null = null;

    const scheduleReload = () => {
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => {
        void load(false);
      }, 500);
    };

    const channel = supabase
      .channel(`staff-analytics-live-${Date.now()}`)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "student_applications" },
        scheduleReload
      )
      .subscribe();

    const poll = setInterval(() => {
      void load(false);
    }, 30000);

    return () => {
      if (timer) clearTimeout(timer);
      clearInterval(poll);
      void supabase.removeChannel(channel);
    };
  }, [load]);

  const cutoff = useMemo(() => {
    if (range === "all") return null;
    return now.getTime() - Number(range) * 24 * 60 * 60 * 1000;
  }, [range, now]);

  const filtered = useMemo(
    () =>
      records.filter((record) => {
        if (trackFilter !== "all" && getTrack(record) !== trackFilter) {
          return false;
        }

        if (cutoff === null) return true;

        const submitted = getSubmittedDate(record);
        return submitted ? submitted.getTime() >= cutoff : false;
      }),
    [records, trackFilter, cutoff]
  );

  const statusCounts = useMemo(() => {
    const counts: Record<EnrollmentStatus, number> = {
      pending: 0,
      enrolled: 0,
      denied: 0,
      rejected: 0,
    };

    for (const record of filtered) {
      counts[getStatus(record)] += 1;
    }

    return counts;
  }, [filtered]);

  const total = filtered.length;
  const enrollmentRate =
    total > 0
      ? Math.round((statusCounts.enrolled / total) * 1000) / 10
      : 0;

  const weekCount = useMemo(() => {
    const weekAgo = now.getTime() - 7 * 24 * 60 * 60 * 1000;
    return filtered.filter((record) => {
      const submitted = getSubmittedDate(record);
      return submitted ? submitted.getTime() >= weekAgo : false;
    }).length;
  }, [filtered, now]);

  const todayCount = useMemo(() => {
    const todayKey = now.toLocaleDateString("en-CA", {
      timeZone: "Asia/Manila",
    });

    return filtered.filter((record) => {
      const submitted = getSubmittedDate(record);
      return (
        submitted !== null &&
        submitted.toLocaleDateString("en-CA", {
          timeZone: "Asia/Manila",
        }) === todayKey
      );
    }).length;
  }, [filtered, now]);

  const pendingAged = useMemo(() => {
    const threshold = now.getTime() - 3 * 24 * 60 * 60 * 1000;

    return filtered.filter((record) => {
      if (getStatus(record) !== "pending") return false;
      const submitted = getSubmittedDate(record);
      return submitted ? submitted.getTime() < threshold : false;
    }).length;
  }, [filtered, now]);

  const trendDays =
    range === "7" ? 7 : range === "30" ? 30 : range === "90" ? 90 : 30;

  const clusterTrend = useMemo(
    () => buildClusterDailyTrend(filtered, trendDays, now, 4),
    [filtered, trendDays, now]
  );

  const trendPoints = useMemo(
    () =>
      clusterTrend.points.map((point) => ({
        label: point.label,
        values: point.values,
      })),
    [clusterTrend.points]
  );

  const clusters = useMemo(() => buildClusterBreakdown(filtered), [filtered]);
  const genders = useMemo(() => buildGenderBreakdown(filtered), [filtered]);
  const ages = useMemo(() => buildAgeBreakdown(filtered), [filtered]);

  const trackCounts = useMemo(() => {
    let academic = 0;
    let techpro = 0;
    let unknown = 0;

    for (const record of filtered) {
      const track = getTrack(record);
      if (track === "academic") academic += 1;
      else if (track === "techpro") techpro += 1;
      else unknown += 1;
    }

    return { academic, techpro, unknown };
  }, [filtered]);

  const barangayMunicipalities = useMemo(
    () =>
      buildCountBreakdown(
        filtered,
        (record) => {
          const barangay = getBarangay(record);
          const municipality = getMunicipality(record);
          if (barangay && municipality) return `${barangay}, ${municipality}`;
          return barangay || municipality;
        },
        8
      ),
    [filtered]
  );

  const courses = useMemo(
    () => buildCountBreakdown(filtered, getCollegeCourse, 8),
    [filtered]
  );

  const requirements = useMemo(() => {
    const complete = filtered.filter((record) => hasRequirements(record)).length;
    return {
      complete,
      incomplete: Math.max(total - complete, 0),
      rate: total > 0 ? Math.round((complete / total) * 1000) / 10 : 0,
    };
  }, [filtered, total]);

  const flags = useMemo(() => {
    let ip = 0;
    let fourPs = 0;
    let special = 0;
    let pwd = 0;

    for (const record of filtered) {
      if (hasIpCommunity(record)) ip += 1;
      if (hasFourPs(record)) fourPs += 1;
      if (hasSpecialNeeds(record)) special += 1;
      if (hasPwdId(record)) pwd += 1;
    }

    return { ip, fourPs, special, pwd };
  }, [filtered]);

  const requirementsCompletion = requirements.rate;

  const availability = useMemo(
    () => evaluateEnrollmentAvailability(settings, now),
    [settings, now]
  );

  const projection = useMemo(() => {
    const startValue = settings?.enrollment_start_date;
    const endValue = settings?.enrollment_end_date;
    if (!startValue || !endValue) return null;

    const start = new Date(`${startValue}T00:00:00+08:00`);
    const end = new Date(`${endValue}T23:59:59+08:00`);

    if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) {
      return null;
    }

    const totalDays = Math.max(
      1,
      Math.ceil((end.getTime() - start.getTime()) / (24 * 60 * 60 * 1000))
    );
    const elapsedDays = Math.min(
      totalDays,
      Math.max(1, Math.ceil((now.getTime() - start.getTime()) / (24 * 60 * 60 * 1000)))
    );
    const remainingDays = Math.max(
      0,
      Math.ceil((end.getTime() - now.getTime()) / (24 * 60 * 60 * 1000))
    );
    const dailyRate = records.length / elapsedDays;
    const projected = Math.round(records.length + dailyRate * remainingDays);

    return {
      totalDays,
      elapsedDays,
      remainingDays,
      dailyRate,
      projected,
    };
  }, [settings, records, now]);

  const insights = useMemo(() => {
    const list: Insight[] = [];

    if (availability.isOpen) {
      list.push({
        tone: "good",
        title: "The enrollment window is open",
        detail: `Applications are being accepted until ${
          availability.endDate ?? "the configured end date"
        }. Keep monitoring daily volume.`,
      });
    } else {
      list.push({
        tone: "info",
        title: "Enrollment window status",
        detail: availability.message,
      });
    }

    if (pendingAged > 0) {
      list.push({
        tone: "warn",
        title: `${pendingAged} pending application${
          pendingAged === 1 ? "" : "s"
        } older than 3 days`,
        detail:
          "Review these records first and send follow-up reminders so learners are not left waiting.",
      });
    }

    const topLocation = barangayMunicipalities.data[0];
    if (topLocation) {
      list.push({
        tone: "info",
        title: `Top applicant location: ${topLocation.label}`,
        detail: `${topLocation.value} application${
          topLocation.value === 1 ? "" : "s"
        } (${formatPercent(
          topLocation.percentage
        )}) came from this barangay and municipality.`,
      });
    }

    if (ages.total > 0) {
      list.push({
        tone: "info",
        title: `Average applicant age: ${ages.average}`,
        detail: `Computed from ${ages.total} application${
          ages.total === 1 ? "" : "s"
        } with a recorded age${
          ages.unrecorded > 0
            ? `; ${ages.unrecorded} application${
                ages.unrecorded === 1 ? "" : "s"
              } still have no age on file`
            : ""
        }.`,
      });
    }

    if (requirementsCompletion < 80) {
      list.push({
        tone: "warn",
        title: `Requirements completion is ${formatPercent(
          requirementsCompletion
        )}`,
        detail: `${requirements.incomplete} application${
          requirements.incomplete === 1 ? "" : "s"
        } still need documents. Send reminders to improve completion.`,
      });
    } else {
      list.push({
        tone: "good",
        title: `Requirements completion is ${formatPercent(
          requirementsCompletion
        )}`,
        detail:
          "Most applicants have submitted their documents. Continue validating pending uploads.",
      });
    }

    if (projection) {
      list.push({
        tone: "info",
        title: `Projected ${projection.projected.toLocaleString()} applications by the deadline`,
        detail: `At the current pace of ${projection.dailyRate.toFixed(
          1
        )} applications per day, with ${projection.remainingDays} day${
          projection.remainingDays === 1 ? "" : "s"
        } remaining.`,
      });
    }

    const topCluster = clusters.data[0];

    if (topCluster) {
      list.push({
        tone: "info",
        title: `${topCluster.name} is the most requested cluster`,
        detail: `${topCluster.value} application${
          topCluster.value === 1 ? "" : "s"
        } (${formatPercent(
          topCluster.percentage
        )}). Allocate advisers and section slots to match this demand.`,
      });
    }

    const topCourse = courses.data[0];

    if (topCourse) {
      list.push({
        tone: "info",
        title: `Most preferred college course: ${topCourse.label}`,
        detail: `${topCourse.value} learner${
          topCourse.value === 1 ? "" : "s"
        } selected it. Use this for college-readiness and career guidance planning.`,
      });
    }

    return list;
  }, [
    availability,
    pendingAged,
    barangayMunicipalities.data,
    ages.total,
    ages.average,
    ages.unrecorded,
    requirements,
    requirementsCompletion,
    projection,
    clusters.data,
    courses.data,
  ]);

  const trendSeries = clusterTrend.keys.map((key, index) => ({
    key,
    label: key,
    color: TREND_COLORS[index] ?? TREND_COLORS[TREND_COLORS.length - 1],
  }));

  const statusData = [
    { label: "Pending", value: statusCounts.pending, color: "#f59e0b" },
    { label: "Enrolled", value: statusCounts.enrolled, color: "#176b4d" },
    { label: "Denied", value: statusCounts.denied, color: "#c2410c" },
  ];

  const trackData = [
    { label: "Academic Track", value: trackCounts.academic },
    { label: "Technical Professional", value: trackCounts.techpro },
    ...(trackCounts.unknown > 0
      ? [{ label: "Not specified", value: trackCounts.unknown }]
      : []),
  ];

  const kpis = [
    {
      label: "Total Applications",
      value: total,
      note: RANGE_LABELS[range],
      icon: Users,
      tone: "text-emerald-700",
    },
    {
      label: "Enrolled",
      value: statusCounts.enrolled,
      note: `${formatPercent(enrollmentRate)} of applications`,
      icon: CheckCircle2,
      tone: "text-emerald-700",
    },
    {
      label: "Pending",
      value: statusCounts.pending,
      note: `${pendingAged} older than 3 days`,
      icon: Clock,
      tone: "text-amber-600",
    },
    {
      label: "New This Week",
      value: weekCount,
      note: `${todayCount} submitted today`,
      icon: TrendingUp,
      tone: "text-sky-600",
    },
  ];

  function handleExport() {
    const rows: (string | number)[][] = [
      ["AASMNHS Enrollment Analytics"],
      [
        "Generated",
        new Date().toLocaleString("en-PH", { timeZone: "Asia/Manila" }),
      ],
      ["Range", RANGE_LABELS[range]],
      ["Track filter", TRACK_FILTER_LABELS[trackFilter]],
      [],
      ["Metric", "Value"],
      ["Total applications", total],
      ["Enrolled", statusCounts.enrolled],
      ["Pending", statusCounts.pending],
      ["Denied", statusCounts.denied],
      ["Enrollment rate (%)", enrollmentRate],
      ["New this week", weekCount],
      ["Submitted today", todayCount],
      ["Average age (recorded)", ages.average],
      ["Age recorded", ages.total],
      ["Age not recorded", ages.unrecorded],
      ["Pending older than 3 days", pendingAged],
      ["Requirements complete", requirements.complete],
      ["Requirements completion rate (%)", requirements.rate],
      ["IP community", flags.ip],
      ["4Ps beneficiary", flags.fourPs],
      ["Special needs program", flags.special],
      ["With PWD ID", flags.pwd],
      [],
      ["Cluster", "Applications", "%"],
      ...clusters.data.map((item) => [
        item.name,
        item.value,
        item.percentage,
      ]),
      [],
      ["Barangay & Municipality", "Applications", "%"],
      ...barangayMunicipalities.data.map((item) => [
        item.label,
        item.value,
        item.percentage,
      ]),
      [],
      ["Age group", "Applicants", "%"],
      ...ages.data.map((item) => [item.label, item.value, item.percentage]),
      [],
      ["College course", "Learners", "%"],
      ...courses.data.map((item) => [
        item.label,
        item.value,
        item.percentage,
      ]),
      [],
      ["Insight", "Detail"],
      ...insights.map((insight) => [insight.title, insight.detail]),
    ];

    downloadCsv(
      `enrollment-analytics-${new Date().toISOString().slice(0, 10)}.csv`,
      rows
    );
  }

  return (
    <div className="space-y-7 text-emerald-700">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
        <div>
          <p className="flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.18em] text-emerald-700">
            <BarChart3 size={14} />
            Descriptive &amp; Prescriptive Analytics
          </p>

          <h1 className="mt-2 text-3xl font-extrabold tracking-tight sm:text-4xl">
            Enrollment Analytics
          </h1>

          <p className="mt-2 max-w-3xl text-sm text-emerald-900">
            Live enrollment summaries, trends, cluster demand, and recommended
            actions for the registrar and staff.
          </p>

          <div className="mt-3 flex flex-wrap items-center gap-3 text-xs">
            <span className="inline-flex items-center gap-2 rounded-full border border-emerald-300 bg-emerald-100 px-3 py-1 font-semibold text-emerald-800">
              <span className="relative flex h-2 w-2">
                <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-500 opacity-75" />
                <span className="relative inline-flex h-2 w-2 rounded-full bg-emerald-600" />
              </span>
              Live
            </span>

            {lastUpdated && (
              <span className="text-emerald-800">
                Updated{" "}
                {lastUpdated.toLocaleTimeString("en-US", {
                  timeZone: "Asia/Manila",
                  hour: "2-digit",
                  minute: "2-digit",
                  second: "2-digit",
                })}
              </span>
            )}

            <span
              className={`rounded-full border px-3 py-1 font-semibold ${
                availability.isOpen
                  ? "border-emerald-300 bg-emerald-100 text-emerald-800"
                  : "border-amber-300 bg-amber-50 text-amber-800"
              }`}
            >
              {availability.isOpen
                ? "Enrollment open"
                : `Enrollment ${availability.reason.replace(/_/g, " ")}`}
            </span>
          </div>
        </div>

        <div className="flex flex-wrap gap-2 self-start">
          <button
            type="button"
            onClick={handleExport}
            className="inline-flex items-center justify-center gap-2 rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-2.5 text-xs font-semibold hover:bg-emerald-100"
          >
            <Download size={14} />
            Export CSV
          </button>

          <button
            type="button"
            onClick={() => void load()}
            disabled={refreshing}
            className="inline-flex items-center justify-center gap-2 rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-2.5 text-xs font-semibold hover:bg-emerald-100 disabled:cursor-not-allowed disabled:opacity-60"
          >
            <RefreshCw
              size={14}
              className={refreshing ? "animate-spin" : undefined}
            />
            {refreshing ? "Refreshing..." : "Refresh data"}
          </button>
        </div>
      </div>

      <div className="flex flex-wrap items-end gap-3 rounded-xl border border-emerald-200 bg-emerald-50/90 p-4">
        <label className="flex flex-col gap-1 text-xs font-semibold text-emerald-800">
          Date range
          <select
            value={range}
            onChange={(event) => setRange(event.target.value as RangeKey)}
            className="rounded-lg border border-emerald-200 bg-white px-3 py-2 text-sm font-medium text-emerald-900 outline-none focus:border-emerald-400"
          >
            <option value="7">Last 7 days</option>
            <option value="30">Last 30 days</option>
            <option value="90">Last 90 days</option>
            <option value="all">All time</option>
          </select>
        </label>

        <label className="flex flex-col gap-1 text-xs font-semibold text-emerald-800">
          Track
          <select
            value={trackFilter}
            onChange={(event) =>
              setTrackFilter(event.target.value as TrackFilter)
            }
            className="rounded-lg border border-emerald-200 bg-white px-3 py-2 text-sm font-medium text-emerald-900 outline-none focus:border-emerald-400"
          >
            <option value="all">All tracks</option>
            <option value="academic">Academic track</option>
            <option value="techpro">Technical Professional</option>
          </select>
        </label>

        <p className="ml-auto text-xs text-emerald-800">
          Showing <strong>{total.toLocaleString()}</strong> of{" "}
          {records.length.toLocaleString()} applications
        </p>
      </div>

      {error && (
        <div
          role="alert"
          className="flex gap-3 rounded-xl border border-red-200 bg-red-400/10 p-4 text-sm text-red-700"
        >
          <AlertTriangle size={19} className="mt-0.5 shrink-0" />
          <div>
            <p className="font-semibold">Analytics data could not be loaded</p>
            <p className="mt-1 wrap-break-word">{error}</p>
          </div>
        </div>
      )}

      {loading && records.length === 0 ? (
        <div className="rounded-2xl border border-emerald-200 bg-emerald-50/90 p-10 text-center text-sm text-emerald-800">
          Loading enrollment analytics...
        </div>
      ) : (
        <>
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-5">
            {kpis.map((card) => {
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
                    {typeof card.value === "number"
                      ? card.value.toLocaleString()
                      : card.value}
                  </p>

                  <p className="mt-2 text-xs text-emerald-800">{card.note}</p>
                </div>
              );
            })}
          </div>

          <div className="grid gap-5 xl:grid-cols-3">
            <section className="rounded-2xl border border-emerald-200 bg-emerald-50/90 p-5 sm:p-6 xl:col-span-2">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <h2 className="text-lg font-bold">Trending Clusters</h2>
                  <p className="mt-1 text-xs text-emerald-800">
                    Daily applications per cluster over the last {trendDays}{" "}
                    days.
                  </p>
                </div>

                <span className="rounded-full border border-emerald-300 bg-emerald-100 px-3 py-1 text-xs font-semibold text-emerald-800">
                  Top{" "}
                  {clusterTrend.keys.length -
                    (clusterTrend.otherKey ? 1 : 0)}{" "}
                  cluster
                  {clusterTrend.keys.length -
                    (clusterTrend.otherKey ? 1 : 0) ===
                  1
                    ? ""
                    : "s"}
                </span>
              </div>

              <div className="mt-5">
                <LineTrendChart points={trendPoints} series={trendSeries} />
              </div>
            </section>

            <section className="rounded-2xl border border-emerald-200 bg-emerald-50/90 p-5 sm:p-6">
              <h2 className="text-lg font-bold">Status Breakdown</h2>
              <p className="mt-1 text-xs text-emerald-800">
                Current processing state of applications in the selected range.
              </p>

              <div className="mt-6">
                <DonutChart
                  data={statusData}
                  centerValue={formatPercent(enrollmentRate)}
                  centerLabel="Enrolled"
                />
              </div>
            </section>
          </div>

          <div className="grid gap-5 lg:grid-cols-2 xl:grid-cols-3">
            <section className="rounded-2xl border border-emerald-200 bg-emerald-50/90 p-5 sm:p-6">
              <h2 className="text-lg font-bold">Cluster Demand</h2>
              <p className="mt-1 text-xs text-emerald-800">
                Most requested elective clusters.
              </p>

              <div className="mt-5">
                <BarList
                  data={clusters.data.map((item) => ({
                    label: item.name,
                    value: item.value,
                  }))}
                  total={clusters.total}
                  emptyLabel="No cluster selections yet"
                />
              </div>
            </section>

            <section className="rounded-2xl border border-emerald-200 bg-emerald-50/90 p-5 sm:p-6">
              <h2 className="text-lg font-bold">Track Distribution</h2>
              <p className="mt-1 text-xs text-emerald-800">
                Academic versus Technical Professional enrollment.
              </p>

              <div className="mt-5">
                <BarList data={trackData} total={total} />
              </div>
            </section>

            <section className="rounded-2xl border border-emerald-200 bg-emerald-50/90 p-5 sm:p-6">
              <h2 className="text-lg font-bold">Gender Distribution</h2>
              <p className="mt-1 text-xs text-emerald-800">
                Learner gender profile in the selected range.
              </p>

              <div className="mt-5">
                <DonutChart
                  data={genders.data}
                  centerValue={String(genders.total)}
                  centerLabel="Recorded"
                />
              </div>
            </section>

            <section className="rounded-2xl border border-emerald-200 bg-emerald-50/90 p-5 sm:p-6">
              <h2 className="text-lg font-bold">Age Distribution</h2>
              <p className="mt-1 text-xs text-emerald-800">
                Applicant age profile
                {ages.total > 0
                  ? ` · average ${ages.average} years`
                  : ""}
                {ages.unrecorded > 0
                  ? ` · ${ages.unrecorded} not recorded`
                  : ""}
                .
              </p>

              <div className="mt-5">
                <BarList
                  data={ages.data}
                  total={ages.total}
                  color="#94a3b8"
                  emptyLabel="No age data yet"
                />
              </div>
            </section>

            <section className="rounded-2xl border border-emerald-200 bg-emerald-50/90 p-5 sm:p-6 lg:col-span-2 xl:col-span-1">
              <div className="flex items-center gap-2">
                <MapPin size={16} className="text-emerald-700" />
                <h2 className="text-lg font-bold">Barangay &amp; Municipality</h2>
              </div>
              <p className="mt-1 text-xs text-emerald-800">
                Connected applicant location view by barangay and municipality.
              </p>

              <div className="mt-5">
                <BarList
                  data={barangayMunicipalities.data}
                  total={barangayMunicipalities.total}
                  color="#6ba8c7"
                  emptyLabel="No barangay or municipality data yet"
                />
              </div>
            </section>

            <section className="rounded-2xl border border-emerald-200 bg-emerald-50/90 p-5 sm:p-6">
              <h2 className="text-lg font-bold">College Course Preference</h2>
              <p className="mt-1 text-xs text-emerald-800">
                Courses learners want to pursue after senior high school.
              </p>

              <div className="mt-5">
                <BarList
                  data={courses.data}
                  total={courses.total}
                  color="#c8b27c"
                  emptyLabel="No college course data yet"
                />
              </div>
            </section>
          </div>

          <section className="rounded-2xl border border-emerald-200 bg-emerald-50/90 p-5 sm:p-6">
            <h2 className="text-lg font-bold">Requirements Completion</h2>
            <p className="mt-1 text-xs text-emerald-800">
              Applicants with at least one uploaded requirement.
            </p>

            <div className="mt-5 flex items-end justify-between gap-4">
              <div>
                <p className="text-3xl font-extrabold tabular-nums text-emerald-950">
                  {formatPercent(requirements.rate)}
                </p>
                <p className="text-xs text-emerald-800">
                  {requirements.complete} complete · {requirements.incomplete}{" "}
                  missing
                </p>
              </div>

              <span className="rounded-full border border-emerald-300 bg-emerald-100 px-3 py-1 text-xs font-semibold text-emerald-800">
                {requirements.complete} / {total}
              </span>
            </div>

            <div className="mt-4 h-3 w-full overflow-hidden rounded-full bg-emerald-200">
              <div
                className="h-full rounded-full bg-emerald-700 transition-all duration-500"
                style={{ width: `${Math.min(100, requirements.rate)}%` }}
              />
            </div>

            <div className="mt-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              {[
                {
                  label: "IP community",
                  value: flags.ip,
                },
                {
                  label: "4Ps beneficiary",
                  value: flags.fourPs,
                },
                {
                  label: "Special needs program",
                  value: flags.special,
                },
                {
                  label: "With PWD ID",
                  value: flags.pwd,
                },
              ].map((item) => (
                <div
                  key={item.label}
                  className="rounded-xl border border-emerald-200 bg-white/70 p-3"
                >
                  <p className="text-xs font-semibold text-emerald-700">
                    {item.label}
                  </p>
                  <p className="mt-1 text-xl font-bold tabular-nums text-emerald-950">
                    {item.value.toLocaleString()}
                  </p>
                </div>
              ))}
            </div>
          </section>

          <section className="rounded-2xl border border-emerald-200 bg-emerald-50/90 p-5 sm:p-6">
            <div className="flex items-start gap-3">
              <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-amber-300 bg-amber-100">
                <Lightbulb size={18} className="text-amber-700" />
              </div>

              <div>
                <p className="text-xs font-semibold uppercase tracking-[0.18em] text-amber-700">
                  Prescriptive Analytics
                </p>
                <h2 className="mt-1 text-lg font-bold">
                  Recommended Actions
                </h2>
                <p className="mt-1 text-xs text-emerald-800">
                  Data-driven recommendations based on the current enrollment
                  period, processing backlog, and section capacity.
                </p>
              </div>
            </div>

            {projection && (
              <div className="mt-5 rounded-xl border border-sky-200 bg-white/70 p-4">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div>
                    <p className="text-xs font-semibold uppercase tracking-wider text-sky-700">
                      Projected by deadline
                    </p>
                    <p className="mt-1 text-3xl font-extrabold tabular-nums text-emerald-950">
                      {projection.projected.toLocaleString()}
                    </p>
                    <p className="mt-1 text-xs text-emerald-800">
                      {projection.dailyRate.toFixed(1)} applications/day ·{" "}
                      {projection.remainingDays} day
                      {projection.remainingDays === 1 ? "" : "s"} remaining
                    </p>
                  </div>

                  <div className="text-right text-xs text-emerald-800">
                    <p>
                      Elapsed: {projection.elapsedDays} /{" "}
                      {projection.totalDays} days
                    </p>
                    <p>Applications so far: {records.length.toLocaleString()}</p>
                  </div>
                </div>
              </div>
            )}

            <div className="mt-5 grid gap-3 md:grid-cols-2">
              {insights.map((insight) => {
                const style = INSIGHT_STYLES[insight.tone];
                const Icon =
                  insight.tone === "good"
                    ? CheckCircle2
                    : insight.tone === "info"
                      ? Lightbulb
                      : AlertTriangle;

                return (
                  <article
                    key={insight.title}
                    className={`rounded-xl border p-4 ${style.container}`}
                  >
                    <div className="flex items-start gap-2.5">
                      <Icon
                        size={16}
                        className={`mt-0.5 shrink-0 ${style.icon}`}
                      />
                      <div>
                        <h3 className={`text-sm font-bold ${style.title}`}>
                          {insight.title}
                        </h3>
                        <p className="mt-1 text-xs leading-5 text-emerald-900">
                          {insight.detail}
                        </p>
                      </div>
                    </div>
                  </article>
                );
              })}
            </div>
          </section>
        </>
      )}
    </div>
  );
}
