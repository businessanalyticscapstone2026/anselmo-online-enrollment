import Link from "next/link";
import Image from "next/image";
import {
  ClipboardList,
  FileUp,
  LogIn,
  Target,
  ArrowDown,
} from "lucide-react";
import { createClient as createSupabaseClient } from "@supabase/supabase-js";
import {
  evaluateEnrollmentAvailability,
  formatManilaDate,
  type EnrollmentSettings,
} from "@/lib/enrollmentSettings";
import { supabaseAnonKey, supabaseUrl } from "@/lib/supabase/config";

export const revalidate = 60;

const IMAGE_VERSION_QUERY = "?v=2";

async function loadEnrollmentSettings(): Promise<EnrollmentSettings | null> {
  try {
    const supabase = createSupabaseClient(supabaseUrl, supabaseAnonKey, {
      auth: { persistSession: false },
    });
    const { data, error } = await supabase
      .from("enrollment_settings")
      .select("id, enrollment_start_date, enrollment_end_date")
      .eq("id", 1)
      .maybeSingle();

    if (error) return null;
    return data;
  } catch {
    return null;
  }
}

const enrollmentSteps = [
  {
    step: "1",
    title: "Choose Your Track and Cluster",
    description:
      "Select the Senior High School track that fits your goals and choose preferred elective cluster.",
    icon: Target,
    image: "/choose%20track%20and%20cluster.jpg",
  },
  {
    step: "2",
    title: "Fill Out the Form",
    description:
      "Provide your personal information and learner details in the online enrollment form.",
    icon: ClipboardList,
    image: "/fill%20out%20the%20form.jpg",
  },
  {
    step: "3",
    title: "Upload Requirements",
    description:
      "Submit clear copies of your required documents to complete your application.",
    icon: FileUp,
    image: "/upload%20requirements.jpg",
  },
  {
    step: "4",
    title: "Get Account & Sign In",
    description:
      "Receive your account credentials by email, then sign in to track your enrollment status.",
    icon: LogIn,
    image: "/get%20account%20%26%20sign%20in.jpg",
  },
];

export default async function Home() {
  const settings = await loadEnrollmentSettings();
  const availability = evaluateEnrollmentAvailability(settings);

  const announcement =
    availability.reason === "open"
      ? null
      : availability.reason === "not_started"
        ? {
          title: "Enrollment Has Not Started Yet",
          body: availability.message,
          tone: "amber" as const,
        }
        : availability.reason === "ended"
          ? {
            title: "Enrollment Is Now Closed",
            body: "Enrollment is now closed. The enrollment period has ended. Existing students can still sign in to view their dashboards.",
            tone: "red" as const,
          }
          : {
            title: "Enrollment Schedule Not Yet Available",
            body: availability.message,
            tone: "amber" as const,
          };

  return (
    <main className="relative min-h-screen bg-[#0b3d2e] text-emerald-50">
      {/* Soft school backdrop */}
      <div
        className="fixed inset-0 bg-cover bg-center opacity-30 brightness-75"
        style={{
          backgroundImage: "url('/school-background.png')",
        }}
      />
      <div className="fixed inset-0 bg-linear-to-b from-[#0b3d2e]/80 via-[#0b3d2e]/70 to-[#052e1c]/90" />

      {/* Deep green + yellow glows */}
      <div className="pointer-events-none fixed -top-40 -left-32 h-96 w-96 rounded-full bg-emerald-600/20 blur-3xl" />
      <div className="pointer-events-none fixed top-1/3 -right-24 h-96 w-96 rounded-full bg-yellow-400/10 blur-3xl" />
      <div className="pointer-events-none fixed -bottom-32 left-1/3 h-96 w-96 rounded-full bg-emerald-500/15 blur-3xl" />

      {/* Content */}
      <div className="relative z-10 flex min-h-screen flex-col">
        {/* Header */}
        <header className="sticky top-0 z-50 w-full border-b border-emerald-800/70 bg-[#0b3d2e]/75 backdrop-blur-md">
          <div className="mx-auto flex max-w-6xl items-center justify-between px-6 py-4">
            <div className="flex items-center gap-3.5">
              <div className="relative flex h-11 w-11 items-center justify-center overflow-hidden rounded-full shadow-md ring-2 ring-yellow-400/60 ring-offset-2 ring-offset-[#0b3d2e]">
                <Image
                  src="/school-logo-trimmed.png"
                  alt="AASMNHS School Logo"
                  width={44}
                  height={44}
                  className="h-full w-full object-cover"
                />
              </div>
              <div className="min-w-0">
                <p className="text-base font-bold tracking-wide text-white">
                  AASMNHS
                </p>
                <p className="text-xs font-medium text-emerald-200">
                  Online Enrollment System
                </p>
              </div>
            </div>
            <nav className="hidden items-center gap-4 text-xs font-semibold text-emerald-100 sm:flex">
              <a href="#vision-mission" className="hover:text-yellow-300">
                Vision, Mission & Values
              </a>
              <a href="#enrollment-steps" className="hover:text-yellow-300">
                Enrollment Steps
              </a>
            </nav>
          </div>
        </header>

        {/* Hero Section */}
        <section className="flex min-h-[calc(100vh-76px)] items-center justify-center px-6 py-16">
          <div className="mx-auto w-full max-w-4xl text-center">
            <div className="mb-6 inline-flex items-center gap-2 rounded-full border border-emerald-700 bg-emerald-900/50 px-5 py-2 text-sm font-semibold text-emerald-100 backdrop-blur-md">
              <span className="h-2 w-2 rounded-full bg-yellow-400" />
              Grade 11 Student Enrollment
            </div>

            <h1 className="text-4xl font-extrabold leading-tight tracking-tight text-white sm:text-5xl md:text-6xl lg:text-7xl">
              Anselmo A. Sandoval Memorial
              <span className="mt-2 block bg-linear-to-r from-yellow-300 via-yellow-400 to-emerald-300 bg-clip-text text-transparent">
                National High School
              </span>
            </h1>

            <p className="mx-auto mt-5 max-w-2xl text-base leading-7 text-emerald-100/90 sm:text-lg">
              Welcome to the online enrollment system for incoming Grade 11
              Senior High School students. Complete your enrollment application,
              submit your requirements, and track your enrollment status
              conveniently online.
            </p>

            {announcement && (
              <div
                className={`mx-auto mt-7 max-w-2xl rounded-xl border p-4 text-left backdrop-blur-sm ${announcement.tone === "red"
                  ? "border-rose-400/40 bg-rose-500/15 text-rose-100"
                  : "border-yellow-400/40 bg-yellow-400/10 text-yellow-100"
                  }`}
                role="status"
              >
                <p className="text-sm font-bold">{announcement.title}</p>
                <p className="mt-1 text-xs leading-6 sm:text-sm">
                  {announcement.body}
                </p>
                {availability.startDate && availability.endDate && (
                  <p className="mt-2 text-xs text-emerald-200">
                    Enrollment window:{" "}
                    <strong className="text-white">
                      {formatManilaDate(availability.startDate)} to{" "}
                      {formatManilaDate(availability.endDate)}
                    </strong>
                  </p>
                )}
              </div>
            )}

            <div className="mt-9 flex flex-col items-center justify-center gap-4 sm:flex-row">
              {availability.isOpen ? (
                <Link
                  href="/enroll"
                  className="w-full rounded-xl bg-yellow-400 px-8 py-3.5 text-center font-bold text-[#052e1c] shadow-lg shadow-yellow-900/30 transition hover:-translate-y-0.5 hover:bg-yellow-300 sm:w-auto"
                >
                  Enroll Now
                </Link>
              ) : (
                <span
                  aria-disabled="true"
                  className="w-full cursor-not-allowed rounded-xl border border-emerald-700 bg-emerald-900/50 px-8 py-3.5 text-center font-semibold text-emerald-200 shadow-sm sm:w-auto"
                >
                  Enrollment Closed
                </span>
              )}
              <Link
                href="/login"
                className="w-full rounded-xl border border-emerald-600 bg-white/10 px-8 py-3.5 text-center font-semibold text-white backdrop-blur-sm transition hover:-translate-y-0.5 hover:border-white hover:bg-white hover:text-[#0b3d2e] sm:w-auto"
              >
                Sign In
              </Link>
            </div>

            <a
              href="#vision-mission"
              className="mt-12 inline-flex flex-col items-center gap-1 text-xs font-semibold uppercase tracking-wider text-emerald-200/90 transition hover:text-yellow-300"
            >
              Scroll to learn more
              <ArrowDown className="h-4 w-4 animate-bounce" />
            </a>
          </div>
        </section>

        {/* Vision, Mission & Core Values */}
        <section
          id="vision-mission"
          className="scroll-mt-24 border-t border-emerald-800/50 bg-[#052e1c]/40 px-6 py-16 backdrop-blur-sm sm:py-20"
        >
          <div className="mx-auto max-w-6xl">
            <div className="text-center">
              <p className="text-xs font-bold uppercase tracking-[0.2em] text-yellow-300">
                Our Direction
              </p>
              <h2 className="mt-2 text-3xl font-extrabold text-white sm:text-4xl">
                Vision, Mission, and Core Values
              </h2>
              <p className="mx-auto mt-3 max-w-2xl text-sm leading-7 text-emerald-100/85 sm:text-base">
                Guiding Anselmo A. Sandoval Memorial National High School in
                nurturing learners and serving the community.
              </p>
            </div>

            <div className="mt-10 grid gap-6 md:grid-cols-2">
              <div className="overflow-hidden rounded-xl border border-emerald-700/60 bg-white/10 shadow-xl backdrop-blur-sm">
                <div className="relative h-44 w-full sm:h-52">
                  <Image
                    src={`/vision.jpg${IMAGE_VERSION_QUERY}`}
                    alt="AASMNHS vision"
                    fill
                    className="object-cover"
                    sizes="(max-width: 768px) 100vw, 50vw"
                  />
                  <div className="absolute inset-0 bg-linear-to-t from-[#052e1c]/70 to-transparent" />
                </div>
                <div className="p-6">
                  <div className="mb-3 flex justify-center">
                    <h3 className="text-xl font-bold text-white">Vision</h3>
                  </div>
                  <p className="text-sm leading-7 text-emerald-100/90 sm:text-base">
                    AASMNHS envisions learners who are values-driven, competent,
                    and prepared for lifelong learning, empowered to contribute
                    positively to their families, community, and nation.
                  </p>
                </div>
              </div>

              <div className="overflow-hidden rounded-xl border border-emerald-700/60 bg-white/10 shadow-xl backdrop-blur-sm">
                <div className="relative h-44 w-full sm:h-52">
                  <Image
                    src={`/mission.jpg${IMAGE_VERSION_QUERY}`}
                    alt="AASMNHS mission"
                    fill
                    className="object-cover"
                    sizes="(max-width: 768px) 100vw, 50vw"
                  />
                  <div className="absolute inset-0 bg-linear-to-t from-[#052e1c]/70 to-transparent" />
                </div>
                <div className="p-6">
                  <div className="mb-3 flex justify-center">
                    <h3 className="text-xl font-bold text-white">Mission</h3>
                  </div>
                  <p className="text-sm leading-7 text-emerald-100/90 sm:text-base">
                    To provide quality, inclusive, and learner-centered education
                    through dedicated teaching, a safe environment, and strong
                    partnerships with stakeholders, developing responsible and
                    skilled Senior High School students.
                  </p>
                </div>
              </div>

              <div className="overflow-hidden rounded-xl border border-emerald-700/60 bg-white/10 shadow-xl backdrop-blur-sm md:col-span-2 md:mx-auto md:w-full md:max-w-[calc(50%-0.75rem)]">
                <div className="relative h-44 w-full sm:h-52">
                  <Image
                    src={`/core%20values.jpg${IMAGE_VERSION_QUERY}`}
                    alt="AASMNHS core values"
                    fill
                    className="object-cover"
                    sizes="(max-width: 768px) 100vw, 50vw"
                  />
                  <div className="absolute inset-0 bg-linear-to-t from-[#052e1c]/70 to-transparent" />
                </div>
                <div className="p-6">
                  <div className="mb-3 flex justify-center">
                    <h3 className="text-xl font-bold text-white">Core Values</h3>
                  </div>
                  <ul className="grid grid-cols-2 gap-x-4 gap-y-2 text-sm leading-7 text-emerald-100/90 sm:grid-cols-3 sm:text-base">
                    {[
                      "Cooperation",
                      "Commitment",
                      "Effectiveness",
                      "Discipline",
                      "Leadership",
                    ].map((value) => (
                      <li key={value} className="flex items-center gap-2">
                        <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-yellow-400" />
                        {value}
                      </li>
                    ))}
                  </ul>
                </div>
              </div>
            </div>
          </div>
        </section>

        {/* Enrollment Steps Tutorial */}
        <section
          id="enrollment-steps"
          className="scroll-mt-24 px-6 py-16 sm:py-20"
        >
          <div className="mx-auto max-w-6xl">
            <div className="text-center">
              <p className="text-xs font-bold uppercase tracking-[0.2em] text-yellow-300">
                How to Enroll
              </p>
              <h2 className="mt-2 text-3xl font-extrabold text-white sm:text-4xl">
                Enrollment Steps Tutorial
              </h2>
              <p className="mx-auto mt-3 max-w-2xl text-sm leading-7 text-emerald-100/85 sm:text-base">
                Follow these simple steps to complete your Grade 11 online
                enrollment.
              </p>
            </div>

            <div className="mt-10 grid gap-6 sm:grid-cols-2 lg:grid-cols-4">
              {enrollmentSteps.map((item) => {
                const Icon = item.icon;
                return (
                  <article
                    key={item.step}
                    className="group overflow-hidden rounded-xl border border-emerald-700/60 bg-white/10 shadow-xl backdrop-blur-sm transition hover:-translate-y-1 hover:border-yellow-400/40"
                  >
                    <div className="relative aspect-945/2048 w-full">
                      <Image
                        src={item.image}
                        alt={item.title}
                        fill
                        className="object-cover transition duration-300 group-hover:scale-105"
                        sizes="(max-width: 640px) 100vw, (max-width: 1024px) 50vw, 25vw"
                      />
                      <div className="absolute inset-0 bg-linear-to-t from-[#052e1c]/80 via-[#052e1c]/20 to-transparent" />
                      <div className="absolute left-3 top-3 flex h-8 w-8 items-center justify-center rounded-full bg-yellow-400 text-sm font-extrabold text-[#052e1c] shadow-md">
                        {item.step}
                      </div>
                    </div>
                    <div className="p-5">
                      <div className="mb-2 flex items-center gap-2 text-yellow-300">
                        <Icon className="h-4 w-4" />
                        <h3 className="text-base font-bold text-white">
                          {item.title}
                        </h3>
                      </div>
                      <p className="text-sm leading-6 text-emerald-100/90">
                        {item.description}
                      </p>
                    </div>
                  </article>
                );
              })}
            </div>

            <div className="mt-10 flex flex-col items-center justify-center gap-4 sm:flex-row">
              {availability.isOpen ? (
                <Link
                  href="/enroll"
                  className="w-full rounded-xl bg-yellow-400 px-8 py-3.5 text-center font-bold text-[#052e1c] shadow-lg shadow-yellow-900/30 transition hover:-translate-y-0.5 hover:bg-yellow-300 sm:w-auto"
                >
                  Start Enrollment
                </Link>
              ) : (
                <span
                  aria-disabled="true"
                  className="w-full cursor-not-allowed rounded-xl border border-emerald-700 bg-emerald-900/50 px-8 py-3.5 text-center font-semibold text-emerald-200 shadow-sm sm:w-auto"
                >
                  Enrollment Closed
                </span>
              )}
              <a
                href="#"
                className="w-full rounded-xl border border-emerald-600 bg-white/10 px-8 py-3.5 text-center font-semibold text-white backdrop-blur-sm transition hover:-translate-y-0.5 hover:border-white hover:bg-white hover:text-[#0b3d2e] sm:w-auto"
              >
                Back to Top
              </a>
            </div>
          </div>
        </section>

        {/* Footer */}
        <footer className="border-t border-emerald-800/70 bg-[#052e1c]/70 px-6 py-5 text-center backdrop-blur-sm">
          <p className="text-xs text-emerald-200 sm:text-sm">
            © {new Date().getFullYear()} Capstone Project - BatStateU Mabini Campus
          </p>
          <p className="mt-1 text-[11px] text-emerald-300/80 sm:text-xs">
            Online Enrollment System for Grade 11 Students
          </p>
        </footer>
      </div>
    </main>
  );
}
