"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  AlertCircle,
  Camera,
  CheckCircle2,
  FileText,
  Loader2,
  Save,
  Upload,
  Users,
  X,
} from "lucide-react";
import { getEnrollmentStatusLabel, normalizeEnrollmentStatus } from "@/lib/enrollmentStatus";
import { normalizeTrack } from "@/lib/clusters";
import type { SectionRecord } from "@/lib/sections";
import {
  walkInRequirementLinks,
  type WalkInRequirementLink,
} from "@/lib/walkInEnrollment";

type WalkInRecord = Record<string, unknown>;

type RequirementFileKey = "reportCard" | "birthCertificate" | "otherRequirement";

function text(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

const INPUT_CLASS =
  "w-full rounded-lg border border-emerald-200 bg-white px-3 py-2.5 text-sm text-emerald-950 outline-none transition focus:border-emerald-500 focus:ring-2 focus:ring-emerald-200";

async function readJson(response: Response) {
  return (await response.json().catch(() => ({}))) as {
    success?: boolean;
    error?: string;
    record?: WalkInRecord;
  };
}

type RequirementCameraDialogProps = {
  label: string;
  onClose: () => void;
  onCapture: (file: File) => void;
};

function RequirementCameraDialog({
  label,
  onClose,
  onCapture,
}: RequirementCameraDialogProps) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const [cameraError, setCameraError] = useState<string | null>(null);
  const [cameraAttempt, setCameraAttempt] = useState(0);

  const stopStream = useCallback(() => {
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((track) => track.stop());
      streamRef.current = null;
    }
    if (videoRef.current) {
      videoRef.current.srcObject = null;
    }
  }, []);

  useEffect(() => {
    let cancelled = false;

    const start = async () => {
      setCameraError(null);

      try {
        if (!navigator.mediaDevices?.getUserMedia) {
          throw new Error(
            "Camera capture is not supported on this device or browser."
          );
        }

        const stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: { ideal: "environment" } },
          audio: false,
        });

        if (cancelled) {
          stream.getTracks().forEach((track) => track.stop());
          return;
        }

        streamRef.current = stream;

        if (videoRef.current) {
          videoRef.current.srcObject = stream;
          await videoRef.current.play().catch(() => undefined);
        }
      } catch (err) {
        if (cancelled) return;
        setCameraError(
          err instanceof Error
            ? err.message
            : "Unable to access the camera. Please check your browser permissions."
        );
      }
    };

    void start();

    return () => {
      cancelled = true;
      stopStream();
    };
  }, [cameraAttempt, stopStream]);

  useEffect(() => () => stopStream(), [stopStream]);

  const capturePhoto = async () => {
    const video = videoRef.current;
    const canvas = canvasRef.current;

    if (!video || !canvas) return;

    const width = video.videoWidth;
    const height = video.videoHeight;

    if (!width || !height) {
      setCameraError("The camera is still starting. Please try again.");
      return;
    }

    canvas.width = width;
    canvas.height = height;

    const context = canvas.getContext("2d");
    if (!context) {
      setCameraError("Could not capture the photo. Please try again.");
      return;
    }

    context.drawImage(video, 0, 0, width, height);

    const blob = await new Promise<Blob | null>((resolve) =>
      canvas.toBlob((result) => resolve(result), "image/jpeg", 0.92)
    );

    if (!blob) {
      setCameraError("Could not capture the photo. Please try again.");
      return;
    }

    onCapture(
      new File([blob], `camera-${Date.now()}.jpg`, { type: "image/jpeg" })
    );
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-4"
      onClick={onClose}
    >
      <div
        role="dialog"
        aria-modal="true"
        className="w-full max-w-lg overflow-hidden rounded-2xl bg-white shadow-2xl"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-emerald-200 px-4 py-3">
          <h3 className="text-sm font-bold text-emerald-900">
            Take a photo · {label}
          </h3>
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg p-1.5 text-emerald-700/60 transition hover:bg-emerald-50 hover:text-emerald-900"
            aria-label="Close camera"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="bg-black">
          {cameraError ? (
            <div className="flex min-h-56 items-center justify-center px-6 py-10 text-center text-sm text-red-300">
              {cameraError}
            </div>
          ) : (
            <video
              ref={videoRef}
              autoPlay
              playsInline
              muted
              className="mx-auto max-h-[60vh] w-full object-contain"
            />
          )}
          <canvas ref={canvasRef} className="hidden" />
        </div>

        <div className="flex items-center justify-center gap-3 px-4 py-4">
          {cameraError ? (
            <button
              type="button"
              onClick={() => setCameraAttempt((attempt) => attempt + 1)}
              className="rounded-lg border border-emerald-200 bg-white px-5 py-2.5 text-sm font-semibold text-emerald-800 transition hover:bg-emerald-50"
            >
              Try again
            </button>
          ) : (
            <button
              type="button"
              onClick={() => void capturePhoto()}
              className="inline-flex items-center gap-2 rounded-lg bg-emerald-700 px-6 py-2.5 text-sm font-bold text-white transition hover:bg-emerald-800"
            >
              <Camera className="h-4 w-4" />
              Capture Photo
            </button>
          )}
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg border border-emerald-200 bg-white px-5 py-2.5 text-sm font-semibold text-emerald-800 transition hover:bg-emerald-50"
          >
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
}

export function SectionPanel({
  record,
  sections,
  onUpdated,
}: {
  record: WalkInRecord;
  sections: SectionRecord[];
  onUpdated: (record: WalkInRecord) => void;
}) {
  const currentSectionId = text(record.assigned_section_id);
  const [sectionId, setSectionId] = useState(currentSectionId);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");

  const compatibleSections = useMemo(() => {
    const recordTrack = normalizeTrack(record.track);
    const recordGrade = text(record.grade_level).toLowerCase();

    return sections.filter((section) => {
      if (currentSectionId && String(section.id) === currentSectionId) {
        return true;
      }

      const sectionGrade = text(section.grade_level).toLowerCase();
      if (recordGrade && sectionGrade && recordGrade !== sectionGrade) {
        return false;
      }

      const sectionTrack = normalizeTrack(section.track);
      if (recordTrack && sectionTrack && recordTrack !== sectionTrack) {
        return false;
      }

      return true;
    });
  }, [sections, record, currentSectionId]);

  const selectedSection = sections.find(
    (section) => String(section.id) === sectionId
  );

  const save = async () => {
    if (saving) return;

    setSaving(true);
    setError("");
    setMessage("");

    try {
      const response = await fetch(
        `/api/staff/walk-ins/${String(record.id)}`,
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          credentials: "include",
          body: JSON.stringify({
            action: "section",
            sectionId: sectionId || null,
          }),
        }
      );
      const result = await readJson(response);

      if (!response.ok || !result.success || !result.record) {
        throw new Error(result.error || "Could not assign the section.");
      }

      onUpdated(result.record);
      setMessage(
        sectionId ? "Section assigned successfully." : "Section cleared."
      );
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Could not assign the section."
      );
    } finally {
      setSaving(false);
    }
  };

  return (
    <section className="rounded-2xl border border-emerald-200 bg-white/90 p-5 shadow-sm">
      <div className="flex items-start gap-3">
        <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-emerald-100 text-emerald-700">
          <Users size={17} />
        </span>
        <div>
          <h2 className="text-base font-bold text-emerald-950">
            Section & Adviser
          </h2>
          <p className="mt-0.5 text-xs text-emerald-600">
            Assign the walk-in student to a section after reviewing the record.
          </p>
        </div>
      </div>

      <div className="mt-4 space-y-3">
        <select
          value={sectionId}
          onChange={(event) => {
            setSectionId(event.target.value);
            setMessage("");
          }}
          className={INPUT_CLASS}
        >
          <option value="">Not assigned</option>
          {compatibleSections.map((section) => (
            <option key={String(section.id)} value={String(section.id)}>
              {section.name}
              {section.adviser_name ? ` — ${section.adviser_name}` : ""}
            </option>
          ))}
        </select>

        {selectedSection && (
          <div className="rounded-lg bg-emerald-50 px-3 py-2 text-xs text-emerald-700">
            <p>
              <span className="font-semibold">Adviser:</span>{" "}
              {selectedSection.adviser_name || "Not set"}
            </p>
            <p className="mt-0.5">
              <span className="font-semibold">Capacity:</span>{" "}
              {selectedSection.capacity ?? "Not set"}
            </p>
          </div>
        )}

        {error && (
          <p className="flex items-start gap-1 text-xs font-semibold text-rose-600">
            <AlertCircle size={13} className="mt-0.5 shrink-0" />
            {error}
          </p>
        )}
        {message && (
          <p className="flex items-start gap-1 text-xs font-semibold text-emerald-700">
            <CheckCircle2 size={13} className="mt-0.5 shrink-0" />
            {message}
          </p>
        )}

        <button
          type="button"
          onClick={() => void save()}
          disabled={saving}
          className="inline-flex items-center gap-2 rounded-lg bg-emerald-700 px-4 py-2.5 text-sm font-bold text-white transition hover:bg-emerald-800 disabled:opacity-70"
        >
          {saving ? (
            <Loader2 size={15} className="animate-spin" />
          ) : (
            <Save size={15} />
          )}
          {saving ? "Saving..." : "Save section"}
        </button>
      </div>
    </section>
  );
}

export function StatusPanel({
  record,
  onUpdated,
}: {
  record: WalkInRecord;
  onUpdated: (record: WalkInRecord) => void;
}) {
  const [status, setStatus] = useState(normalizeEnrollmentStatus(record.status));
  const [remarks, setRemarks] = useState(text(record.registrar_remarks));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");

  const save = async () => {
    if (saving) return;

    setSaving(true);
    setError("");
    setMessage("");

    try {
      const response = await fetch(
        `/api/staff/walk-ins/${String(record.id)}`,
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          credentials: "include",
          body: JSON.stringify({ action: "status", status, remarks }),
        }
      );
      const result = await readJson(response);

      if (!response.ok || !result.success || !result.record) {
        throw new Error(result.error || "Could not update the status.");
      }

      onUpdated(result.record);
      setMessage(`Status saved as ${getEnrollmentStatusLabel(status)}.`);
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Could not update the status."
      );
    } finally {
      setSaving(false);
    }
  };

  return (
    <section className="rounded-2xl border border-emerald-200 bg-white/90 p-5 shadow-sm">
      <div className="flex items-start gap-3">
        <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-emerald-100 text-emerald-700">
          <FileText size={17} />
        </span>
        <div>
          <h2 className="text-base font-bold text-emerald-950">
            Enrollment Status
          </h2>
          <p className="mt-0.5 text-xs text-emerald-600">
            Set the registrar decision for this walk-in enrollment.
          </p>
        </div>
      </div>

      <div className="mt-4 space-y-3">
        <select
          value={status}
          onChange={(event) => {
            setStatus(
              normalizeEnrollmentStatus(event.target.value)
            );
            setMessage("");
          }}
          className={INPUT_CLASS}
        >
          <option value="pending">Pending</option>
          <option value="enrolled">Enrolled</option>
          <option value="denied">Denied</option>
        </select>

        <textarea
          value={remarks}
          onChange={(event) => setRemarks(event.target.value.slice(0, 1000))}
          rows={3}
          placeholder="Optional remarks for this decision."
          className={`${INPUT_CLASS} resize-y`}
        />

        {error && (
          <p className="flex items-start gap-1 text-xs font-semibold text-rose-600">
            <AlertCircle size={13} className="mt-0.5 shrink-0" />
            {error}
          </p>
        )}
        {message && (
          <p className="flex items-start gap-1 text-xs font-semibold text-emerald-700">
            <CheckCircle2 size={13} className="mt-0.5 shrink-0" />
            {message}
          </p>
        )}

        <button
          type="button"
          onClick={() => void save()}
          disabled={saving}
          className="inline-flex items-center gap-2 rounded-lg bg-emerald-700 px-4 py-2.5 text-sm font-bold text-white transition hover:bg-emerald-800 disabled:opacity-70"
        >
          {saving ? (
            <Loader2 size={15} className="animate-spin" />
          ) : (
            <Save size={15} />
          )}
          {saving ? "Saving..." : "Save status"}
        </button>
      </div>
    </section>
  );
}

export function RequirementsPanel({
  record,
  onUpdated,
}: {
  record: WalkInRecord;
  onUpdated: (record: WalkInRecord) => void;
}) {
  const [files, setFiles] = useState<{
    reportCard: File | null;
    birthCertificate: File | null;
    otherRequirement: File | null;
  }>({
    reportCard: null,
    birthCertificate: null,
    otherRequirement: null,
  });
  const [complete, setComplete] = useState(record.requirements_submitted === true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [cameraFor, setCameraFor] = useState<RequirementFileKey | null>(null);
  const fileInputRefs = useRef<
    Record<RequirementFileKey, HTMLInputElement | null>
  >({
    reportCard: null,
    birthCertificate: null,
    otherRequirement: null,
  });

  const existing = useMemo(
    () => walkInRequirementLinks(record),
    [record]
  );

  const existingByKey = useMemo(() => {
    const map = new Map<string, WalkInRequirementLink>();
    existing.forEach((document) => map.set(document.key, document));
    return map;
  }, [existing]);

  const save = async () => {
    if (saving) return;

    setSaving(true);
    setError("");
    setMessage("");

    try {
      const selected = [files.reportCard, files.birthCertificate, files.otherRequirement]
        .filter((file): file is File => Boolean(file));

      let result: { success?: boolean; error?: string; record?: WalkInRecord };

      if (selected.length > 0) {
        const formData = new FormData();
        if (files.reportCard) formData.append("reportCard", files.reportCard);
        if (files.birthCertificate) {
          formData.append("birthCertificate", files.birthCertificate);
        }
        if (files.otherRequirement) {
          formData.append("otherRequirement", files.otherRequirement);
        }
        if (complete) formData.append("markSubmitted", "true");

        const response = await fetch(
          `/api/staff/walk-ins/${String(record.id)}/requirements`,
          {
            method: "POST",
            credentials: "include",
            body: formData,
          }
        );
        result = await readJson(response);

        if (!response.ok || !result.success || !result.record) {
          throw new Error(result.error || "Could not upload the requirements.");
        }
      } else {
        const response = await fetch(
          `/api/staff/walk-ins/${String(record.id)}`,
          {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            credentials: "include",
            body: JSON.stringify({
              action: "requirements",
              requirementsSubmitted: complete,
            }),
          }
        );
        result = await readJson(response);

        if (!response.ok || !result.success || !result.record) {
          throw new Error(result.error || "Could not update the requirements.");
        }
      }

      onUpdated(result.record);
      setFiles({
        reportCard: null,
        birthCertificate: null,
        otherRequirement: null,
      });
      setMessage("Requirements updated.");
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Could not update requirements."
      );
    } finally {
      setSaving(false);
    }
  };

  const items = [
    {
      key: "reportCard" as const,
      documentKey: "report_card",
      label: "Grade 10 Report Card",
      required: true,
    },
    {
      key: "birthCertificate" as const,
      documentKey: "birth_certificate",
      label: "Birth Certificate",
      required: true,
    },
    {
      key: "otherRequirement" as const,
      documentKey: "other_requirement",
      label: "Other Requirements (Form 137)",
      required: false,
    },
  ];

  return (
    <section className="rounded-2xl border border-emerald-200 bg-white/90 p-5 shadow-sm">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex items-start gap-3">
          <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-emerald-100 text-emerald-700">
            <FileText size={17} />
          </span>
          <div>
            <h2 className="text-base font-bold text-emerald-950">
              Enrollment Requirements
            </h2>
            <p className="mt-0.5 text-xs text-emerald-600">
              Upload or replace scanned documents for this walk-in student.
            </p>
          </div>
        </div>

        <span
          className={`inline-flex items-center gap-1 rounded-full border px-2.5 py-1 text-[10px] font-bold uppercase tracking-wider ${
            record.requirements_submitted === true
              ? "border-emerald-300 bg-emerald-100 text-emerald-800"
              : "border-amber-300 bg-amber-100 text-amber-800"
          }`}
        >
          {record.requirements_submitted === true ? "Complete" : "Incomplete"}
        </span>
      </div>

      <div className="mt-4 grid gap-3 lg:grid-cols-3">
        {items.map((item) => {
          const document = existingByKey.get(item.documentKey);

          return (
            <div
              key={item.key}
              className="rounded-xl border border-emerald-100 bg-emerald-50/40 p-3.5"
            >
              <p className="text-[10px] font-bold uppercase tracking-wider text-emerald-700">
                {item.label}{" "}
                {item.required ? (
                  <span className="text-rose-600">*</span>
                ) : (
                  <span className="font-semibold text-emerald-500">
                    (Optional)
                  </span>
                )}
              </p>

              {document ? (
                <a
                  href={document.url}
                  target="_blank"
                  rel="noreferrer"
                  className="mt-1.5 inline-flex items-center gap-1 text-xs font-semibold text-emerald-700 underline"
                >
                  <CheckCircle2 size={12} />
                  View file
                </a>
              ) : (
                <p className="mt-1.5 text-[11px] text-emerald-500">
                  Not uploaded
                </p>
              )}

              <input
                ref={(node) => {
                  fileInputRefs.current[item.key] = node;
                }}
                type="file"
                accept=".pdf,.png,.jpg,.jpeg,.webp,.doc,.docx"
                className="sr-only"
                onChange={(event) => {
                  const file = event.target.files?.[0] ?? null;
                  setFiles((previous) => ({ ...previous, [item.key]: file }));
                  setMessage("");
                }}
              />

              <div className="mt-2.5 flex gap-1.5">
                <button
                  type="button"
                  onClick={() => setCameraFor(item.key)}
                  className="inline-flex flex-1 items-center justify-center gap-1 rounded-lg border border-emerald-300 bg-white px-2 py-2 text-[11px] font-semibold text-emerald-700 transition hover:bg-emerald-50"
                >
                  <Camera size={13} />
                  Take Photo
                </button>
                <button
                  type="button"
                  onClick={() => fileInputRefs.current[item.key]?.click()}
                  className="inline-flex flex-1 items-center justify-center gap-1 rounded-lg border border-emerald-300 bg-white px-2 py-2 text-[11px] font-semibold text-emerald-700 transition hover:bg-emerald-50"
                >
                  <Upload size={13} />
                  {files[item.key] || document ? "Replace" : "Choose file"}
                </button>
              </div>

              {files[item.key] ? (
                <p className="mt-1.5 truncate text-[10px] font-semibold text-emerald-700">
                  Selected: {files[item.key]?.name}
                </p>
              ) : document ? (
                <p className="mt-1.5 truncate text-[10px] font-semibold text-emerald-600">
                  Uploaded: {document.fileName || "File on record"}
                </p>
              ) : null}
            </div>
          );
        })}
      </div>

      <label className="mt-3 flex items-center gap-2 rounded-lg border border-emerald-200 bg-white px-3 py-2.5 text-xs font-semibold text-emerald-900">
        <input
          type="checkbox"
          checked={complete}
          onChange={(event) => {
            setComplete(event.target.checked);
            setMessage("");
          }}
          className="h-4 w-4 rounded border-emerald-300 text-emerald-600 focus:ring-emerald-500"
        />
        All requirements received
      </label>

      {error && (
        <p className="mt-2 flex items-start gap-1 text-xs font-semibold text-rose-600">
          <AlertCircle size={13} className="mt-0.5 shrink-0" />
          {error}
        </p>
      )}
      {message && (
        <p className="mt-2 flex items-start gap-1 text-xs font-semibold text-emerald-700">
          <CheckCircle2 size={13} className="mt-0.5 shrink-0" />
          {message}
        </p>
      )}

      <button
        type="button"
        onClick={() => void save()}
        disabled={saving}
        className="mt-3 inline-flex items-center gap-2 rounded-lg bg-emerald-700 px-4 py-2.5 text-sm font-bold text-white transition hover:bg-emerald-800 disabled:opacity-70"
      >
        {saving ? (
          <Loader2 size={15} className="animate-spin" />
        ) : (
          <Save size={15} />
        )}
        {saving ? "Saving..." : "Save requirements"}
      </button>

      {cameraFor && (
        <RequirementCameraDialog
          label={
            items.find((item) => item.key === cameraFor)?.label || "Document"
          }
          onClose={() => setCameraFor(null)}
          onCapture={(file) => {
            setFiles((previous) => ({ ...previous, [cameraFor]: file }));
            setMessage("");
            setCameraFor(null);
          }}
        />
      )}
    </section>
  );
}
