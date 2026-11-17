"use client";

import { useEffect, useState, useCallback, useMemo, useRef } from "react";
import {
  ENROLLMENT_STATUS_OPTIONS,
  getEnrollmentStatusLabel,
  normalizeEnrollmentStatus,
} from "@/lib/enrollmentStatus";
import { supabase } from "@/lib/supabaseClient";
import { Save, RefreshCw, AlertCircle, CheckCircle2 } from "lucide-react";

type Row = {
  id: string;
  first_name?: string | null;
  middle_name?: string | null;
  last_name?: string | null;
  status?: string | null;
  registrar_remarks?: string | null;
  submitted_at?: string | null;
  [key: string]: unknown;
};

const statuses = ENROLLMENT_STATUS_OPTIONS;

export default function UpdateStatusPage() {
  const [rows, setRows] = useState<Row[]>([]);
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [remarks, setRemarks] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [search, setSearch] = useState("");
  const [hasRemoteUpdates, setHasRemoteUpdates] = useState(false);
  const suppressRealtimeRef = useRef(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    setHasRemoteUpdates(false);

    try {
      const {
        data: { session },
        error: sessionError,
      } = await supabase.auth.getSession();

      if (sessionError) {
        throw new Error(`Could not check your staff session: ${sessionError.message}`);
      }

      if (!session) {
        setRows([]);
        setDrafts({});
        setRemarks({});
        setError("Your staff session is missing or expired. Please sign in again.");
        return;
      }

      // Use select("*") to be completely safe against missing columns
      const { data, error: fetchError } = await supabase
        .from("student_applications")
        .select("*")
        .order("submitted_at", { ascending: false });

      if (fetchError) {
        setError(fetchError.message);
      } else {
        const list = (data ?? []) as Row[];
        setRows(list);

        let localRemarks: Record<string, string> = {};
        if (typeof window !== "undefined") {
          try {
            const raw = localStorage.getItem("staff_registrar_remarks");
            if (raw) localRemarks = JSON.parse(raw);
          } catch {
            // ignore
          }
        }

        const initialDrafts: Record<string, string> = {};
        const initialRemarks: Record<string, string> = {};

        list.forEach((a) => {
          initialDrafts[a.id] = normalizeEnrollmentStatus(a.status);
          initialRemarks[a.id] =
            (a.registrar_remarks as string) || localRemarks[a.id] || "";
        });

        setDrafts(initialDrafts);
        setRemarks(initialRemarks);
      }
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Failed to load applications");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    const run = async () => { try { await load(); } catch (e) { console.error(e); } }; run();
  }, [load]);

  useEffect(() => {
    const channel = supabase
      .channel(`staff-status-live-${Date.now()}`)
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
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, []);

  async function save(id: string) {
    setSaving(id);
    setError("");
    setMessage("");
    suppressRealtimeRef.current = true;
    window.setTimeout(() => {
      suppressRealtimeRef.current = false;
    }, 1500);

    const targetStatus = normalizeEnrollmentStatus(drafts[id] || "pending");
    const targetRemark = remarks[id] || "";

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
        message?: string;
        data?: {
          status?: string;
          statusLabel?: string;
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

      if (savedRemark !== null && typeof window !== "undefined") {
        try {
          const raw = localStorage.getItem("staff_registrar_remarks");
          const existing = raw ? JSON.parse(raw) : {};
          existing[id] = savedRemark;
          localStorage.setItem(
            "staff_registrar_remarks",
            JSON.stringify(existing)
          );
        } catch {
          // ignore local cache errors
        }
      }

      setRows((prev) =>
        prev.map((r) =>
          r.id === id
            ? {
              ...r,
              status: verifiedStatus,
              ...(savedRemark !== null
                ? { registrar_remarks: savedRemark }
                : {}),
            }
            : r
        )
      );
      setDrafts((prev) => ({
        ...prev,
        [id]: normalizeEnrollmentStatus(verifiedStatus),
      }));

      if (savedRemark !== null) {
        setRemarks((prev) => ({ ...prev, [id]: savedRemark }));
      }

      const emailNotice = result.data?.emailSent
        ? " A notification email was sent to the student's registered email."
        : result.data?.statusChanged && result.data?.emailError
          ? ` The student could not be notified by email: ${result.data.emailError}`
          : "";

      setMessage(
        `Enrollment status successfully updated to "${getEnrollmentStatusLabel(
          verifiedStatus
        )}".${emailNotice}`
      );
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Error saving status update");
    } finally {
      setSaving(null);
    }
  }

  const filtered = useMemo(
    () =>
      rows.filter((r) => {
        const q = `${r.first_name ?? ""} ${r.middle_name ?? ""} ${r.last_name ?? ""} ${r.id ?? ""}`.toLowerCase();
        return q.includes(search.toLowerCase());
      }),
    [rows, search]
  );

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.18em] text-emerald-700">
            Registrar Workspace
          </p>
          <h1 className="mt-2 text-3xl font-extrabold">Update Enrollment Status</h1>
          <p className="mt-2 text-sm text-emerald-900">
            Evaluate student submissions, set application status, and add remarks.
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
            New enrollment updates are available.
          </span>
          <button
            onClick={load}
            className="rounded-lg border border-sky-200 px-3 py-1.5 text-xs font-semibold hover:bg-sky-50"
          >
            Load updates
          </button>
        </div>
      )}

      <div className="flex flex-col gap-3 sm:flex-row">
        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search student name or application ID…"
          className="flex-1 rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-700 outline-none placeholder:text-emerald-800 focus:border-emerald-200"
        />
      </div>

      <div className="overflow-hidden rounded-2xl border border-emerald-200 bg-emerald-50">
        <div className="overflow-x-auto">
          <table className="w-full min-w-225 text-left text-sm">
            <thead className="bg-emerald-50 text-[10px] uppercase tracking-wider text-emerald-900">
              <tr>
                <th className="px-5 py-3">Student</th>
                <th className="px-5 py-3">Current Status</th>
                <th className="px-5 py-3">Set Status</th>
                <th className="px-5 py-3">Registrar Remarks / Rejection Reason</th>
                <th className="px-5 py-3">Save</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-emerald-200/10">
              {loading ? (
                <tr>
                  <td colSpan={5} className="animate-pulse-soft px-5 py-10 text-center text-emerald-900">
                    Loading applications…
                  </td>
                </tr>
              ) : filtered.length > 0 ? (
                filtered.map((r) => (
                  <tr key={r.id} className="align-top hover:bg-emerald-50">
                    <td className="px-5 py-4">
                      <p className="font-semibold">
                        {[r.first_name, r.middle_name, r.last_name]
                          .filter(Boolean)
                          .join(" ") || "Unnamed applicant"}
                      </p>
                      <p className="mt-1 font-mono text-[10px] text-emerald-700">
                        {String(r.id).slice(0, 8)}
                      </p>
                    </td>
                    <td className="px-5 py-4 text-xs capitalize">
                      <span className="rounded-full border border-emerald-200 bg-emerald-50 px-2.5 py-1 text-[10px]">
                        {getEnrollmentStatusLabel(r.status)}
                      </span>
                    </td>
                    <td className="px-5 py-4">
                      <select
                        value={drafts[r.id] || "pending"}
                        onChange={(e) =>
                          setDrafts((p) => ({
                            ...p,
                            [r.id]: e.target.value,
                          }))
                        }
                        className="rounded-lg border border-emerald-200 bg-white px-3 py-2.5 text-xs text-emerald-700 outline-none focus:border-emerald-200"
                      >
                        {statuses.map((s) => (
                          <option key={s.value} value={s.value}>
                            {s.label}
                          </option>
                        ))}
                      </select>
                    </td>
                    <td className="px-5 py-4">
                      <textarea
                        value={remarks[r.id] || ""}
                        onChange={(e) =>
                          setRemarks((p) => ({
                            ...p,
                            [r.id]: e.target.value,
                          }))
                        }
                        rows={2}
                        placeholder="Optional remarks or rejection reason (e.g. Incomplete Form 138)"
                        className="w-48 resize-none rounded-lg border border-emerald-200 bg-white px-3 py-2 text-xs text-emerald-700 outline-none placeholder:text-emerald-700 focus:border-emerald-200 sm:w-64"
                      />
                    </td>
                    <td className="px-5 py-4">
                      <button
                        onClick={() => save(r.id)}
                        disabled={saving === r.id}
                        className="inline-flex items-center gap-1.5 rounded-lg bg-yellow-300 px-3 py-2 text-xs font-bold text-emerald-950 hover:bg-yellow-300 disabled:opacity-60"
                      >
                        <Save size={14} />
                        {saving === r.id ? "Saving…" : "Save"}
                      </button>
                    </td>
                  </tr>
                ))
              ) : (
                <tr>
                  <td colSpan={5} className="px-5 py-10 text-center text-emerald-900">
                    No applications found.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
