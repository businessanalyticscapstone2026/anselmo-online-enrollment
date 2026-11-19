"use client";

import { useEffect, useState, useCallback, useMemo, useRef, type FormEvent } from "react";
import {
  getEnrollmentStatusLabel,
  normalizeEnrollmentStatus,
} from "@/lib/enrollmentStatus";
import { DEFAULT_SECTIONS, type SectionRecord } from "@/lib/sections";
import { TRACKS, getTrackLabel, getClustersForTrack, getTrackForCluster, normalizeTrack, type TrackValue } from "@/lib/clusters";
import { supabase } from "@/lib/supabaseClient";
import { RefreshCw, Save, AlertCircle, Users, CheckCircle2, Info, Plus, Pencil, Trash2, X, Lock } from "lucide-react";

type App = {
  id: string;
  first_name?: string | null;
  middle_name?: string | null;
  last_name?: string | null;
  status?: string | null;
  track?: string | null;
  selected_track?: string | null;
  selected_cluster?: string | null;
  cluster?: string | null;
  cluster_name?: string | null;
  preferred_cluster?: string | null;
  preferred_strand_id?: string | null;
  strand?: string | null;
  student_details?: unknown;
  assigned_section_id?: string | null;
  [key: string]: unknown;
};

type Section = SectionRecord;

const defaultSections = DEFAULT_SECTIONS;

function resolveSectionTrack(section: Section): string | null {
  return section.track ?? getTrackForCluster(section.strand ?? section.cluster);
}

function trackSortOrder(track: TrackValue | null): number {
  if (track === "academic") return 0;
  if (track === "techpro") return 1;
  return 2;
}

function firstText(...values: unknown[]): string {
  for (const value of values) {
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return "";
}

function applicationDetails(app: App): Record<string, unknown> | null {
  const details = app.student_details;
  if (!details || typeof details !== "object" || Array.isArray(details)) {
    return null;
  }
  return details as Record<string, unknown>;
}

function resolveApplicationTrack(app: App): string {
  const details = applicationDetails(app);
  return firstText(
    app.track,
    app.selected_track,
    details?.track,
    details?.selected_track
  );
}

function resolveApplicationCluster(app: App): string {
  const details = applicationDetails(app);
  return firstText(
    app.selected_cluster,
    app.cluster,
    app.cluster_name,
    app.preferred_cluster,
    app.strand,
    app.preferred_strand_id,
    details?.selected_cluster,
    details?.cluster,
    details?.cluster_name
  );
}

export default function SectionsPage() {
  const [apps, setApps] = useState<App[]>([]);
  const [sections, setSections] = useState<Section[]>(defaultSections);
  const [assignments, setAssignments] = useState<Record<string, string>>({});
  const [lockedIds, setLockedIds] = useState<Record<string, boolean>>({});
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState<string | null>(null);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<"enrolled" | "pending">(
    "enrolled"
  );
  const [trackFilter, setTrackFilter] = useState<"all" | TrackValue>("all");
  const [usingDefaultSections, setUsingDefaultSections] = useState(false);
  const [hasRemoteUpdates, setHasRemoteUpdates] = useState(false);
  const [showSectionForm, setShowSectionForm] = useState(false);
  const [editingSection, setEditingSection] = useState<Section | null>(null);
  const [formName, setFormName] = useState("");
  const [formAdviser, setFormAdviser] = useState("");
  const [formGradeLevel, setFormGradeLevel] = useState("");
  const [formTrack, setFormTrack] = useState("");
  const [formStrand, setFormStrand] = useState("");
  const [formSchoolYear, setFormSchoolYear] = useState("2025-2026");
  const [formCapacity, setFormCapacity] = useState("");
  const [savingSection, setSavingSection] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState<Section | null>(null);
  const [deletingSection, setDeletingSection] = useState(false);
  const suppressRealtimeRef = useRef(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    setMessage("");
    setHasRemoteUpdates(false);

    try {
      // 1. Fetch applications with select("*") to be 100% resilient
      const appsRes = await supabase
        .from("student_applications")
        .select("*")
        .order("submitted_at", { ascending: false });

      if (appsRes.error) {
        setError(`Applications: ${appsRes.error.message}`);
      } else {
        // Enrolled and pending students can be reviewed here. Rejected
        // applications remain in Applications & Requirements.
        const applicationList = ((appsRes.data ?? []) as App[]).filter((r) =>
          ["enrolled", "pending"].includes(
            normalizeEnrollmentStatus(r.status)
          )
        );
        setApps(applicationList);

        const initialAssignments: Record<string, string> = {};
        const initialLocked: Record<string, boolean> = {};
        applicationList.forEach((r) => {
          const assigned =
            r.assigned_section_id != null
              ? String(r.assigned_section_id)
              : "";
          initialAssignments[r.id] = assigned;
          initialLocked[r.id] = Boolean(assigned);
        });
        setAssignments(initialAssignments);
        setLockedIds(initialLocked);
      }

      // 2. Fetch sections table if it exists
      try {
        const sectionsRes = await supabase
          .from("sections")
          .select("*")
          .order("name");

        if (!sectionsRes.error && sectionsRes.data && sectionsRes.data.length > 0) {
          setSections(sectionsRes.data as Section[]);
          setUsingDefaultSections(false);
        } else {
          setSections(defaultSections);
          setUsingDefaultSections(true);
          if (sectionsRes.error) {
            setError(`Sections: ${sectionsRes.error.message}`);
          }
        }
      } catch {
        setSections(defaultSections);
        setUsingDefaultSections(true);
      }
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Failed to load sections data.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    const run = async () => { try { await load(); } catch (e) { console.error(e); } }; run();
  }, [load]);

  useEffect(() => {
    const channel = supabase
      .channel(`staff-sections-live-${Date.now()}`)
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "student_applications",
        },
        () => {
          if (suppressRealtimeRef.current) {
            return;
          }

          setHasRemoteUpdates(true);
        }
      )
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "sections",
        },
        () => {
          if (suppressRealtimeRef.current) {
            return;
          }

          setHasRemoteUpdates(true);
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, []);

  async function save(id: string) {
    setMessage("");
    setError("");

    if (lockedIds[id]) {
      setError(
        "This student already has an assigned section. Section assignments are final and can no longer be changed."
      );
      return;
    }

    setSaving(id);

    const value = assignments[id] ?? "";
    const section = value ? sections.find((s) => String(s.id) === value) : null;

    if (value && !section) {
      setError("The selected section is no longer available. Refresh and try again.");
      setSaving(null);
      return;
    }

    suppressRealtimeRef.current = true;
    window.setTimeout(() => {
      suppressRealtimeRef.current = false;
    }, 1500);

    try {
      const response = await fetch("/api/staff/assign-section", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "same-origin",
        body: JSON.stringify({
          applicationId: id,
          sectionId: value || null,
        }),
      });

      const result = (await response.json().catch(() => null)) as
        | {
            success?: boolean;
            error?: string;
            data?: {
              assigned_section_id?: string | null;
              emailSent?: boolean;
              emailError?: string | null;
              emailConfigured?: boolean;
            };
          }
        | null;

      if (!response.ok || !result?.success) {
        throw new Error(
          result?.error || "The section assignment could not be saved."
        );
      }

      const savedSectionId =
        result.data?.assigned_section_id != null
          ? String(result.data.assigned_section_id)
          : "";

      if (savedSectionId !== value) {
        throw new Error("The database did not keep the selected section. Please try again.");
      }

      setAssignments((prev) => ({ ...prev, [id]: savedSectionId }));
      setLockedIds((prev) => ({ ...prev, [id]: Boolean(savedSectionId) }));
      setHasRemoteUpdates(false);

      const emailNotice = result.data?.emailSent
        ? " A notification email with the section and adviser was sent to the student."
        : result.data?.emailError
          ? ` The student could not be notified by email: ${result.data.emailError}`
          : "";

      setMessage(
        `Section assignment saved successfully: ${section?.name || "Unassigned"}.${emailNotice}`
      );
    } catch (err: unknown) {
      setError(
        `Could not save the section assignment: ${
          err instanceof Error ? err.message : "Unknown error"
        }`
      );
    } finally {
      setSaving(null);
    }
  }

  function assignedCount(sectionId: string | number) {
    const target = String(sectionId);
    return Object.values(assignments).filter((value) => value === target).length;
  }

  function openAddSection() {
    setEditingSection(null);
    setFormName("");
    setFormAdviser("");
    setFormGradeLevel("");
    setFormTrack("");
    setFormStrand("");
    setFormSchoolYear("2025-2026");
    setFormCapacity("");
    setError("");
    setMessage("");
    setShowSectionForm(true);
  }

  function openEditSection(section: Section) {
    setEditingSection(section);
    setFormName(section.name ?? "");
    setFormAdviser(section.adviser_name ?? "");
    setFormGradeLevel(section.grade_level ?? "");
    setFormTrack(resolveSectionTrack(section) ?? "");
    setFormStrand(section.strand ?? section.cluster ?? "");
    setFormSchoolYear(section.school_year ?? "");
    setFormCapacity(section.capacity != null ? String(section.capacity) : "");
    setError("");
    setMessage("");
    setShowSectionForm(true);
  }

  function closeSectionForm() {
    if (savingSection) return;
    setShowSectionForm(false);
    setEditingSection(null);
  }

  async function submitSectionForm(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setSavingSection(true);
    setError("");
    setMessage("");

    const payload = {
      name: formName.trim(),
      adviserName: formAdviser.trim(),
      gradeLevel: formGradeLevel.trim(),
      track: formTrack.trim(),
      strand: formStrand.trim(),
      cluster: formStrand.trim(),
      schoolYear: formSchoolYear.trim(),
      capacity: formCapacity.trim(),
    };

    if (!payload.name) {
      setError("A section name is required.");
      setSavingSection(false);
      return;
    }

    try {
      const isEdit = Boolean(editingSection);
      const response = await fetch("/api/staff/sections", {
        method: isEdit ? "PATCH" : "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "same-origin",
        body: JSON.stringify(
          isEdit ? { ...payload, id: editingSection?.id } : payload
        ),
      });

      const result = (await response.json().catch(() => null)) as
        | { success?: boolean; error?: string; message?: string }
        | null;

      if (!response.ok || !result?.success) {
        throw new Error(result?.error || "The section could not be saved.");
      }

      const successMessage =
        result?.message ||
        (isEdit ? "Section updated successfully." : "Section added successfully.");

      setShowSectionForm(false);
      setEditingSection(null);
      await load();
      setMessage(successMessage);
    } catch (err: unknown) {
      setError(
        err instanceof Error ? err.message : "Could not save the section."
      );
    } finally {
      setSavingSection(false);
    }
  }

  function requestDelete(section: Section) {
    setError("");
    setMessage("");
    setConfirmDelete(section);
  }

  async function confirmDeleteSection() {
    if (!confirmDelete) return;
    setDeletingSection(true);
    setError("");
    setMessage("");

    try {
      const response = await fetch(
        `/api/staff/sections?id=${encodeURIComponent(String(confirmDelete.id))}`,
        { method: "DELETE", credentials: "same-origin" }
      );

      const result = (await response.json().catch(() => null)) as
        | { success?: boolean; error?: string; message?: string }
        | null;

      if (!response.ok || !result?.success) {
        throw new Error(result?.error || "The section could not be deleted.");
      }

      const successMessage = result?.message || "Section deleted successfully.";
      setConfirmDelete(null);
      await load();
      setMessage(successMessage);
    } catch (err: unknown) {
      setError(
        err instanceof Error ? err.message : "Could not delete the section."
      );
    } finally {
      setDeletingSection(false);
    }
  }

  const filtered = useMemo(() => {
    const term = search.toLowerCase();
    const list = apps.filter((a) => {
      if (normalizeEnrollmentStatus(a.status) !== statusFilter) return false;
      const name = `${a.first_name ?? ""} ${a.middle_name ?? ""} ${a.last_name ?? ""} ${a.id ?? ""}`.toLowerCase();
      return name.includes(term);
    });

    const sorted = [...list].sort((a, b) => {
      const orderA = trackSortOrder(normalizeTrack(resolveApplicationTrack(a)));
      const orderB = trackSortOrder(normalizeTrack(resolveApplicationTrack(b)));
      if (orderA !== orderB) return orderA - orderB;
      const nameA = `${a.last_name ?? ""} ${a.first_name ?? ""}`.toLowerCase();
      const nameB = `${b.last_name ?? ""} ${b.first_name ?? ""}`.toLowerCase();
      return nameA.localeCompare(nameB);
    });

    if (trackFilter === "all") return sorted;
    return sorted.filter(
      (a) => normalizeTrack(resolveApplicationTrack(a)) === trackFilter
    );
  }, [apps, search, trackFilter, statusFilter]);

  const sectionsByTrack = useMemo(
    () =>
      [...sections].sort((a, b) => {
        const orderA = trackSortOrder(normalizeTrack(resolveSectionTrack(a)));
        const orderB = trackSortOrder(normalizeTrack(resolveSectionTrack(b)));
        if (orderA !== orderB) return orderA - orderB;
        return (a.name ?? "").localeCompare(b.name ?? "");
      }),
    [sections]
  );

  const clusterOptions = useMemo(() => {
    const forTrack = getClustersForTrack(formTrack);
    if (forTrack.length > 0) return forTrack;
    return TRACKS.flatMap((track) => track.clusters);
  }, [formTrack]);

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.18em] text-emerald-700">
            Registrar Workspace
          </p>
          <h1 className="mt-2 text-3xl font-extrabold">Section & Adviser</h1>
          <p className="mt-2 text-sm text-emerald-900">
            Review enrolled and pending students, assign them to Senior High School sections, and view designated advisers.
          </p>
        </div>
        <button
          onClick={load}
          className="inline-flex items-center justify-center gap-2 rounded-lg border border-emerald-200 px-4 py-2.5 text-xs font-semibold hover:bg-emerald-50"
        >
          <RefreshCw size={14} className={loading ? "animate-spin" : ""} />
          Refresh
        </button>
      </div>

      {message && (
        <p className="flex items-center gap-2 rounded-lg border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-700">
          <CheckCircle2 size={17} className="shrink-0" />
          {message}
        </p>
      )}

      {error && (
        <p className="flex gap-2 rounded-lg border border-red-200 bg-red-400/10 p-3 text-sm text-red-700">
          <AlertCircle size={18} className="shrink-0" />
          {error}
        </p>
      )}

      {hasRemoteUpdates && (
        <div className="flex flex-col gap-3 rounded-lg border border-sky-200 bg-sky-50 p-3 text-sm text-sky-700 sm:flex-row sm:items-center sm:justify-between">
          <span className="flex items-center gap-2">
            <RefreshCw size={16} className="shrink-0" />
            New section or application updates are available.
          </span>
          <button
            onClick={load}
            className="rounded-lg border border-sky-200 px-3 py-1.5 text-xs font-semibold hover:bg-sky-50"
          >
            Load updates
          </button>
        </div>
      )}

      {usingDefaultSections && (
        <div className="flex items-start gap-3 rounded-xl border border-emerald-200 bg-amber-50 p-3.5 text-xs text-emerald-700">
          <Info size={17} className="shrink-0 text-emerald-700 mt-0.5" />
          <div>
            <span className="font-bold">Standard School Sections Active:</span> Displaying AASMNHS Senior High School sections (STEM, ABM, HUMSS, GAS, TVL). Apply the sections migration in Supabase before saving assignments.
          </div>
        </div>
      )}

      <div className="flex flex-col gap-3 rounded-2xl border border-emerald-200 bg-emerald-50 p-4 sm:flex-row">
        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search student by name or application ID…"
          className="flex-1 rounded-lg border border-emerald-200 bg-white px-4 py-3 text-sm text-emerald-700 outline-none placeholder:text-emerald-800 focus:border-emerald-200"
        />
      </div>

      <div className="overflow-hidden rounded-2xl border border-emerald-200 bg-emerald-50">
        <div className="flex flex-col gap-3 border-b border-emerald-200 px-5 py-4 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h2 className="font-semibold">Manage Sections &amp; Advisers</h2>
            <p className="mt-1 text-xs text-emerald-800">
              Add a new section with its adviser, or edit and delete existing
              sections.
            </p>
          </div>
          <button
            onClick={openAddSection}
            className="inline-flex items-center justify-center gap-2 rounded-lg bg-yellow-300 px-4 py-2.5 text-xs font-bold text-emerald-950 hover:bg-yellow-300"
          >
            <Plus size={14} />
            Add Section
          </button>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full min-w-212.5 text-left text-sm">
            <thead className="bg-emerald-50 text-[10px] uppercase tracking-wider text-emerald-900">
              <tr>
                <th className="px-5 py-3">Section</th>
                <th className="px-5 py-3">Adviser</th>
                <th className="px-5 py-3">Track</th>
                <th className="px-5 py-3">Grade / Cluster</th>
                <th className="px-5 py-3">School Year</th>
                <th className="px-5 py-3">Capacity</th>
                <th className="px-5 py-3">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-emerald-200/10">
              {sectionsByTrack.length > 0 ? (
                sectionsByTrack.map((s) => (
                  <tr key={String(s.id)} className="hover:bg-emerald-50">
                    <td className="px-5 py-4 font-semibold">{s.name}</td>
                    <td className="px-5 py-4 text-xs text-emerald-900">
                      {s.adviser_name || (
                        <span className="text-emerald-800">Not assigned</span>
                      )}
                    </td>
                    <td className="px-5 py-4 text-xs text-emerald-900">
                      {resolveSectionTrack(s) ? (
                        getTrackLabel(resolveSectionTrack(s))
                      ) : (
                        <span className="text-emerald-800">—</span>
                      )}
                    </td>
                    <td className="px-5 py-4 text-xs text-emerald-900">
                      {[s.grade_level, s.strand ?? s.cluster]
                        .filter(Boolean)
                        .join(" · ") || "—"}
                    </td>
                    <td className="px-5 py-4 text-xs text-emerald-900">
                      {s.school_year || "—"}
                    </td>
                    <td className="px-5 py-4 text-xs text-emerald-900">
                      <span className="font-semibold text-emerald-700">
                        {assignedCount(s.id)}
                      </span>
                      <span className="text-emerald-800">
                        {" / "}
                        {s.capacity ?? "—"}
                      </span>
                    </td>
                    <td className="px-5 py-4">
                      <div className="flex items-center gap-2">
                        <button
                          onClick={() => openEditSection(s)}
                          className="inline-flex items-center gap-1.5 rounded-lg border border-emerald-200 bg-white px-3 py-2 text-xs font-semibold text-emerald-900 hover:bg-emerald-50"
                        >
                          <Pencil size={13} />
                          Edit
                        </button>
                        <button
                          onClick={() => requestDelete(s)}
                          className="inline-flex items-center gap-1.5 rounded-lg border border-red-200 bg-white px-3 py-2 text-xs font-semibold text-red-700 hover:bg-red-50"
                        >
                          <Trash2 size={13} />
                          Delete
                        </button>
                      </div>
                    </td>
                  </tr>
                ))
              ) : (
                <tr>
                  <td
                    colSpan={7}
                    className="px-5 py-10 text-center text-emerald-900"
                  >
                    No sections yet. Use &ldquo;Add Section&rdquo; to create one.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      <div className="overflow-hidden rounded-2xl border border-emerald-200 bg-emerald-50">
        <div className="flex flex-col gap-2 border-b border-emerald-200 px-5 py-4 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h2 className="font-semibold">Student Section Assignments</h2>
            <p className="mt-1 text-xs text-emerald-800">
              Select a section for each student to link their adviser. Once a
              section is saved, it is locked and can no longer be changed.
            </p>
          </div>
          <span className="text-xs text-emerald-700 font-mono">
            {filtered.length} {statusFilter} student
            {filtered.length === 1 ? "" : "s"}
          </span>
        </div>

        <div className="flex flex-wrap items-center gap-2 border-b border-emerald-200 px-5 py-3">
          <span className="mr-1 text-[10px] font-bold uppercase tracking-wider text-emerald-800">
            Status
          </span>
          {(
            [
              { value: "enrolled", label: "Enrolled" },
              { value: "pending", label: "Pending" },
            ] as const
          ).map((option) => {
            const active = statusFilter === option.value;
            const count = apps.filter(
              (a) => normalizeEnrollmentStatus(a.status) === option.value
            ).length;
            return (
              <button
                key={option.value}
                type="button"
                onClick={() => setStatusFilter(option.value)}
                className={`inline-flex items-center gap-2 rounded-full border px-3 py-1.5 text-xs font-semibold transition ${
                  active
                    ? "border-emerald-400 bg-emerald-600 text-white"
                    : "border-emerald-200 bg-white text-emerald-800 hover:bg-emerald-50"
                }`}
              >
                {option.label}
                <span
                  className={`rounded-full px-1.5 text-[10px] ${
                    active ? "bg-white/25" : "bg-emerald-100 text-emerald-700"
                  }`}
                >
                  {count}
                </span>
              </button>
            );
          })}
        </div>

        <div className="flex flex-wrap items-center gap-2 border-b border-emerald-200 px-5 py-3">
          <span className="mr-1 text-[10px] font-bold uppercase tracking-wider text-emerald-800">
            Track
          </span>
          {(
            [
              { value: "all", label: "All Tracks" },
              { value: "academic", label: "Academic Track" },
              { value: "techpro", label: "Technical Professional Track" },
            ] as const
          ).map((option) => {
            const active = trackFilter === option.value;
            const statusApps = apps.filter(
              (a) => normalizeEnrollmentStatus(a.status) === statusFilter
            );
            const count =
              option.value === "all"
                ? statusApps.length
                : statusApps.filter(
                    (a) =>
                      normalizeTrack(resolveApplicationTrack(a)) === option.value
                  ).length;
            return (
              <button
                key={option.value}
                type="button"
                onClick={() => setTrackFilter(option.value)}
                className={`inline-flex items-center gap-2 rounded-full border px-3 py-1.5 text-xs font-semibold transition ${
                  active
                    ? "border-emerald-400 bg-emerald-600 text-white"
                    : "border-emerald-200 bg-white text-emerald-800 hover:bg-emerald-50"
                }`}
              >
                {option.label}
                <span
                  className={`rounded-full px-1.5 text-[10px] ${
                    active ? "bg-white/25" : "bg-emerald-100 text-emerald-700"
                  }`}
                >
                  {count}
                </span>
              </button>
            );
          })}
        </div>

        <div className="overflow-x-auto">
          <table className="w-full min-w-250 text-left text-sm">
            <thead className="bg-emerald-50 text-[10px] uppercase tracking-wider text-emerald-900">
              <tr>
                <th className="px-5 py-3">Student</th>
                <th className="px-5 py-3">Track</th>
                <th className="px-5 py-3">Cluster</th>
                <th className="px-5 py-3">Status</th>
                <th className="px-5 py-3">Section</th>
                <th className="px-5 py-3">Adviser</th>
                <th className="px-5 py-3">Action</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-emerald-200/10">
              {loading ? (
                <tr>
                  <td colSpan={7} className="animate-pulse-soft px-5 py-10 text-center text-emerald-900">
                    Loading applicants…
                  </td>
                </tr>
              ) : filtered.length > 0 ? (
                filtered.map((a) => {
                  const selected = sections.find(
                    (s) => String(s.id) === assignments[a.id]
                  );
                  const studentTrack =
                    resolveApplicationTrack(a) ||
                    (selected ? resolveSectionTrack(selected) : "") ||
                    "";
                  const studentCluster =
                    resolveApplicationCluster(a) ||
                    (selected ? selected.strand ?? selected.cluster ?? "" : "");
                  const studentTrackValue = normalizeTrack(studentTrack);
                  const matchingSections = studentTrackValue
                    ? sectionsByTrack.filter(
                        (s) =>
                          normalizeTrack(resolveSectionTrack(s)) ===
                          studentTrackValue
                      )
                    : sectionsByTrack;
                  const currentSectionId = assignments[a.id] ?? "";
                  const locked = Boolean(lockedIds[a.id]);
                  const sectionOptions =
                    currentSectionId &&
                    !matchingSections.some(
                      (s) => String(s.id) === currentSectionId
                    )
                      ? [
                          ...matchingSections,
                          ...sectionsByTrack.filter(
                            (s) => String(s.id) === currentSectionId
                          ),
                        ]
                      : matchingSections;
                  return (
                    <tr key={a.id} className="hover:bg-emerald-50">
                      <td className="px-5 py-4">
                        <p className="font-semibold">
                          {[a.first_name, a.middle_name, a.last_name]
                            .filter(Boolean)
                            .join(" ") || "Unnamed applicant"}
                        </p>
                        <p className="font-mono text-[10px] text-emerald-700">
                          {String(a.id).slice(0, 8)}
                        </p>
                      </td>
                      <td className="px-5 py-4 text-xs text-emerald-900">
                        {studentTrack ? (
                          getTrackLabel(studentTrack)
                        ) : (
                          <span className="text-emerald-800">—</span>
                        )}
                      </td>
                      <td className="px-5 py-4 text-xs text-emerald-900">
                        {studentCluster || (
                          <span className="text-emerald-800">—</span>
                        )}
                      </td>
                      <td className="px-5 py-4 text-xs capitalize">
                        <span className="rounded-full border border-emerald-200 bg-emerald-50 px-2.5 py-1 text-[10px]">
                          {getEnrollmentStatusLabel(a.status)}
                        </span>
                      </td>
                      <td className="px-5 py-4">
                        {locked ? (
                          <div className="w-60 rounded-lg border border-emerald-300 bg-emerald-100 px-3 py-2.5 text-xs font-semibold text-emerald-800">
                            <span className="flex items-center gap-1.5">
                              <Lock size={13} />
                              {selected?.name || "Assigned section"}
                            </span>
                            <span className="mt-0.5 block text-[10px] font-normal text-emerald-700">
                              Locked — cannot be changed
                            </span>
                          </div>
                        ) : (
                          <select
                            value={assignments[a.id] ?? ""}
                            onChange={(e) =>
                              setAssignments((p) => ({
                                ...p,
                                [a.id]: e.target.value,
                              }))
                            }
                            className="w-60 rounded-lg border border-emerald-200 bg-white px-3 py-2.5 text-xs text-emerald-700 outline-none focus:border-emerald-200"
                          >
                            <option value="">— Unassigned —</option>
                            {sectionOptions.length === 0 && (
                              <option value="" disabled>
                                No {getTrackLabel(studentTrack)} sections
                              </option>
                            )}
                            {sectionOptions.map((s) => (
                              <option key={s.id} value={String(s.id)}>
                                {s.name}
                                {s.school_year ? ` · ${s.school_year}` : ""}
                              </option>
                            ))}
                          </select>
                        )}
                      </td>
                      <td className="px-5 py-4 text-xs text-emerald-900">
                        {selected?.adviser_name ? (
                          <span className="font-medium text-emerald-700">
                            {selected.adviser_name}
                          </span>
                        ) : (
                          <span className="text-emerald-800">Not assigned</span>
                        )}
                        {selected?.capacity != null && (
                          <span className="block mt-0.5 text-[10px] text-emerald-800">
                            Class capacity: {selected.capacity}
                          </span>
                        )}
                      </td>
                      <td className="px-5 py-4">
                        {locked ? (
                          <span
                            title="Section assignments are final and cannot be changed once saved."
                            className="inline-flex items-center gap-1.5 rounded-lg border border-emerald-300 bg-emerald-100 px-3 py-2 text-xs font-semibold text-emerald-800"
                          >
                            <Lock size={14} />
                            Locked
                          </span>
                        ) : (
                          <button
                            onClick={() => save(a.id)}
                            disabled={saving === a.id}
                            className="inline-flex items-center gap-1.5 rounded-lg bg-yellow-300 px-3 py-2 text-xs font-bold text-emerald-950 hover:bg-yellow-300 disabled:opacity-60"
                          >
                            <Save size={14} />
                            {saving === a.id ? "Saving…" : "Save"}
                          </button>
                        )}
                      </td>
                    </tr>
                  );
                })
              ) : (
                <tr>
                  <td
                    colSpan={7}
                    className="px-5 py-10 text-center text-emerald-900"
                  >
                    <Users className="mx-auto mb-2 opacity-50" size={24} />
                    No {statusFilter} students found.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {showSectionForm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4 sm:p-6">
          <div className="w-full max-w-xl overflow-hidden rounded-xl border border-emerald-200 bg-white shadow-2xl">
            <div className="flex items-center justify-between border-b border-emerald-200 px-5 py-4">
              <h2 className="font-bold">
                {editingSection ? "Edit Section" : "Add Section"}
              </h2>
              <button
                onClick={closeSectionForm}
                aria-label="Close"
                className="rounded-lg p-1 text-emerald-800 hover:bg-emerald-50"
              >
                <X size={18} />
              </button>
            </div>

            <form onSubmit={submitSectionForm} className="space-y-4 p-5">
              <label className="block text-xs font-semibold text-emerald-900">
                Section Name *
                <input
                  value={formName}
                  onChange={(e) => setFormName(e.target.value)}
                  required
                  maxLength={120}
                  placeholder="e.g. 11 - STEM Einstein"
                  className="mt-2 block w-full rounded-lg border border-emerald-200 bg-white px-3 py-2.5 text-sm text-emerald-950 outline-none focus:border-emerald-400"
                />
              </label>

              <label className="block text-xs font-semibold text-emerald-900">
                Adviser Name
                <input
                  value={formAdviser}
                  onChange={(e) => setFormAdviser(e.target.value)}
                  maxLength={120}
                  placeholder="e.g. Mrs. Maria Santos"
                  className="mt-2 block w-full rounded-lg border border-emerald-200 bg-white px-3 py-2.5 text-sm text-emerald-950 outline-none focus:border-emerald-400"
                />
              </label>

              <label className="block text-xs font-semibold text-emerald-900">
                Track
                <select
                  value={formTrack}
                  onChange={(e) => {
                    const nextTrack = e.target.value;
                    setFormTrack(nextTrack);
                    const validClusters = getClustersForTrack(nextTrack);
                    if (
                      validClusters.length > 0 &&
                      formStrand &&
                      !validClusters.includes(formStrand)
                    ) {
                      setFormStrand("");
                    }
                  }}
                  className="mt-2 block w-full rounded-lg border border-emerald-200 bg-white px-3 py-2.5 text-sm text-emerald-950 outline-none focus:border-emerald-400"
                >
                  <option value="">— Not set —</option>
                  {TRACKS.map((track) => (
                    <option key={track.value} value={track.value}>
                      {track.label}
                    </option>
                  ))}
                </select>
              </label>

              <div className="grid gap-4 sm:grid-cols-2">
                <label className="block text-xs font-semibold text-emerald-900">
                  Grade Level
                  <input
                    value={formGradeLevel}
                    onChange={(e) => setFormGradeLevel(e.target.value)}
                    maxLength={60}
                    placeholder="e.g. Grade 11"
                    className="mt-2 block w-full rounded-lg border border-emerald-200 bg-white px-3 py-2.5 text-sm text-emerald-950 outline-none focus:border-emerald-400"
                  />
                </label>

                <label className="block text-xs font-semibold text-emerald-900">
                  Cluster
                  <select
                    value={formStrand}
                    onChange={(e) => setFormStrand(e.target.value)}
                    className="mt-2 block w-full rounded-lg border border-emerald-200 bg-white px-3 py-2.5 text-sm text-emerald-950 outline-none focus:border-emerald-400"
                  >
                    <option value="">— Not set —</option>
                    {formStrand && !clusterOptions.includes(formStrand) && (
                      <option value={formStrand}>{formStrand}</option>
                    )}
                    {clusterOptions.map((cluster) => (
                      <option key={cluster} value={cluster}>
                        {cluster}
                      </option>
                    ))}
                  </select>
                </label>

                <label className="block text-xs font-semibold text-emerald-900">
                  School Year
                  <input
                    value={formSchoolYear}
                    onChange={(e) => setFormSchoolYear(e.target.value)}
                    maxLength={40}
                    placeholder="e.g. 2025-2026"
                    className="mt-2 block w-full rounded-lg border border-emerald-200 bg-white px-3 py-2.5 text-sm text-emerald-950 outline-none focus:border-emerald-400"
                  />
                </label>

                <label className="block text-xs font-semibold text-emerald-900">
                  Capacity
                  <input
                    value={formCapacity}
                    onChange={(e) => setFormCapacity(e.target.value)}
                    type="number"
                    min={1}
                    placeholder="e.g. 45"
                    className="mt-2 block w-full rounded-lg border border-emerald-200 bg-white px-3 py-2.5 text-sm text-emerald-950 outline-none focus:border-emerald-400"
                  />
                </label>
              </div>

              <div className="flex justify-end gap-2 border-t border-emerald-200 pt-4">
                <button
                  type="button"
                  onClick={closeSectionForm}
                  disabled={savingSection}
                  className="rounded-lg border border-emerald-200 px-4 py-2.5 text-xs font-semibold text-emerald-900 hover:bg-emerald-50 disabled:opacity-60"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={savingSection}
                  className="inline-flex items-center gap-1.5 rounded-lg bg-yellow-300 px-4 py-2.5 text-xs font-bold text-emerald-950 hover:bg-yellow-300 disabled:opacity-60"
                >
                  <Save size={14} />
                  {savingSection
                    ? "Saving…"
                    : editingSection
                      ? "Save Changes"
                      : "Add Section"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {confirmDelete && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4 sm:p-6">
          <div className="w-full max-w-md overflow-hidden rounded-xl border border-emerald-200 bg-white shadow-2xl">
            <div className="flex items-center gap-3 border-b border-emerald-200 px-5 py-4">
              <AlertCircle className="text-red-600" size={18} />
              <h2 className="font-bold">Delete Section</h2>
            </div>

            <div className="space-y-3 p-5 text-sm text-emerald-900">
              <p>
                Are you sure you want to delete{" "}
                <span className="font-semibold">{confirmDelete.name}</span>?
              </p>
              {assignedCount(confirmDelete.id) > 0 && (
                <p className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-xs text-amber-800">
                  {assignedCount(confirmDelete.id)} student
                  {assignedCount(confirmDelete.id) === 1 ? "" : "s"} will be
                  unassigned from this section. Their records are not deleted.
                </p>
              )}
            </div>

            <div className="flex justify-end gap-2 border-t border-emerald-200 px-5 py-4">
              <button
                type="button"
                onClick={() => setConfirmDelete(null)}
                disabled={deletingSection}
                className="rounded-lg border border-emerald-200 px-4 py-2.5 text-xs font-semibold text-emerald-900 hover:bg-emerald-50 disabled:opacity-60"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={confirmDeleteSection}
                disabled={deletingSection}
                className="inline-flex items-center gap-1.5 rounded-lg bg-red-600 px-4 py-2.5 text-xs font-bold text-white hover:bg-red-700 disabled:opacity-60"
              >
                <Trash2 size={14} />
                {deletingSection ? "Deleting…" : "Delete Section"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
