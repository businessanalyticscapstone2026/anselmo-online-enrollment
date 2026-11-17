"use client";

import { useEffect, useState, useMemo } from "react";
import {
  History,
  Trash2,
  RotateCw,
  Search,
  AlertCircle,
  CheckCircle2,
  ShieldAlert,
  Clock,
  Filter,
} from "lucide-react";
import { supabase } from "@/lib/supabaseClient";
import { formatPhilippineDateTime } from "@/lib/activityLogger";

type ActivityLogItem = {
  id: string;
  created_at: string;
  user_type: string;
  user_email: string;
  action: string;
  ip_address?: string | null;
};

function getLogIp(log: Pick<ActivityLogItem, "ip_address">): string {
  const ip = log.ip_address;
  return typeof ip === "string" && ip.trim() ? ip.trim() : "—";
}

export default function ActivityLogsPage() {
  const [logs, setLogs] = useState<ActivityLogItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  const [tableMissing, setTableMissing] = useState(false);

  // Search & Filter
  const [searchTerm, setSearchTerm] = useState("");
  const [userTypeFilter, setUserTypeFilter] = useState<string>("ALL");

  // Clear modal
  const [showClearModal, setShowClearModal] = useState(false);
  const [clearing, setClearing] = useState(false);

  async function fetchLogs() {
    setLoading(true);
    setError(null);

    try {
      const { data: sessionData } = await supabase.auth.getSession();
      const token = sessionData.session?.access_token;

      const res = await fetch("/api/admin/activity-logs", {
        headers: {
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        credentials: "include",
        cache: "no-store",
      });
      const data = await res.json();

      if (!res.ok) {
        throw new Error(data.error || "Failed to load activity logs.");
      }

      setTableMissing(Boolean(data.tableMissing));
      setLogs(data.logs || []);
    } catch (err) {
      console.error("Error fetching logs:", err);
      setError(err instanceof Error ? err.message : "Unable to retrieve logs.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    fetchLogs();
  }, []);

  // Filtered logs
  const filteredLogs = useMemo(() => {
    return logs.filter((log) => {
      const search = searchTerm.toLowerCase().trim();
      const type = String(log.user_type || "").toLowerCase();
      const matchesSearch =
        !search ||
        String(log.user_email || "").toLowerCase().includes(search) ||
        String(log.action || "").toLowerCase().includes(search) ||
        type.includes(search) ||
        getLogIp(log).toLowerCase().includes(search);

      const matchesType =
        userTypeFilter === "ALL" || type === userTypeFilter.toLowerCase();

      return matchesSearch && matchesType;
    });
  }, [logs, searchTerm, userTypeFilter]);

  // Handle Clear All Logs
  async function handleClearAllLogs() {
    setClearing(true);
    setError(null);
    setSuccessMessage(null);

    try {
      const { data: sessionData } = await supabase.auth.getSession();
      const token = sessionData.session?.access_token;

      const res = await fetch("/api/admin/activity-logs", {
        method: "DELETE",
        headers: {
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        credentials: "include",
      });
      const data = await res.json();

      if (!res.ok) {
        throw new Error(data.error || "Failed to clear logs.");
      }

      setSuccessMessage(
        "✓ All activity log records have been permanently cleared. User accounts, applications, and documents remain untouched."
      );
      setShowClearModal(false);

      // Refresh table
      await fetchLogs();
    } catch (err) {
      console.error("Error clearing logs:", err);
      setError(err instanceof Error ? err.message : "Failed to clear activity logs.");
    } finally {
      setClearing(false);
    }
  }

  return (
    <div className="space-y-6">
      {/* Page Header */}
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-emerald-950 sm:text-3xl">
            Activity Logs
          </h1>
          <p className="mt-1 text-xs text-emerald-900 sm:text-sm">
            Monitor important administrative actions, sign-in activity, and enrollment updates.
          </p>
        </div>

        <div className="flex items-center gap-2.5">
          <button
            onClick={fetchLogs}
            disabled={loading}
            className="inline-flex items-center gap-2 rounded-lg border border-emerald-200 bg-white px-4 py-2 text-xs font-semibold text-emerald-700 transition hover:border-emerald-200 hover:bg-amber-50 disabled:opacity-50"
          >
            <RotateCw size={14} className={loading ? "animate-spin" : ""} />
            <span>Refresh</span>
          </button>

          <button
            onClick={() => setShowClearModal(true)}
            disabled={loading || logs.length === 0}
            className="inline-flex items-center gap-1.5 rounded-lg border border-red-200 bg-red-50 px-4 py-2 text-xs font-semibold text-red-700 transition hover:bg-red-50 disabled:opacity-50"
          >
            <Trash2 size={14} />
            <span>Clear All Logs</span>
          </button>
        </div>
      </div>

      {/* Table Migration Notice */}
      {tableMissing && (
        <div
          role="status"
          className="flex items-start justify-between gap-3 rounded-xl border border-emerald-200 bg-amber-50 p-4 text-xs text-emerald-700"
        >
          <div className="flex items-start gap-2.5">
            <div>
              <p className="font-bold text-emerald-700">
                Database Activity Logs Table Pending
              </p>
              <p className="mt-0.5 leading-relaxed text-emerald-900">
                The <code className="rounded bg-emerald-50 px-1.5 py-0.5 font-mono text-emerald-700">activity_logs</code> table is not yet created in your Supabase database. Run the migration script in Supabase SQL Editor to enable logging.
              </p>
            </div>
          </div>
          <button
            onClick={() => setTableMissing(false)}
            className="text-emerald-700 hover:text-emerald-950"
          >
            ✕
          </button>
        </div>
      )}

      {/* Notifications */}
      {successMessage && (
        <div
          role="status"
          className="flex items-center justify-between gap-3 rounded-xl border border-emerald-200 bg-emerald-50 p-4 text-xs text-emerald-700"
        >
          <div className="flex items-center gap-2">
            <CheckCircle2 size={16} className="shrink-0 text-emerald-700" />
            <span>{successMessage}</span>
          </div>
          <button
            onClick={() => setSuccessMessage(null)}
            className="text-emerald-700 hover:text-emerald-950"
          >
            ✕
          </button>
        </div>
      )}

      {error && (
        <div
          role="alert"
          className="flex items-center justify-between gap-3 rounded-xl border border-red-200 bg-red-50 p-4 text-xs text-red-700"
        >
          <div className="flex items-center gap-2">
            <AlertCircle size={16} className="shrink-0 text-red-700" />
            <span>{error}</span>
          </div>
          <button
            onClick={() => setError(null)}
            className="text-red-700 hover:text-emerald-950"
          >
            ✕
          </button>
        </div>
      )}

      {/* Search & Filter Bar */}
      <div className="rounded-xl border border-emerald-200 bg-white/90 p-4 shadow-sm sm:p-5">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="relative flex-1">
            <Search
              size={16}
              className="absolute left-3.5 top-1/2 -translate-y-1/2 text-emerald-800"
            />
            <input
              type="text"
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              placeholder="Search by email, IP, action, or user type..."
              className="w-full rounded-lg border border-emerald-200 bg-white py-2.5 pl-10 pr-4 text-xs text-emerald-950 outline-none placeholder:text-emerald-800 focus:border-emerald-200 sm:text-sm"
            />
            {searchTerm && (
              <button
                onClick={() => setSearchTerm("")}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-xs text-emerald-800 hover:text-emerald-950"
              >
                Clear
              </button>
            )}
          </div>

          <div className="flex items-center gap-2">
            <Filter size={15} className="text-emerald-700" />
            <select
              value={userTypeFilter}
              onChange={(e) => setUserTypeFilter(e.target.value)}
              className="rounded-lg border border-emerald-200 bg-white px-3 py-2 text-xs text-emerald-950 outline-none focus:border-emerald-200"
            >
              <option value="ALL">All User Types</option>
              <option value="Admin">Admin</option>
              <option value="Staff">Staff</option>
              <option value="Student">Student</option>
              <option value="User">User</option>
            </select>
          </div>
        </div>
      </div>

      {/* Activity Logs Table */}
      <div className="overflow-hidden rounded-xl border border-emerald-200 bg-white/90 shadow-sm">
        <div className="overflow-x-auto">
          <table className="w-full min-w-175 text-left text-xs sm:text-sm">
            <thead className="border-b border-emerald-200 bg-white text-[11px] uppercase tracking-wider text-emerald-900">
              <tr>
                <th className="px-5 py-4">Timestamp (PHT)</th>
                <th className="px-5 py-4">User Type</th>
                <th className="px-5 py-4">User Email</th>
                <th className="px-5 py-4">IP Address</th>
                <th className="px-5 py-4">Action</th>
              </tr>
            </thead>

            <tbody className="divide-y divide-emerald-200/15">
              {loading && (
                <tr>
                  <td colSpan={5} className="px-5 py-12 text-center text-emerald-900">
                    <div className="inline-flex items-center gap-2">
                      <span className="h-4 w-4 animate-spin rounded-full border-2 border-emerald-200 border-t-transparent" />
                      <span>Loading activity logs...</span>
                    </div>
                  </td>
                </tr>
              )}

              {!loading && filteredLogs.length === 0 && (
                <tr>
                  <td colSpan={5} className="px-5 py-12 text-center text-emerald-900">
                    <div className="flex flex-col items-center justify-center gap-2">
                      <History size={28} className="text-emerald-700/40" />
                      <p>
                        {searchTerm || userTypeFilter !== "ALL"
                          ? "No logs match the selected filter."
                          : "No activity logs recorded yet."}
                      </p>
                    </div>
                  </td>
                </tr>
              )}

              {!loading &&
                filteredLogs.map((log) => {
                  const type = String(log.user_type || "").toLowerCase();
                  const isAdmin = type.includes("admin");
                  const isStaff = type.includes("staff") || type.includes("registrar");
                  const isStudent = type.includes("student");

                  return (
                    <tr
                      key={log.id}
                      className="transition hover:bg-white/3"
                    >
                      <td className="whitespace-nowrap px-5 py-4 font-mono text-xs text-emerald-900">
                        <div className="flex items-center gap-1.5">
                          <Clock size={13} className="text-emerald-700" />
                          <span>{formatPhilippineDateTime(log.created_at)}</span>
                        </div>
                      </td>

                      <td className="px-5 py-4">
                        <span
                          className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-[11px] font-bold ${isAdmin
                              ? "bg-purple-50 text-purple-700 ring-1 ring-purple-200"
                              : isStaff
                                ? "bg-amber-50 text-amber-700 ring-1 ring-amber-200"
                                : isStudent
                                  ? "bg-emerald-50 text-emerald-700 ring-1 ring-emerald-200"
                                  : "bg-gray-100 text-gray-700 ring-1 ring-gray-200"
                            }`}
                        >
                          {log.user_type}
                        </span>
                      </td>

                      <td className="px-5 py-4 break-all font-medium text-emerald-950">
                        {log.user_email || "—"}
                      </td>

                      <td className="px-5 py-4 font-mono text-xs text-emerald-900">
                        {getLogIp(log)}
                      </td>

                      <td className="px-5 py-4 text-xs text-emerald-600">
                        {log.action}
                      </td>
                    </tr>
                  );
                })}
            </tbody>
          </table>
        </div>
      </div>

      {/* Clear Logs Confirmation Modal */}
      {showClearModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 p-4 backdrop-blur-xs">
          <div className="w-full max-w-md rounded-2xl border border-emerald-200 bg-white p-6 text-emerald-700 shadow-2xl">
            <div className="flex items-center gap-3">
              <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full border border-red-200 bg-red-50 text-red-700">
                <ShieldAlert size={24} />
              </div>
              <div>
                <h3 className="text-lg font-bold text-emerald-950">
                  Clear All Activity Logs
                </h3>
                <p className="text-xs text-emerald-900">
                  Action requires administrator authorization
                </p>
              </div>
            </div>

            <div className="mt-5 rounded-xl border border-red-200 bg-red-50 p-4 text-xs leading-relaxed text-red-700">
              <p>
                Are you sure you want to permanently clear all activity log records?
              </p>
              <p className="mt-2.5 rounded-lg border border-emerald-200 bg-white p-3 text-xs text-emerald-700">
                ✓ <strong>Safe operation:</strong> This clears only the system activity log table. User accounts, student applications, sections, and uploaded documents will <strong>not</strong> be deleted.
              </p>
            </div>

            <div className="mt-6 flex justify-end gap-3">
              <button
                type="button"
                disabled={clearing}
                onClick={() => setShowClearModal(false)}
                className="rounded-lg border border-emerald-200 px-4 py-2 text-xs font-semibold text-emerald-700 transition hover:bg-emerald-50 disabled:opacity-50"
              >
                Cancel
              </button>

              <button
                type="button"
                disabled={clearing}
                onClick={handleClearAllLogs}
                className="inline-flex items-center gap-2 rounded-lg bg-red-600 px-4 py-2 text-xs font-bold text-emerald-950 transition hover:bg-red-500 disabled:opacity-60"
              >
                {clearing ? (
                  <>
                    <span className="h-3 w-3 animate-spin rounded-full border-2 border-emerald-200 border-t-transparent" />
                    <span>Clearing...</span>
                  </>
                ) : (
                  <>
                    <Trash2 size={14} />
                    <span>Confirm &amp; Clear Logs</span>
                  </>
                )}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
