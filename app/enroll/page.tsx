"use client";

import Image from "next/image";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import EnrollmentProgress from "@/app/_components/EnrollmentProgress";
import { getClustersForTrack, getTrackConfig } from "@/lib/clusters";
import {
  evaluateEnrollmentAvailability,
  formatManilaDate,
  type EnrollmentSettings,
} from "@/lib/enrollmentSettings";

export default function EnrollPage() {
  const router = useRouter();
  const [selectedTrack, setSelectedTrack] = useState<string | null>(null);
  const [settingsLoading, setSettingsLoading] = useState(true);
  const [settings, setSettings] = useState<EnrollmentSettings | null>(null);
  const [nowTick, setNowTick] = useState(() => Date.now());

  useEffect(() => {
    async function checkEnrollmentWindow() {
      try {
        const res = await fetch("/api/enrollment-status", {
          cache: "no-store",
        });
        const data = await res.json().catch(() => null);
        setSettings((data?.settings as EnrollmentSettings | null) ?? null);
      } catch (err) {
        console.warn("Could not check enrollment settings:", err);
        setSettings(null);
      } finally {
        setSettingsLoading(false);
      }
    }
    checkEnrollmentWindow();
  }, []);

  // Re-evaluate automatically so the page transitions at the configured
  // start/end moment without requiring a manual reload.
  useEffect(() => {
    const timer = setInterval(() => setNowTick(Date.now()), 30_000);
    return () => clearInterval(timer);
  }, []);

  const availability = useMemo(
    () => evaluateEnrollmentAvailability(settings, new Date(nowTick)),
    [settings, nowTick]
  );

  const enrollmentOpen = availability.isOpen;

  const handleContinue = () => {
    if (!selectedTrack || !enrollmentOpen) return;

    // Starting a new enrollment: discard any state left by a previous applicant
    // on this browser so an old application ID/email cannot leak into this one.
    const staleKeys = [
      "applicationId",
      "enrollmentId",
      "studentApplicationDraft",
      "studentPassword",
      "studentAccountEmailPending",
      "studentEmail",
      "studentFirstName",
      "studentLastName",
      "studentName",
      "studentContactNumber",
      "studentTrack",
      "studentCluster",
      "studentRequirements",
      "emailMessage",
    ];

    staleKeys.forEach((key) => localStorage.removeItem(key));

    router.push(`/enroll/cluster?track=${selectedTrack}`);
  };

  return (
    <main className="relative min-h-screen overflow-hidden bg-[#0b3d2e] text-emerald-50">
      {/* Background School Image */}
      <div
        className="fixed inset-0 bg-cover bg-center opacity-40 brightness-75 pointer-events-none"
        style={{
          backgroundImage: "url('/school.jpg')",
        }}
      />

      {/* Dark Green Gradient Overlay with Khaki Ambient Tints */}
      <div className="fixed inset-0 bg-linear-to-b from-[#0b3d2e]/75 via-[#0b3d2e]/60 to-[#052e1c]/85 pointer-events-none" />

      {/* Ambient Glows */}
      <div className="pointer-events-none fixed -top-40 left-1/2 h-96 w-180 -translate-x-1/2 rounded-full bg-yellow-400/10 blur-3xl" />
      <div className="pointer-events-none fixed bottom-10 -right-20 h-96 w-96 rounded-full bg-emerald-600/20 blur-3xl" />

      {/* Page Content */}
      <div className="relative z-10 flex min-h-screen flex-col">

        {/* Header */}
        <header className="sticky top-0 z-50 w-full border-b border-emerald-800/70 bg-[#0b3d2e]/75 backdrop-blur-md">
          <div className="mx-auto flex max-w-6xl items-center justify-between px-6 py-4">
            {/* School Logo & Title */}
            <div className="flex items-center gap-3.5">
              <div className="relative flex h-11 w-11 items-center justify-center overflow-hidden rounded-full shadow-md ring-2 ring-yellow-400/60 ring-offset-2 ring-offset-[#0b3d2e]">
                <Image
                  src="/school-logo-trimmed.png"
                  alt="AASMNHS School Logo"
                  width={44}
                  height={44}
                  className="h-full w-full object-cover"
                  priority
                />
              </div>

              <div>
                <p className="text-base font-bold tracking-wide text-white">
                  AASMNHS
                </p>
                <p className="text-xs font-medium text-emerald-200">
                  Online Enrollment System
                </p>
              </div>
            </div>
          </div>
        </header>

        <EnrollmentProgress activeStep={1} />

        {/* Main Content Area */}
        <section className="mx-auto w-full max-w-5xl flex-1 px-6 py-10 sm:py-12">
          <div className="text-center">
            {/* Status Pill Badge */}
            <div className="mb-6 inline-flex items-center gap-2.5 rounded-full border border-emerald-200 bg-emerald-50/80 px-4 py-1.5 text-xs font-semibold uppercase tracking-wider text-emerald-700 backdrop-blur-md shadow-lg shadow-black/20">
              <span className="relative flex h-2 w-2">
                <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-yellow-300 opacity-75"></span>
                <span className="relative inline-flex h-2 w-2 rounded-full bg-yellow-300"></span>
              </span>
              Grade 11 Online Enrollment • S.Y. 2026–2027
            </div>

            {/* School Name */}
            <h1 className="text-3xl font-extrabold leading-tight tracking-tight text-white drop-shadow-lg sm:text-4xl md:text-5xl lg:text-6xl">
              Anselmo A. Sandoval Memorial
              <span className="mt-1 block bg-linear-to-r from-yellow-300 via-yellow-400 to-emerald-300 bg-clip-text text-transparent">
                National High School
              </span>
            </h1>

            {/* Portal Subtitle */}
            <div className="mt-4 flex items-center justify-center gap-3">
              <span className="h-px w-10 bg-linear-to-r from-transparent to-yellow-300/70 sm:w-16" />
              <h2 className="text-lg font-semibold tracking-wide text-emerald-100 sm:text-xl md:text-2xl">
                Online Enrollment System
              </h2>
              <span className="h-px w-10 bg-linear-to-l from-transparent to-yellow-300/70 sm:w-16" />
            </div>

            {/* Step 1 Heading Box */}
            <div className="mt-8 rounded-xl border border-emerald-200 bg-emerald-50/70 p-5 backdrop-blur-md shadow-lg">
              <h3 className="text-xl font-bold text-emerald-700 sm:text-2xl">
                Step 1: Choose Your Senior High Track
              </h3>
              <p className="mx-auto mt-2 max-w-2xl text-sm leading-relaxed text-emerald-700/90 sm:text-base">
                Select the Senior High School track that best matches your
                interests, skills, and future career path. You will choose a
                specific cluster on the next step.
              </p>
            </div>

            {/* Enrollment Period Notice */}
            {!enrollmentOpen && !settingsLoading && (
              <div
                className={`mt-6 rounded-xl border p-4 text-xs shadow-lg text-left ${availability.reason === "not_started" ||
                  availability.reason === "not_configured"
                  ? "border-amber-200 bg-amber-50 text-amber-700"
                  : "border-red-200 bg-red-50 text-red-700"
                  }`}
                role="status"
              >
                <div className="flex items-start gap-3">
                  <span className="text-xl">⚠️</span>
                  <div>
                    <p
                      className={`text-sm font-bold ${availability.reason === "not_started" ||
                        availability.reason === "not_configured"
                        ? "text-amber-700"
                        : "text-red-700"
                        }`}
                    >
                      {availability.reason === "not_started"
                        ? "Enrollment Has Not Started Yet"
                        : availability.reason === "ended"
                          ? "Enrollment Is Now Closed"
                          : "Enrollment Is Currently Unavailable"}
                    </p>
                    <p className="mt-1 leading-relaxed">{availability.message}</p>
                    {availability.startDate && availability.endDate && (
                      <p className="mt-2 leading-relaxed">
                        Official Enrollment Period:{" "}
                        <strong className="text-emerald-950">
                          {formatManilaDate(availability.startDate)} to{" "}
                          {formatManilaDate(availability.endDate)}
                        </strong>{" "}
                      </p>
                    )}
                    <p className="mt-2 leading-relaxed">
                      Existing students can still use the{" "}
                      <a href="/login" className="font-semibold underline">
                        Student Sign In
                      </a>
                      .
                    </p>
                  </div>
                </div>
              </div>
            )}
          </div>

          {/* Track Selection Cards */}
          <div className="mt-10 grid gap-6 md:grid-cols-2">

            {/* Academic Track */}
            <button
              type="button"
              onClick={() => setSelectedTrack("academic")}
              className={`group relative rounded-2xl border p-7 text-left backdrop-blur-md transition-all duration-300 hover:-translate-y-1 shadow-lg shadow-black/25 ${selectedTrack === "academic"
                ? "border-emerald-200 ring-2 ring-amber-200 bg-emerald-50/95 shadow-[0_0_30px_rgba(200,178,124,0.3)]"
                : "border-emerald-200 bg-emerald-50/70 hover:border-emerald-200 hover:bg-emerald-50/85"
                }`}
            >
              <div className="flex items-start justify-between">
                {selectedTrack === "academic" ? (
                  <div className="flex h-7 w-7 items-center justify-center rounded-full bg-linear-to-r from-yellow-300 to-yellow-300 text-sm font-black text-emerald-950 shadow-md">
                    ✓
                  </div>
                ) : (
                  <div className="flex h-7 w-7 items-center justify-center rounded-full border border-emerald-200 text-xs text-transparent group-hover:border-emerald-200">
                    ○
                  </div>
                )}
              </div>

              <h2 className="mt-6 text-2xl font-bold text-emerald-700">
                Academic Track
              </h2>

              <p className="mt-3 text-sm sm:text-base leading-relaxed text-emerald-700">
                Choose academic-focused elective clusters aligned with your
                interests and future college degree or career goals.
              </p>

              {/* Academic Sub-clusters */}
              <div className="mt-6 grid gap-2.5 sm:grid-cols-2">
                {getClustersForTrack("academic").map((cluster) => (
                  <div
                    key={cluster}
                    className="rounded-xl border border-emerald-200 bg-white/60 px-4 py-3 transition-colors group-hover:border-emerald-200"
                  >
                    <p className="text-xs font-semibold leading-snug text-emerald-700 sm:text-sm">
                      {cluster}
                    </p>
                  </div>
                ))}
              </div>
            </button>

            {/* TechPro Track */}
            <button
              type="button"
              onClick={() => setSelectedTrack("techpro")}
              className={`group relative rounded-2xl border p-7 text-left backdrop-blur-md transition-all duration-300 hover:-translate-y-1 shadow-lg shadow-black/25 ${selectedTrack === "techpro"
                ? "border-emerald-200 ring-2 ring-amber-200 bg-emerald-50/95 shadow-[0_0_30px_rgba(200,178,124,0.3)]"
                : "border-emerald-200 bg-emerald-50/70 hover:border-emerald-200 hover:bg-emerald-50/85"
                }`}
            >
              <div className="flex items-start justify-between">

                {selectedTrack === "techpro" ? (
                  <div className="flex h-7 w-7 items-center justify-center rounded-full bg-linear-to-r from-yellow-300 to-yellow-300 text-sm font-black text-emerald-950 shadow-md">
                    ✓
                  </div>
                ) : (
                  <div className="flex h-7 w-7 items-center justify-center rounded-full border border-emerald-200 text-xs text-transparent group-hover:border-emerald-200">
                    ○
                  </div>
                )}
              </div>

              <h2 className="mt-6 text-2xl font-bold text-emerald-700">
                {getTrackConfig("techpro")?.label ?? "Technical Professional Track"}
              </h2>

              <p className="mt-3 text-sm sm:text-base leading-relaxed text-emerald-700">
                {getTrackConfig("techpro")?.description ??
                  "Choose technology and skills-oriented elective clusters that support practical competencies and immediate career preparation."}
              </p>

              {/* TechPro Sub-clusters */}
              <div className="mt-6 grid gap-2.5 sm:grid-cols-2">
                {getClustersForTrack("techpro").map((cluster) => (
                  <div
                    key={cluster}
                    className="rounded-xl border border-emerald-200 bg-white/60 px-4 py-3 transition-colors group-hover:border-emerald-200"
                  >
                    <p className="text-xs font-semibold leading-snug text-emerald-700 sm:text-sm">
                      {cluster}
                    </p>
                  </div>
                ))}
              </div>
            </button>
          </div>

          {/* Selection Notice Message Box */}
          <div className="mt-8 rounded-xl border border-emerald-200 bg-emerald-50/80 px-5 py-4 backdrop-blur-sm shadow-md">
            <div className="flex items-start gap-3">
              <span className="text-lg">💡</span>
              <p className="text-sm leading-6 text-emerald-700">
                <span className="font-bold text-emerald-700">Important:</span>{" "}
                Choose the elective cluster that best matches your interests and
                career goals. Your selection will be confirmed during document verification.
              </p>
            </div>
          </div>

          {/* Navigation Controls */}
          <div className="mt-8 flex flex-col-reverse gap-3 border-t border-emerald-200 pt-6 sm:flex-row sm:items-center sm:justify-between">
            <Link
              href="/"
              className="w-full rounded-lg border border-emerald-200 bg-white/80 px-6 py-3 text-center text-sm font-semibold text-emerald-700 backdrop-blur-sm transition hover:border-emerald-200 hover:bg-amber-50 sm:w-auto"
            >
              Back to Home
            </Link>

            <button
              type="button"
              onClick={handleContinue}
              disabled={!selectedTrack || !enrollmentOpen}
              className={`w-full rounded-lg px-8 py-3 text-sm font-bold transition-all duration-300 sm:w-auto ${selectedTrack && enrollmentOpen
                ? "bg-linear-to-r from-yellow-300 via-yellow-300 to-yellow-300 text-emerald-950 shadow-lg shadow-black/30 hover:scale-[1.02] hover:shadow-[0_0_20px_rgba(200,178,124,0.45)] cursor-pointer"
                : "cursor-not-allowed border border-emerald-200 bg-white/60 text-emerald-700"
                }`}
            >
              {enrollmentOpen
                ? "Continue to Cluster Selection"
                : availability.reason === "not_started"
                  ? "Enrollment Has Not Started Yet"
                  : "Enrollment Currently Closed"}
            </button>
          </div>
        </section>

        {/* Footer */}
        <footer className="border-t border-emerald-800/70 bg-[#0b3d2e]/60 px-6 py-5 backdrop-blur-sm">
          <div className="mx-auto flex max-w-6xl flex-col items-center justify-between gap-2 text-center sm:flex-row sm:text-left">
            <p className="text-xs text-emerald-200 sm:text-sm">
              © {new Date().getFullYear()} Anselmo A. Sandoval Memorial National High School
            </p>
            <p className="text-xs text-emerald-300">
              Mabini, Batangas • DepEd Region IV-A CALABARZON
            </p>
          </div>
        </footer>
      </div>
    </main>
  );
}