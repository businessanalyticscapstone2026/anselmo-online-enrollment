"use client";

import Image from "next/image";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Check } from "lucide-react";
import {
  Suspense,
  useEffect,
  useState,
  useSyncExternalStore,
} from "react";
import EnrollmentProgress from "@/app/_components/EnrollmentProgress";
import {
  getClustersForTrack,
  getTrackConfig,
  isValidClusterForTrack,
} from "@/lib/clusters";

const emptySubscribe = () => () => { };

const CLUSTER_BACKGROUNDS: Record<string, string> = {
  STEM: "/stem.png",
  "Business & Entrepreneurship": "/business%20and%20entreprenuership.png",
  "Arts, Social Sciences & Humanities": "/art,%20social%20sciences%20%26%20humanities.png",
  "Sports, Health & Wellness": "/sports,%20health%20%26%20wellness.png",
  "Construction & Building Technology": "/construction%20%26%20building%20technology.png",
  "Industrial Technology": "/industrial%20technology.png",
  "Hospitality & Tourism": "/hospitality%20%26%20tourism.png",
  "ICT Support": "/ict%20support.png",
};

const CLUSTER_BACKGROUND_POSITIONS: Record<string, string> = {
  STEM: "center 35%",
  "Business & Entrepreneurship": "center 45%",
  "Arts, Social Sciences & Humanities": "center 55%",
  "Sports, Health & Wellness": "center 40%",
  "Construction & Building Technology": "center 50%",
  "Industrial Technology": "center 35%",
  "Hospitality & Tourism": "center 45%",
  "ICT Support": "center 55%",
};

const DEFAULT_CLUSTER_BACKGROUND = "/school-background.png";

function ClusterContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const trackValue = searchParams.get("track");
  const track = getTrackConfig(trackValue);
  const clusters = getClustersForTrack(trackValue);

  const [selectedCluster, setSelectedCluster] = useState<string | null>(null);
  const storedCluster = useSyncExternalStore(
    emptySubscribe,
    () => {
      if (typeof window === "undefined") return null;

      const value = localStorage.getItem("studentCluster");
      return value && isValidClusterForTrack(trackValue ?? "", value)
        ? value
        : null;
    },
    () => null
  );
  const activeCluster = selectedCluster ?? storedCluster;

  useEffect(() => {
    if (!track) {
      router.replace("/enroll");
      return;
    }

    const value = localStorage.getItem("studentCluster");
    if (value && !isValidClusterForTrack(track.value, value)) {
      localStorage.removeItem("studentCluster");
    }
  }, [track, router]);

  const handleContinue = () => {
    if (!track || !activeCluster) return;

    localStorage.setItem("studentTrack", track.value);
    localStorage.setItem("studentCluster", activeCluster);

    router.push(
      `/form?track=${track.value}&cluster=${encodeURIComponent(activeCluster)}`
    );
  };

  if (!track) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-[#0b3d2e] text-emerald-50">
        <div className="text-center animate-fade-in-up">
          <div className="mx-auto h-8 w-8 animate-spin rounded-full border-2 border-emerald-700 border-t-yellow-400" />
          <p className="mt-3 text-sm font-semibold">Loading cluster options...</p>
        </div>
      </main>
    );
  }

  return (
    <main className="relative min-h-screen overflow-hidden bg-[#0b3d2e] text-emerald-50">
      {/* Background School Image */}
      <div
        className="fixed inset-0 bg-cover bg-center opacity-40 brightness-75 pointer-events-none"
        style={{
          backgroundImage: "url('/school-background.png')",
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
        <header className="sticky top-0 z-50 w-full border-b border-emerald-800/70 bg-[#0b3d2e]/70 backdrop-blur-md">
          <div className="mx-auto flex max-w-6xl items-center justify-between px-6 py-4">
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

        <EnrollmentProgress activeStep={2} />

        {/* Main Content Area */}
        <section className="mx-auto w-full max-w-5xl flex-1 px-6 py-10 sm:py-12">
          <div className="text-center">
            <div className="mb-6 inline-flex items-center gap-2.5 rounded-full border border-emerald-200 bg-emerald-50/80 px-4 py-1.5 text-xs font-semibold uppercase tracking-wider text-emerald-700 backdrop-blur-md shadow-lg shadow-black/20">
              <span className="relative flex h-2 w-2">
                <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-yellow-300 opacity-75"></span>
                <span className="relative inline-flex h-2 w-2 rounded-full bg-yellow-300"></span>
              </span>
              Grade 11 Online Enrollment • S.Y. 2026–2027
            </div>

            <div className="mt-8 rounded-xl border border-emerald-200 bg-emerald-50/70 p-5 backdrop-blur-md shadow-lg">
              <h1 className="text-xl font-bold text-emerald-700 sm:text-2xl">
                Step 2: Choose Your Cluster
              </h1>
              <p className="mx-auto mt-2 max-w-2xl text-sm leading-relaxed text-emerald-700/90 sm:text-base">
                You selected the{" "}
                <span className="font-bold text-emerald-700">{track.label}</span>.
                Choose the elective cluster that best matches your interests,
                skills, and career goals.
              </p>
            </div>
          </div>

          {/* Cluster Selection Cards */}
          <div className="mt-10 grid gap-5 sm:grid-cols-2">
            {clusters.map((cluster) => {
              const isSelected = activeCluster === cluster;
              const backgroundImage =
                CLUSTER_BACKGROUNDS[cluster] ?? DEFAULT_CLUSTER_BACKGROUND;
              const backgroundPosition =
                CLUSTER_BACKGROUND_POSITIONS[cluster] ?? "center";

              return (
                <button
                  key={cluster}
                  type="button"
                  aria-pressed={isSelected}
                  onClick={() => setSelectedCluster(cluster)}
                  className={`group relative flex min-h-48 flex-col overflow-hidden rounded-2xl border p-6 text-left shadow-lg shadow-black/25 transition-all duration-300 hover:-translate-y-1 ${isSelected
                    ? "border-yellow-300 ring-2 ring-amber-200 shadow-[0_0_30px_rgba(250,204,21,0.28)]"
                    : "border-emerald-200/60 hover:border-yellow-300/60"
                    }`}
                >
                  <div
                    className="absolute inset-0 bg-cover transition-transform duration-500 group-hover:scale-105"
                    style={{
                      backgroundImage: `url('${backgroundImage}')`,
                      backgroundPosition,
                    }}
                  />
                  <div
                    className={`absolute inset-0 transition-colors duration-300 ${isSelected
                      ? "bg-[#052e1c]/60"
                      : "bg-[#052e1c]/65 group-hover:bg-[#052e1c]/55"
                      }`}
                  />
                  <div className="absolute inset-0 bg-linear-to-t from-[#031f13]/90 via-[#052e1c]/20 to-transparent" />

                  <div className="relative flex flex-1 flex-col">
                    <div className="flex justify-end">
                      {isSelected ? (
                        <div className="flex h-7 w-7 items-center justify-center rounded-full bg-yellow-300 text-emerald-950 shadow-md">
                          <Check size={15} strokeWidth={3} />
                        </div>
                      ) : (
                        <div className="flex h-7 w-7 items-center justify-center rounded-full border border-white/40 bg-white/10 transition-colors group-hover:border-yellow-300/70">
                          <span className="h-2 w-2 rounded-full bg-white/30" />
                        </div>
                      )}
                    </div>

                    <h2 className="mt-5 text-lg font-bold leading-snug text-white sm:text-xl">
                      {cluster}
                    </h2>

                    <p className="mt-2 text-xs leading-relaxed text-emerald-100 sm:text-sm">
                      {track.shortLabel} Track elective cluster
                    </p>

                    <div className="mt-auto pt-5">
                      <span
                        className={`inline-flex items-center rounded-full border px-3 py-1 text-[10px] font-bold uppercase tracking-wider ${isSelected
                          ? "border-yellow-300/60 bg-yellow-300/15 text-yellow-200"
                          : "border-white/15 bg-white/10 text-emerald-100"
                          }`}
                      >
                        {isSelected ? "Selected" : "Select cluster"}
                      </span>
                    </div>
                  </div>
                </button>
              );
            })}
          </div>

          {/* Selection Notice */}
          <div className="mt-8 rounded-xl border border-emerald-200 bg-emerald-50/80 px-5 py-4 backdrop-blur-sm shadow-md">
            <div className="flex items-start gap-3">
              <span className="text-lg">💡</span>
              <p className="text-sm leading-6 text-emerald-700">
                <span className="font-bold text-emerald-700">Important:</span>{" "}
                Your cluster selection can still be changed before you submit
                the student information form.
              </p>
            </div>
          </div>

          {/* Navigation Controls */}
          <div className="mt-8 flex flex-col-reverse gap-3 border-t border-emerald-200 pt-6 sm:flex-row sm:items-center sm:justify-between">
            <Link
              href="/enroll"
              className="w-full rounded-lg border border-emerald-200 bg-white/80 px-6 py-3 text-center text-sm font-semibold text-emerald-700 backdrop-blur-sm transition hover:border-emerald-200 hover:bg-amber-50 sm:w-auto"
            >
              Back to Track
            </Link>

            <button
              type="button"
              onClick={handleContinue}
              disabled={!activeCluster}
              className={`w-full rounded-lg px-8 py-3 text-sm font-bold transition-all duration-300 sm:w-auto ${activeCluster
                ? "bg-linear-to-r from-yellow-300 via-yellow-300 to-yellow-300 text-emerald-950 shadow-lg shadow-black/30 hover:scale-[1.02] hover:shadow-[0_0_20px_rgba(200,178,124,0.45)] cursor-pointer"
                : "cursor-not-allowed border border-emerald-200 bg-white/60 text-emerald-700"
                }`}
            >
              Continue to Student Info
            </button>
          </div>
        </section>

        {/* Footer */}
        <footer className="border-t border-emerald-800/70 bg-[#0b3d2e]/60 px-6 py-5 backdrop-blur-sm">
          <div className="mx-auto flex max-w-6xl flex-col items-center justify-between gap-2 text-center sm:flex-row sm:text-left">
            <p className="text-xs text-emerald-200 sm:text-sm">
              © {new Date().getFullYear()} Capstone Project - BatStateU Mabini Campus

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

export default function ClusterSelectionPage() {
  return (
    <Suspense
      fallback={
        <div className="flex min-h-screen items-center justify-center bg-[#eaf5ec] text-[#06281b]">
          <div className="text-center animate-fade-in-up">
            <div className="mx-auto h-8 w-8 animate-spin rounded-full border-2 border-emerald-200 border-t-transparent"></div>
            <p className="mt-3 text-sm font-semibold">
              Loading cluster options...
            </p>
          </div>
        </div>
      }
    >
      <ClusterContent />
    </Suspense>
  );
}
