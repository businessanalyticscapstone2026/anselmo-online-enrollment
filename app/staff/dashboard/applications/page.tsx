"use client";

import { useEffect, useMemo, useState, useCallback } from "react";
import {
  ENROLLMENT_STATUS_OPTIONS,
  getEnrollmentStatusLabel,
  normalizeEnrollmentStatus,
} from "@/lib/enrollmentStatus";
import { supabase } from "@/lib/supabaseClient";
import { filterVisibleApplications } from "@/lib/applicationVisibility";
import {
  Search,
  RefreshCw,
  Eye,
  X,
  FileText,
  AlertCircle,
  User,
  ClipboardCheck,
  CheckCircle2,
  Clock3,
  Save,
  Lock,
} from "lucide-react";

type AppRecord = Record<string, unknown>;

const firstText = (values: unknown[]) => {
  const value = values.find(
    (candidate) => typeof candidate === "string" && candidate.trim()
  );

  return typeof value === "string" ? value.trim() : "";
};

const parseObject = (value: unknown): AppRecord => {
  if (typeof value === "string") {
    try {
      const parsed = JSON.parse(value);
      return parsed && typeof parsed === "object" && !Array.isArray(parsed)
        ? (parsed as AppRecord)
        : {};
    } catch {
      return {};
    }
  }

  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as AppRecord)
    : {};
};

const formatAddressValue = (value: unknown): string => {
  if (typeof value === "string") return value.trim();

  const address = parseObject(value);
  return [
    firstText([address.houseNo, address.house_no]),
    firstText([address.street]),
    firstText([address.barangay]),
    firstText([address.municipality, address.city]),
    firstText([address.province]),
    firstText([address.zipCode, address.zip_code]),
    firstText([address.country]),
  ]
    .filter(Boolean)
    .join(", ");
};

const booleanLabel = (value: unknown): string => {
  if (typeof value === "boolean") return value ? "Yes" : "No";
  const text = String(value ?? "").trim();
  if (/^(true|yes|1)$/i.test(text)) return "Yes";
  if (/^(false|no|0)$/i.test(text)) return "No";
  return text || "—";
};

const arrayLabel = (value: unknown): string => {
  if (Array.isArray(value)) {
    return value.map(String).filter(Boolean).join(", ") || "—";
  }
  return firstText([value]) || "—";
};

const guardianName = (info: GuardianInfo | null): string =>
  info
    ? [info.firstName, info.middleName, info.lastName].filter(Boolean).join(" ")
    : "";

const formatAge = (record: AppRecord, details: AppRecord): string => {
  const direct = record.age ?? details.age;

  if (typeof direct === "number" && Number.isFinite(direct)) {
    return String(Math.trunc(direct));
  }

  if (typeof direct === "string" && direct.trim()) {
    return direct.trim();
  }

  const birth = firstText([record.birth_date, details.birth_date]);
  if (!birth) return "—";

  const date = new Date(birth.length === 10 ? `${birth}T00:00:00` : birth);
  if (Number.isNaN(date.getTime())) return "—";

  const today = new Date();
  let age = today.getFullYear() - date.getFullYear();
  const monthDiff = today.getMonth() - date.getMonth();

  if (monthDiff < 0 || (monthDiff === 0 && today.getDate() < date.getDate())) {
    age -= 1;
  }

  return age >= 0 ? String(age) : "—";
};

const getCluster = (record: AppRecord) => {
  const direct = firstText([
    record.selected_cluster,
    record.cluster,
    record.cluster_name,
    record.preferred_cluster,
  ]);

  if (direct) return direct;

  const details = record.student_details;
  if (details && typeof details === "object" && !Array.isArray(details)) {
    const nested = firstText([
      (details as AppRecord).selected_cluster,
      (details as AppRecord).cluster,
    ]);

    if (nested) return nested;
  }

  return firstText([record.track, record.selected_track, record.program]);
};

const isStatusFinalized = (record: AppRecord) =>
  normalizeEnrollmentStatus(record.status) !== "pending";

const formatCluster = (value: string) => {
  if (!value) return "Not provided";

  const normalized = value.toLowerCase();

  if (normalized === "academic") return "Academic Track";
  if (normalized === "techpro" || normalized === "tvl") {
    return "Technical-Vocational-Livelihood";
  }

  return value;
};

type GuardianInfo = {
  firstName: string;
  middleName: string;
  lastName: string;
  contactNumber: string;
};

const hasGuardianInfo = (info: GuardianInfo) =>
  Boolean(info.firstName || info.middleName || info.lastName || info.contactNumber);

// Reads one guardian (father / mother / legal guardian) from the dedicated
// columns, falling back to the student_details jsonb payload that older
// applications used before the dedicated columns were populated.
const getGuardianInfo = (
  record: AppRecord,
  columnPrefix: "father" | "mother" | "guardian",
  detailsKey: string
): GuardianInfo | null => {
  const fromColumns: GuardianInfo = {
    firstName: firstText([record[`${columnPrefix}_first_name`]]),
    middleName: firstText([record[`${columnPrefix}_middle_name`]]),
    lastName: firstText([record[`${columnPrefix}_last_name`]]),
    contactNumber: firstText([record[`${columnPrefix}_contact_number`]]),
  };

  if (hasGuardianInfo(fromColumns)) return fromColumns;

  const details = record.student_details;
  if (!details || typeof details !== "object" || Array.isArray(details)) return null;

  const guardians = (details as AppRecord).guardians;
  if (!guardians || typeof guardians !== "object" || Array.isArray(guardians)) {
    return null;
  }

  const guardian = (guardians as AppRecord)[detailsKey];
  if (!guardian || typeof guardian !== "object" || Array.isArray(guardian)) {
    return null;
  }

  const guardianRecord = guardian as AppRecord;
  const fromDetails: GuardianInfo = {
    firstName: firstText([guardianRecord.firstName, guardianRecord.first_name]),
    middleName: firstText([guardianRecord.middleName, guardianRecord.middle_name]),
    lastName: firstText([guardianRecord.lastName, guardianRecord.last_name]),
    contactNumber: firstText([guardianRecord.contactNumber, guardianRecord.contact_number]),
  };

  return hasGuardianInfo(fromDetails) ? fromDetails : null;
};

const ignored = new Set([
  "id",
  "user_id",
  "lrn",
  "learner_reference_number",
  "grade_level",
  "strand",
  "track",
  "selected_track",
  "preferred_strand_id",
  "assigned_section_id",
  "upload_token_hash",
  "upload_token_expires_at",
  "submitted_at",
  "updated_at",
]);

export default function ApplicationsPage() {
  const [records, setRecords] = useState<AppRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<"pending" | "enrolled">(
    "pending"
  );
  const [selected, setSelected] = useState<AppRecord | null>(null);
  const [previewFile, setPreviewFile] = useState<{ label: string; url: string } | null>(null);
  const [statusTarget, setStatusTarget] = useState<AppRecord | null>(null);
  const [statusDraft, setStatusDraft] = useState("pending");
  const [statusRemarks, setStatusRemarks] = useState("");
  const [statusSaving, setStatusSaving] = useState(false);
  const [statusError, setStatusError] = useState("");
  const [statusMessage, setStatusMessage] = useState("");

  const load = useCallback(
    async (
      showLoading = true,
      filter: "pending" | "enrolled" = statusFilter
    ) => {
      if (showLoading) {
        setLoading(true);
      }
      setError("");

      try {
        const { data, error: fetchErr } = await supabase
          .from("student_applications")
          .select("*")
          .order("submitted_at", { ascending: false })
          .limit(1000);

        if (fetchErr) {
          setError(fetchErr.message);
        } else {
          const visibleRecords = filterVisibleApplications(
            (data ?? []) as AppRecord[]
          );
          setRecords(
            visibleRecords.filter((record) =>
              filter === "enrolled"
                ? normalizeEnrollmentStatus(record.status) === "enrolled"
                : !isStatusFinalized(record)
            )
          );
        }
      } catch (err: unknown) {
        setError(
          err instanceof Error ? err.message : "Error loading applications"
        );
      } finally {
        if (showLoading) {
          setLoading(false);
        }
      }
    },
    [statusFilter]
  );

  const openStatusEditor = (record: AppRecord) => {
    if (isStatusFinalized(record)) return;

    setStatusTarget(record);
    setStatusDraft(normalizeEnrollmentStatus(record.status));
    setStatusRemarks(
      typeof record.registrar_remarks === "string" ? record.registrar_remarks : ""
    );
    setStatusError("");
    setStatusMessage("");
  };

  const closeStatusEditor = () => {
    if (statusSaving) return;
    setStatusTarget(null);
    setStatusError("");
    setStatusMessage("");
  };

  const saveStatus = async () => {
    if (!statusTarget || statusSaving) return;

    if (isStatusFinalized(statusTarget)) {
      setStatusError(
        "This enrollment status has already been finalized and can no longer be changed."
      );
      return;
    }

    const id = String(statusTarget.id);
    const targetStatus = normalizeEnrollmentStatus(statusDraft);
    const targetRemark = statusRemarks.trim();

    if (targetStatus === "pending") {
      setStatusError(
        "Select Enrolled or Rejected to finalize the enrollment status."
      );
      return;
    }

    setStatusSaving(true);
    setStatusError("");
    setStatusMessage("");

    try {
      const {
        data: { session },
        error: sessionError,
      } = await supabase.auth.getSession();

      if (sessionError) {
        throw new Error(`Could not verify your staff session: ${sessionError.message}`);
      }
      if (!session) {
        throw new Error("Your staff session has expired. Please sign in again.");
      }

      const response = await fetch("/api/staff/update-status", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          applicationId: id,
          status: targetStatus,
          remarks: targetRemark,
        }),
      });

      const result = (await response.json()) as {
        success?: boolean;
        error?: string;
        data?: {
          status?: string;
          registrar_remarks?: string | null;
          statusChanged?: boolean;
          emailSent?: boolean;
          emailError?: string | null;
        };
      };

      if (!response.ok || !result.success) {
        throw new Error(result.error || "Error saving status update");
      }

      const verifiedStatus = normalizeEnrollmentStatus(
        result.data?.status ?? targetStatus
      );
      const savedRemark =
        result.data?.registrar_remarks !== undefined &&
        result.data?.registrar_remarks !== null
          ? String(result.data.registrar_remarks)
          : null;

      if (typeof window !== "undefined") {
        try {
          const raw = localStorage.getItem("staff_registrar_remarks");
          const existing = raw ? JSON.parse(raw) : {};
          if (savedRemark !== null) {
            existing[id] = savedRemark;
          } else {
            delete existing[id];
          }
          localStorage.setItem(
            "staff_registrar_remarks",
            JSON.stringify(existing)
          );
        } catch (cacheError) {
          void cacheError;
        }
      }

      const updatedFields = {
        status: verifiedStatus,
        registrar_remarks: savedRemark,
      };

      // The status is now finalized, so the record leaves the pending list.
      setRecords((prev) =>
        prev.filter((record) => String(record.id) !== id)
      );
      setSelected((prev) =>
        prev && String(prev.id) === id ? { ...prev, ...updatedFields } : prev
      );
      setStatusTarget((prev) =>
        prev && String(prev.id) === id ? { ...prev, ...updatedFields } : prev
      );
      setStatusDraft(verifiedStatus);
      setStatusRemarks(savedRemark ?? "");

      const emailNotice = result.data?.emailSent
        ? " A notification email was sent to the student's registered email."
        : result.data?.statusChanged && result.data?.emailError
          ? ` The student could not be notified by email: ${result.data.emailError}`
          : "";

      setStatusMessage(
        `Enrollment status successfully updated to "${getEnrollmentStatusLabel(
          verifiedStatus
        )}".${emailNotice}`
      );
    } catch (err: unknown) {
      setStatusError(
        err instanceof Error ? err.message : "Error saving status update"
      );
    } finally {
      setStatusSaving(false);
    }
  };

  useEffect(() => {
    let cancelled = false;
    let reloadTimeout: number | undefined;

    const initialLoad = window.setTimeout(() => {
      void load(true, statusFilter);
    }, 0);

    const scheduleReload = () => {
      if (cancelled) return;

      if (reloadTimeout) {
        window.clearTimeout(reloadTimeout);
      }

      reloadTimeout = window.setTimeout(() => {
        reloadTimeout = undefined;
        void load(false, statusFilter);
      }, 400);
    };

    const channel = supabase
      .channel(`staff-applications-live-${Date.now()}`)
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "student_applications",
        },
        scheduleReload
      )
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "sections",
        },
        scheduleReload
      )
      .subscribe();

    return () => {
      cancelled = true;
      window.clearTimeout(initialLoad);

      if (reloadTimeout) {
        window.clearTimeout(reloadTimeout);
      }

      supabase.removeChannel(channel);
    };
  }, [load, statusFilter]);

  const filtered = useMemo(
    () =>
      records.filter((r) => {
        const full = `${r.first_name ?? ""} ${r.middle_name ?? ""} ${r.last_name ?? ""} ${r.email ?? ""} ${r.contact_number ?? ""} ${r.id ?? ""}`.toLowerCase();
        return full.includes(search.toLowerCase());
      }),
    [records, search]
  );

  // Extract file/document URLs
  const fileCandidates = useMemo(() => {
    if (!selected) return [];
    const results: { label: string; url: string }[] = [];
    const seen = new Set<string>();

    const addFile = (label: string, rawUrlOrPath: unknown) => {
      if (!rawUrlOrPath || typeof rawUrlOrPath !== "string") return;
      const val = rawUrlOrPath.trim();
      if (!val || seen.has(val)) return;
      seen.add(val);

      if (/^https?:\/\//i.test(val)) {
        results.push({ label: label.replaceAll("_", " "), url: val });
      } else {
        // Resolve storage URL from 'enrollment-documents.' bucket (or requirements fallback)
        const { data: d1 } = supabase.storage
          .from("enrollment-documents.")
          .getPublicUrl(val);
        const resolvedUrl = d1?.publicUrl || "";
        if (resolvedUrl) {
          results.push({ label: label.replaceAll("_", " "), url: resolvedUrl });
        }
      }
    };

    // 1. Check requirements_documents JSONB
    let reqDocs: Record<string, unknown> = {};
    if (selected.requirements_documents) {
      if (typeof selected.requirements_documents === "object") {
        reqDocs = selected.requirements_documents as Record<string, unknown>;
      } else if (typeof selected.requirements_documents === "string") {
        try {
          reqDocs = JSON.parse(selected.requirements_documents);
        } catch {
          // ignore
        }
      }
    }

    if (reqDocs) {
      if (reqDocs.birth_certificate_url) addFile("Birth Certificate", reqDocs.birth_certificate_url);
      if (reqDocs.report_card_url) addFile("Grade 10 Report Card", reqDocs.report_card_url);
      if (reqDocs.other_requirement_url) addFile("Other Requirements (Form 137)", reqDocs.other_requirement_url);

      // Check object variants e.g. reqDocs.birth_certificate.url
      if (typeof reqDocs.birth_certificate === "object" && reqDocs.birth_certificate !== null) {
        const bc = reqDocs.birth_certificate as Record<string, unknown>;
        if (bc.signed_url || bc.url) addFile("Birth Certificate", bc.signed_url || bc.url);
      }
      if (typeof reqDocs.report_card === "object" && reqDocs.report_card !== null) {
        const rc = reqDocs.report_card as Record<string, unknown>;
        if (rc.signed_url || rc.url) addFile("Grade 10 Report Card", rc.signed_url || rc.url);
      }
      if (typeof reqDocs.other_requirement === "object" && reqDocs.other_requirement !== null) {
        const ot = reqDocs.other_requirement as Record<string, unknown>;
        if (ot.signed_url || ot.url) addFile("Other Requirements", ot.signed_url || ot.url);
      }
    }

    // 2. Also check top-level columns
    Object.entries(selected).forEach(([k, v]) => {
      if (ignored.has(k) || /token/i.test(k)) return;

      if (
        /file|document|report_card|birth_certificate|requirement|upload|url|path/i.test(
          k
        ) &&
        v &&
        typeof v === "string"
      ) {
        addFile(k, v);
      }
    });

    return results;
  }, [selected]);

  const detail = useMemo(() => {
    if (!selected) return null;

    const details = parseObject(selected.student_details);
    const requirements = parseObject(selected.requirements_documents);
    const fatherInfo = getGuardianInfo(selected, "father", "father");
    const motherInfo = getGuardianInfo(selected, "mother", "mother");
    const guardianInfo = getGuardianInfo(selected, "guardian", "legal_guardian");

    const ipCommunityType = firstText([
      selected.ip_community_type,
      details.ip_community_type,
    ]);
    const fourPsHouseholdId = firstText([
      selected.four_ps_household_id,
      details.four_ps_household_id,
    ]);

    return {
      name:
        [selected.first_name, selected.middle_name, selected.last_name]
          .filter(Boolean)
          .map(String)
          .join(" ") || "—",
      lrn:
        firstText([
          selected.lrn,
          selected.learner_reference_number,
          details.lrn,
          requirements.lrn,
        ]) || "—",
      extension: firstText([selected.extension, details.extension]) || "—",
      email: firstText([
        selected.email,
        details.email,
        requirements.student_email,
      ]),
      collegeCourse:
        firstText([selected.college_course, details.college_course]) || "—",
      birthDate: firstText([selected.birth_date]),
      age: formatAge(selected, details),
      placeOfBirth: firstText([
        selected.place_of_birth,
        details.place_of_birth,
      ]),
      gender: firstText([
        selected.gender,
        selected.sex,
        details.gender,
        details.sex,
      ]),
      religion: firstText([selected.religion, details.religion]),
      contactNumber: firstText([
        selected.contact_number,
        details.contact_number,
      ]),
      isIpCommunityMember: ipCommunityType ? "Yes" : "No",
      ipCommunityType: ipCommunityType || "—",
      isFourPsBeneficiary: fourPsHouseholdId ? "Yes" : "No",
      fourPsHouseholdId: fourPsHouseholdId || "—",
      sameAsCurrentAddress: booleanLabel(details.same_as_current_address),
      currentAddress:
        firstText([selected.current_address, selected.address]) ||
        formatAddressValue(details.current_address) ||
        firstText([details.address]),
      permanentAddress:
        firstText([selected.permanent_address]) ||
        formatAddressValue(details.permanent_address),
      fatherName:
        firstText([selected.father_name]) || guardianName(fatherInfo) || "—",
      fatherMiddleName: fatherInfo?.middleName || "—",
      fatherContact:
        firstText([
          selected.father_contact_number,
          fatherInfo?.contactNumber,
        ]) || "—",
      motherName:
        firstText([selected.mother_name]) || guardianName(motherInfo) || "—",
      motherMiddleName: motherInfo?.middleName || "—",
      motherContact:
        firstText([
          selected.mother_contact_number,
          motherInfo?.contactNumber,
        ]) || "—",
      legalGuardianName:
        firstText([selected.legal_guardian_name]) ||
        guardianName(guardianInfo) ||
        "—",
      legalGuardianMiddleName: guardianInfo?.middleName || "—",
      legalGuardianContact:
        firstText([
          selected.legal_guardian_contact_number,
          guardianInfo?.contactNumber,
        ]) || "—",
      specialNeedsGroup:
        firstText([
          selected.special_needs_group,
          details.special_needs_group,
        ]) || "—",
      specialNeedsProgram: booleanLabel(
        selected.special_needs_program ?? details.special_needs_program
      ),
      specialNeedsCondition:
        firstText([
          selected.special_needs_condition,
          details.special_needs_condition,
        ]) || "—",
      specialNeedsDetail:
        firstText([
          selected.special_needs_detail,
          details.special_needs_detail,
        ]) || "—",
      hasPwdId: booleanLabel(selected.has_pwd_id ?? details.has_pwd_id),
      lastGradeLevelCompleted:
        firstText([
          selected.last_grade_level_completed,
          details.last_grade_level_completed,
        ]) || "—",
      lastSchoolYearCompleted:
        firstText([
          selected.last_school_year_completed,
          details.last_school_year_completed,
        ]) || "—",
      lastSchoolAttended:
        firstText([
          selected.last_school_attended,
          details.last_school_attended,
        ]) || "—",
      lastSchoolId:
        firstText([selected.last_school_id, details.last_school_id]) || "—",
      semester: firstText([selected.semester, details.semester]) || "—",
      track:
        firstText([
          selected.track,
          selected.selected_track,
          details.selected_track,
        ]) || "—",
      strand: getCluster(selected) || "—",
      preferredModalities: arrayLabel(
        selected.preferred_distance_modalities ??
          details.preferred_distance_modalities
      ),
    };
  }, [selected]);

  const statusFinalized = statusTarget ? isStatusFinalized(statusTarget) : false;

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.18em] text-emerald-700">
            Registrar Workspace
          </p>
          <h1 className="mt-2 text-3xl font-extrabold">Applications & Requirements</h1>
          <p className="mt-2 text-sm text-emerald-900">
            Review pending enrollment forms, credentials, and student qualifications.
            Enrolled students are moved to the Section &amp; Adviser module.
          </p>
        </div>
        <button
          onClick={() => load()}
          className="inline-flex items-center justify-center gap-2 rounded-lg border border-emerald-200 px-4 py-2.5 text-xs font-semibold hover:bg-emerald-50"
        >
          <RefreshCw size={14} className={loading ? "animate-spin" : ""} />
          Refresh
        </button>
      </div>

      {error && (
        <div className="flex gap-2 rounded-lg border border-red-200 bg-red-400/10 p-3 text-sm text-red-700">
          <AlertCircle size={18} className="shrink-0" />
          <span>{error}</span>
        </div>
      )}

      {/* Filter Toolbar */}
      <div className="flex flex-col gap-3 rounded-2xl border border-emerald-200 bg-emerald-50 p-4 md:flex-row">
        <div className="relative flex-1">
          <Search
            size={17}
            className="absolute left-3 top-1/2 -translate-y-1/2 text-emerald-800"
          />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search student name, email, or application ID…"
            className="w-full rounded-lg border border-emerald-200 bg-white py-3 pl-10 pr-3 text-sm text-emerald-700 outline-none placeholder:text-emerald-800 focus:border-emerald-200"
          />
        </div>

        <label className="inline-flex items-center gap-2 rounded-lg border border-emerald-200 bg-white px-3 py-3 text-xs font-semibold text-emerald-700">
          <Clock3 size={14} />
          <span className="sr-only">Filter applications by status</span>
          <select
            value={statusFilter}
            onChange={(e) =>
              setStatusFilter(e.target.value as "pending" | "enrolled")
            }
            className="bg-transparent text-xs font-semibold text-emerald-700 outline-none"
            aria-label="Filter applications by status"
          >
            <option value="pending">Pending</option>
            <option value="enrolled">Enrolled</option>
          </select>
        </label>
      </div>

      {/* Applications Table */}
      <div className="overflow-hidden rounded-2xl border border-emerald-200 bg-emerald-50">
        <div className="flex items-center justify-between border-b border-emerald-200 px-5 py-4">
          <h2 className="font-semibold">
            {statusFilter === "enrolled"
              ? "Enrolled Applications"
              : "Pending Applications"}
          </h2>
          <span className="text-xs text-emerald-700 font-mono">
            {filtered.length} record{filtered.length === 1 ? "" : "s"}
          </span>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full table-fixed text-left text-sm">
            <colgroup>
              <col className="w-[22%]" />
              <col className="w-[18%]" />
              <col className="w-[20%]" />
              <col className="w-[12%]" />
              <col className="w-[10%]" />
              <col className="w-[18%]" />
            </colgroup>
            <thead className="bg-emerald-50 text-[10px] uppercase tracking-wider text-emerald-900">
              <tr>
                <th className="px-3 py-3">Student</th>
                <th className="px-3 py-3">Cluster</th>
                <th className="px-3 py-3">Contact</th>
                <th className="px-3 py-3">Submitted</th>
                <th className="px-3 py-3">Status</th>
                <th className="px-3 py-3">Review</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-emerald-200/10">
              {loading ? (
                <tr>
                  <td
                    colSpan={6}
                    className="px-3 py-12 text-center text-emerald-900"
                  >
                    Loading student records…
                  </td>
                </tr>
              ) : filtered.length > 0 ? (
                filtered.map((r) => (
                  <tr key={String(r.id)} className="hover:bg-emerald-50">
                    <td className="wrap-break-word px-3 py-4">
                      <p className="font-semibold">
                        {[r.first_name, r.middle_name, r.last_name]
                          .filter(Boolean)
                          .map(String)
                          .join(" ") || "Unnamed applicant"}
                      </p>
                      <p className="mt-1 font-mono text-[10px] text-emerald-700">
                        {String(r.id).slice(0, 8)}
                      </p>
                    </td>
                    <td className="wrap-break-word px-3 py-4 text-xs font-semibold text-emerald-700">
                      {formatCluster(getCluster(r))}
                    </td>
                    <td className="wrap-break-word px-3 py-4 text-xs text-emerald-900">
                      <p>{String(r.email || "—")}</p>
                      <p className="text-[11px] text-emerald-800">
                        {String(r.contact_number || "")}
                      </p>
                    </td>
                    <td className="wrap-break-word px-3 py-4 text-xs text-emerald-900">
                      {r.submitted_at
                        ? new Date(String(r.submitted_at)).toLocaleDateString()
                        : "—"}
                    </td>
                    <td className="px-3 py-4">
                      <span className="inline-block rounded-full border border-emerald-200 bg-emerald-50 px-2.5 py-1 text-[10px] capitalize">
                        {getEnrollmentStatusLabel(r.status)}
                      </span>
                    </td>
                    <td className="px-3 py-4">
                      <div className="flex flex-col items-stretch gap-2">
                        <button
                          onClick={() => setSelected(r)}
                          className="inline-flex w-full items-center justify-center gap-1.5 rounded-lg border border-emerald-200 px-2 py-2 text-xs font-semibold text-emerald-700 hover:bg-amber-50"
                        >
                          <Eye size={14} />
                          View record
                        </button>
                        {isStatusFinalized(r) ? (
                          <span
                            title="Enrollment status updates are limited to one per student and cannot be changed."
                            className="inline-flex w-full items-center justify-center gap-1.5 rounded-lg border border-emerald-300 bg-emerald-100 px-2 py-2 text-center text-xs font-semibold text-emerald-800"
                          >
                            <Lock size={14} className="shrink-0" />
                            Status finalized
                          </span>
                        ) : (
                          <button
                            onClick={() => openStatusEditor(r)}
                            className="inline-flex w-full items-center justify-center gap-1.5 rounded-lg border border-emerald-200 px-2 py-2 text-xs font-semibold text-emerald-700 hover:bg-emerald-100"
                          >
                            <ClipboardCheck size={14} />
                            Update status
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                ))
              ) : (
                <tr>
                  <td
                    colSpan={6}
                    className="px-3 py-12 text-center text-emerald-900"
                  >
                    {statusFilter === "enrolled"
                      ? "No enrolled applications found."
                      : "No pending applications found."}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Detail Inspection Modal */}
      {selected && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4 sm:p-6"
          onClick={() => {
            setSelected(null);
            setPreviewFile(null);
          }}
        >
          <div
            role="dialog"
            aria-modal="true"
            className="flex h-[85vh] w-full max-w-3xl flex-col overflow-hidden rounded-xl border border-emerald-200 bg-white text-emerald-700 shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex shrink-0 items-center justify-between border-b border-emerald-200 bg-white px-5 py-4">
              <div>
                <h2 className="text-lg font-bold">
                  {[selected.first_name, selected.middle_name, selected.last_name]
                    .filter(Boolean)
                    .map(String)
                    .join(" ") || "Student Application"}
                </h2>
                <p className="text-xs text-emerald-700 font-mono">
                  ID: {String(selected.id)}
                </p>
              </div>
              <button
                onClick={() => {
                  setSelected(null);
                  setPreviewFile(null);
                }}
                className="rounded-lg p-2 text-emerald-900 hover:bg-emerald-50 hover:text-emerald-950"
                aria-label="Close"
              >
                <X size={18} />
              </button>
            </div>

            <div className="min-h-0 flex-1 overflow-y-auto">
              {/* Quick Status Pill in Modal */}
              <div className="flex items-center justify-between border-b border-emerald-200 bg-emerald-50 px-5 py-3 text-xs">
                <span className="text-emerald-800">Status:</span>
                <span className="font-bold uppercase tracking-wide text-emerald-700">
                  {getEnrollmentStatusLabel(selected.status)}
                </span>
              </div>

              {/* Details Grid */}
              <div className="space-y-6 p-5">
              <div>
                <h3 className="mb-3 flex items-center gap-2 text-xs font-bold uppercase tracking-wider text-emerald-700">
                  <User size={15} /> Student Application
                </h3>
                <div className="grid gap-2.5 sm:grid-cols-2">
                  <DetailField label="Student Name" value={detail?.name ?? "—"} />
                  <DetailField
                    label="Learner Reference Number (LRN)"
                    value={detail?.lrn ?? "—"}
                  />
                  <DetailField
                    label="Extension (Jr., III, etc.)"
                    value={detail?.extension ?? "—"}
                  />
                  <DetailField
                    label="Email Address"
                    value={detail?.email ?? "—"}
                  />
                  <DetailField
                    label="College Course Intended"
                    value={detail?.collegeCourse ?? "—"}
                  />
                  <DetailField
                    label="Date of Birth"
                    value={detail?.birthDate ?? "—"}
                  />
                  <DetailField label="Age" value={detail?.age ?? "—"} />
                  <DetailField
                    label="Place of Birth"
                    value={detail?.placeOfBirth ?? "—"}
                  />
                  <DetailField label="Gender" value={detail?.gender ?? "—"} />
                  <DetailField
                    label="Religion"
                    value={detail?.religion ?? "—"}
                  />
                  <DetailField
                    label="Contact Number"
                    value={detail?.contactNumber ?? "—"}
                  />
                  <DetailField
                    label="IP Community Member"
                    value={detail?.isIpCommunityMember ?? "—"}
                  />
                  <DetailField
                    label="IP Community / Indigenous Cultural Community"
                    value={detail?.ipCommunityType ?? "—"}
                  />
                  <DetailField
                    label="4Ps Beneficiary"
                    value={detail?.isFourPsBeneficiary ?? "—"}
                  />
                  <DetailField
                    label="4Ps Household ID"
                    value={detail?.fourPsHouseholdId ?? "—"}
                  />
                  <DetailField
                    label="Current Address"
                    value={detail?.currentAddress ?? "—"}
                  />
                  <DetailField
                    label="Permanent Address"
                    value={detail?.permanentAddress ?? "—"}
                  />
                  <DetailField
                    label="Same as Current Address"
                    value={detail?.sameAsCurrentAddress ?? "—"}
                  />
                </div>
              </div>

              <div>
                <h3 className="mb-3 flex items-center gap-2 text-xs font-bold uppercase tracking-wider text-emerald-700">
                  <User size={15} /> Parent / Guardian Information
                </h3>
                <div className="grid gap-2.5 sm:grid-cols-2">
                  <DetailField
                    label="Father's Name"
                    value={detail?.fatherName ?? "—"}
                  />
                  <DetailField
                    label="Father's Middle Name"
                    value={detail?.fatherMiddleName ?? "—"}
                  />
                  <DetailField
                    label="Father's Contact Number"
                    value={detail?.fatherContact ?? "—"}
                  />
                  <DetailField
                    label="Mother's Name"
                    value={detail?.motherName ?? "—"}
                  />
                  <DetailField
                    label="Mother's Middle Name"
                    value={detail?.motherMiddleName ?? "—"}
                  />
                  <DetailField
                    label="Mother's Contact Number"
                    value={detail?.motherContact ?? "—"}
                  />
                  <DetailField
                    label="Legal Guardian Name"
                    value={detail?.legalGuardianName ?? "—"}
                  />
                  <DetailField
                    label="Legal Guardian Middle Name"
                    value={detail?.legalGuardianMiddleName ?? "—"}
                  />
                  <DetailField
                    label="Legal Guardian Contact Number"
                    value={detail?.legalGuardianContact ?? "—"}
                  />
                </div>
              </div>

              <div>
                <h3 className="mb-3 flex items-center gap-2 text-xs font-bold uppercase tracking-wider text-emerald-700">
                  <ClipboardCheck size={15} /> Enrollment Profile
                </h3>
                <div className="grid gap-2.5 sm:grid-cols-2">
                  <DetailField
                    label="Special Needs Education Program"
                    value={detail?.specialNeedsProgram ?? "—"}
                  />
                  <DetailField
                    label="Special Needs Group"
                    value={detail?.specialNeedsGroup ?? "—"}
                  />
                  <DetailField
                    label="Special Needs Condition"
                    value={detail?.specialNeedsCondition ?? "—"}
                  />
                  <DetailField
                    label="Special Needs Detail"
                    value={detail?.specialNeedsDetail ?? "—"}
                  />
                  <DetailField label="PWD ID" value={detail?.hasPwdId ?? "—"} />
                  <DetailField
                    label="Last School Year Completed"
                    value={detail?.lastSchoolYearCompleted ?? "—"}
                  />
                  <DetailField
                    label="Last School Attended"
                    value={detail?.lastSchoolAttended ?? "—"}
                  />
                  <DetailField
                    label="Last School ID"
                    value={detail?.lastSchoolId ?? "—"}
                  />
                  <DetailField label="Track" value={detail?.track ?? "—"} />
                  <DetailField label="Cluster" value={detail?.strand ?? "—"} />
                  <DetailField
                    label="Preferred Distance Modalities"
                    value={detail?.preferredModalities ?? "—"}
                  />
                </div>
              </div>

              {/* Documents */}
              <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-4">
                <h3 className="mb-3 flex items-center gap-2 font-semibold">
                  <FileText size={17} className="text-emerald-700" />
                  Upload Requirements
                </h3>
                {fileCandidates.length > 0 ? (
                  <div className="space-y-2">
                    {fileCandidates.map(({ label, url }) => (
                      <button
                        key={label}
                        type="button"
                        onClick={() => setPreviewFile({ label, url })}
                        className="flex w-full items-center gap-2 rounded-lg border border-emerald-200 bg-white p-3 text-left text-sm text-emerald-700 transition hover:bg-amber-50"
                      >
                        <Eye size={15} className="shrink-0" />
                        <span className="capitalize">{label}</span>
                        <span className="ml-auto text-xs text-emerald-800">
                          View
                        </span>
                      </button>
                    ))}
                  </div>
                ) : (
                  <p className="text-xs leading-5 text-emerald-800">
                    No attached document files were uploaded for this record, or files are stored as private attachments.
                  </p>
                )}
              </div>
            </div>
            </div>
          </div>
        </div>
      )}

      {statusTarget && (
        <div
          className="fixed inset-0 z-[70] flex items-center justify-center bg-black/70 p-4 sm:p-6"
          onClick={closeStatusEditor}
        >
          <div
            role="dialog"
            aria-modal="true"
            aria-label="Update enrollment status"
            className="flex h-[85vh] w-full max-w-3xl flex-col overflow-hidden rounded-xl border border-emerald-200 bg-white text-emerald-700 shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex shrink-0 items-start justify-between border-b border-emerald-200 bg-white px-5 py-4">
              <div>
                <h3 className="text-base font-bold text-emerald-900">
                  Update Enrollment Status
                </h3>
                <p className="mt-0.5 text-xs text-emerald-700">
                  {[statusTarget.first_name, statusTarget.middle_name, statusTarget.last_name]
                    .filter(Boolean)
                    .map(String)
                    .join(" ") || "Student Application"}{" "}
                  · ID: {String(statusTarget.id)}
                </p>
              </div>
              <button
                type="button"
                onClick={closeStatusEditor}
                disabled={statusSaving}
                className="rounded-lg p-2 text-emerald-900 hover:bg-emerald-50 hover:text-emerald-950 disabled:opacity-50"
                aria-label="Close"
              >
                <X size={18} />
              </button>
            </div>

            <div className="min-h-0 flex-1 space-y-4 overflow-y-auto p-5">
              <label className="block text-xs font-semibold uppercase tracking-wider text-emerald-800">
                Enrollment status
                <select
                  value={statusDraft}
                  onChange={(e) => setStatusDraft(e.target.value)}
                  disabled={statusSaving || statusFinalized}
                  className="mt-2 block w-full rounded-lg border border-emerald-200 bg-white px-3 py-3 text-sm text-emerald-700 outline-none focus:border-emerald-300 disabled:opacity-60"
                >
                  {ENROLLMENT_STATUS_OPTIONS.map((option) => (
                    <option
                      key={option.value}
                      value={option.value}
                      disabled={option.value === "pending"}
                    >
                      {option.label}
                      {option.value === "pending" ? " (default)" : ""}
                    </option>
                  ))}
                </select>
                <span className="mt-1 block text-[11px] font-normal normal-case tracking-normal text-emerald-700">
                  Choose Enrolled or Rejected. Saving is final: the status can
                  only be updated once and cannot be undone.
                </span>
              </label>

              <label className="block text-xs font-semibold uppercase tracking-wider text-emerald-800">
                Registrar remarks / rejection reason
                <textarea
                  value={statusRemarks}
                  onChange={(e) => setStatusRemarks(e.target.value)}
                  maxLength={1000}
                  rows={4}
                  placeholder="Optional remarks or rejection reason (e.g. Incomplete Form 138)"
                  disabled={statusSaving || statusFinalized}
                  className="mt-2 block w-full rounded-lg border border-emerald-200 bg-white px-3 py-3 text-sm text-emerald-700 outline-none placeholder:text-emerald-700/60 focus:border-emerald-300 disabled:opacity-60"
                />
              </label>

              {statusFinalized && (
                <p className="flex gap-2 rounded-lg border border-amber-200 bg-amber-50 p-3 text-xs text-amber-800">
                  <Lock size={16} className="shrink-0" />
                  <span>
                    This enrollment status has been finalized. Status updates
                    are allowed only once per student and cannot be undone or
                    changed.
                  </span>
                </p>
              )}

              {statusError && (
                <p className="flex gap-2 rounded-lg border border-red-200 bg-red-50 p-3 text-xs text-red-700">
                  <AlertCircle size={16} className="shrink-0" />
                  <span>{statusError}</span>
                </p>
              )}
              {statusMessage && (
                <p className="flex gap-2 rounded-lg border border-emerald-200 bg-emerald-50 p-3 text-xs text-emerald-800">
                  <CheckCircle2 size={16} className="shrink-0" />
                  <span>{statusMessage}</span>
                </p>
              )}
            </div>

            <div className="flex shrink-0 items-center justify-end gap-2 border-t border-emerald-200 bg-emerald-50 px-5 py-3">
              <button
                type="button"
                onClick={closeStatusEditor}
                disabled={statusSaving}
                className="rounded-lg border border-emerald-200 bg-white px-4 py-2 text-xs font-semibold text-emerald-700 hover:bg-emerald-100 disabled:opacity-50"
              >
                Close
              </button>
              <button
                type="button"
                onClick={() => void saveStatus()}
                disabled={
                  statusSaving ||
                  statusFinalized ||
                  normalizeEnrollmentStatus(statusDraft) === "pending"
                }
                className="inline-flex items-center gap-1.5 rounded-lg bg-yellow-300 px-4 py-2 text-xs font-bold text-emerald-950 hover:bg-yellow-400 disabled:cursor-not-allowed disabled:opacity-60"
              >
                {statusSaving ? (
                  "Saving…"
                ) : statusFinalized ? (
                  <>
                    <Lock size={14} />
                    Status finalized
                  </>
                ) : (
                  <>
                    <Save size={14} />
                    Save status
                  </>
                )}
              </button>
            </div>
          </div>
        </div>
      )}

      {previewFile && (
        <div
          className="fixed inset-0 z-[60] flex items-center justify-center bg-black/70 p-4 sm:p-6"
          onClick={() => setPreviewFile(null)}
        >
          <div
            role="dialog"
            aria-modal="true"
            aria-label={previewFile.label}
            className="flex h-[85vh] w-full max-w-5xl flex-col overflow-hidden rounded-xl border border-emerald-200 bg-white shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex shrink-0 items-center justify-between border-b border-emerald-200 bg-white px-5 py-4">
              <h3 className="text-sm font-bold capitalize text-emerald-900 sm:text-base">
                {previewFile.label}
              </h3>
              <button
                type="button"
                onClick={() => setPreviewFile(null)}
                className="rounded-lg p-2 text-emerald-900 hover:bg-emerald-50 hover:text-emerald-950"
                aria-label="Close"
              >
                <X size={18} />
              </button>
            </div>
            <div className="min-h-0 flex-1 overflow-auto bg-emerald-50/40 p-3 sm:p-4">
              {/\.(png|jpe?g|gif|webp|bmp|svg)(\?|$)/i.test(previewFile.url) ? (
                <div className="flex h-full items-center justify-center">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={previewFile.url}
                    alt={previewFile.label}
                    className="max-h-full max-w-full rounded-lg object-contain"
                  />
                </div>
              ) : (
                <iframe
                  src={previewFile.url}
                  title={previewFile.label}
                  className="h-full min-h-[60vh] w-full rounded-lg border border-emerald-200 bg-white"
                />
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function DetailField({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-emerald-200 bg-emerald-50 p-3">
      <p className="text-[10px] uppercase text-emerald-800">{label}</p>
      <p className="mt-1 wrap-break-word text-sm font-semibold">{value}</p>
    </div>
  );
}
