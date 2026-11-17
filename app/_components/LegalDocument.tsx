import Image from "next/image";
import Link from "next/link";
import {
  LEGAL_DOCUMENT_TITLE,
  LEGAL_REVIEW_NOTICE,
  type LegalSection,
} from "@/lib/legal";

export default function LegalDocument({
  title,
  intro,
  sections,
}: {
  title: string;
  intro: string;
  sections: LegalSection[];
}) {
  return (
    <main className="min-h-screen bg-[#eaf5ec] text-[#06281b]">
      <header className="sticky top-0 z-50 w-full border-b border-emerald-800/70 bg-[#0b3d2e]/75 backdrop-blur-md">
        <div className="mx-auto flex max-w-6xl items-center justify-between gap-3 px-6 py-4">
          <Link href="/" className="group flex min-w-0 items-center gap-3.5">
            <div className="relative flex h-11 w-11 shrink-0 items-center justify-center overflow-hidden rounded-full shadow-md ring-2 ring-yellow-400/60 ring-offset-2 ring-offset-[#0b3d2e] transition-transform group-hover:scale-105">
              <Image
                src="/school-logo-trimmed.png"
                alt="AASMNHS School Logo"
                width={44}
                height={44}
                className="h-full w-full object-cover"
                priority
              />
            </div>

            <div className="min-w-0">
              <p className="truncate text-base font-bold tracking-wide text-white">
                AASMNHS
              </p>
              <p className="truncate text-xs font-medium text-emerald-200">
                Online Enrollment System
              </p>
            </div>
          </Link>

          <Link
            href="/login"
            className="inline-flex shrink-0 items-center gap-2 rounded-lg border border-emerald-700 bg-emerald-900/40 px-3 py-2 text-[11px] font-semibold text-emerald-100 backdrop-blur-sm transition-all duration-200 hover:border-yellow-400/60 hover:bg-yellow-400 hover:text-[#052e1c] sm:px-4 sm:text-xs"
          >
            <span>Back to Sign In</span>
          </Link>
        </div>
      </header>

      <div className="mx-auto w-full max-w-3xl px-6 py-10">
        <article className="rounded-2xl border border-emerald-700/40 bg-white p-7 shadow-xl sm:p-10">
          <p className="text-xs font-bold uppercase tracking-wider text-emerald-600">
            {LEGAL_DOCUMENT_TITLE}
          </p>

          <h1 className="mt-2 text-2xl font-extrabold text-emerald-900 sm:text-3xl">
            {title}
          </h1>

          <p className="mt-3 text-sm leading-6 text-gray-600">{intro}</p>

          <div className="mt-6 flex gap-2 rounded-lg border border-amber-200 bg-amber-50 p-3 text-xs leading-5 text-amber-800">
            <span className="font-semibold">Note:</span>
            <span>{LEGAL_REVIEW_NOTICE}</span>
          </div>

          <ol className="mt-8 space-y-5">
            {sections.map((section, index) => (
              <li key={section.heading} className="flex gap-3">
                <span className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-emerald-100 text-xs font-bold text-emerald-800">
                  {index + 1}
                </span>
                <div>
                  <h2 className="text-sm font-bold text-emerald-900">
                    {section.heading}
                  </h2>
                  <p className="mt-1 text-sm leading-6 text-gray-600">
                    {section.body}
                  </p>
                </div>
              </li>
            ))}
          </ol>
        </article>

        <p className="mt-6 text-center text-xs text-gray-500">
          Anselmo A. Sandoval Memorial National High School • Mabini, Batangas
        </p>
      </div>
    </main>
  );
}
