"use client";

import Image from "next/image";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import {
  AlertCircle,
  ArrowLeft,
  CheckCircle2,
  FileText,
  Upload,
} from "lucide-react";

const MAX_FILE_SIZE = 10 * 1024 * 1024;

function validateFile(file: File | null, label: string) {
  if (!file) return;

  if (file.size === 0) {
    throw new Error(`${label}: the selected file is empty.`);
  }

  if (file.size > MAX_FILE_SIZE) {
    throw new Error(`${label}: the maximum file size is 10 MB.`);
  }
}

type FileFieldProps = {
  id: string;
  label: string;
  required?: boolean;
  file: File | null;
  onChange: (file: File | null) => void;
  disabled: boolean;
};

function FileField({
  id,
  label,
  required,
  file,
  onChange,
  disabled,
}: FileFieldProps) {
  return (
    <label
      htmlFor={id}
      className="block rounded-xl border border-emerald-200 bg-white p-4"
    >
      <span className="flex items-center gap-2 text-xs font-bold uppercase tracking-wider text-emerald-800">
        <FileText size={15} />
        {label}
        {required ? (
          <span className="text-red-600">*</span>
        ) : (
          <span className="text-[10px] font-medium normal-case tracking-normal text-emerald-600">
            optional
          </span>
        )}
      </span>
      <input
        id={id}
        type="file"
        accept="image/*,application/pdf"
        disabled={disabled}
        onChange={(e) => onChange(e.target.files?.[0] ?? null)}
        className="mt-3 block w-full cursor-pointer rounded-lg border border-emerald-200 bg-emerald-50/60 px-3 py-2.5 text-xs text-emerald-800 file:mr-3 file:rounded-md file:border-0 file:bg-emerald-700 file:px-3 file:py-2 file:text-xs file:font-semibold file:text-white disabled:cursor-not-allowed disabled:opacity-60"
      />
      <span className="mt-2 block truncate text-[11px] text-emerald-700">
        {file ? file.name : "Accepted: images or PDF, up to 10 MB"}
      </span>
    </label>
  );
}

export default function ResubmitRequirementsForm({
  remarks,
}: {
  remarks: string;
}) {
  const router = useRouter();
  const [birthCertificate, setBirthCertificate] = useState<File | null>(null);
  const [reportCard, setReportCard] = useState<File | null>(null);
  const [form137, setForm137] = useState<File | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");

  async function handleSubmit() {
    if (submitting) return;

    setError("");
    setSuccess("");

    try {
      if (!birthCertificate || !reportCard) {
        throw new Error(
          "Both Birth Certificate and Grade 10 Report Card are required."
        );
      }

      validateFile(birthCertificate, "Birth Certificate");
      validateFile(reportCard, "Grade 10 Report Card");
      validateFile(form137, "Other requirement");

      const formData = new FormData();
      formData.append("birthCertificate", birthCertificate);
      formData.append("reportCard", reportCard);
      if (form137) formData.append("form137", form137);

      setSubmitting(true);

      const response = await fetch("/api/student/resubmit-requirements", {
        method: "POST",
        body: formData,
      });

      const result = (await response.json().catch(() => null)) as
        | { success?: boolean; error?: string; message?: string }
        | null;

      if (!response.ok || !result?.success) {
        throw new Error(result?.error || "Could not resubmit your requirements.");
      }

      setSuccess(
        result.message ||
          "Your requirements were resubmitted. Your application is back in the pending review queue."
      );
      setBirthCertificate(null);
      setReportCard(null);
      setForm137(null);

      window.setTimeout(() => {
        router.push("/student/dashboard");
        router.refresh();
      }, 1500);
    } catch (err: unknown) {
      setError(
        err instanceof Error ? err.message : "Could not resubmit your requirements."
      );
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="min-h-screen bg-[#eaf5ec] text-[#06281b]">
      <header className="border-b border-[#c3e2cd] bg-[#d7eedd]/95">
        <div className="mx-auto flex max-w-4xl items-center justify-between gap-4 px-4 py-4 sm:px-6">
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
          <Link
            href="/student/dashboard"
            className="inline-flex items-center gap-2 rounded-lg border border-emerald-200 px-3 py-2 text-xs font-semibold text-emerald-800 transition hover:bg-emerald-50"
          >
            <ArrowLeft size={15} />
            Back to dashboard
          </Link>
        </div>
      </header>

      <main className="mx-auto max-w-4xl px-4 py-8 sm:px-6 lg:py-10">
        <p className="text-xs font-semibold uppercase tracking-[0.18em] text-emerald-700">
          Requirements
        </p>
        <h1 className="mt-2 text-2xl font-extrabold tracking-tight sm:text-3xl">
          Resubmit your requirements
        </h1>
        <p className="mt-2 max-w-2xl text-sm text-emerald-900">
          Upload the missing or clearer copies of your requirements. Once
          submitted, your application returns to the registrar for another
          review.
        </p>

        {remarks && (
          <div className="mt-5 flex items-start gap-3 rounded-xl border border-orange-200 bg-orange-50 p-4 text-sm text-orange-800">
            <AlertCircle size={18} className="mt-0.5 shrink-0" />
            <div>
              <p className="font-bold">Registrar remarks</p>
              <p className="mt-1 text-orange-800/90">{remarks}</p>
            </div>
          </div>
        )}

        <section className="mt-6 space-y-4 rounded-2xl border border-emerald-200 bg-emerald-50/80 p-5 sm:p-6">
          <FileField
            id="birth-certificate"
            label="Birth Certificate"
            required
            file={birthCertificate}
            onChange={setBirthCertificate}
            disabled={submitting || Boolean(success)}
          />
          <FileField
            id="report-card"
            label="Grade 10 Report Card"
            required
            file={reportCard}
            onChange={setReportCard}
            disabled={submitting || Boolean(success)}
          />
          <FileField
            id="form-137"
            label="Other requirement (e.g. Form 137)"
            file={form137}
            onChange={setForm137}
            disabled={submitting || Boolean(success)}
          />

          {error && (
            <p className="flex gap-2 rounded-lg border border-red-200 bg-red-50 p-3 text-xs text-red-700">
              <AlertCircle size={16} className="shrink-0" />
              <span>{error}</span>
            </p>
          )}

          {success && (
            <p className="flex gap-2 rounded-lg border border-emerald-200 bg-emerald-50 p-3 text-xs text-emerald-800">
              <CheckCircle2 size={16} className="shrink-0" />
              <span>{success}</span>
            </p>
          )}

          <div className="flex flex-col-reverse gap-2 pt-2 sm:flex-row sm:justify-end">
            <Link
              href="/student/dashboard"
              className="inline-flex items-center justify-center rounded-lg border border-emerald-200 bg-white px-4 py-2.5 text-xs font-semibold text-emerald-800 transition hover:bg-emerald-100"
            >
              Cancel
            </Link>
            <button
              type="button"
              onClick={() => void handleSubmit()}
              disabled={
                submitting ||
                Boolean(success) ||
                !birthCertificate ||
                !reportCard
              }
              className="inline-flex items-center justify-center gap-2 rounded-lg bg-yellow-300 px-4 py-2.5 text-xs font-bold text-emerald-950 transition hover:bg-yellow-400 disabled:cursor-not-allowed disabled:opacity-60"
            >
              <Upload size={15} />
              {submitting ? "Submitting…" : "Submit requirements"}
            </button>
          </div>
        </section>
      </main>
    </div>
  );
}
