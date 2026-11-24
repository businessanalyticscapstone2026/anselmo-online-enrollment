// app/enroll/requirements/page.tsx
"use client";

import Image from "next/image";
import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Camera, FileText, Upload, X } from "lucide-react";
import EnrollmentProgress from "@/app/_components/EnrollmentProgress";
import { supabase } from "@/lib/supabaseClient";

const MAX_FILE_SIZE = 50 * 1024 * 1024;

function validateFile(file: File | null, label: string) {
    if (!file) return;

    if (file.size === 0) {
        throw new Error(`${label}: the selected file is empty.`);
    }

    if (file.size > MAX_FILE_SIZE) {
        throw new Error(`${label}: the maximum file size is 50 MB.`);
    }
}

export default function RequirementsPage() {
    const router = useRouter();
    const [birthCertificate, setBirthCertificate] = useState<File | null>(null);
    const [reportCard, setReportCard] = useState<File | null>(null);
    const [otherRequirements, setOtherRequirements] = useState<File | null>(null);
    const [submitting, setSubmitting] = useState(false);
    const [step, setStep] = useState(1);
    const [missingApplicationContext, setMissingApplicationContext] =
        useState(false);
    const [errorMessage, setErrorMessage] = useState<string | null>(null);

    // Auto-redirect to account page when step 2 is reached
    useEffect(() => {
        if (step === 2) {
            const timer = setTimeout(() => {
                router.push("/enroll/account");
            }, 1200);
            return () => clearTimeout(timer);
        }
    }, [step, router]);

    // Without a draft ID or email there is nothing the API can match.
    useEffect(() => {
        const hasDraftId = Boolean(localStorage.getItem("enrollmentDraftId"));
        const hasEmail = Boolean(localStorage.getItem("studentEmail"));

        queueMicrotask(() => {
            setMissingApplicationContext(!hasDraftId && !hasEmail);
        });
    }, []);

    // Redirect to account page after successful upload
    const submitRequirements = async () => {
        const draftId = localStorage.getItem("enrollmentDraftId") || "";

        let email = (localStorage.getItem("studentEmail") || "").trim();
        let contactNumber = (localStorage.getItem("studentContactNumber") || "").trim();
        let studentName = localStorage.getItem("studentName") || "";

        const draft = localStorage.getItem("studentApplicationDraft");
        if (draft) {
            try {
                const parsed = JSON.parse(draft);
                if (!email && typeof parsed?.email === "string" && parsed.email) {
                    email = parsed.email.trim();
                    localStorage.setItem("studentEmail", email);
                }
                if (!contactNumber && typeof parsed?.contactNumber === "string" && parsed.contactNumber) {
                    contactNumber = parsed.contactNumber.trim();
                    localStorage.setItem("studentContactNumber", contactNumber);
                }
                if (!studentName && parsed?.firstName && parsed?.lastName) {
                    studentName = `${parsed.firstName} ${parsed.lastName}`.trim();
                }
            } catch {
                // Ignore parse error
            }
        }

        email = email.toLowerCase();

        if (!email) {
            throw new Error(
                "Your email address was not found. Please return to the enrollment form and submit it again."
            );
        }

        if (!draftId) {
            throw new Error(
                "Your enrollment details were not found. Please start a new application from the enrollment form."
            );
        }

        validateFile(birthCertificate, "Birth Certificate");
        validateFile(reportCard, "Grade 10 Report Card");
        validateFile(otherRequirements, "Other Requirements");

        if (!birthCertificate || !reportCard) {
            throw new Error(
                "Please upload the required birth certificate and Grade 10 report card."
            );
        }

        const filesToUpload: Array<{
            kind: "birthCertificate" | "reportCard" | "form137";
            file: File;
        }> = [
            { kind: "birthCertificate", file: birthCertificate },
            { kind: "reportCard", file: reportCard },
        ];

        if (otherRequirements) {
            filesToUpload.push({ kind: "form137", file: otherRequirements });
        }

        // Get short-lived signed upload URLs from the server, then upload each
        // file directly to Supabase Storage. This bypasses hosting request-body
        // limits (which caused large phone photos to fail) and accepts any
        // image type.
        const prepareResponse = await fetch("/api/enroll/upload-url", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                draftId,
                email,
                contactNumber,
                files: filesToUpload.map(({ kind, file }) => ({
                    kind,
                    name: file.name,
                })),
            }),
        });

        const prepared = await prepareResponse.json().catch(() => null);

        if (
            !prepareResponse.ok ||
            !prepared?.success ||
            !prepared?.bucket ||
            !prepared?.uploads
        ) {
            throw new Error(
                prepared?.error ||
                "Unable to prepare the document upload. Please try again."
            );
        }

        const uploads = prepared.uploads as Record<
            string,
            { name?: string; path?: string; token?: string }
        >;

        for (const { kind, file } of filesToUpload) {
            const target = uploads[kind];

            if (!target?.path || !target?.token) {
                throw new Error(
                    `The upload for ${file.name} could not be prepared.`
                );
            }

            const { error: uploadError } = await supabase.storage
                .from(prepared.bucket)
                .uploadToSignedUrl(target.path, target.token, file, {
                    contentType: file.type || "application/octet-stream",
                });

            if (uploadError) {
                throw new Error(`${file.name}: ${uploadError.message}`);
            }
        }

        const completedFiles: Record<string, unknown> = {};

        for (const { kind, file } of filesToUpload) {
            const target = uploads[kind];
            completedFiles[kind] = {
                path: target.path,
                name: file.name,
                size: file.size,
                type: file.type,
            };
        }

        const completeResponse = await fetch(
            "/api/enroll/complete-requirements",
            {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    draftId: prepared.draftId || draftId,
                    email,
                    contactNumber,
                    studentName,
                    files: completedFiles,
                }),
            }
        );

        const result = await completeResponse.json().catch(() => ({}));

        if (!completeResponse.ok || !result?.success) {
            throw new Error(result?.error || "Document upload failed.");
        }

        if (result.data?.draftId) {
            localStorage.setItem("enrollmentDraftId", result.data.draftId);
        }
        if (result.data?.requirements_documents) {
            localStorage.setItem(
                "studentRequirements",
                JSON.stringify(result.data.requirements_documents)
            );
        }

        return result;
    };

    const handleUpload = async () => {
        setErrorMessage(null);

        try {
            setSubmitting(true);
            await submitRequirements();
            setStep(2);
        } catch (err) {
            console.error("Upload error:", err);
            setErrorMessage(
                err instanceof Error
                    ? err.message
                    : "Something went wrong. Please try again."
            );
        } finally {
            setSubmitting(false);
        }
    };

    return (
        <main className="relative min-h-screen overflow-hidden bg-[#0b3d2e] text-emerald-50">
            {/* Background School Image */}
            <div
                className="fixed inset-0 bg-cover bg-center opacity-40 brightness-75 pointer-events-none"
                style={{
                    backgroundImage: "url('/school-background.png')",
                }}
            />

            {/* Dark Green Gradient Overlay with Khaki Ambient Tints */}
            <div className="fixed inset-0 bg-linear-to-b from-[#0b3d2e]/75 via-[#0b3d2e]/60 to-[#052e1c]/85 pointer-events-none" />

            {/* Ambient Glows */}
            <div className="pointer-events-none fixed -top-40 left-1/2 h-96 w-180 -translate-x-1/2 rounded-full bg-yellow-400/10 blur-3xl" />
            <div className="pointer-events-none fixed bottom-10 -right-20 h-96 w-96 rounded-full bg-emerald-600/20 blur-3xl" />

            {/* Page Content */}
            <div className="relative z-10 flex min-h-screen flex-col">
                {/* Sticky Header */}
                <header className="sticky top-0 z-50 w-full border-b border-emerald-800/70 bg-[#0b3d2e]/70 backdrop-blur-md">
                    <div className="mx-auto flex max-w-6xl items-center justify-between px-6 py-4">
                        <Link href="/" className="group flex items-center gap-3.5">
                            <div className="relative flex h-11 w-11 items-center justify-center overflow-hidden rounded-full shadow-md ring-2 ring-yellow-400/60 ring-offset-2 ring-offset-[#0b3d2e] transition-transform group-hover:scale-105">
                                <Image
                                    src="/school-logo-trimmed.png"
                                    alt="AASMNHS School Logo"
                                    width={44}
                                    height={44}
                                    className="h-full w-full object-cover"
                                    priority
                                />
                            </div>

                            <div>
                                <p className="text-base font-bold tracking-wide text-white">
                                    AASMNHS
                                </p>
                                <p className="text-xs font-medium text-emerald-200">
                                    Online Enrollment System
                                </p>
                            </div>
                        </Link>
                    </div>
                </header>

                <EnrollmentProgress activeStep={4} />

                {/* Main Content Area */}
                <section className="mx-auto w-full max-w-5xl flex-1 px-4 py-10 sm:px-6 sm:py-12">
                    <div className="text-center">
                        {/* Status Pill Badge */}
                        <div className="mb-6 inline-flex items-center gap-2.5 rounded-full border border-emerald-200 bg-emerald-50/80 px-4 py-1.5 text-xs font-semibold uppercase tracking-wider text-emerald-700 backdrop-blur-md shadow-lg shadow-black/20">
                            <span className="relative flex h-2 w-2">
                                <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-yellow-300 opacity-75"></span>
                                <span className="relative inline-flex h-2 w-2 rounded-full bg-yellow-300"></span>
                            </span>
                            Grade 11 Online Enrollment • S.Y. 2026–2027
                        </div>

                        {/* School Name */}
                        <h1 className="text-3xl font-extrabold leading-tight tracking-tight text-white drop-shadow-lg sm:text-4xl md:text-5xl lg:text-6xl">
                            Anselmo A. Sandoval Memorial
                            <span className="mt-1 block bg-linear-to-r from-yellow-300 via-yellow-400 to-emerald-300 bg-clip-text text-transparent">
                                National High School
                            </span>
                        </h1>

                        {/* Portal Subtitle */}
                        <div className="mt-4 flex items-center justify-center gap-3">
                            <span className="h-px w-10 bg-linear-to-r from-transparent to-yellow-300/70 sm:w-16" />
                            <h2 className="text-lg font-semibold tracking-wide text-emerald-100 sm:text-xl md:text-2xl">
                                Online Enrollment System
                            </h2>
                            <span className="h-px w-10 bg-linear-to-l from-transparent to-yellow-300/70 sm:w-16" />
                        </div>

                        {/* Step 4 Heading Box */}
                        <div className="mt-8 rounded-xl border border-emerald-200 bg-emerald-50/70 p-5 backdrop-blur-md shadow-lg">
                            <h3 className="text-xl font-bold text-emerald-700 sm:text-2xl">
                                Step 4: Upload Your Requirements
                            </h3>
                            <p className="mx-auto mt-2 max-w-2xl text-sm leading-relaxed text-emerald-700/90 sm:text-base">
                                Take a photo of your documents or upload clear copies.
                                Every image type is accepted (JPG, PNG, GIF, WEBP,
                                HEIC, and any other format) as well as PDF files.
                                Each file must not exceed 50 MB.
                            </p>
                        </div>
                    </div>

                    {/* Form Container - Pure White Background for High Contrast & Readability */}
                    <div className="mt-10 rounded-2xl border border-gray-200 bg-white p-6 text-gray-900 shadow-2xl ring-1 ring-black/5 sm:p-10">
                        {/* Step 1 - Upload documents */}
                        {step === 1 && (
                            <div className="space-y-8">
                                <div className="flex flex-col gap-2 border-b border-gray-200 pb-4 sm:flex-row sm:items-center sm:justify-between">
                                    <h4 className="flex items-center gap-2 text-lg font-bold text-emerald-900 sm:text-xl">
                                        Enrollment Requirements
                                    </h4>
                                    <span className="text-xs font-semibold text-emerald-700">
                                        Step 4 of 5
                                    </span>
                                </div>

                                {missingApplicationContext && (
                                    <div
                                        className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900"
                                        role="status"
                                    >
                                        <p className="font-semibold">
                                            We could not find your enrollment application on
                                            this browser.
                                        </p>
                                        <p className="mt-1">
                                            Please{" "}
                                            <Link
                                                href="/enroll"
                                                className="font-semibold underline"
                                            >
                                                start a new application
                                            </Link>{" "}
                                            so your requirements can be linked to it.
                                        </p>
                                    </div>
                                )}

                                {errorMessage && (
                                    <div
                                        className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800"
                                        role="alert"
                                    >
                                        <div className="flex items-start gap-2">
                                            <span className="text-base">⚠</span>
                                            <p>{errorMessage}</p>
                                        </div>
                                    </div>
                                )}

                                <div className="grid grid-cols-1 gap-5 md:grid-cols-2">
                                    <UploadField
                                        id="birth-certificate"
                                        label="Birth Certificate"
                                        required
                                        file={birthCertificate}
                                        onChange={(file) => {
                                            setBirthCertificate(file);
                                            setErrorMessage(null);
                                        }}
                                    />

                                    <UploadField
                                        id="report-card"
                                        label="Grade 10 Report Card"
                                        required
                                        file={reportCard}
                                        onChange={(file) => {
                                            setReportCard(file);
                                            setErrorMessage(null);
                                        }}
                                    />

                                    <div className="md:col-span-2">
                                        <UploadField
                                            id="other-requirements"
                                            label="Other Requirements"
                                            helper="Optional. For example: Form 137, good moral certificate, or other supporting documents."
                                            file={otherRequirements}
                                            onChange={(file) => {
                                                setOtherRequirements(file);
                                                setErrorMessage(null);
                                            }}
                                        />
                                    </div>
                                </div>

                                <div className="rounded-xl border border-emerald-300 bg-emerald-50 p-4">
                                    <div className="flex items-start gap-3">
                                        <p className="text-xs leading-6 text-emerald-900 sm:text-sm">
                                            Make sure each document is clear and readable. Your
                                            files are uploaded securely and linked to your
                                            enrollment application.
                                        </p>
                                    </div>
                                </div>

                                {/* Buttons */}
                                <div className="flex flex-col-reverse gap-4 border-t border-gray-200 pt-8 sm:flex-row sm:items-center sm:justify-between">
                                    <button
                                        type="button"
                                        onClick={() => router.back()}
                                        className="rounded-lg border border-gray-300 bg-white px-6 py-3.5 text-center text-sm font-semibold text-gray-700 shadow-sm transition hover:bg-gray-50 hover:text-gray-900"
                                    >
                                        Back to Personal Information
                                    </button>

                                    <button
                                        type="button"
                                        onClick={handleUpload}
                                        disabled={
                                            submitting || !birthCertificate || !reportCard
                                        }
                                        className="flex items-center justify-center gap-2 rounded-lg bg-linear-to-r from-yellow-400 via-yellow-300 to-yellow-300 px-8 py-3.5 text-sm font-bold text-emerald-950 shadow-lg shadow-amber-300/25 transition-all duration-300 hover:scale-[1.02] hover:bg-yellow-300 hover:shadow-[0_0_20px_rgba(23,107,77,0.4)] disabled:cursor-not-allowed disabled:opacity-70"
                                    >
                                        {submitting ? (
                                            <>
                                                <span className="inline-block h-4 w-4 animate-spin rounded-full border-2 border-emerald-200 border-t-transparent" />
                                                <span>Uploading...</span>
                                            </>
                                        ) : (
                                            <span>Upload &amp; Continue</span>
                                        )}
                                    </button>
                                </div>
                            </div>
                        )}

                        {/* Step 2 - Account Setup (redirects) */}
                        {step === 2 && (
                            <div className="py-6 text-center">
                                <div className="mx-auto mb-5 flex h-20 w-20 items-center justify-center rounded-full bg-green-100 ring-8 ring-green-50">
                                    <div className="flex h-12 w-12 items-center justify-center rounded-full bg-yellow-400 text-2xl font-bold text-emerald-950 shadow-md">
                                        ✓
                                    </div>
                                </div>

                                <h4 className="text-2xl font-bold text-emerald-900 sm:text-3xl">
                                    Requirements Uploaded
                                </h4>
                                <p className="mx-auto mt-3 max-w-xl text-sm leading-6 text-gray-500">
                                    Your documents have been submitted. We will now redirect
                                    you to Account Setup to finish your enrollment.
                                </p>
                                <p className="mt-4 text-sm text-gray-500">
                                    Redirecting in a few seconds...
                                </p>

                                <div className="mt-6">
                                    <button
                                        type="button"
                                        onClick={() => router.push("/enroll/account")}
                                        className="text-sm font-semibold text-emerald-700 underline underline-offset-4 hover:text-emerald-900"
                                    >
                                        Click here if not redirected automatically
                                    </button>
                                </div>
                            </div>
                        )}
                    </div>
                </section>

                {/* Footer */}
                <footer className="border-t border-emerald-800/70 bg-[#0b3d2e]/60 px-6 py-5 backdrop-blur-sm">
                    <div className="mx-auto flex max-w-6xl flex-col items-center justify-between gap-2 text-center sm:flex-row sm:text-left">
                        <p className="text-xs text-emerald-200 sm:text-sm">
                            © {new Date().getFullYear()} Capstone Project - BatStateU Mabini Campus
                        </p>
                        <p className="text-xs text-emerald-300">
                            Mabini, Batangas • DepEd Region IV-A CALABARZON
                        </p>
                    </div>
                </footer>
            </div>
        </main>
    );
}

function UploadField({
    id,
    label,
    file,
    required = false,
    helper,
    onChange,
}: {
    id: string;
    label: string;
    file: File | null;
    required?: boolean;
    helper?: string;
    onChange: (file: File | null) => void;
}) {
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
        setCameraError(null);
        setCameraAttempt((attempt) => attempt + 1);
        setCameraOpen(true);
    };

    const closeCamera = () => {
        stopStream();
        setCameraOpen(false);
    };

    const clearFile = () => {
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
                <label
                    htmlFor={id}
                    className="text-sm font-semibold text-emerald-900"
                >
                    {label}{" "}
                    {required && (
                        <span className="text-red-500" aria-hidden="true">
                            *
                        </span>
                    )}
                </label>
                <span
                    className={`text-[10px] font-bold uppercase tracking-wider ${file
                        ? "text-emerald-700"
                        : required
                            ? "text-amber-600"
                            : "text-gray-400"
                        }`}
                >
                    {file ? "Selected" : required ? "Required" : "Optional"}
                </span>
            </div>

            <div
                className={`rounded-xl border-2 border-dashed p-4 transition focus-within:border-emerald-300 focus-within:ring-2 focus-within:ring-yellow-300/40 focus-within:bg-amber-50 ${file
                    ? "border-emerald-200 bg-emerald-50"
                    : "border-gray-200 bg-gray-50/70 hover:border-emerald-200 hover:bg-emerald-50"
                    }`}
            >
                <input
                    ref={inputRef}
                    id={id}
                    type="file"
                    accept="*/*"
                    className="sr-only"
                    onChange={(event) =>
                        onChange(event.target.files?.[0] ?? null)
                    }
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
                            <p className="text-xs text-gray-500">
                                {formatFileSize(file.size)}
                            </p>
                        </div>
                        <div className="flex shrink-0 items-center gap-1">
                            <button
                                type="button"
                                onClick={openCamera}
                                className="inline-flex items-center gap-1 rounded-lg px-2 py-1 text-xs font-semibold text-emerald-700 transition hover:bg-yellow-400/10"
                            >
                                <Camera className="h-3.5 w-3.5" />
                                Retake
                            </button>
                            <button
                                type="button"
                                onClick={() => inputRef.current?.click()}
                                className="rounded-lg px-2 py-1 text-xs font-semibold text-emerald-700 transition hover:bg-yellow-400/10"
                            >
                                Replace
                            </button>
                            <button
                                type="button"
                                onClick={clearFile}
                                className="rounded-lg p-1.5 text-gray-400 transition hover:bg-red-50 hover:text-red-600"
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
                                    className="inline-flex items-center gap-1.5 text-sm font-semibold text-emerald-700 underline underline-offset-4 transition hover:text-emerald-900"
                                >
                                    <Camera className="h-4 w-4" />
                                    Take Photo
                                </button>
                                <label
                                    htmlFor={id}
                                    className="inline-flex cursor-pointer items-center gap-1.5 text-sm font-semibold text-emerald-700 underline underline-offset-4 transition hover:text-emerald-900"
                                >
                                    <Upload className="h-4 w-4" />
                                    Choose a file
                                </label>
                            </div>
                            <p className="mt-1 text-xs leading-5 text-gray-500">
                                Take a photo with your camera or choose any image
                                file (JPG, PNG, HEIC, and every other type) or PDF
                                · max 50 MB
                            </p>
                        </div>
                    </div>
                )}
            </div>

            {helper && (
                <p className="mt-2 text-xs leading-5 text-gray-500">{helper}</p>
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
                        <div className="flex items-center justify-between border-b border-gray-200 px-4 py-3">
                            <h3 className="text-sm font-bold text-emerald-900">
                                Take a photo · {label}
                            </h3>
                            <button
                                type="button"
                                onClick={closeCamera}
                                className="rounded-lg p-1.5 text-gray-400 transition hover:bg-gray-100 hover:text-gray-700"
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
                                    className="rounded-lg border border-gray-300 bg-white px-5 py-2.5 text-sm font-semibold text-gray-700 transition hover:bg-gray-50"
                                >
                                    Try again
                                </button>
                            ) : (
                                <button
                                    type="button"
                                    onClick={capturePhoto}
                                    className="inline-flex items-center gap-2 rounded-lg bg-linear-to-r from-yellow-400 via-yellow-300 to-yellow-300 px-6 py-2.5 text-sm font-bold text-emerald-950 shadow-lg shadow-amber-300/25 transition hover:scale-[1.02]"
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

function formatFileSize(bytes: number) {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
