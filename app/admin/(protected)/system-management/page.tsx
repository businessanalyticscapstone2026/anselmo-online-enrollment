"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { supabase } from "@/lib/supabaseClient";
import {
  AlertCircle,
  Calendar,
  CheckCircle2,
  Clock,
  RotateCw,
  Save,
} from "lucide-react";
import {
  evaluateEnrollmentAvailability,
  formatManilaDate,
  formatManilaDateTime,
  type EnrollmentAvailability,
  type EnrollmentSettings,
} from "@/lib/enrollmentSettings";
import type { DatabaseErrorInfo } from "@/lib/supabase/errors";

type SettingsResponse = {
  settings?: EnrollmentSettings | null;
  availability?: EnrollmentAvailability;
  exists?: boolean;
};

type SettingsErrorPayload = {
  code?: string | null;
  databaseError?: DatabaseErrorInfo | null;
  migration?: string | null;
  reloadSchemaSql?: string | null;
  status?: number;
};

class SettingsApiError extends Error {
  details: SettingsErrorPayload;

  constructor(message: string, details: SettingsErrorPayload = {}) {
    super(message);
    this.name = "SettingsApiError";
    this.details = details;
  }
}

async function fetchSettings(): Promise<SettingsResponse> {
  const { data: sessionData } = await supabase.auth.getSession();
  const token = sessionData.session?.access_token;

  const res = await fetch("/api/admin/settings", {
    cache: "no-store",
    headers: token ? { Authorization: `Bearer ${token}` } : {},
    credentials: "include",
  });
  const data = await res.json().catch(() => ({}));

  if (!res.ok) {
    throw new SettingsApiError(
      data?.error || `Failed to load enrollment settings (HTTP ${res.status}).`,
      {
        code: data?.code ?? null,
        databaseError: data?.databaseError ?? null,
        migration: data?.migration ?? null,
        reloadSchemaSql: data?.reloadSchemaSql ?? null,
        status: res.status,
      }
    );
  }

  return data as SettingsResponse;
}

export default function SystemManagementPage() {
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");
  const [serverAvailability, setServerAvailability] =
    useState<EnrollmentAvailability | null>(null);

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [errorDetails, setErrorDetails] = useState<SettingsErrorPayload | null>(
    null
  );
  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  const [nowTick, setNowTick] = useState(() => Date.now());

  const applySettings = useCallback((settings: EnrollmentSettings | null) => {
    setStartDate(settings?.enrollment_start_date ?? "");
    setEndDate(settings?.enrollment_end_date ?? "");
  }, []);

  useEffect(() => {
    let cancelled = false;

    (async () => {
      try {
        const data = await fetchSettings();
        if (cancelled) return;

        applySettings(data.settings ?? null);
        setServerAvailability(data.availability ?? null);
        setError(null);
        setErrorDetails(null);
      } catch (err) {
        if (cancelled) return;
        console.error("Error loading settings:", err);
        if (err instanceof SettingsApiError) {
          setError(err.message);
          setErrorDetails(err.details);
        } else {
          setError(
            err instanceof Error
              ? err.message
              : "Unable to load settings from server."
          );
          setErrorDetails(null);
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [applySettings]);

  async function handleReload() {
    setLoading(true);
    setError(null);
    setErrorDetails(null);

    try {
      const data = await fetchSettings();
      applySettings(data.settings ?? null);
      setServerAvailability(data.availability ?? null);
      setError(null);
      setErrorDetails(null);
    } catch (err) {
      console.error("Error loading settings:", err);
      if (err instanceof SettingsApiError) {
        setError(err.message);
        setErrorDetails(err.details);
      } else {
        setError(
          err instanceof Error
            ? err.message
            : "Unable to load settings from server."
        );
        setErrorDetails(null);
      }
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    const timer = setInterval(() => setNowTick(Date.now()), 30_000);
    return () => clearInterval(timer);
  }, []);

  async function handleSaveSettings(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setErrorDetails(null);
    setSuccessMessage(null);

    if (!startDate || !endDate) {
      setError(
        "Please provide both the Enrollment Start Date and Enrollment End Date."
      );
      return;
    }

    if (endDate < startDate) {
      setError(
        "The enrollment end date cannot be earlier than the enrollment start date."
      );
      return;
    }

    setSaving(true);

    try {
      const { data: sessionData } = await supabase.auth.getSession();
      const token = sessionData.session?.access_token;

      const res = await fetch("/api/admin/settings", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        credentials: "include",
        body: JSON.stringify({
          enrollment_start_date: startDate,
          enrollment_end_date: endDate,
        }),
      });

      const data = await res.json().catch(() => ({}));

      if (!res.ok || !data?.success) {
        throw new SettingsApiError(
          data?.error || `Failed to save settings (HTTP ${res.status}).`,
          {
            code: data?.code ?? null,
            databaseError: data?.databaseError ?? null,
            migration: data?.migration ?? null,
            reloadSchemaSql: data?.reloadSchemaSql ?? null,
            status: res.status,
          }
        );
      }

      applySettings((data.settings as EnrollmentSettings | null) ?? null);
      setServerAvailability(data.availability ?? null);
      setNowTick(Date.now());
      setErrorDetails(null);

      setSuccessMessage(
        "Enrollment dates saved to Supabase. The public enrollment status has been refreshed."
      );
    } catch (err) {
      console.error("Error saving settings:", err);
      if (err instanceof SettingsApiError) {
        setError(err.message);
        setErrorDetails(err.details);
      } else {
        setError(
          err instanceof Error ? err.message : "Unable to save system settings."
        );
        setErrorDetails(null);
      }
    } finally {
      setSaving(false);
    }
  }

  const liveAvailability = useMemo(
    () =>
      evaluateEnrollmentAvailability(
        startDate && endDate
          ? {
            enrollment_start_date: startDate,
            enrollment_end_date: endDate,
          }
          : null,
        new Date(nowTick)
      ),
    [startDate, endDate, nowTick]
  );

  const isEnrollmentActive = liveAvailability.isOpen;

  const statusLabel =
    liveAvailability.reason === "open"
      ? "OPEN FOR ENROLLMENT"
      : liveAvailability.reason === "not_started"
        ? "NOT YET STARTED"
        : liveAvailability.reason === "not_configured"
          ? "NOT CONFIGURED"
          : "ENROLLMENT CLOSED";

  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-emerald-950 sm:text-3xl">
            System Settings
          </h1>
          <p className="mt-1 text-xs text-emerald-900 sm:text-sm">
            Configure the online enrollment period. The saved dates are used by
            the public portal, the enrollment form, and the submission API.
          </p>
        </div>

        <button
          onClick={handleReload}
          disabled={loading || saving}
          className="inline-flex items-center gap-2 self-start rounded-lg border border-emerald-200 bg-white px-4 py-2 text-xs font-semibold text-emerald-700 transition hover:border-emerald-200 hover:bg-amber-50 disabled:opacity-50"
        >
          <RotateCw size={14} className={loading ? "animate-spin" : ""} />
          <span>Reload</span>
        </button>
      </div>

      {loading && (
        <div
          role="status"
          className="flex animate-fade-in items-center gap-2 rounded-xl border border-emerald-200 bg-white/90 p-4 text-xs text-emerald-700"
        >
          <span className="h-4 w-4 animate-spin rounded-full border-2 border-emerald-200 border-t-transparent" />
          <span>Loading saved enrollment dates from Supabase...</span>
        </div>
      )}

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
          className="flex items-start justify-between gap-3 rounded-xl border border-red-200 bg-red-50 p-4 text-xs text-red-700"
        >
          <div className="flex min-w-0 items-start gap-2">
            <AlertCircle size={16} className="mt-0.5 shrink-0 text-red-700" />
            <div className="min-w-0 space-y-2">
              <p className="whitespace-pre-wrap wrap-break-word">{error}</p>
              {errorDetails?.databaseError && (
                <details className="rounded-lg border border-red-200 bg-red-50 p-3 text-[11px] text-red-700/90">
                  <summary className="cursor-pointer font-semibold text-red-700">
                    Database error details
                  </summary>
                  <div className="mt-2 space-y-1 font-mono">
                    <p>
                      <span className="font-sans font-semibold">Code:</span>{" "}
                      {errorDetails.databaseError.code ?? "n/a"}
                    </p>
                    <p>
                      <span className="font-sans font-semibold">Message:</span>{" "}
                      {errorDetails.databaseError.message}
                    </p>
                    {errorDetails.databaseError.details && (
                      <p>
                        <span className="font-sans font-semibold">
                          Details:
                        </span>{" "}
                        {errorDetails.databaseError.details}
                      </p>
                    )}
                    {errorDetails.databaseError.hint && (
                      <p>
                        <span className="font-sans font-semibold">Hint:</span>{" "}
                        {errorDetails.databaseError.hint}
                      </p>
                    )}
                  </div>
                  {errorDetails.reloadSchemaSql && (
                    <div className="mt-2">
                      <p className="font-sans font-semibold">
                        Run in Supabase SQL Editor:
                      </p>
                      <code className="mt-1 block rounded bg-emerald-50 p-2 font-mono text-[11px] text-emerald-700">
                        {errorDetails.reloadSchemaSql}
                      </code>
                    </div>
                  )}
                  {errorDetails.migration && (
                    <p className="mt-2 font-sans">
                      Migration: <code>{errorDetails.migration}</code>
                    </p>
                  )}
                </details>
              )}
            </div>
          </div>
          <button
            onClick={() => {
              setError(null);
              setErrorDetails(null);
            }}
            className="shrink-0 text-red-700 hover:text-emerald-950"
          >
            ✕
          </button>
        </div>
      )}

      <div className="rounded-xl border border-emerald-200 bg-white/90 p-5 shadow-sm">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-center gap-3">
            <div
              className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-xl border ${isEnrollmentActive
                  ? "border-emerald-200 bg-emerald-50 text-emerald-700"
                  : "border-red-200 bg-red-50 text-red-700"
                }`}
            >
              <Clock size={20} />
            </div>
            <div>
              <p className="text-xs font-bold uppercase tracking-wider text-emerald-800">
                Current Enrollment Status
              </p>
              <div className="mt-1 flex flex-wrap items-center gap-2">
                <span
                  className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-bold ${isEnrollmentActive
                      ? "bg-emerald-50 text-emerald-700 ring-1 ring-emerald-200"
                      : "bg-red-50 text-red-700 ring-1 ring-red-200"
                    }`}
                >
                  ● {statusLabel}
                </span>
                <span className="text-xs text-emerald-900">
                  Now:{" "}
                  {formatManilaDateTime(
                    liveAvailability.currentManilaDate,
                    liveAvailability.currentManilaTime
                  )}
                </span>
              </div>
              <p className="mt-1 text-[11px] text-emerald-800">
                {liveAvailability.message}
              </p>
            </div>
          </div>

          <div className="rounded-lg border border-emerald-200 bg-white p-3 text-right">
            <p className="text-[11px] uppercase tracking-wider text-emerald-800">
              Configured Window
            </p>
            <p className="mt-0.5 text-xs font-semibold text-emerald-700">
              {startDate ? formatManilaDate(startDate) : "Not set"} —{" "}
              {endDate ? formatManilaDate(endDate) : "Not set"}
            </p>
            <p className="mt-1 text-[10px] text-emerald-800">
              {serverAvailability
                ? "Verified against the server clock on load."
                : "Evaluated automatically in Asia/Manila."}
            </p>
          </div>
        </div>
      </div>

      <form onSubmit={handleSaveSettings} className="space-y-6">
        <section className="rounded-xl border border-emerald-200 bg-white/90 p-6 shadow-sm">
          <div className="flex items-center gap-2.5 border-b border-emerald-200 pb-4">
            <Calendar size={18} className="text-emerald-700" />
            <h2 className="text-base font-bold text-emerald-950">
              Enrollment Schedule &amp; Period
            </h2>
          </div>

          <p className="mt-3 text-xs leading-relaxed text-emerald-900">
            Set the first and last day of the enrollment period. The portal opens
            at 12:00 AM on the start date and closes at 11:59 PM on the end date,
            Philippine Standard Time (Asia/Manila). The end date cannot be
            earlier than the start date.
          </p>

          <div className="mt-5 grid gap-5 sm:grid-cols-2">
            <div>
              <label
                htmlFor="enrollment-start-date"
                className="mb-2 block text-xs font-bold uppercase tracking-wider text-emerald-600"
              >
                Enrollment Start Date
              </label>
              <input
                id="enrollment-start-date"
                type="date"
                required
                value={startDate}
                onChange={(e) => setStartDate(e.target.value)}
                className="w-full rounded-lg border border-emerald-200 bg-white px-4 py-3 text-sm text-emerald-950 outline-none focus:border-emerald-200"
              />
              <p className="mt-1.5 text-[11px] text-emerald-800">
                First day students can submit applications.
              </p>
            </div>

            <div>
              <label
                htmlFor="enrollment-end-date"
                className="mb-2 block text-xs font-bold uppercase tracking-wider text-emerald-600"
              >
                Enrollment End Date
              </label>
              <input
                id="enrollment-end-date"
                type="date"
                required
                value={endDate}
                onChange={(e) => setEndDate(e.target.value)}
                className="w-full rounded-lg border border-emerald-200 bg-white px-4 py-3 text-sm text-emerald-950 outline-none focus:border-emerald-200"
              />
              <p className="mt-1.5 text-[11px] text-emerald-800">
                Last day online applications are accepted.
              </p>
            </div>
          </div>
        </section>

        <section className="rounded-xl border border-emerald-200 bg-white/90 p-6 shadow-sm">
          <div className="flex items-center gap-2.5 border-b border-emerald-200 pb-4">
            <Clock size={18} className="text-emerald-700" />
            <h2 className="text-base font-bold text-emerald-950">
              Availability Rules
            </h2>
          </div>

          <div className="mt-4 space-y-2 text-xs leading-relaxed text-emerald-900">
            <p>
              Before the start date: <strong className="text-emerald-950">not yet started</strong>.
            </p>
            <p>
              From the start date through the end date, inclusive:{" "}
              <strong className="text-emerald-950">open for applications</strong>.
            </p>
            <p>
              After the end date: <strong className="text-emerald-950">closed</strong>.
            </p>
            <p>
              All comparisons use the Asia/Manila calendar. Student, staff, and
              administrator sign-in pages remain available even when enrollment
              is closed.
            </p>
          </div>
        </section>

        <div className="flex items-center justify-end gap-3 pt-2">
          <button
            type="submit"
            disabled={saving || loading}
            className="inline-flex items-center gap-2 rounded-xl bg-yellow-300 px-6 py-3.5 text-sm font-extrabold text-emerald-950 shadow-md transition hover:bg-yellow-300 disabled:opacity-60"
          >
            {saving ? (
              <>
                <span className="h-4 w-4 animate-spin rounded-full border-2 border-emerald-200 border-t-transparent" />
                <span>Saving Dates...</span>
              </>
            ) : (
              <>
                <Save size={16} />
                <span>Save Settings</span>
              </>
            )}
          </button>
        </div>
      </form>
    </div>
  );
}
