"use client";

import { X } from "lucide-react";
import {
  LEGAL_DOCUMENT_TITLE,
  LEGAL_REVIEW_NOTICE,
  PRIVACY_NOTICE,
  TERMS_AND_CONDITIONS,
  type LegalSection,
} from "@/lib/legal";

export type LegalKind = "terms" | "privacy";

const CONTENT: Record<
  LegalKind,
  { title: string; intro: string; sections: LegalSection[] }
> = {
  terms: {
    title: "Terms and Conditions",
    intro:
      "Please read these Terms and Conditions carefully before using the AASMNHS Online Enrollment System.",
    sections: TERMS_AND_CONDITIONS,
  },
  privacy: {
    title: "Privacy Notice",
    intro:
      "This Privacy Notice explains how the school collects, uses, stores, and protects the personal information you provide through the AASMNHS Online Enrollment System.",
    sections: PRIVACY_NOTICE,
  },
};

export default function LegalModal({
  kind,
  onClose,
}: {
  kind: LegalKind;
  onClose: () => void;
}) {
  const { title, intro, sections } = CONTENT[kind];

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4 sm:p-6"
      onClick={onClose}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label={title}
        className="flex max-h-[85vh] w-full max-w-3xl flex-col overflow-hidden rounded-xl bg-white shadow-2xl"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-4 border-b border-gray-200 px-5 py-4">
          <div>
            <p className="text-[10px] font-bold uppercase tracking-wider text-emerald-600">
              {LEGAL_DOCUMENT_TITLE}
            </p>
            <h2 className="mt-0.5 text-lg font-extrabold text-emerald-900">
              {title}
            </h2>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg p-2 text-gray-400 transition hover:bg-gray-100 hover:text-gray-700"
            aria-label="Close"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="overflow-y-auto px-5 py-5">
          <p className="text-sm leading-6 text-gray-600">{intro}</p>

          <div className="mt-4 rounded-lg border border-amber-200 bg-amber-50 p-3 text-xs leading-5 text-amber-800">
            <span className="font-semibold">Note:</span> {LEGAL_REVIEW_NOTICE}
          </div>

          <ol className="mt-6 space-y-5">
            {sections.map((section, index) => (
              <li key={section.heading} className="flex gap-3">
                <span className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-emerald-100 text-xs font-bold text-emerald-800">
                  {index + 1}
                </span>
                <div>
                  <h3 className="text-sm font-bold text-emerald-900">
                    {section.heading}
                  </h3>
                  <p className="mt-1 text-sm leading-6 text-gray-600">
                    {section.body}
                  </p>
                </div>
              </li>
            ))}
          </ol>
        </div>

        <div className="border-t border-gray-200 px-5 py-4">
          <button
            type="button"
            onClick={onClose}
            className="w-full rounded-lg bg-linear-to-r from-yellow-400 via-yellow-300 to-yellow-300 px-6 py-3 text-sm font-bold text-emerald-950 shadow-lg shadow-amber-300/25 transition hover:scale-[1.01]"
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
}
