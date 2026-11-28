"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import {
  AlertCircle,
  ArrowLeft,
  CheckCircle2,
  FileText,
  Loader2,
  UserPlus,
} from "lucide-react";
import { supabase } from "@/lib/supabaseClient";
import {
  getEnrollmentStatusLabel,
  normalizeEnrollmentStatus,
} from "@/lib/enrollmentStatus";
import { getTrackLabel } from "@/lib/clusters";
import {
  DEFAULT_SECTIONS,
  resolveSectionList,
  type SectionRecord,
} from "@/lib/sections";
import {
  formatWalkInAddress,
  walkInFullName,
  walkInInputFromRecord,
  walkInRequirementLinks,
} from "@/lib/walkInEnrollment";

type WalkInRecord = Record<string, unknown>;

function text(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function formatDate(value: unknown, withTime = false): string {
  const raw = text(value);
  if (!raw) return "—";

  const date = new Date(raw);
  if (Number.isNaN(date.getTime())) return raw;

  return date.toLocaleDateString("en-PH", {
    year: "numeric",
    month: "long",
    day: "numeric",
    ...(withTime ? { hour: "numeric", minute: "2-digit" } : {}),
  });
}

function InfoRow({
  label,
  value,
  wide = false,
}: {
  label: string;
  value: string;
  wide?: boolean;
}) {
  return (
    <div className={wide ? "sm:col-span-2" : ""}>
      <dt className="text-[10px] font-bold uppercase tracking-wider text-emerald-600">
        {label}
      </dt>
      <dd className="mt-0.5 text-sm font-semibold text-emerald-950">
        {value || "—"}
      </dd>
    </div>
  );
}

export default function WalkInDetailsPage() {
  const params = useParams<{ id: string }>();
  const id = String(params?.id ?? "");

  const [record, setRecord] = useState<WalkInRecord | null>(null);
  const [sections, setSections] = useState<SectionRecord[]>(DEFAULT_SECTIONS);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    if (!id) {
      setError("A walk-in record ID is required.");
      setLoading(false);
      return;
    }

    setLoading(true);
    setError("");

    try {
      const response = await fetch(`/api/staff/walk-ins/${id}`, {
        credentials: "include",
        cache: "no-store",
      });
      const payload = (await response.json().catch(() => ({}))) as {
        success?: boolean;
        error?: string;
        record?: WalkInRecord;
      };

      if (!response.ok || !payload.success || !payload.record) {
        throw new Error(payload.error || "Could not load the walk-in record.");
      }

      setRecord(payload.record);
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Could not load the walk-in record."
      );
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      void load();
    }, 0);

    return () => window.clearTimeout(timer);
  }, [load]);

  useEffect(() => {
    let active = true;

    supabase
      .from("sections")
      .select("*")
      .order("name")
      .then(({ data }) => {
        if (!active) return;
        setSections(resolveSectionList((data ?? []) as SectionRecord[]));
      });

    return () => {
      active = false;
    };
  }, []);



  if (loading) {
    return (
      <div className="flex min-h-[50vh] flex-col items-center justify-center gap-3 rounded-2xl border border-emerald-200 bg-white/90 p-8 text-emerald-800">
        <Loader2 size={26} className="animate-spin" />
        <p className="text-sm font-semibold">Loading walk-in record...</p>
      </div>
    );
  }

  if (error || !record) {
    return (
      <div className="space-y-4">
        <Link
          href="/staff/dashboard/walk-ins"
          className="inline-flex items-center gap-1.5 text-xs font-semibold text-emerald-700 hover:text-emerald-900"
        >
          <ArrowLeft size={14} />
          Back to Manage Walk-ins
        </Link>
        <div className="flex items-start gap-3 rounded-xl border border-rose-200 bg-rose-50 p-4 text-sm text-rose-800">
          <AlertCircle size={18} className="mt-0.5 shrink-0" />
          <p>{error || "The walk-in record could not be found."}</p>
        </div>
      </div>
    );
  }

  const input = walkInInputFromRecord(record);
  const status = normalizeEnrollmentStatus(record.status);
  const requirementsSubmitted = record.requirements_submitted === true;
  const documents = walkInRequirementLinks(record);
  const reference = text(record.walk_in_reference);
  const fullName = walkInFullName(record) || "Unnamed student";
  const sectionId = text(record.assigned_section_id);
  const section = sectionId ? sections.find((item) => String(item.id) === sectionId) : undefined;
  const adviser = text(section?.adviser_name) || "Not assigned";

  return (
    <div className="space-y-6">
      <header className="rounded-2xl border border-emerald-200 bg-white/90 p-5 shadow-sm sm:p-6">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
          <div>
            <Link
              href="/staff/dashboard/walk-ins"
              className="inline-flex items-center gap-1.5 text-xs font-semibold text-emerald-700 transition hover:text-emerald-900"
            >
              <ArrowLeft size={14} />
              Back to Manage Walk-ins
            </Link>

            <div className="mt-2 flex flex-wrap items-center gap-2">
              <span className="inline-flex items-center gap-1.5 rounded-full border border-amber-300 bg-amber-50 px-2.5 py-1 text-[10px] font-bold uppercase tracking-wider text-amber-800">
                <UserPlus size={12} />
                Walk-in
              </span>
              <span className="rounded-full border border-emerald-200 bg-emerald-50 px-2.5 py-1 font-mono text-[10px] font-bold tracking-wider text-emerald-800">
                {reference || "No reference"}
              </span>
              <span
                className={`rounded-full border px-2.5 py-1 text-[10px] font-bold uppercase tracking-wider ${
                  status === "enrolled"
                    ? "border-emerald-300 bg-emerald-100 text-emerald-800"
                    : status === "denied"
                      ? "border-rose-300 bg-rose-100 text-rose-800"
                      : "border-amber-300 bg-amber-100 text-amber-800"
                }`}
              >
                {getEnrollmentStatusLabel(status)}
              </span>
              <span
                className={`rounded-full border px-2.5 py-1 text-[10px] font-bold uppercase tracking-wider ${
                  requirementsSubmitted
                    ? "border-emerald-300 bg-emerald-100 text-emerald-800"
                    : "border-amber-300 bg-amber-100 text-amber-800"
                }`}
              >
                Requirements {requirementsSubmitted ? "complete" : "incomplete"}
              </span>
            </div>

            <h1 className="mt-2 text-2xl font-extrabold text-emerald-950 sm:text-3xl">
              {fullName}
            </h1>
            <p className="mt-1 text-sm text-emerald-700">
              {text(record.grade_level) || input.gradeLevel} ·{" "}
              {getTrackLabel(record.track || input.track)} ·{" "}
              {text(record.selected_cluster) || input.selectedCluster || "No cluster"}
            </p>
            <p className="mt-1 text-xs text-emerald-600">
              LRN: {text(record.lrn) || "—"} · Contact:{" "}
              {text(record.contact_number) || "—"} · No student account
            </p>
          </div>


        </div>


      </header>

      <div className="grid gap-6 xl:grid-cols-3">
        <div className="space-y-6 xl:col-span-2">
          <section className="rounded-2xl border border-emerald-200 bg-white/90 p-5 shadow-sm">
            <h2 className="text-base font-bold text-emerald-950">
              Student Information
            </h2>

            <dl className="mt-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              <InfoRow label="Last name" value={input.lastName} />
              <InfoRow label="First name" value={input.firstName} />
              <InfoRow label="Middle name" value={input.middleName} />
              <InfoRow label="Extension" value={input.extension} />
              <InfoRow label="LRN" value={input.lrn} />
              <InfoRow
                label="Birth date"
                value={
                  input.birthDate
                    ? `${formatDate(input.birthDate)}${
                        input.age !== null ? ` (${input.age} yrs)` : ""
                      }`
                    : ""
                }
              />
              <InfoRow label="Sex" value={input.sex} />
              <InfoRow label="Religion" value={input.religion} />
              <InfoRow label="Place of birth" value={input.placeOfBirth} />
              <InfoRow label="Contact number" value={input.contactNumber} />
              <InfoRow label="Email address" value={input.email || "Not provided"} />
              <InfoRow label="Grade level" value={input.gradeLevel} />
              <InfoRow label="Track" value={getTrackLabel(input.track)} />
              <InfoRow label="Cluster" value={input.selectedCluster} />
              <InfoRow label="Section" value={section?.name || "Not assigned"} />
              <InfoRow label="Adviser" value={adviser} />
              <InfoRow
                label="Current address"
                value={formatWalkInAddress(input.currentAddress)}
                wide
              />
              <InfoRow
                label="Permanent address"
                value={formatWalkInAddress(input.permanentAddress)}
                wide
              />
              <InfoRow
                label="Last school attended"
                value={input.lastSchoolAttended}
              />
              <InfoRow
                label="Last school year completed"
                value={input.lastSchoolYearCompleted}
              />
              <InfoRow label="Last school ID" value={input.lastSchoolId} />
              <InfoRow
                label="College course"
                value={input.collegeCourse}
              />
              <InfoRow
                label="IP community"
                value={input.isIpCommunity ? input.ipCommunityType : "No"}
              />
              <InfoRow
                label="4Ps beneficiary"
                value={input.is4psBeneficiary ? input.fourPsHouseholdId : "No"}
              />
              <InfoRow
                label="Special needs program"
                value={
                  input.specialNeedsProgram === null
                    ? "Not specified"
                    : input.specialNeedsProgram
                      ? input.specialNeedsCondition || "Yes"
                      : "No"
                }
              />
              <InfoRow
                label="PWD ID"
                value={
                  input.hasPwdId === null
                    ? "Not specified"
                    : input.hasPwdId
                      ? "Yes"
                      : "No"
                }
              />
              <InfoRow
                label="Preferred modalities"
                value={input.preferredModalities.join(", ")}
                wide
              />
            </dl>
          </section>

          <section className="rounded-2xl border border-emerald-200 bg-white/90 p-5 shadow-sm">
            <h2 className="text-base font-bold text-emerald-950">
              Parents & Legal Guardian
            </h2>

            <div className="mt-4 grid gap-3 sm:grid-cols-3">
              {["Father", "Mother", "Legal Guardian"].map((role, index) => {
                const guardian = input.guardians[index];

                return (
                  <div
                    key={role}
                    className="rounded-xl border border-emerald-100 bg-emerald-50/40 p-3.5"
                  >
                    <p className="text-[10px] font-bold uppercase tracking-wider text-emerald-600">
                      {role}
                    </p>
                    <p className="mt-1 text-sm font-semibold text-emerald-950">
                      {[guardian.lastName, guardian.firstName, guardian.middleName]
                        .filter(Boolean)
                        .join(" ") || "Not provided"}
                    </p>
                    <p className="mt-0.5 text-xs text-emerald-600">
                      {guardian.contactNumber || "No contact number"}
                    </p>
                  </div>
                );
              })}
            </div>
          </section>

          <section className="rounded-2xl border border-emerald-200 bg-white/90 p-5 shadow-sm">
            <h2 className="text-base font-bold text-emerald-950">
              Enrollment Requirements
            </h2>
            <p className="mt-1 text-xs text-emerald-600">
              View-only. Uploaded documents cannot be edited from this page.
            </p>

            <div className="mt-4 flex items-center gap-2">
              <span
                className={`inline-flex items-center gap-1 rounded-full border px-2.5 py-1 text-[10px] font-bold uppercase tracking-wider ${
                  requirementsSubmitted
                    ? "border-emerald-300 bg-emerald-100 text-emerald-800"
                    : "border-amber-300 bg-amber-100 text-amber-800"
                }`}
              >
                <FileText size={12} />
                {requirementsSubmitted ? "Complete" : "Incomplete"}
              </span>
            </div>

            <div className="mt-4 space-y-2">
              {documents.length > 0 ? (
                documents.map((document) => (
                  <a
                    key={document.key}
                    href={document.url}
                    target="_blank"
                    rel="noreferrer"
                    className="flex items-center justify-between gap-3 rounded-lg border border-emerald-100 bg-emerald-50/40 px-3 py-2.5 text-xs font-semibold text-emerald-800 transition hover:bg-emerald-50"
                  >
                    <span className="inline-flex items-center gap-2">
                      <CheckCircle2 size={14} />
                      {document.label}
                    </span>
                    <span className="truncate text-[11px] text-emerald-600">
                      {document.fileName || "Open file"}
                    </span>
                  </a>
                ))
              ) : (
                <p className="text-sm text-emerald-700">No documents uploaded.</p>
              )}
            </div>
          </section>
        </div>

        <div className="space-y-6">
          <section className="rounded-2xl border border-emerald-200 bg-white/90 p-5 shadow-sm">
            <h2 className="text-base font-bold text-emerald-950">
              Registrar Record
            </h2>
            <dl className="mt-3 space-y-3">
              <InfoRow label="Reference number" value={reference} />
              <InfoRow
                label="Encoded at"
                value={formatDate(record.encoded_at ?? record.submitted_at, true)}
              />
              <InfoRow label="Encoded by" value="School Registrar" />
              <InfoRow
                label="Student account"
                value="None — walk-in students cannot access the student dashboard"
              />
              <InfoRow
                label="Registrar remarks"
                value={text(record.registrar_remarks)}
              />
            </dl>
          </section>
        </div>
      </div>

    </div>
  );
}
