"use client";

import Image from "next/image";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import type { ComponentType } from "react";
import {
  AlertCircle,
  BadgeCheck,
  CalendarDays,
  Check,
  ClipboardList,
  Clock3,
  Download,
  GraduationCap,
  IdCard,
  Lock,
  LogOut,
  Mail,
  MapPin,
  Phone,
  RefreshCw,
  School,
  UserRound,
  Users,
  XCircle,
} from "lucide-react";
import ConfirmDialog from "@/app/_components/ConfirmDialog";
import { normalizeEnrollmentStatus } from "@/lib/enrollmentStatus";
import { getTrackForCluster, getTrackLabel } from "@/lib/clusters";
import { supabase } from "@/lib/supabaseClient";

type Application = Record<string, unknown>;
type Section = Record<string, unknown>;
type StudentProfile = Record<string, unknown>;

type StudentDashboardViewProps = {
  userId: string;
  email: string;
  fullName: string;
  initialApplication: Application | null;
  initialSection: Section | null;
  initialStudentProfile: StudentProfile | null;
  fallbackTrack: string;
};

const statusSteps = ["pending", "enrolled"];

const statusLabels: Record<string, string> = {
  pending: "Pending Review",
  enrolled: "Enrolled",
  rejected: "Rejected",
};

const statusStyles: Record<string, string> = {
  pending: "border-amber-200 bg-amber-50 text-amber-700",
  enrolled: "border-emerald-200 bg-emerald-50 text-emerald-700",
  rejected: "border-red-200 bg-red-50 text-red-700",
};

function getText(record: Application | Section | null, keys: string[]) {
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

function normalizeStatus(value: string) {
  return normalizeEnrollmentStatus(value);
}

function formatDate(value: string) {
  if (!value) return "Not provided";

  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? value
    : date.toLocaleDateString("en-PH", {
      year: "numeric",
      month: "long",
      day: "numeric",
    });
}

function formatTrack(value: string) {
  const text = value.trim();
  if (!text) return "Not provided";

  const label = getTrackLabel(text);
  return label === "Senior High Track" ? text : label;
}

function InfoItem({
  icon: Icon,
  label,
  value,
}: {
  icon: ComponentType<{ size?: number; className?: string }>;
  label: string;
  value: string;
}) {
  return (
    <div className="flex gap-3 rounded-xl border border-emerald-200 bg-white/3 p-4">
      <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-amber-50 text-emerald-700">
        <Icon size={17} />
      </div>
      <div className="min-w-0">
        <p className="text-[10px] font-bold uppercase tracking-[0.14em] text-emerald-800">
          {label}
        </p>
        <p className="mt-1 wrap-break-word text-sm font-medium text-emerald-700">
          {value || "Not provided"}
        </p>
      </div>
    </div>
  );
}

export default function StudentDashboardView({
  userId,
  email,
  fullName,
  initialApplication,
  initialSection,
  initialStudentProfile,
  fallbackTrack,
}: StudentDashboardViewProps) {
  const router = useRouter();
  const [application, setApplication] = useState<Application | null>(
    initialApplication
  );
  const [section, setSection] = useState<Section | null>(initialSection);
  const [studentProfile, setStudentProfile] = useState<StudentProfile | null>(
    initialStudentProfile
  );
  const [refreshing, setRefreshing] = useState(false);
  const [showLogoutConfirm, setShowLogoutConfirm] = useState(false);
  const [error, setError] = useState("");
  const [slipError, setSlipError] = useState("");
  const [downloadingSlip, setDownloadingSlip] = useState(false);
  const [lastUpdated, setLastUpdated] = useState("");
  const [realtimeStatus, setRealtimeStatus] = useState<
    "connecting" | "live" | "error"
  >("connecting");
  const reloadTimerRef = useRef<number | null>(null);

  const loadData = useCallback(
    async (showSpinner = false) => {
      if (showSpinner) setRefreshing(true);
      setError("");

      try {
        const {
          data: { session },
        } = await supabase.auth.getSession();

        if (!session) {
          return;
        }

        const response = await fetch("/api/student/dashboard", {
          cache: "no-store",
        });

        if (!response.ok) {
          const payload = (await response.json().catch(() => null)) as
            | { error?: string }
            | null;

          throw new Error(
            payload?.error || "Unable to refresh your enrollment details."
          );
        }

        const payload = (await response.json()) as {
          data?: {
            application?: Application | null;
            section?: Section | null;
            studentProfile?: StudentProfile | null;
          };
        };

        setApplication(payload.data?.application ?? null);
        setSection(payload.data?.section ?? null);
        setStudentProfile(payload.data?.studentProfile ?? null);

        setLastUpdated(
          new Date().toLocaleTimeString("en-PH", {
            hour: "2-digit",
            minute: "2-digit",
          })
        );
      } catch (loadError) {
        setError(
          loadError instanceof Error
            ? loadError.message
            : "Unable to refresh your enrollment details."
        );
      } finally {
        setRefreshing(false);
      }
    },
    []
  );

  const scheduleReload = useCallback(() => {
    if (typeof window === "undefined") return;

    if (reloadTimerRef.current) {
      window.clearTimeout(reloadTimerRef.current);
    }

    reloadTimerRef.current = window.setTimeout(() => {
      reloadTimerRef.current = null;
      void loadData();
    }, 300);
  }, [loadData]);

  const applicationId = getText(application, ["id"]);
  const sectionId = getText(section, ["id"]);

  useEffect(() => {
    let active = true;
    let retryTimeout: number | undefined;
    let channel: ReturnType<typeof supabase.channel> | null = null;

    const connect = () => {
      if (!active) return;

      setRealtimeStatus("connecting");

      const channelName = [
        "student-dashboard",
        userId,
        applicationId || "unlinked",
        sectionId || "no-section",
        Date.now(),
      ].join("-");

      channel = supabase.channel(channelName);

      if (applicationId) {
        channel.on(
          "postgres_changes",
          {
            event: "UPDATE",
            schema: "public",
            table: "student_applications",
            filter: `id=eq.${applicationId}`,
          },
          scheduleReload
        );
      } else {
        channel.on(
          "postgres_changes",
          {
            event: "*",
            schema: "public",
            table: "student_applications",
            filter: `user_id=eq.${userId}`,
          },
          scheduleReload
        );
      }

      if (sectionId) {
        channel.on(
          "postgres_changes",
          {
            event: "UPDATE",
            schema: "public",
            table: "sections",
            filter: `id=eq.${sectionId}`,
          },
          scheduleReload
        );
      }

      channel.subscribe((status) => {
        if (!active) return;

        if (status === "SUBSCRIBED") {
          setRealtimeStatus("live");
          void loadData();
          return;
        }

        if (
          status === "CHANNEL_ERROR" ||
          status === "TIMED_OUT" ||
          status === "CLOSED"
        ) {
          setRealtimeStatus("error");

          if (status !== "CLOSED" && !retryTimeout) {
            retryTimeout = window.setTimeout(() => {
              retryTimeout = undefined;

              if (channel) {
                supabase.removeChannel(channel);
                channel = null;
              }

              connect();
            }, 3000);
          }
        }
      });
    };

    connect();

    const interval = window.setInterval(() => {
      void loadData();
    }, 60000);

    const handleFocus = () => {
      void loadData();
    };

    const handleVisibility = () => {
      if (document.visibilityState === "visible") {
        void loadData();
      }
    };

    window.addEventListener("focus", handleFocus);
    document.addEventListener("visibilitychange", handleVisibility);

    return () => {
      active = false;

      if (retryTimeout) {
        window.clearTimeout(retryTimeout);
      }

      if (reloadTimerRef.current) {
        window.clearTimeout(reloadTimerRef.current);
        reloadTimerRef.current = null;
      }

      window.clearInterval(interval);
      window.removeEventListener("focus", handleFocus);
      document.removeEventListener("visibilitychange", handleVisibility);

      if (channel) {
        supabase.removeChannel(channel);
      }
    };
  }, [applicationId, loadData, scheduleReload, sectionId, userId]);

  async function handleLogout() {
    try {
      const { data: sessionData } = await supabase.auth.getSession();
      const token = sessionData.session?.access_token;

      await fetch("/api/auth/activity", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        credentials: "include",
        body: JSON.stringify({ event: "signout" }),
      }).catch(() => null);
    } catch {
      // Ignore background log error
    }

    await supabase.auth.signOut();
    router.replace("/login");
    router.refresh();
  }

  const status = normalizeStatus(
    getText(application, ["status", "application_status", "enrollment_status"]) ||
    getText(studentProfile, ["status"])
  );
  const statusLabel = statusLabels[status] ?? status.replace(/_/g, " ");
  const statusStyle =
    statusStyles[status] ??
    "border-emerald-200 bg-amber-50 text-emerald-700";
  const activeStep = statusSteps.indexOf(status);
  const studentName =
    getText(application, ["full_name", "student_name"]) || fullName;
  const firstName = studentName.split(" ")[0] || "Student";
  const details = application?.student_details;
  const studentDetails =
    details && typeof details === "object" && !Array.isArray(details)
      ? (details as Application)
      : null;
  const cluster =
    getText(application, ["selected_cluster", "cluster", "cluster_name"]) ||
    getText(studentDetails, ["selected_cluster", "cluster"]) ||
    getText(section, ["cluster", "strand"]);
  const track =
    getText(application, ["track", "selected_track"]) ||
    getText(studentDetails, ["selected_track", "track"]) ||
    fallbackTrack ||
    getTrackForCluster(cluster) ||
    getText(section, ["track"]) ||
    getTrackForCluster(getText(section, ["strand", "cluster"])) ||
    "";
  const sectionName = getText(section, ["name", "section_name"]);
  const adviserName = getText(section, ["adviser_name", "adviser"]);
  const contact = getText(application, ["contact_number", "phone", "mobile"]);
  const address =
    getText(application, ["address"]) ||
    [
      getText(application, ["current_house_no"]),
      getText(application, ["current_street"]),
      getText(application, ["current_barangay"]),
      getText(application, ["current_municipality"]),
      getText(application, ["current_province"]),
    ]
      .filter(Boolean)
      .join(", ");
  const submittedAt = getText(application, [
    "submitted_at",
    "created_at",
    "application_date",
  ]);
  const applicationNumber = getText(application, ["id"]);
  const remarks = getText(application, ["registrar_remarks"]);

  const profileStatus =
    getText(studentProfile, ["status"]) || statusLabel;
  const profileStatusLabel =
    statusLabels[normalizeStatus(profileStatus)] ?? profileStatus;
  const profileName =
    getText(studentProfile, ["full_name"]) || studentName;
  const profileTrack =
    getText(studentProfile, ["track"]) || formatTrack(track);
  const profileCluster =
    getText(studentProfile, ["selected_cluster"]) || cluster;
  const profileEmail = getText(studentProfile, ["email"]) || email;
  const profileContact =
    getText(studentProfile, ["contact_number"]) || contact;
  const profileBirthDate =
    getText(studentProfile, ["birth_date"]) ||
    getText(application, ["birth_date"]);
  const profileAddress = getText(studentProfile, ["address"]) || address;
  const profileSection =
    getText(studentProfile, ["assigned_section"]) || sectionName;
  const profileAdviser =
    getText(studentProfile, ["adviser"]) || adviserName;
  const canDownloadSlip = status === "enrolled";

  async function handleDownloadSlip() {
    if (!canDownloadSlip || downloadingSlip) return;

    setDownloadingSlip(true);
    setSlipError("");

    try {
      const response = await fetch("/api/student/enrollment-slip", {
        cache: "no-store",
      });

      if (!response.ok) {
        const payload = (await response.json().catch(() => null)) as
          | { error?: string }
          | null;

        throw new Error(
          payload?.error || "Unable to download your enrollment slip."
        );
      }

      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      const safeName =
        studentName
          .replace(/[^a-zA-Z0-9]+/g, "-")
          .replace(/^-+|-+$/g, "") || "Student";

      link.href = url;
      link.download = `${safeName}-Enrollment-Slip.pdf`;
      document.body.appendChild(link);
      link.click();
      link.remove();
      window.setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (downloadError) {
      setSlipError(
        downloadError instanceof Error
          ? downloadError.message
          : "Unable to download your enrollment slip."
      );
    } finally {
      setDownloadingSlip(false);
    }
  }

  return (
    <div className="min-h-screen bg-[#eaf5ec] text-[#06281b]">
      <header className="border-b border-[#c3e2cd] bg-[#d7eedd]/95">
        <div className="mx-auto flex max-w-6xl items-center justify-between gap-4 px-4 py-4 sm:px-6">
          <div className="flex min-w-0 items-center gap-3">
            <div className="relative flex h-11 w-11 shrink-0 items-center justify-center overflow-hidden rounded-full border border-emerald-200">
              <Image
                src="/school-logo-trimmed.png"
                alt="AASMNHS logo"
                width={44}
                height={44}
                className="h-full w-full object-cover"
              />
            </div>
            <div className="min-w-0">
              <p className="truncate text-sm font-extrabold tracking-wide">
                AASMNHS
              </p>
              <p className="truncate text-[10px] text-emerald-700">
                Student Enrollment Portal
              </p>
            </div>
          </div>

          <div className="flex items-center gap-3">
            <div className="hidden text-right sm:block">
              <p className="max-w-55 truncate text-xs font-semibold">
                {studentName}
              </p>
              <p className="text-[10px] text-emerald-800">{email}</p>
            </div>
            <button
              onClick={() => setShowLogoutConfirm(true)}
              className="flex items-center gap-2 rounded-lg border border-emerald-200 px-3 py-2 text-xs font-semibold text-rose-600 transition hover:bg-red-400/10"
            >
              <LogOut size={15} />
              <span className="hidden sm:inline">Log out</span>
            </button>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-6xl px-4 py-8 sm:px-6 lg:py-10">
        <div className="mb-7 flex flex-col justify-between gap-4 sm:flex-row sm:items-end">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.18em] text-emerald-700">
              Student Dashboard
            </p>
            <h1 className="mt-2 text-2xl font-extrabold tracking-tight sm:text-3xl">
              Welcome, {firstName}
            </h1>
            <p className="mt-2 max-w-2xl text-sm text-emerald-900">
              View your enrollment status, assigned section, and submitted
              information.
            </p>
          </div>
          <div className="flex items-center gap-3">
            <span className="hidden items-center gap-1.5 text-[11px] text-emerald-800 sm:inline-flex">
              <span
                className={`h-1.5 w-1.5 rounded-full ${realtimeStatus === "live"
                    ? "bg-emerald-400"
                    : realtimeStatus === "error"
                      ? "bg-red-400"
                      : "bg-amber-300"
                  }`}
              />
              {realtimeStatus === "live"
                ? "Live"
                : realtimeStatus === "error"
                  ? "Reconnecting"
                  : "Connecting"}
            </span>
            {lastUpdated && (
              <span className="hidden text-[11px] text-emerald-800 sm:inline">
                Updated {lastUpdated}
              </span>
            )}
            <button
              onClick={() => loadData(true)}
              disabled={refreshing}
              className="flex items-center gap-2 rounded-lg border border-emerald-200 bg-amber-50 px-3 py-2 text-xs font-semibold text-emerald-700 transition hover:bg-amber-50 disabled:opacity-60"
            >
              <RefreshCw
                size={15}
                className={refreshing ? "animate-spin" : ""}
              />
              Refresh
            </button>
          </div>
        </div>

        {error && (
          <div className="mb-5 flex items-start gap-2 rounded-xl border border-red-200 bg-red-400/10 p-4 text-sm text-red-700">
            <AlertCircle size={18} className="mt-0.5 shrink-0" />
            <span>{error}</span>
          </div>
        )}

        {realtimeStatus === "error" && (
          <div className="mb-5 flex items-start gap-2 rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-700">
            <AlertCircle size={18} className="mt-0.5 shrink-0" />
            <span>
              Live updates are reconnecting. Your dashboard will refresh
              automatically.
            </span>
          </div>
        )}

        {!application ? (
          <div className="rounded-2xl border border-emerald-200 bg-emerald-50/80 p-8 text-center">
            <ClipboardList
              size={38}
              className="mx-auto text-emerald-700"
            />
            <h2 className="mt-4 text-lg font-bold">No enrollment record yet</h2>
            <p className="mx-auto mt-2 max-w-md text-sm text-emerald-900">
              We could not find an application linked to this account. Please
              complete the enrollment form or contact the school registrar.
            </p>
          </div>
        ) : (
          <div className="space-y-5">
            <section className="overflow-hidden rounded-2xl border border-emerald-200 bg-emerald-50/80">
              <div className="flex flex-col justify-between gap-4 border-b border-emerald-200 p-5 sm:flex-row sm:items-center sm:p-6">
                <div>
                  <p className="text-[10px] font-bold uppercase tracking-[0.16em] text-emerald-800">
                    Current Enrollment Status
                  </p>
                  <div className="mt-2 flex flex-wrap items-center gap-3">
                    <span
                      className={`inline-flex items-center gap-2 rounded-full border px-3 py-1.5 text-xs font-bold uppercase tracking-wide ${statusStyle}`}
                    >
                      {status === "rejected" ? (
                        <XCircle size={14} />
                      ) : status === "enrolled" ? (
                        <BadgeCheck size={14} />
                      ) : (
                        <Clock3 size={14} />
                      )}
                      {statusLabel}
                    </span>
                    <span className="text-xs text-emerald-800">
                      Submitted {formatDate(submittedAt)}
                    </span>
                  </div>
                </div>
                <div className="flex flex-col items-stretch gap-3 sm:items-end">
                  <div className="rounded-xl border border-emerald-200 bg-white/3 px-4 py-3">
                    <p className="text-[10px] font-bold uppercase tracking-[0.14em] text-emerald-800">
                      Application No.
                    </p>
                    <p className="mt-1 font-mono text-xs text-emerald-700">
                      {applicationNumber
                        ? applicationNumber.slice(0, 8).toUpperCase()
                        : "Not available"}
                    </p>
                  </div>

                  <button
                    type="button"
                    onClick={handleDownloadSlip}
                    disabled={!canDownloadSlip || downloadingSlip}
                    title={
                      canDownloadSlip
                        ? "Download your enrollment slip as a PDF"
                        : "Available once your application is approved or enrolled"
                    }
                    className="inline-flex items-center justify-center gap-2 rounded-lg bg-yellow-300 px-4 py-2.5 text-xs font-bold text-emerald-950 transition hover:bg-yellow-300 disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    {canDownloadSlip ? (
                      <Download size={15} />
                    ) : (
                      <Lock size={15} />
                    )}
                    {downloadingSlip
                      ? "Preparing slip..."
                      : "Download Enrollment Slip"}
                  </button>

                  {!canDownloadSlip && (
                    <p className="max-w-52 text-[10px] leading-4 text-emerald-800 sm:text-right">
                      Unlocks once your application is approved or enrolled.
                    </p>
                  )}

                  {slipError && (
                    <p className="max-w-58 text-[10px] leading-4 text-red-600 sm:text-right">
                      {slipError}
                    </p>
                  )}
                </div>
              </div>

              {status === "rejected" ? (
                <div className="flex items-start gap-3 bg-red-400/10 p-5 text-sm text-red-700 sm:p-6">
                  <XCircle size={20} className="mt-0.5 shrink-0" />
                  <div>
                    <p className="font-bold">Application needs attention</p>
                    <p className="mt-1 text-red-700/80">
                      {remarks ||
                        "Please contact the school registrar for more information."}
                    </p>
                  </div>
                </div>
              ) : (
                <div className="grid gap-3 p-5 sm:grid-cols-2 sm:p-6">
                  {statusSteps.map((step, index) => {
                    const complete = activeStep >= index;
                    const current = activeStep === index;

                    return (
                      <div
                        key={step}
                        className={`rounded-xl border p-3 ${complete
                            ? "border-emerald-200 bg-amber-50"
                            : "border-emerald-200 bg-white/2"
                          }`}
                      >
                        <div className="flex items-center gap-2">
                          <span
                            className={`flex h-6 w-6 items-center justify-center rounded-full text-[11px] font-bold ${complete
                                ? "bg-yellow-300 text-emerald-950"
                                : "bg-emerald-50 text-emerald-800"
                              }`}
                          >
                            {complete ? <Check size={13} /> : index + 1}
                          </span>
                          <p
                            className={`text-xs font-semibold ${current ? "text-emerald-700" : "text-emerald-900"
                              }`}
                          >
                            {statusLabels[step]}
                          </p>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}

              {remarks && status !== "rejected" && (
                <div className="border-t border-emerald-200 px-5 py-4 text-sm text-emerald-700 sm:px-6">
                  <span className="font-semibold">Registrar remarks: </span>
                  {remarks}
                </div>
              )}
            </section>

            <section className="rounded-2xl border border-emerald-200 bg-emerald-50/80 p-5">
              <div className="mb-4 flex items-center gap-2">
                <UserRound size={18} className="text-emerald-700" />
                <h2 className="text-sm font-bold uppercase tracking-[0.12em]">
                  Student Profile
                </h2>
              </div>
              <div className="grid gap-3 sm:grid-cols-2">
                <InfoItem
                  icon={BadgeCheck}
                  label="Status"
                  value={profileStatusLabel}
                />
                <InfoItem
                  icon={IdCard}
                  label="Full Name"
                  value={profileName}
                />
                <InfoItem
                  icon={GraduationCap}
                  label="Senior High Track"
                  value={profileTrack || "Not provided"}
                />
                <InfoItem
                  icon={ClipboardList}
                  label="Selected Cluster"
                  value={profileCluster || "Not provided"}
                />
                <InfoItem
                  icon={Mail}
                  label="Email Address"
                  value={profileEmail}
                />
                <InfoItem
                  icon={Phone}
                  label="Contact Number"
                  value={profileContact}
                />
                <InfoItem
                  icon={CalendarDays}
                  label="Date of Birth"
                  value={formatDate(profileBirthDate)}
                />
                <InfoItem
                  icon={MapPin}
                  label="Address"
                  value={profileAddress}
                />
                <InfoItem
                  icon={School}
                  label="Assigned Section"
                  value={profileSection || "Not yet assigned"}
                />
                <InfoItem
                  icon={Users}
                  label="Adviser"
                  value={profileAdviser || "To be announced"}
                />
              </div>
            </section>
          </div>
        )}
      </main>

      <ConfirmDialog
        open={showLogoutConfirm}
        title="Log out?"
        message="Are you sure you want to log out of your account?"
        confirmLabel="Log out"
        onConfirm={() => {
          setShowLogoutConfirm(false);
          handleLogout();
        }}
        onCancel={() => setShowLogoutConfirm(false)}
      />
    </div>
  );
}
