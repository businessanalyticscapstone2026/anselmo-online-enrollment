"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { AlertCircle, CheckCircle2, Eye, FileText, Plus, RefreshCw, UserPlus, X } from "lucide-react";
import { supabase } from "@/lib/supabaseClient";
import { normalizeEnrollmentStatus } from "@/lib/enrollmentStatus";
import { TRACKS, getClustersForTrack, getTrackLabel } from "@/lib/clusters";
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

function formatDate(value: unknown, includeTime = false): string {
  const raw = text(value);
  if (!raw) return "—";

  const date = new Date(raw);
  if (Number.isNaN(date.getTime())) return raw;

  return date.toLocaleString("en-PH", {
    year: "numeric",
    month: "short",
    day: "numeric",
    ...(includeTime ? { hour: "numeric", minute: "2-digit" } : {}),
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
    <div className={wide ? "sm:col-span-2 lg:col-span-3" : ""}>
      <dt className="text-[10px] font-bold uppercase tracking-wider text-emerald-600">
        {label}
      </dt>
      <dd className="mt-1 text-sm font-medium text-emerald-950">
        {value || "—"}
      </dd>
    </div>
  );
}



export default function ManageWalkInsPage() {
  const [records, setRecords] = useState<WalkInRecord[]>([]);
  const [sections, setSections] = useState<SectionRecord[]>(DEFAULT_SECTIONS);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [track, setTrack] = useState("");
  const [cluster, setCluster] = useState("");
  const [selectedRecord, setSelectedRecord] = useState<WalkInRecord | null>(null);

  const clusterOptions = useMemo(() => getClustersForTrack(track), [track]);

  const sectionById = useMemo(() => {
    const map = new Map<string, SectionRecord>();
    sections.forEach((item) => map.set(String(item.id), item));
    return map;
  }, [sections]);

  const load = useCallback(async () => {
    setLoading(true);
    setError("");

    try {
      const params = new URLSearchParams();
      if (track) params.set("track", track);
      if (cluster) params.set("cluster", cluster);

      const response = await fetch(`/api/staff/walk-ins?${params.toString()}`, {
        credentials: "include",
        cache: "no-store",
      });
      const payload = (await response.json().catch(() => ({}))) as {
        success?: boolean;
        error?: string;
        records?: WalkInRecord[];
      };

      if (!response.ok || !payload.success) {
        throw new Error(payload.error || "Could not load walk-in records.");
      }

      setRecords(payload.records ?? []);
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Could not load walk-in records."
      );
      setRecords([]);
    } finally {
      setLoading(false);
    }
  }, [track, cluster]);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      void load();
    }, 250);

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

  return (
    <div className="space-y-6">
      <header className="flex flex-col gap-4 rounded-2xl border border-emerald-200 bg-white/90 p-5 shadow-sm sm:flex-row sm:items-center sm:justify-between sm:p-6">
        <div className="flex items-start gap-3">
          <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-emerald-100 text-emerald-700">
            <UserPlus size={22} />
          </span>
          <div>
            <p className="text-[10px] font-bold uppercase tracking-[0.18em] text-emerald-600">
              Registrar Workspace
            </p>
            <h1 className="mt-1 text-2xl font-extrabold text-emerald-950 sm:text-3xl">
              Manage Walk-ins
            </h1>
            <p className="mt-1 max-w-2xl text-sm text-emerald-800">
              Encode enrollment details for students who cannot complete the
              online enrollment. Walk-in records are saved without a student
              account and are managed only by the registrar.
            </p>
          </div>
        </div>

        <div className="flex shrink-0 items-center gap-2">
          <button
            type="button"
            onClick={() => void load()}
            className="inline-flex items-center gap-2 rounded-lg border border-emerald-300 bg-white px-3 py-2.5 text-sm font-semibold text-emerald-800 transition hover:bg-emerald-50"
          >
            <RefreshCw size={16} className={loading ? "animate-spin" : ""} />
            Refresh
          </button>
          <Link
            href="/staff/dashboard/walk-ins/new"
            className="inline-flex items-center gap-2 rounded-lg bg-emerald-700 px-4 py-2.5 text-sm font-bold text-white transition hover:bg-emerald-800"
          >
            <Plus size={16} />
            Add Walk-in
          </Link>
        </div>
      </header>

      <section className="rounded-2xl border border-emerald-200 bg-white/90 p-4 shadow-sm sm:p-5">
        <div className="grid gap-3 sm:grid-cols-2">
          <div>
            <label className="mb-1.5 block text-[10px] font-bold uppercase tracking-wider text-emerald-700">
              Track
            </label>
            <select
              value={track}
              onChange={(event) => {
                setTrack(event.target.value);
                setCluster("");
              }}
              className="w-full rounded-lg border border-emerald-200 bg-white px-3 py-2.5 text-sm text-emerald-950 outline-none focus:border-emerald-500 focus:ring-2 focus:ring-emerald-200"
            >
              <option value="">All tracks</option>
              {TRACKS.map((item) => (
                <option key={item.value} value={item.value}>
                  {item.label}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className="mb-1.5 block text-[10px] font-bold uppercase tracking-wider text-emerald-700">
              Cluster
            </label>
            <select
              value={cluster}
              onChange={(event) => setCluster(event.target.value)}
              disabled={!track}
              className="w-full rounded-lg border border-emerald-200 bg-white px-3 py-2.5 text-sm text-emerald-950 outline-none focus:border-emerald-500 focus:ring-2 focus:ring-emerald-200 disabled:bg-emerald-50 disabled:text-emerald-500"
            >
              <option value="">All clusters</option>
              {clusterOptions.map((option) => (
                <option key={option} value={option}>
                  {option}
                </option>
              ))}
            </select>
          </div>
        </div>
      </section>

      {error && (
        <div className="flex items-start gap-3 rounded-xl border border-rose-200 bg-rose-50 p-4 text-sm text-rose-800">
          <AlertCircle size={18} className="mt-0.5 shrink-0" />
          <p>{error}</p>
        </div>
      )}



      <section className="overflow-hidden rounded-2xl border border-emerald-200 bg-white/90 shadow-sm">
        <div className="flex items-center justify-between border-b border-emerald-100 px-5 py-4">
          <div>
            <h2 className="text-lg font-bold text-emerald-950">
              Walk-in enrollment records
            </h2>
            <p className="mt-0.5 text-xs text-emerald-700">
              {loading
                ? "Loading records..."
                : `${records.length} record${records.length === 1 ? "" : "s"} shown`}
            </p>
          </div>
          <span className="rounded-full border border-emerald-200 bg-emerald-50 px-3 py-1 text-[10px] font-bold uppercase tracking-wider text-emerald-700">
            No student account
          </span>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full min-w-[820px] border-collapse text-left text-sm">
            <thead>
              <tr className="border-b border-emerald-100 bg-emerald-50/70 text-[10px] uppercase tracking-wider text-emerald-700">
                <th className="px-4 py-3 font-bold">Student Name</th>
                <th className="px-4 py-3 font-bold">Track</th>
                <th className="px-4 py-3 font-bold">Cluster</th>
                <th className="px-4 py-3 font-bold">Section</th>
                <th className="px-4 py-3 font-bold">Adviser</th>
                <th className="px-4 py-3 font-bold">Date Enrolled</th>
                <th className="px-4 py-3 text-right font-bold">Actions</th>
              </tr>
            </thead>
            <tbody>
              {loading && records.length === 0 ? (
                <tr>
                  <td colSpan={7} className="px-4 py-12 text-center text-emerald-700">
                    Loading walk-in records...
                  </td>
                </tr>
              ) : records.length === 0 ? (
                <tr>
                  <td colSpan={7} className="px-4 py-14 text-center">
                    <div className="mx-auto flex max-w-md flex-col items-center">
                      <span className="flex h-14 w-14 items-center justify-center rounded-full bg-emerald-100 text-emerald-700">
                        <UserPlus size={26} />
                      </span>
                      <p className="mt-4 text-base font-bold text-emerald-950">
                        No walk-in records yet
                      </p>
                      <p className="mt-1 text-sm text-emerald-700">
                        Start by encoding a walk-in student who cannot enroll
                        online.
                      </p>
                      <Link
                        href="/staff/dashboard/walk-ins/new"
                        className="mt-4 inline-flex items-center gap-2 rounded-lg bg-emerald-700 px-4 py-2.5 text-sm font-bold text-white transition hover:bg-emerald-800"
                      >
                        <Plus size={16} />
                        Add Walk-in
                      </Link>
                    </div>
                  </td>
                </tr>
              ) : (
                records.map((record) => {
                  const id = String(record.id);
                  const normalizedStatus = normalizeEnrollmentStatus(record.status);
                  const trackValue = text(record.track);
                  const clusterValue = text(record.selected_cluster);
                  const sectionId = text(record.assigned_section_id);
                  const section = sectionId ? sectionById.get(sectionId) : undefined;
                  const adviser = section
                    ? text(section.adviser_name ?? section.cluster)
                    : "";
                  const dateEnrolled =
                    normalizedStatus === "enrolled"
                      ? formatDate(record.updated_at ?? record.submitted_at)
                      : "—";

                  return (
                    <tr
                      key={id}
                      className="border-b border-emerald-50 transition hover:bg-emerald-50/40"
                    >
                      <td className="px-4 py-3 align-top">
                        <p className="font-semibold text-emerald-950">
                          {walkInFullName(record) || "Unnamed student"}
                        </p>
                        <p className="mt-0.5 text-[11px] uppercase tracking-wider text-emerald-500">
                          {text(record.walk_in_reference) || "Walk-in"}
                        </p>
                      </td>
                      <td className="px-4 py-3 align-top text-xs font-semibold text-emerald-900">
                        {trackValue ? getTrackLabel(trackValue) : "—"}
                      </td>
                      <td className="px-4 py-3 align-top text-xs text-emerald-700">
                        {clusterValue || "—"}
                      </td>
                      <td className="px-4 py-3 align-top text-xs text-emerald-800">
                        {section?.name || sectionId || "Not assigned"}
                      </td>
                      <td className="px-4 py-3 align-top text-xs text-emerald-800">
                        {adviser || "—"}
                      </td>
                      <td className="px-4 py-3 align-top text-xs text-emerald-700">
                        {dateEnrolled}
                      </td>
                      <td className="px-4 py-3 align-top">
                        <div className="flex items-center justify-end gap-1.5">
                          <button
                            type="button"
                            onClick={() => setSelectedRecord(record)}
                            className="inline-flex items-center gap-1 rounded-lg border border-emerald-200 bg-white px-2.5 py-1.5 text-xs font-semibold text-emerald-800 transition hover:bg-emerald-50"
                          >
                            <Eye size={13} />
                            View
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </section>

      {selectedRecord ? (
        <WalkInViewModal
          record={selectedRecord}
          sections={sections}
          onClose={() => setSelectedRecord(null)}
        />
      ) : null}
    </div>
  );
}

function WalkInViewModal({
  record,
  sections,
  onClose,
}: {
  record: WalkInRecord;
  sections: SectionRecord[];
  onClose: () => void;
}) {
  const input = walkInInputFromRecord(record);
  const normalizedStatus = normalizeEnrollmentStatus(record.status);
  const requirementsSubmitted = record.requirements_submitted === true;
  const documents = walkInRequirementLinks(record);
  const reference = text(record.walk_in_reference);
  const fullName = walkInFullName(record) || "Unnamed student";
  const sectionId = text(record.assigned_section_id);
  const section = sectionId ? sections.find((item) => String(item.id) === sectionId) : undefined;
  const adviser = text(section?.adviser_name) || "Not assigned";

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-emerald-950/45 p-4 backdrop-blur-sm"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-label="Walk-in record details"
    >
      <div
        className="max-h-[90vh] w-full max-w-6xl overflow-y-auto rounded-2xl border border-emerald-200 bg-white p-5 shadow-2xl sm:p-6"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex flex-col gap-4 border-b border-emerald-100 pb-4 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <p className="text-[10px] font-bold uppercase tracking-[0.2em] text-emerald-600">
              Walk-in Enrollment Record
            </p>
            <h2 className="mt-1 text-2xl font-extrabold text-emerald-950">{fullName}</h2>
            <div className="mt-2 flex flex-wrap items-center gap-2 text-xs font-semibold text-emerald-700">
              <span className="rounded-full border border-emerald-200 bg-emerald-50 px-2.5 py-1 font-mono">
                {reference || "No reference"}
              </span>
              <span className="rounded-full border border-emerald-200 bg-emerald-50 px-2.5 py-1">
                {getTrackLabel(text(record.track)) || "—"}
              </span>
              <span className="rounded-full border border-emerald-200 bg-emerald-50 px-2.5 py-1">
                {text(record.selected_cluster) || "—"}
              </span>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="inline-flex items-center gap-2 self-start rounded-lg border border-emerald-200 px-3 py-2 text-sm font-semibold text-emerald-800 hover:bg-emerald-50"
          >
            <X size={16} />
            Close
          </button>
        </div>

        <div className="mt-5 grid gap-6 xl:grid-cols-3">
          <div className="space-y-6 xl:col-span-2">
            <section className="rounded-2xl border border-emerald-200 bg-white/90 p-5 shadow-sm">
              <h3 className="text-base font-bold text-emerald-950">Student Information</h3>
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
                      ? `${formatDate(input.birthDate)}${input.age !== null ? ` (${input.age} yrs)` : ""}`
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
                <InfoRow label="Current address" value={formatWalkInAddress(input.currentAddress)} wide />
                <InfoRow label="Permanent address" value={formatWalkInAddress(input.permanentAddress)} wide />
                <InfoRow label="Last school attended" value={input.lastSchoolAttended} />
                <InfoRow label="Last school year completed" value={input.lastSchoolYearCompleted} />
                <InfoRow label="Last school ID" value={input.lastSchoolId} />
                <InfoRow label="College course" value={input.collegeCourse} />
                <InfoRow label="IP community" value={input.isIpCommunity ? input.ipCommunityType : "No"} />
                <InfoRow label="4Ps beneficiary" value={input.is4psBeneficiary ? input.fourPsHouseholdId : "No"} />
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
                  value={input.hasPwdId === null ? "Not specified" : input.hasPwdId ? "Yes" : "No"}
                />
                <InfoRow label="Preferred modalities" value={input.preferredModalities.join(", ")} wide />
              </dl>
            </section>

            <section className="rounded-2xl border border-emerald-200 bg-white/90 p-5 shadow-sm">
              <h3 className="text-base font-bold text-emerald-950">Parents & Legal Guardian</h3>
              <div className="mt-4 grid gap-3 sm:grid-cols-3">
                {["Father", "Mother", "Legal Guardian"].map((role, index) => {
                  const guardian = input.guardians[index];
                  return (
                    <div key={role} className="rounded-xl border border-emerald-100 bg-emerald-50/40 p-3.5">
                      <p className="text-[10px] font-bold uppercase tracking-wider text-emerald-600">{role}</p>
                      <p className="mt-1 text-sm font-semibold text-emerald-950">
                        {[guardian.lastName, guardian.firstName, guardian.middleName].filter(Boolean).join(" ") || "Not provided"}
                      </p>
                      <p className="mt-0.5 text-xs text-emerald-600">{guardian.contactNumber || "No contact number"}</p>
                    </div>
                  );
                })}
              </div>
            </section>

            <section className="rounded-2xl border border-emerald-200 bg-white/90 p-5 shadow-sm">
              <h3 className="text-base font-bold text-emerald-950">Enrollment Requirements</h3>
              <p className="mt-1 text-xs text-emerald-600">View-only. Uploaded documents cannot be edited here.</p>
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
                      <span className="truncate text-[11px] text-emerald-600">{document.fileName || "Open file"}</span>
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
              <h3 className="text-base font-bold text-emerald-950">Registrar Record</h3>
              <dl className="mt-3 space-y-3">
                <InfoRow label="Reference number" value={reference} />
                <InfoRow label="Status" value={normalizedStatus === "enrolled" ? "Enrolled" : normalizedStatus === "denied" ? "Denied" : "Pending"} />
                <InfoRow label="Encoded at" value={formatDate(record.encoded_at ?? record.submitted_at, true)} />
                <InfoRow label="Encoded by" value="School Registrar" />
                <InfoRow label="Student account" value="None — walk-in students cannot access the student dashboard" />
                <InfoRow label="Registrar remarks" value={text(record.registrar_remarks)} />
              </dl>
            </section>
          </div>
        </div>
      </div>
    </div>
  );
}
