"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  AlertCircle,
  ArrowLeft,
  ArrowRight,
  Camera,
  Check,
  CheckCircle2,
  Loader2,
  Save,
  Upload,
  X,
} from "lucide-react";
import { TRACKS, getClustersForTrack } from "@/lib/clusters";
import {
  DISTANCE_LEARNING_MODALITIES,
  SPECIAL_NEEDS_DETAILS,
  SPECIAL_NEEDS_DIAGNOSES,
  SPECIAL_NEEDS_MANIFESTATIONS,
} from "@/lib/enrollmentFormOptions";
import {
  WALK_IN_GRADE_LEVELS,
  WALK_IN_SEX_OPTIONS,
  computeAge,
  emptyWalkInInput,
  validateWalkInInput,
  walkInFullName,
  walkInInputFromRecord,
  walkInRequirementLinks,
  type WalkInAddress,
  type WalkInGuardian,
  type WalkInInput,
} from "@/lib/walkInEnrollment";

type Props = {
  mode: "create" | "edit";
  recordId?: string;
  initialRecord?: Record<string, unknown>;
};

type RequirementFiles = {
  reportCard: File | null;
  birthCertificate: File | null;
  otherRequirement: File | null;
};

type RequirementFileKey = keyof RequirementFiles;

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

const STEPS = [
  {
    title: "Track & Cluster",
    description: "Choose the senior high track, cluster, and grade level.",
  },
  {
    title: "Student Information",
    description: "Encode the learner's personal, address, and school details.",
  },
  {
    title: "Family & Guardians",
    description: "Record the parents or legal guardian and contact numbers.",
  },
  {
    title: "Requirements & Review",
    description: "Upload requirements, review the record, and save.",
  },
] as const;

const INPUT_CLASS =
  "w-full rounded-lg border border-emerald-200 bg-white px-3 py-2.5 text-sm text-emerald-950 outline-none transition placeholder:text-emerald-400 focus:border-emerald-500 focus:ring-2 focus:ring-emerald-200 disabled:bg-emerald-50 disabled:text-emerald-500";

const ERROR_INPUT_CLASS =
  "w-full rounded-lg border border-rose-400 bg-rose-50/40 px-3 py-2.5 text-sm text-emerald-950 outline-none transition placeholder:text-emerald-400 focus:border-rose-500 focus:ring-2 focus:ring-rose-200";

function nameValue(value: string): string {
  return value
    .replace(/[^A-Za-zÀ-ÖØ-öø-ÿ.'’\-\s]/g, "")
    .toUpperCase()
    .slice(0, 100);
}

function textValue(value: string, maxLength = 150): string {
  return value
    .replace(/[^A-Za-zÀ-ÖØ-öø-ÿ.,'’/&\-\s]/g, "")
    .toUpperCase()
    .slice(0, maxLength);
}

function digitsValue(value: string, maxLength: number): string {
  return value.replace(/\D/g, "").slice(0, maxLength);
}

function Field({
  label,
  htmlFor,
  error,
  required,
  hint,
  children,
  className = "",
}: {
  label: string;
  htmlFor?: string;
  error?: string;
  required?: boolean;
  hint?: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <div className={className}>
      <label
        htmlFor={htmlFor}
        className="mb-1.5 block text-[10px] font-bold uppercase tracking-wider text-emerald-700"
      >
        {label}
        {required && <span className="ml-1 text-rose-600">*</span>}
      </label>
      {children}
      {hint && !error && (
        <p className="mt-1 text-[11px] text-emerald-600">{hint}</p>
      )}
      {error && (
        <p className="mt-1 flex items-start gap-1 text-[11px] font-semibold text-rose-600">
          <AlertCircle size={12} className="mt-0.5 shrink-0" />
          {error}
        </p>
      )}
    </div>
  );
}

function StepIndicator({ current }: { current: number }) {
  return (
    <ol className="grid gap-2 sm:grid-cols-4">
      {STEPS.map((item, index) => {
        const complete = index < current;
        const active = index === current;

        return (
          <li
            key={item.title}
            className={`flex items-center gap-2 rounded-xl border px-3 py-2.5 ${
              active
                ? "border-emerald-500 bg-emerald-50"
                : complete
                  ? "border-emerald-200 bg-white"
                  : "border-emerald-100 bg-white/60"
            }`}
          >
            <span
              className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-[11px] font-bold ${
                complete
                  ? "bg-emerald-600 text-white"
                  : active
                    ? "bg-emerald-700 text-white"
                    : "bg-emerald-100 text-emerald-600"
              }`}
            >
              {complete ? <Check size={13} /> : index + 1}
            </span>
            <div className="min-w-0">
              <p
                className={`truncate text-xs font-bold ${
                  active ? "text-emerald-900" : "text-emerald-700"
                }`}
              >
                {item.title}
              </p>
              <p className="hidden truncate text-[10px] text-emerald-500 lg:block">
                {item.description}
              </p>
            </div>
          </li>
        );
      })}
    </ol>
  );
}

export default function WalkInForm({ mode, recordId, initialRecord }: Props) {
  const router = useRouter();
  const initialInput = useMemo(
    () =>
      initialRecord ? walkInInputFromRecord(initialRecord) : emptyWalkInInput(),
    [initialRecord]
  );

  const [input, setInput] = useState<WalkInInput>(initialInput);
  const [step, setStep] = useState(0);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [submitError, setSubmitError] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [files, setFiles] = useState<RequirementFiles>({
    reportCard: null,
    birthCertificate: null,
    otherRequirement: null,
  });
  const [requirementsComplete, setRequirementsComplete] = useState(
    initialRecord?.requirements_submitted === true
  );
  const [cameraFor, setCameraFor] = useState<RequirementFileKey | null>(null);
  const fileInputRefs = useRef<Record<RequirementFileKey, HTMLInputElement | null>>(
    {
      reportCard: null,
      birthCertificate: null,
      otherRequirement: null,
    }
  );

  const clusterOptions = useMemo(
    () => getClustersForTrack(input.track),
    [input.track]
  );

  const existingDocuments = useMemo(
    () => (initialRecord ? walkInRequirementLinks(initialRecord) : []),
    [initialRecord]
  );

  const clearError = (key: string) => {
    setErrors((previous) => {
      if (!(key in previous)) return previous;
      const next = { ...previous };
      delete next[key];
      return next;
    });
  };

  const update = <K extends keyof WalkInInput>(
    key: K,
    value: WalkInInput[K]
  ) => {
    setInput((previous) => ({ ...previous, [key]: value }));
    clearError(String(key));
  };

  const setAddress = (
    which: "currentAddress" | "permanentAddress",
    field: keyof WalkInAddress,
    value: string
  ) => {
    setInput((previous) => {
      const next = {
        ...previous,
        [which]: { ...previous[which], [field]: value },
      };

      if (which === "currentAddress" && previous.sameAsCurrentAddress) {
        next.permanentAddress = { ...next.currentAddress };
      }

      return next;
    });
    clearError(`${which}.${field}`);
  };

  const setGuardian = (
    index: number,
    field: keyof WalkInGuardian,
    value: string
  ) => {
    setInput((previous) => {
      const guardians = previous.guardians.map((guardian, guardianIndex) =>
        guardianIndex === index
          ? { ...guardian, [field]: value }
          : guardian
      );

      return { ...previous, guardians };
    });
    clearError(`guardians.${index}.${field}`);
  };

  const toggleModality = (modality: string) => {
    setInput((previous) => ({
      ...previous,
      preferredModalities: previous.preferredModalities.includes(modality)
        ? previous.preferredModalities.filter((item) => item !== modality)
        : [...previous.preferredModalities, modality],
    }));
  };

  const stepFields: Record<number, string[]> = {
    0: ["track", "selectedCluster", "gradeLevel"],
    1: [
      "lrn",
      "firstName",
      "middleName",
      "lastName",
      "email",
      "birthDate",
      "age",
      "placeOfBirth",
      "sex",
      "contactNumber",
      "currentAddress.barangay",
      "currentAddress.municipality",
      "currentAddress.province",
      "permanentAddress.barangay",
      "permanentAddress.municipality",
      "permanentAddress.province",
      "ipCommunityType",
      "fourPsHouseholdId",
      "specialNeedsProgram",
      "specialNeedsCondition",
      "hasPwdId",
      "lastSchoolId",
      "collegeCourse",
      "preferredModalities",
    ],
    2: input.guardians.flatMap((_, index) => [
      `guardians.${index}.lastName`,
      `guardians.${index}.firstName`,
      `guardians.${index}.contactNumber`,
    ]),
    3: ["requirementsDocuments", "certificationAccepted"],
  };

  const goNext = () => {
    const validation = validateWalkInInput(input);
    setErrors(validation);

    const currentErrors = stepFields[step].filter((key) => validation[key]);

    if (currentErrors.length > 0) {
      setSubmitError("Please complete the highlighted fields on this step.");
      return;
    }

    setSubmitError("");
    setStep((previous) => Math.min(STEPS.length - 1, previous + 1));
  };

  const goBack = () => {
    setSubmitError("");
    setStep((previous) => Math.max(0, previous - 1));
  };

  const handleSubmit = async () => {
    if (submitting) return;

    const validation = validateWalkInInput(input);
    const hasReportCard =
      Boolean(files.reportCard) ||
      existingDocuments.some((document) => document.key === "report_card");
    const hasBirthCertificate =
      Boolean(files.birthCertificate) ||
      existingDocuments.some((document) => document.key === "birth_certificate");

    if (!hasReportCard || !hasBirthCertificate) {
      validation.requirementsDocuments =
        "Birth Certificate and Grade 10 Report Card are required, same as the online enrollment.";
    }

    if (Object.keys(validation).length > 0) {
      setErrors(validation);
      const firstStep =
        [0, 1, 2, 3].find((candidate) =>
          stepFields[candidate].some((key) => validation[key])
        ) ?? 3;
      setStep(firstStep);
      setSubmitError("Please complete the highlighted fields before saving.");
      return;
    }

    setSubmitting(true);
    setSubmitError("");

    try {
      const payload = {
        ...input,
        requirementsToFollow: !requirementsComplete,
      };

      const response = await fetch(
        mode === "create"
          ? "/api/staff/walk-ins"
          : `/api/staff/walk-ins/${recordId}`,
        {
          method: mode === "create" ? "POST" : "PATCH",
          headers: { "Content-Type": "application/json" },
          credentials: "include",
          body: JSON.stringify(
            mode === "create" ? payload : { action: "details", ...payload }
          ),
        }
      );

      const result = (await response.json().catch(() => ({}))) as {
        success?: boolean;
        error?: string;
        errors?: Record<string, string>;
        record?: Record<string, unknown>;
      };

      if (!response.ok || !result.success || !result.record) {
        if (result.errors) {
          setErrors(result.errors);
        }
        throw new Error(result.error || "The walk-in record could not be saved.");
      }

      const savedId = String(result.record.id);

      const selectedFiles = [
        files.reportCard,
        files.birthCertificate,
        files.otherRequirement,
      ].filter((file): file is File => Boolean(file));

      if (selectedFiles.length > 0) {
        const formData = new FormData();
        if (files.reportCard) formData.append("reportCard", files.reportCard);
        if (files.birthCertificate) {
          formData.append("birthCertificate", files.birthCertificate);
        }
        if (files.otherRequirement) {
          formData.append("otherRequirement", files.otherRequirement);
        }
        if (requirementsComplete) {
          formData.append("markSubmitted", "true");
        }

        const uploadResponse = await fetch(
          `/api/staff/walk-ins/${savedId}/requirements`,
          {
            method: "POST",
            credentials: "include",
            body: formData,
          }
        );
        const uploadResult = (await uploadResponse.json().catch(() => ({}))) as {
          success?: boolean;
          error?: string;
        };

        if (!uploadResponse.ok || !uploadResult.success) {
          throw new Error(
            uploadResult.error ||
              "The record was saved, but the requirement files could not be uploaded. Open the record and upload them again."
          );
        }
      } else if (requirementsComplete !== (initialRecord?.requirements_submitted === true)) {
        const patchResponse = await fetch(`/api/staff/walk-ins/${savedId}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          credentials: "include",
          body: JSON.stringify({
            action: "requirements",
            requirementsSubmitted: requirementsComplete,
          }),
        });
        const patchResult = (await patchResponse.json().catch(() => ({}))) as {
          success?: boolean;
          error?: string;
        };

        if (!patchResponse.ok || !patchResult.success) {
          throw new Error(
            patchResult.error ||
              "The record was saved, but the requirements status could not be updated."
          );
        }
      }

      router.push(`/staff/dashboard/walk-ins/${savedId}`);
      router.refresh();
    } catch (error) {
      setSubmitError(
        error instanceof Error
          ? error.message
          : "The walk-in record could not be saved."
      );
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="space-y-6">
      <header className="flex flex-col gap-4 rounded-2xl border border-emerald-200 bg-white/90 p-5 shadow-sm sm:flex-row sm:items-center sm:justify-between sm:p-6">
        <div>
          <Link
            href="/staff/dashboard/walk-ins"
            className="inline-flex items-center gap-1.5 text-xs font-semibold text-emerald-700 transition hover:text-emerald-900"
          >
            <ArrowLeft size={14} />
            Back to Manage Walk-ins
          </Link>
          <h1 className="mt-2 text-2xl font-extrabold text-emerald-950 sm:text-3xl">
            {mode === "create" ? "Encode Walk-in Student" : "Edit Walk-in Details"}
          </h1>
          <p className="mt-1 max-w-2xl text-sm text-emerald-800">
            {mode === "create"
              ? "Complete the same details required by the online enrollment. The record is saved for the registrar only — no student account is created."
              : "Update the encoded walk-in details. The record stays linked to the registrar and never gets a student account."}
          </p>
        </div>
        <span className="inline-flex shrink-0 items-center gap-2 rounded-full border border-amber-300 bg-amber-50 px-3 py-1.5 text-[10px] font-bold uppercase tracking-wider text-amber-800">
          <AlertCircle size={13} />
          No student dashboard access
        </span>
      </header>

      <StepIndicator current={step} />

      {submitError && (
        <div className="flex items-start gap-3 rounded-xl border border-rose-200 bg-rose-50 p-4 text-sm text-rose-800">
          <AlertCircle size={18} className="mt-0.5 shrink-0" />
          <p>{submitError}</p>
        </div>
      )}

      <section className="rounded-2xl border border-emerald-200 bg-white/90 p-5 shadow-sm sm:p-6">
        {step === 0 && (
          <div className="space-y-7">
            <div>
              <h2 className="text-lg font-bold text-emerald-950">
                Senior High Track
              </h2>
              <p className="mt-1 text-sm text-emerald-700">
                Select the track the walk-in student is enrolling in.
              </p>

              <div className="mt-4 grid gap-3 md:grid-cols-2">
                {TRACKS.map((track) => {
                  const active = input.track === track.value;
                  return (
                    <button
                      key={track.value}
                      type="button"
                      onClick={() => {
                        update("track", track.value);
                        update("selectedCluster", "");
                      }}
                      className={`rounded-xl border p-4 text-left transition ${
                        active
                          ? "border-emerald-600 bg-emerald-50 ring-2 ring-emerald-200"
                          : "border-emerald-200 bg-white hover:border-emerald-400 hover:bg-emerald-50/50"
                      }`}
                    >
                      <div className="flex items-center justify-between gap-3">
                        <p className="text-sm font-bold text-emerald-950">
                          {track.label}
                        </p>
                        <span
                          className={`flex h-5 w-5 items-center justify-center rounded-full border ${
                            active
                              ? "border-emerald-600 bg-emerald-600 text-white"
                              : "border-emerald-300 text-transparent"
                          }`}
                        >
                          <Check size={12} />
                        </span>
                      </div>
                      <p className="mt-1 text-xs leading-5 text-emerald-700">
                        {track.description}
                      </p>
                    </button>
                  );
                })}
              </div>
              {errors.track && (
                <p className="mt-2 flex items-center gap-1 text-xs font-semibold text-rose-600">
                  <AlertCircle size={13} />
                  {errors.track}
                </p>
              )}
            </div>

            <div>
              <h2 className="text-lg font-bold text-emerald-950">Cluster</h2>
              <p className="mt-1 text-sm text-emerald-700">
                {input.track
                  ? "Choose one cluster under the selected track."
                  : "Select a track first to see its clusters."}
              </p>

              <div className="mt-4 grid gap-2.5 sm:grid-cols-2">
                {clusterOptions.map((cluster) => {
                  const active = input.selectedCluster === cluster;
                  return (
                    <button
                      key={cluster}
                      type="button"
                      disabled={!input.track}
                      onClick={() => update("selectedCluster", cluster)}
                      className={`flex items-center justify-between gap-3 rounded-lg border px-3.5 py-3 text-left text-sm font-semibold transition disabled:cursor-not-allowed disabled:opacity-50 ${
                        active
                          ? "border-emerald-600 bg-emerald-600 text-white"
                          : "border-emerald-200 bg-white text-emerald-800 hover:border-emerald-400 hover:bg-emerald-50"
                      }`}
                    >
                      {cluster}
                      {active && <Check size={15} />}
                    </button>
                  );
                })}
              </div>
              {errors.selectedCluster && (
                <p className="mt-2 flex items-center gap-1 text-xs font-semibold text-rose-600">
                  <AlertCircle size={13} />
                  {errors.selectedCluster}
                </p>
              )}
            </div>

            <Field
              label="Grade Level"
              htmlFor="gradeLevel"
              error={errors.gradeLevel}
              required
            >
              <select
                id="gradeLevel"
                value={input.gradeLevel}
                onChange={(event) => update("gradeLevel", event.target.value)}
                className={errors.gradeLevel ? ERROR_INPUT_CLASS : INPUT_CLASS}
              >
                {WALK_IN_GRADE_LEVELS.map((level) => (
                  <option key={level} value={level}>
                    {level}
                  </option>
                ))}
              </select>
            </Field>
          </div>
        )}

        {step === 1 && (
          <div className="space-y-8">
            <div>
              <h2 className="text-lg font-bold text-emerald-950">
                Learner Information
              </h2>
              <div className="mt-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                <Field
                  label="LRN (if applicable)"
                  htmlFor="lrn"
                  error={errors.lrn}
                >
                  <input
                    id="lrn"
                    inputMode="numeric"
                    value={input.lrn}
                    onChange={(event) =>
                      update("lrn", digitsValue(event.target.value, 12))
                    }
                    placeholder="12-digit LRN"
                    className={errors.lrn ? ERROR_INPUT_CLASS : INPUT_CLASS}
                  />
                </Field>

                <Field
                  label="Last Name"
                  htmlFor="lastName"
                  error={errors.lastName}
                  required
                >
                  <input
                    id="lastName"
                    value={input.lastName}
                    onChange={(event) =>
                      update("lastName", nameValue(event.target.value))
                    }
                    className={errors.lastName ? ERROR_INPUT_CLASS : INPUT_CLASS}
                  />
                </Field>

                <Field
                  label="First Name"
                  htmlFor="firstName"
                  error={errors.firstName}
                  required
                >
                  <input
                    id="firstName"
                    value={input.firstName}
                    onChange={(event) =>
                      update("firstName", nameValue(event.target.value))
                    }
                    className={errors.firstName ? ERROR_INPUT_CLASS : INPUT_CLASS}
                  />
                </Field>

                <Field
                  label="Middle Name"
                  htmlFor="middleName"
                  error={errors.middleName}
                >
                  <input
                    id="middleName"
                    value={input.middleName}
                    onChange={(event) =>
                      update("middleName", nameValue(event.target.value))
                    }
                    className={errors.middleName ? ERROR_INPUT_CLASS : INPUT_CLASS}
                  />
                </Field>

                <Field label="Extension Name" htmlFor="extension">
                  <input
                    id="extension"
                    value={input.extension}
                    onChange={(event) =>
                      update("extension", nameValue(event.target.value))
                    }
                    placeholder="Jr., Sr., III"
                    className={INPUT_CLASS}
                  />
                </Field>

                <Field
                  label="Birth Date"
                  htmlFor="birthDate"
                  error={errors.birthDate}
                  required
                >
                  <input
                    id="birthDate"
                    type="date"
                    value={input.birthDate}
                    onChange={(event) => {
                      const value = event.target.value;
                      setInput((previous) => ({
                        ...previous,
                        birthDate: value,
                        age: computeAge(value),
                      }));
                      clearError("birthDate");
                    }}
                    className={errors.birthDate ? ERROR_INPUT_CLASS : INPUT_CLASS}
                  />
                </Field>

                <Field label="Age" htmlFor="age" error={errors.age} required>
                  <input
                    id="age"
                    readOnly
                    value={input.age ?? ""}
                    className={`${INPUT_CLASS} bg-emerald-50`}
                  />
                </Field>

                <Field label="Sex" htmlFor="sex" error={errors.sex} required>
                  <select
                    id="sex"
                    value={input.sex}
                    onChange={(event) => update("sex", event.target.value)}
                    className={errors.sex ? ERROR_INPUT_CLASS : INPUT_CLASS}
                  >
                    <option value="">Select sex</option>
                    {WALK_IN_SEX_OPTIONS.map((option) => (
                      <option key={option} value={option}>
                        {option}
                      </option>
                    ))}
                  </select>
                </Field>

                <Field label="Religion" htmlFor="religion">
                  <input
                    id="religion"
                    value={input.religion}
                    onChange={(event) =>
                      update("religion", textValue(event.target.value, 100))
                    }
                    className={INPUT_CLASS}
                  />
                </Field>

                <Field
                  label="Contact Number"
                  htmlFor="contactNumber"
                  error={errors.contactNumber}
                >
                  <input
                    id="contactNumber"
                    inputMode="numeric"
                    value={input.contactNumber}
                    onChange={(event) =>
                      update(
                        "contactNumber",
                        digitsValue(event.target.value, 11)
                      )
                    }
                    placeholder="09XXXXXXXXX"
                    className={
                      errors.contactNumber ? ERROR_INPUT_CLASS : INPUT_CLASS
                    }
                  />
                </Field>

                <Field
                  label="Email Address"
                  htmlFor="email"
                  error={errors.email}
                >
                  <input
                    id="email"
                    type="email"
                    value={input.email}
                    onChange={(event) =>
                      update("email", event.target.value.replace(/\s/g, ""))
                    }
                    className={errors.email ? ERROR_INPUT_CLASS : INPUT_CLASS}
                    placeholder="Optional"
                  />
                </Field>

                <Field
                  label="Place of Birth"
                  htmlFor="placeOfBirth"
                  error={errors.placeOfBirth}
                  required
                >
                  <input
                    id="placeOfBirth"
                    value={input.placeOfBirth}
                    onChange={(event) =>
                      update("placeOfBirth", textValue(event.target.value, 200))
                    }
                    className={
                      errors.placeOfBirth ? ERROR_INPUT_CLASS : INPUT_CLASS
                    }
                  />
                </Field>
              </div>
            </div>

            <div>
              <h2 className="text-lg font-bold text-emerald-950">
                Current Address
              </h2>
              <div className="mt-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
                <Field label="House No." htmlFor="currentHouseNo">
                  <input
                    id="currentHouseNo"
                    value={input.currentAddress.houseNo}
                    onChange={(event) =>
                      setAddress(
                        "currentAddress",
                        "houseNo",
                        digitsValue(event.target.value, 10)
                      )
                    }
                    className={INPUT_CLASS}
                  />
                </Field>

                <Field
                  label="Street"
                  htmlFor="currentStreet"
                  className="lg:col-span-2"
                >
                  <input
                    id="currentStreet"
                    value={input.currentAddress.street}
                    onChange={(event) =>
                      setAddress(
                        "currentAddress",
                        "street",
                        textValue(event.target.value)
                      )
                    }
                    className={INPUT_CLASS}
                  />
                </Field>

                <Field
                  label="Barangay"
                  htmlFor="currentBarangay"
                  error={errors["currentAddress.barangay"]}
                  required
                >
                  <input
                    id="currentBarangay"
                    value={input.currentAddress.barangay}
                    onChange={(event) =>
                      setAddress(
                        "currentAddress",
                        "barangay",
                        textValue(event.target.value)
                      )
                    }
                    className={
                      errors["currentAddress.barangay"]
                        ? ERROR_INPUT_CLASS
                        : INPUT_CLASS
                    }
                  />
                </Field>

                <Field
                  label="Municipality / City"
                  htmlFor="currentMunicipality"
                  error={errors["currentAddress.municipality"]}
                  required
                >
                  <input
                    id="currentMunicipality"
                    value={input.currentAddress.municipality}
                    onChange={(event) =>
                      setAddress(
                        "currentAddress",
                        "municipality",
                        textValue(event.target.value)
                      )
                    }
                    className={
                      errors["currentAddress.municipality"]
                        ? ERROR_INPUT_CLASS
                        : INPUT_CLASS
                    }
                  />
                </Field>

                <Field
                  label="Province"
                  htmlFor="currentProvince"
                  error={errors["currentAddress.province"]}
                  required
                >
                  <input
                    id="currentProvince"
                    value={input.currentAddress.province}
                    onChange={(event) =>
                      setAddress(
                        "currentAddress",
                        "province",
                        textValue(event.target.value)
                      )
                    }
                    className={
                      errors["currentAddress.province"]
                        ? ERROR_INPUT_CLASS
                        : INPUT_CLASS
                    }
                  />
                </Field>

                <Field label="ZIP Code" htmlFor="currentZip">
                  <input
                    id="currentZip"
                    inputMode="numeric"
                    value={input.currentAddress.zipCode}
                    onChange={(event) =>
                      setAddress(
                        "currentAddress",
                        "zipCode",
                        digitsValue(event.target.value, 4)
                      )
                    }
                    className={INPUT_CLASS}
                  />
                </Field>
              </div>
            </div>

            <div>
              <div className="flex flex-wrap items-center justify-between gap-3">
                <h2 className="text-lg font-bold text-emerald-950">
                  Permanent Address
                </h2>
                <label className="inline-flex items-center gap-2 text-sm font-semibold text-emerald-800">
                  <input
                    type="checkbox"
                    checked={input.sameAsCurrentAddress}
                    onChange={(event) => {
                      const checked = event.target.checked;
                      setInput((previous) => ({
                        ...previous,
                        sameAsCurrentAddress: checked,
                        permanentAddress: checked
                          ? { ...previous.currentAddress }
                          : previous.permanentAddress,
                      }));
                    }}
                    className="h-4 w-4 rounded border-emerald-300 text-emerald-600 focus:ring-emerald-500"
                  />
                  Same as current address
                </label>
              </div>

              <div className="mt-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
                <Field label="House No." htmlFor="permanentHouseNo">
                  <input
                    id="permanentHouseNo"
                    value={input.permanentAddress.houseNo}
                    disabled={input.sameAsCurrentAddress}
                    onChange={(event) =>
                      setAddress(
                        "permanentAddress",
                        "houseNo",
                        digitsValue(event.target.value, 10)
                      )
                    }
                    className={INPUT_CLASS}
                  />
                </Field>

                <Field
                  label="Street"
                  htmlFor="permanentStreet"
                  className="lg:col-span-2"
                >
                  <input
                    id="permanentStreet"
                    value={input.permanentAddress.street}
                    disabled={input.sameAsCurrentAddress}
                    onChange={(event) =>
                      setAddress(
                        "permanentAddress",
                        "street",
                        textValue(event.target.value)
                      )
                    }
                    className={INPUT_CLASS}
                  />
                </Field>

                <Field
                  label="Barangay"
                  htmlFor="permanentBarangay"
                  error={errors["permanentAddress.barangay"]}
                  required={!input.sameAsCurrentAddress}
                >
                  <input
                    id="permanentBarangay"
                    value={input.permanentAddress.barangay}
                    disabled={input.sameAsCurrentAddress}
                    onChange={(event) =>
                      setAddress(
                        "permanentAddress",
                        "barangay",
                        textValue(event.target.value)
                      )
                    }
                    className={
                      errors["permanentAddress.barangay"]
                        ? ERROR_INPUT_CLASS
                        : INPUT_CLASS
                    }
                  />
                </Field>

                <Field
                  label="Municipality / City"
                  htmlFor="permanentMunicipality"
                  error={errors["permanentAddress.municipality"]}
                  required={!input.sameAsCurrentAddress}
                >
                  <input
                    id="permanentMunicipality"
                    value={input.permanentAddress.municipality}
                    disabled={input.sameAsCurrentAddress}
                    onChange={(event) =>
                      setAddress(
                        "permanentAddress",
                        "municipality",
                        textValue(event.target.value)
                      )
                    }
                    className={
                      errors["permanentAddress.municipality"]
                        ? ERROR_INPUT_CLASS
                        : INPUT_CLASS
                    }
                  />
                </Field>

                <Field
                  label="Province"
                  htmlFor="permanentProvince"
                  error={errors["permanentAddress.province"]}
                  required={!input.sameAsCurrentAddress}
                >
                  <input
                    id="permanentProvince"
                    value={input.permanentAddress.province}
                    disabled={input.sameAsCurrentAddress}
                    onChange={(event) =>
                      setAddress(
                        "permanentAddress",
                        "province",
                        textValue(event.target.value)
                      )
                    }
                    className={
                      errors["permanentAddress.province"]
                        ? ERROR_INPUT_CLASS
                        : INPUT_CLASS
                    }
                  />
                </Field>

                <Field label="ZIP Code" htmlFor="permanentZip">
                  <input
                    id="permanentZip"
                    inputMode="numeric"
                    value={input.permanentAddress.zipCode}
                    disabled={input.sameAsCurrentAddress}
                    onChange={(event) =>
                      setAddress(
                        "permanentAddress",
                        "zipCode",
                        digitsValue(event.target.value, 4)
                      )
                    }
                    className={INPUT_CLASS}
                  />
                </Field>
              </div>
            </div>

            <div>
              <h2 className="text-lg font-bold text-emerald-950">
                Learner Background
              </h2>
              <div className="mt-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                <Field label="Last School Year Completed" htmlFor="lastSchoolYear">
                  <input
                    id="lastSchoolYear"
                    value={input.lastSchoolYearCompleted}
                    onChange={(event) =>
                      update(
                        "lastSchoolYearCompleted",
                        textValue(event.target.value, 20)
                      )
                    }
                    placeholder="e.g. 2025-2026"
                    className={INPUT_CLASS}
                  />
                </Field>

                <Field
                  label="Last School Attended"
                  htmlFor="lastSchool"
                  className="lg:col-span-2"
                >
                  <input
                    id="lastSchool"
                    value={input.lastSchoolAttended}
                    onChange={(event) =>
                      update(
                        "lastSchoolAttended",
                        textValue(event.target.value, 200)
                      )
                    }
                    className={INPUT_CLASS}
                  />
                </Field>

                <Field
                  label="Last School ID"
                  htmlFor="lastSchoolId"
                  error={errors.lastSchoolId}
                >
                  <input
                    id="lastSchoolId"
                    inputMode="numeric"
                    value={input.lastSchoolId}
                    onChange={(event) =>
                      update("lastSchoolId", digitsValue(event.target.value, 6))
                    }
                    className={errors.lastSchoolId ? ERROR_INPUT_CLASS : INPUT_CLASS}
                  />
                </Field>

                <Field
                  label="Course you want to take in College"
                  htmlFor="collegeCourse"
                  error={errors.collegeCourse}
                  required
                  className="sm:col-span-2"
                >
                  <input
                    id="collegeCourse"
                    value={input.collegeCourse}
                    onChange={(event) =>
                      update("collegeCourse", textValue(event.target.value, 200))
                    }
                    className={
                      errors.collegeCourse ? ERROR_INPUT_CLASS : INPUT_CLASS
                    }
                  />
                </Field>
              </div>

              <div className="mt-5 grid gap-4 sm:grid-cols-2">
                <div className="rounded-xl border border-emerald-100 bg-emerald-50/50 p-4">
                  <label className="flex items-center gap-2 text-sm font-semibold text-emerald-900">
                    <input
                      type="checkbox"
                      checked={input.isIpCommunity}
                      onChange={(event) =>
                        update("isIpCommunity", event.target.checked)
                      }
                      className="h-4 w-4 rounded border-emerald-300 text-emerald-600 focus:ring-emerald-500"
                    />
                    Member of an IP community
                  </label>
                  {input.isIpCommunity && (
                    <Field
                      label="IP Community Group"
                      htmlFor="ipCommunityType"
                      error={errors.ipCommunityType}
                      className="mt-3"
                    >
                      <input
                        id="ipCommunityType"
                        value={input.ipCommunityType}
                        onChange={(event) =>
                          update(
                            "ipCommunityType",
                            textValue(event.target.value, 120)
                          )
                        }
                        className={
                          errors.ipCommunityType
                            ? ERROR_INPUT_CLASS
                            : INPUT_CLASS
                        }
                      />
                    </Field>
                  )}
                </div>

                <div className="rounded-xl border border-emerald-100 bg-emerald-50/50 p-4">
                  <label className="flex items-center gap-2 text-sm font-semibold text-emerald-900">
                    <input
                      type="checkbox"
                      checked={input.is4psBeneficiary}
                      onChange={(event) =>
                        update("is4psBeneficiary", event.target.checked)
                      }
                      className="h-4 w-4 rounded border-emerald-300 text-emerald-600 focus:ring-emerald-500"
                    />
                    4Ps beneficiary
                  </label>
                  {input.is4psBeneficiary && (
                    <Field
                      label="4Ps Household ID"
                      htmlFor="fourPsHouseholdId"
                      error={errors.fourPsHouseholdId}
                      className="mt-3"
                    >
                      <input
                        id="fourPsHouseholdId"
                        value={input.fourPsHouseholdId}
                        onChange={(event) =>
                          update(
                            "fourPsHouseholdId",
                            textValue(event.target.value, 60)
                          )
                        }
                        className={
                          errors.fourPsHouseholdId
                            ? ERROR_INPUT_CLASS
                            : INPUT_CLASS
                        }
                      />
                    </Field>
                  )}
                </div>
              </div>
            </div>

            <div>
              <h2 className="text-lg font-bold text-emerald-950">
                Special Needs Education Program
              </h2>
              <div className="mt-3 rounded-xl border border-emerald-100 bg-emerald-50/50 p-4">
                <p className="text-sm font-semibold text-emerald-900">
                  Is the learner under the Special Needs Education Program?{" "}
                  <span className="text-rose-600">*</span>
                </p>
                <div className="mt-2 flex gap-4">
                  <label className="inline-flex items-center gap-2 text-sm text-emerald-800">
                    <input
                      type="radio"
                      name="specialNeedsProgram"
                      checked={input.specialNeedsProgram === true}
                      onChange={() =>
                        update("specialNeedsProgram", true)
                      }
                      className="h-4 w-4 border-emerald-300 text-emerald-600 focus:ring-emerald-500"
                    />
                    Yes
                  </label>
                  <label className="inline-flex items-center gap-2 text-sm text-emerald-800">
                    <input
                      type="radio"
                      name="specialNeedsProgram"
                      checked={input.specialNeedsProgram === false}
                      onChange={() => {
                        setInput((previous) => ({
                          ...previous,
                          specialNeedsProgram: false,
                          specialNeedsGroup: "",
                          specialNeedsCondition: "",
                          specialNeedsDetail: "",
                        }));
                        clearError("specialNeedsProgram");
                        clearError("specialNeedsCondition");
                      }}
                      className="h-4 w-4 border-emerald-300 text-emerald-600 focus:ring-emerald-500"
                    />
                    No
                  </label>
                </div>
                {errors.specialNeedsProgram && (
                  <p className="mt-2 flex items-center gap-1 text-[11px] font-semibold text-rose-600">
                    <AlertCircle size={12} />
                    {errors.specialNeedsProgram}
                  </p>
                )}

                {input.specialNeedsProgram === true && (
                  <div className="mt-4 space-y-4 border-t border-emerald-200 pt-4">
                    <div>
                      <p className="text-[10px] font-bold uppercase tracking-wider text-emerald-700">
                        a1. With diagnosis from a licensed medical specialist
                      </p>
                      <div className="mt-2 grid gap-1.5 sm:grid-cols-2">
                        {SPECIAL_NEEDS_DIAGNOSES.map((condition) => (
                          <label
                            key={condition}
                            className="flex items-start gap-2 text-xs text-emerald-800"
                          >
                            <input
                              type="radio"
                              name="specialNeedsCondition"
                              checked={input.specialNeedsCondition === condition}
                              onChange={() => {
                                setInput((previous) => ({
                                  ...previous,
                                  specialNeedsGroup: "diagnosis",
                                  specialNeedsCondition: condition,
                                  specialNeedsDetail: "",
                                }));
                                clearError("specialNeedsCondition");
                              }}
                              className="mt-0.5 h-3.5 w-3.5 border-emerald-300 text-emerald-600 focus:ring-emerald-500"
                            />
                            {condition}
                          </label>
                        ))}
                      </div>

                      {SPECIAL_NEEDS_DETAILS[input.specialNeedsCondition] && (
                        <div className="mt-3 flex flex-wrap gap-3 pl-5">
                          {SPECIAL_NEEDS_DETAILS[input.specialNeedsCondition].map(
                            (detail) => (
                              <label
                                key={detail}
                                className="inline-flex items-center gap-1.5 text-xs text-emerald-800"
                              >
                                <input
                                  type="radio"
                                  name="specialNeedsDetail"
                                  checked={input.specialNeedsDetail === detail}
                                  onChange={() =>
                                    update("specialNeedsDetail", detail)
                                  }
                                  className="h-3.5 w-3.5 border-emerald-300 text-emerald-600 focus:ring-emerald-500"
                                />
                                {detail}
                              </label>
                            )
                          )}
                        </div>
                      )}
                    </div>

                    <div>
                      <p className="text-[10px] font-bold uppercase tracking-wider text-emerald-700">
                        a2. With manifestations
                      </p>
                      <div className="mt-2 grid gap-1.5 sm:grid-cols-2">
                        {SPECIAL_NEEDS_MANIFESTATIONS.map((condition) => (
                          <label
                            key={condition}
                            className="flex items-start gap-2 text-xs text-emerald-800"
                          >
                            <input
                              type="radio"
                              name="specialNeedsCondition"
                              checked={input.specialNeedsCondition === condition}
                              onChange={() => {
                                setInput((previous) => ({
                                  ...previous,
                                  specialNeedsGroup: "manifestation",
                                  specialNeedsCondition: condition,
                                  specialNeedsDetail: "",
                                }));
                                clearError("specialNeedsCondition");
                              }}
                              className="mt-0.5 h-3.5 w-3.5 border-emerald-300 text-emerald-600 focus:ring-emerald-500"
                            />
                            {condition}
                          </label>
                        ))}
                      </div>
                      {errors.specialNeedsCondition && (
                        <p className="mt-2 flex items-center gap-1 text-[11px] font-semibold text-rose-600">
                          <AlertCircle size={12} />
                          {errors.specialNeedsCondition}
                        </p>
                      )}
                    </div>
                  </div>
                )}

                <div className="mt-4 border-t border-emerald-200 pt-4">
                  <p className="text-sm font-semibold text-emerald-900">
                    Does the learner have a PWD ID?{" "}
                    <span className="text-rose-600">*</span>
                  </p>
                  <div className="mt-2 flex gap-4">
                    <label className="inline-flex items-center gap-2 text-sm text-emerald-800">
                      <input
                        type="radio"
                        name="hasPwdId"
                        checked={input.hasPwdId === true}
                        onChange={() => update("hasPwdId", true)}
                        className="h-4 w-4 border-emerald-300 text-emerald-600 focus:ring-emerald-500"
                      />
                      Yes
                    </label>
                    <label className="inline-flex items-center gap-2 text-sm text-emerald-800">
                      <input
                        type="radio"
                        name="hasPwdId"
                        checked={input.hasPwdId === false}
                        onChange={() => update("hasPwdId", false)}
                        className="h-4 w-4 border-emerald-300 text-emerald-600 focus:ring-emerald-500"
                      />
                      No
                    </label>
                  </div>
                  {errors.hasPwdId && (
                    <p className="mt-2 flex items-center gap-1 text-[11px] font-semibold text-rose-600">
                      <AlertCircle size={12} />
                      {errors.hasPwdId}
                    </p>
                  )}
                </div>
              </div>
            </div>

            <div>
              <h2 className="text-lg font-bold text-emerald-950">
                Preferred Distance Learning Modalities{" "}
                <span className="text-rose-600">*</span>
              </h2>
              <div className="mt-3 grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
                {DISTANCE_LEARNING_MODALITIES.map((modality) => (
                  <label
                    key={modality}
                    className="flex items-center gap-2 rounded-lg border border-emerald-100 bg-emerald-50/40 px-3 py-2 text-xs font-semibold text-emerald-800"
                  >
                    <input
                      type="checkbox"
                      checked={input.preferredModalities.includes(modality)}
                      onChange={() => toggleModality(modality)}
                      className="h-4 w-4 rounded border-emerald-300 text-emerald-600 focus:ring-emerald-500"
                    />
                    {modality}
                  </label>
                ))}
              </div>
              {errors.preferredModalities && (
                <p className="mt-2 flex items-center gap-1 text-[11px] font-semibold text-rose-600">
                  <AlertCircle size={12} />
                  {errors.preferredModalities}
                </p>
              )}
            </div>
          </div>
        )}

        {step === 2 && (
          <div className="space-y-6">
            <div>
              <h2 className="text-lg font-bold text-emerald-950">
                Parents & Legal Guardian
              </h2>
              <p className="mt-1 text-sm text-emerald-700">
                Mother&apos;s and legal guardian&apos;s details are required.
                Father&apos;s information is optional. All middle names are
                optional.
              </p>
            </div>

            {["Father", "Mother", "Legal Guardian"].map((role, index) => {
              const guardian = input.guardians[index];

              return (
                <div
                  key={role}
                  className="rounded-xl border border-emerald-100 bg-emerald-50/40 p-4"
                >
                  <h3 className="text-sm font-bold text-emerald-900">{role}</h3>
                  <div className="mt-3 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
                    <Field
                      label="Last Name"
                      htmlFor={`guardian-${index}-last`}
                      error={errors[`guardians.${index}.lastName`]}
                      required={index > 0}
                    >
                      <input
                        id={`guardian-${index}-last`}
                        value={guardian.lastName}
                        onChange={(event) =>
                          setGuardian(
                            index,
                            "lastName",
                            nameValue(event.target.value)
                          )
                        }
                        className={
                          errors[`guardians.${index}.lastName`]
                            ? ERROR_INPUT_CLASS
                            : INPUT_CLASS
                        }
                      />
                    </Field>

                    <Field
                      label="First Name"
                      htmlFor={`guardian-${index}-first`}
                      error={errors[`guardians.${index}.firstName`]}
                      required={index > 0}
                    >
                      <input
                        id={`guardian-${index}-first`}
                        value={guardian.firstName}
                        onChange={(event) =>
                          setGuardian(
                            index,
                            "firstName",
                            nameValue(event.target.value)
                          )
                        }
                        className={
                          errors[`guardians.${index}.firstName`]
                            ? ERROR_INPUT_CLASS
                            : INPUT_CLASS
                        }
                      />
                    </Field>

                    <Field
                      label="Middle Name"
                      htmlFor={`guardian-${index}-middle`}
                    >
                      <input
                        id={`guardian-${index}-middle`}
                        value={guardian.middleName}
                        onChange={(event) =>
                          setGuardian(
                            index,
                            "middleName",
                            nameValue(event.target.value)
                          )
                        }
                        className={INPUT_CLASS}
                      />
                    </Field>

                    <Field
                      label="Contact Number"
                      htmlFor={`guardian-${index}-contact`}
                      error={errors[`guardians.${index}.contactNumber`]}
                      required={index > 0}
                    >
                      <input
                        id={`guardian-${index}-contact`}
                        inputMode="numeric"
                        value={guardian.contactNumber}
                        onChange={(event) =>
                          setGuardian(
                            index,
                            "contactNumber",
                            digitsValue(event.target.value, 11)
                          )
                        }
                        placeholder="09XXXXXXXXX"
                        className={
                          errors[`guardians.${index}.contactNumber`]
                            ? ERROR_INPUT_CLASS
                            : INPUT_CLASS
                        }
                      />
                    </Field>
                  </div>
                </div>
              );
            })}
          </div>
        )}

        {step === 3 && (
          <div className="space-y-7">
            <div>
              <h2 className="text-lg font-bold text-emerald-950">
                Enrollment Requirements
              </h2>
              <p className="mt-1 text-sm text-emerald-700">
                Upload scanned copies if the student brought them. You can also
                save the record now and complete the requirements later.
              </p>

              <div className="mt-4 grid gap-4 lg:grid-cols-3">
                {[
                  {
                    key: "reportCard" as const,
                    label: "Grade 10 Report Card",
                    documentKey: "report_card",
                    required: true,
                  },
                  {
                    key: "birthCertificate" as const,
                    label: "Birth Certificate",
                    documentKey: "birth_certificate",
                    required: true,
                  },
                  {
                    key: "otherRequirement" as const,
                    label: "Other Requirements (Form 137)",
                    documentKey: "other_requirement",
                    required: false,
                  },
                ].map((item) => {
                  const existing = existingDocuments.find(
                    (document) => document.key === item.documentKey
                  );

                  return (
                    <div
                      key={item.key}
                      className="rounded-xl border border-emerald-100 bg-emerald-50/40 p-4"
                    >
                      <p className="text-xs font-bold uppercase tracking-wider text-emerald-700">
                        {item.label}{" "}
                        {item.required ? (
                          <span className="text-rose-600">*</span>
                        ) : (
                          <span className="font-semibold text-emerald-500">
                            (Optional)
                          </span>
                        )}
                      </p>

                      {existing ? (
                        <a
                          href={existing.url}
                          target="_blank"
                          rel="noreferrer"
                          className="mt-2 inline-flex items-center gap-1.5 text-xs font-semibold text-emerald-700 underline"
                        >
                          <CheckCircle2 size={13} />
                          View uploaded file
                        </a>
                      ) : (
                        <p className="mt-2 text-[11px] text-emerald-500">
                          No file uploaded yet.
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
                          setFiles((previous) => ({
                            ...previous,
                            [item.key]: file,
                          }));
                        }}
                      />

                      <div className="mt-3 flex gap-2">
                        <button
                          type="button"
                          onClick={() => setCameraFor(item.key)}
                          className="inline-flex flex-1 items-center justify-center gap-1.5 rounded-lg border border-emerald-300 bg-white px-2.5 py-2 text-xs font-semibold text-emerald-700 transition hover:bg-emerald-50"
                        >
                          <Camera size={14} />
                          Take Photo
                        </button>
                        <button
                          type="button"
                          onClick={() => fileInputRefs.current[item.key]?.click()}
                          className="inline-flex flex-1 items-center justify-center gap-1.5 rounded-lg border border-emerald-300 bg-white px-2.5 py-2 text-xs font-semibold text-emerald-700 transition hover:bg-emerald-50"
                        >
                          <Upload size={14} />
                          {files[item.key] || existing ? "Replace" : "Choose file"}
                        </button>
                      </div>

                      {files[item.key] ? (
                        <p className="mt-1.5 truncate text-[11px] font-semibold text-emerald-700">
                          Selected: {files[item.key]?.name}
                        </p>
                      ) : existing ? (
                        <p className="mt-1.5 truncate text-[11px] font-semibold text-emerald-600">
                          Uploaded: {existing.fileName || "File on record"}
                        </p>
                      ) : null}
                    </div>
                  );
                })}
              </div>

              <label className="mt-4 flex items-center gap-2 rounded-xl border border-emerald-200 bg-white px-4 py-3 text-sm font-semibold text-emerald-900">
                <input
                  type="checkbox"
                  checked={requirementsComplete}
                  onChange={(event) =>
                    setRequirementsComplete(event.target.checked)
                  }
                  className="h-4 w-4 rounded border-emerald-300 text-emerald-600 focus:ring-emerald-500"
                />
                Mark requirements as complete (all required documents received)
              </label>
              {errors.requirementsDocuments && (
                <p className="mt-2 flex items-center gap-1 text-xs font-semibold text-rose-600">
                  <AlertCircle size={13} />
                  {errors.requirementsDocuments}
                </p>
              )}
            </div>

            <div>
              <h2 className="text-lg font-bold text-emerald-950">
                Registrar Remarks
              </h2>
              <textarea
                value={input.registrarRemarks}
                onChange={(event) =>
                  update("registrarRemarks", event.target.value.slice(0, 1000))
                }
                rows={3}
                placeholder="Optional notes about this walk-in enrollment."
                className={`${INPUT_CLASS} mt-2 resize-y`}
              />
            </div>

            <div>
              <h2 className="text-lg font-bold text-emerald-950">
                Certification
              </h2>
              <label className="mt-3 flex items-start gap-3 rounded-xl border border-emerald-200 bg-white px-4 py-3 text-sm text-emerald-900">
                <input
                  type="checkbox"
                  checked={input.certificationAccepted}
                  onChange={(event) =>
                    update("certificationAccepted", event.target.checked)
                  }
                  className="mt-0.5 h-4 w-4 rounded border-emerald-300 text-emerald-600 focus:ring-emerald-500"
                />
                <span>
                  I certify that the information encoded for this walk-in student
                  is true and correct based on the documents and details provided
                  to the registrar. <span className="text-rose-600">*</span>
                </span>
              </label>
              {errors.certificationAccepted && (
                <p className="mt-2 flex items-center gap-1 text-xs font-semibold text-rose-600">
                  <AlertCircle size={13} />
                  {errors.certificationAccepted}
                </p>
              )}
            </div>

            <div>
              <h2 className="text-lg font-bold text-emerald-950">Review</h2>
              <div className="mt-3 overflow-hidden rounded-xl border border-emerald-100">
                <dl className="grid gap-px bg-emerald-100 sm:grid-cols-2 lg:grid-cols-3">
                  {[
                    ["Full name", walkInFullName({
                      first_name: input.firstName,
                      middle_name: input.middleName,
                      last_name: input.lastName,
                      extension: input.extension,
                    }) || "—"],
                    ["LRN", input.lrn || "—"],
                    ["Grade level", input.gradeLevel || "—"],
                    ["Track", TRACKS.find((track) => track.value === input.track)?.label || "—"],
                    ["Cluster", input.selectedCluster || "—"],
                    ["Contact number", input.contactNumber || "—"],
                    ["Birth date", input.birthDate || "—"],
                    ["Sex", input.sex || "—"],
                    ["Email", input.email || "Not provided"],
                    [
                      "Guardian",
                      walkInFullName({
                        first_name: input.guardians[0]?.firstName,
                        middle_name: input.guardians[0]?.middleName,
                        last_name: input.guardians[0]?.lastName,
                      }) || "—",
                    ],
                    [
                      "Requirements",
                      requirementsComplete ? "Complete" : "Incomplete / to follow",
                    ],
                    ["Student account", "None (walk-in)"],
                  ].map(([label, value]) => (
                    <div key={label} className="bg-white px-4 py-3">
                      <dt className="text-[10px] font-bold uppercase tracking-wider text-emerald-600">
                        {label}
                      </dt>
                      <dd className="mt-0.5 text-sm font-semibold text-emerald-950">
                        {value}
                      </dd>
                    </div>
                  ))}
                </dl>
              </div>
            </div>
          </div>
        )}
      </section>

      {cameraFor && (
        <RequirementCameraDialog
          label={
            {
              reportCard: "Grade 10 Report Card",
              birthCertificate: "Birth Certificate",
              otherRequirement: "Other Requirements (Form 137)",
            }[cameraFor]
          }
          onClose={() => setCameraFor(null)}
          onCapture={(file) => {
            setFiles((previous) => ({ ...previous, [cameraFor]: file }));
            setCameraFor(null);
          }}
        />
      )}

      <div className="flex flex-col-reverse gap-3 rounded-2xl border border-emerald-200 bg-white/90 p-4 shadow-sm sm:flex-row sm:items-center sm:justify-between">
        <div className="text-xs text-emerald-600">
          Step {step + 1} of {STEPS.length} · {STEPS[step].title}
        </div>

        <div className="flex items-center gap-2">
          {step > 0 && (
            <button
              type="button"
              onClick={goBack}
              disabled={submitting}
              className="inline-flex items-center gap-2 rounded-lg border border-emerald-300 bg-white px-4 py-2.5 text-sm font-semibold text-emerald-800 transition hover:bg-emerald-50 disabled:opacity-60"
            >
              <ArrowLeft size={15} />
              Back
            </button>
          )}

          {step < STEPS.length - 1 ? (
            <button
              type="button"
              onClick={goNext}
              className="inline-flex items-center gap-2 rounded-lg bg-emerald-700 px-5 py-2.5 text-sm font-bold text-white transition hover:bg-emerald-800"
            >
              Next
              <ArrowRight size={15} />
            </button>
          ) : (
            <button
              type="button"
              onClick={() => void handleSubmit()}
              disabled={submitting}
              className="inline-flex items-center gap-2 rounded-lg bg-emerald-700 px-5 py-2.5 text-sm font-bold text-white transition hover:bg-emerald-800 disabled:cursor-not-allowed disabled:opacity-70"
            >
              {submitting ? (
                <Loader2 size={15} className="animate-spin" />
              ) : (
                <Save size={15} />
              )}
              {submitting
                ? "Saving..."
                : mode === "create"
                  ? "Save Walk-in"
                  : "Save Changes"}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
