"use client";

import Image from "next/image";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  AlertCircle,
  ArrowLeft,
  Camera,
  CheckCircle2,
  FileText,
  Upload,
  X,
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

function formatFileSize(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

type UploadFieldProps = {
  id: string;
  label: string;
  required?: boolean;
  helper?: string;
  file: File | null;
  onChange: (file: File | null) => void;
  disabled?: boolean;
};

function UploadField({
  id,
  label,
  required = false,
  helper,
  file,
  onChange,
  disabled = false,
}: UploadFieldProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const streamRef = useRef<MediaStream | null>(null);

  const [cameraOpen, setCameraOpen] = useState(false);
  const [cameraAttempt, setCameraAttempt] = useState(0);
  const [cameraError, setCameraError] = useState<string | null>(null);

  const stopStream = useCallback(() => {
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((track) => track.stop());
      streamRef.current = null;
    }
    if (videoRef.current) {
      videoRef.current.srcObject = null;
    }
  }, []);

  const openCamera = () => {
    if (disabled) return;
    setCameraError(null);
    setCameraAttempt((attempt) => attempt + 1);
    setCameraOpen(true);
  };

  const closeCamera = () => {
    stopStream();
    setCameraOpen(false);
  };

  const clearFile = () => {
    if (disabled) return;
    if (inputRef.current) {
      inputRef.current.value = "";
    }
    onChange(null);
  };

  // Start a live camera stream while the capture dialog is open.
  useEffect(() => {
    if (!cameraOpen) return;

    let cancelled = false;

    const start = async () => {
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
  }, [cameraOpen, cameraAttempt, stopStream]);

  // Stop the stream if the component unmounts while the camera is open.
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

    onChange(
      new File([blob], `camera-${Date.now()}.jpg`, {
        type: "image/jpeg",
      })
    );
    closeCamera();
  };

  return (
    <div className="min-w-0">
      <div className="mb-2 flex items-center justify-between gap-3">
        <label htmlFor={id} className="text-sm font-semibold text-emerald-900">
          {label}{" "}
          {required && (
            <span className="text-red-500" aria-hidden="true">
              *
            </span>
          )}
        </label>
        <span
          className={`text-[10px] font-bold uppercase tracking-wider ${
            file
              ? "text-emerald-700"
              : required
                ? "text-amber-600"
                : "text-emerald-700/60"
          }`}
        >
          {file ? "Selected" : required ? "Required" : "Optional"}
        </span>
      </div>

      <div
        className={`rounded-xl border-2 border-dashed p-4 transition focus-within:border-emerald-300 focus-within:ring-2 focus-within:ring-yellow-300/40 focus-within:bg-amber-50 ${
          file
            ? "border-emerald-300 bg-emerald-50"
            : "border-emerald-200 bg-white hover:border-emerald-300 hover:bg-emerald-50/60"
        }`}
      >
        <input
          ref={inputRef}
          id={id}
          type="file"
          accept="image/*,application/pdf"
          className="sr-only"
          disabled={disabled}
          onChange={(event) => onChange(event.target.files?.[0] ?? null)}
        />

        {file ? (
          <div className="flex min-w-0 items-center gap-3">
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-yellow-400/10 text-emerald-700">
              <FileText className="h-5 w-5" />
            </div>
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-semibold text-emerald-900">
                {file.name}
              </p>
              <p className="text-xs text-emerald-700/70">
                {formatFileSize(file.size)}
              </p>
            </div>
            <div className="flex shrink-0 items-center gap-1">
              <button
                type="button"
                onClick={openCamera}
                disabled={disabled}
                className="inline-flex items-center gap-1 rounded-lg px-2 py-1 text-xs font-semibold text-emerald-700 transition hover:bg-yellow-400/10 disabled:cursor-not-allowed disabled:opacity-50"
              >
                <Camera className="h-3.5 w-3.5" />
                Retake
              </button>
              <button
                type="button"
                onClick={() => inputRef.current?.click()}
                disabled={disabled}
                className="rounded-lg px-2 py-1 text-xs font-semibold text-emerald-700 transition hover:bg-yellow-400/10 disabled:cursor-not-allowed disabled:opacity-50"
              >
                Replace
              </button>
              <button
                type="button"
                onClick={clearFile}
                disabled={disabled}
                className="rounded-lg p-1.5 text-emerald-700/50 transition hover:bg-red-50 hover:text-red-600 disabled:cursor-not-allowed disabled:opacity-50"
                aria-label={`Remove ${label}`}
              >
                <X className="h-4 w-4" />
              </button>
            </div>
          </div>
        ) : (
          <div className="flex min-w-0 flex-col items-center justify-center gap-3 py-2 text-center sm:flex-row sm:text-left">
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-yellow-400/10 text-emerald-700">
              <Camera className="h-5 w-5" />
            </div>
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center justify-center gap-x-4 gap-y-1 sm:justify-start">
                <button
                  type="button"
                  onClick={openCamera}
                  disabled={disabled}
                  className="inline-flex items-center gap-1.5 text-sm font-semibold text-emerald-700 underline underline-offset-4 transition hover:text-emerald-900 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  <Camera className="h-4 w-4" />
                  Take Photo
                </button>
                <label
                  htmlFor={id}
                  className={`inline-flex items-center gap-1.5 text-sm font-semibold text-emerald-700 underline underline-offset-4 transition hover:text-emerald-900 ${
                    disabled ? "cursor-not-allowed opacity-50" : "cursor-pointer"
                  }`}
                >
                  <Upload className="h-4 w-4" />
                  Choose a file
                </label>
              </div>
              <p className="mt-1 text-xs leading-5 text-emerald-700/70">
                Take a photo with your camera or choose an image or PDF file ·
                max 10 MB
              </p>
            </div>
          </div>
        )}
      </div>

      {helper && (
        <p className="mt-2 text-xs leading-5 text-emerald-700/70">{helper}</p>
      )}

      {cameraOpen && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-4"
          onClick={closeCamera}
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
                onClick={closeCamera}
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
                  onClick={openCamera}
                  className="rounded-lg border border-emerald-200 bg-white px-5 py-2.5 text-sm font-semibold text-emerald-800 transition hover:bg-emerald-50"
                >
                  Try again
                </button>
              ) : (
                <button
                  type="button"
                  onClick={capturePhoto}
                  className="inline-flex items-center gap-2 rounded-lg bg-yellow-300 px-6 py-2.5 text-sm font-bold text-emerald-950 shadow-lg shadow-amber-300/25 transition hover:bg-yellow-400"
                >
                  <Camera className="h-4 w-4" />
                  Capture Photo
                </button>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
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

  const disabled = submitting || Boolean(success);

  return (
    <div className="min-h-screen bg-[#eaf5ec] text-[#06281b]">
      <header className="sticky top-0 z-50 w-full border-b border-emerald-800/70 bg-[#0b3d2e] shadow-lg">
        <div className="mx-auto flex max-w-4xl items-center justify-between gap-4 px-4 py-4 sm:px-6">
          <Link
            href="/student/dashboard"
            className="group flex min-w-0 items-center gap-3"
          >
            <div className="relative flex h-11 w-11 shrink-0 items-center justify-center overflow-hidden rounded-full shadow-md ring-2 ring-yellow-400/60 ring-offset-2 ring-offset-[#0b3d2e] transition-transform group-hover:scale-105">
              <Image
                src="/school-logo-trimmed.png"
                alt="AASMNHS logo"
                width={44}
                height={44}
                className="h-full w-full object-cover"
              />
            </div>
            <div className="min-w-0">
              <p className="truncate text-sm font-extrabold tracking-wide text-white">
                AASMNHS
              </p>
              <p className="truncate text-[10px] font-medium text-emerald-200">
                Student Enrollment Portal
              </p>
            </div>
          </Link>
          <Link
            href="/student/dashboard"
            className="inline-flex items-center gap-2 rounded-lg border border-emerald-600/60 px-3 py-2 text-xs font-semibold text-emerald-50 transition hover:bg-white/10"
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
        <h1 className="mt-2 text-2xl font-extrabold tracking-tight text-emerald-900 sm:text-3xl">
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

        <section className="mt-6 space-y-5 rounded-2xl border border-emerald-200 bg-emerald-50/80 p-5 sm:p-6">
          <div className="grid grid-cols-1 gap-5 md:grid-cols-2">
            <UploadField
              id="birth-certificate"
              label="Birth Certificate"
              required
              file={birthCertificate}
              onChange={(file) => {
                setBirthCertificate(file);
                setError("");
              }}
              disabled={disabled}
            />
            <UploadField
              id="report-card"
              label="Grade 10 Report Card"
              required
              file={reportCard}
              onChange={(file) => {
                setReportCard(file);
                setError("");
              }}
              disabled={disabled}
            />
            <div className="md:col-span-2">
              <UploadField
                id="form-137"
                label="Other requirement"
                helper="Optional. For example: Form 137, good moral certificate, or other supporting documents."
                file={form137}
                onChange={(file) => {
                  setForm137(file);
                  setError("");
                }}
                disabled={disabled}
              />
            </div>
          </div>

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
              disabled={disabled || !birthCertificate || !reportCard}
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
