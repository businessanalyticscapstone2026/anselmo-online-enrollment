"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";

const emptySubscribe = () => () => { };

function useLocalStorage(key: string, defaultValue: string = ""): string {
  return useSyncExternalStore(
    emptySubscribe,
    () =>
      typeof window !== "undefined"
        ? localStorage.getItem(key) ?? defaultValue
        : defaultValue,
    () => defaultValue
  );
}

export default function AccountPage() {
  const storedEmail = useLocalStorage("studentEmail", "your registered email");
  const storedApplicationId = useLocalStorage("applicationId", "");
  const storedEnrollmentId = useLocalStorage("enrollmentId", "");
  const storedFeedback = useLocalStorage("emailMessage", "");
  const accountEmailPending = useLocalStorage(
    "studentAccountEmailPending",
    ""
  );

  const [isSending, setIsSending] = useState(false);
  const [apiFeedback, setApiFeedback] = useState<string | null>(null);
  const autoSendAttempted = useRef(false);

  const email = storedEmail;
  const applicationId = storedApplicationId || storedEnrollmentId;
  const feedbackMessage = apiFeedback || storedFeedback || null;

  const triggerSendEmail = useCallback(async (targetEmail: string) => {
    if (!targetEmail || targetEmail === "your registered email") return;
    setIsSending(true);
    setApiFeedback(null);
    try {
      const studentName =
        (typeof window !== "undefined" ? localStorage.getItem("studentName") : null) ||
        "Student";
      const track =
        (typeof window !== "undefined" ? localStorage.getItem("studentTrack") : null) ||
        "Senior High Track";
      const cluster =
        (typeof window !== "undefined"
          ? localStorage.getItem("studentCluster")
          : null) || "";
      const currentApplicationId =
        (typeof window !== "undefined"
          ? localStorage.getItem("applicationId") ||
          localStorage.getItem("enrollmentId")
          : null) || "";
      const contactNumber =
        (typeof window !== "undefined"
          ? localStorage.getItem("studentContactNumber")
          : null) || "";

      if (!currentApplicationId) {
        setApiFeedback(
          "Your application ID was not found. Please return to the enrollment form before requesting credentials."
        );
        return;
      }

      const response = await fetch("/api/send-account", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          email: targetEmail,
          applicationId: currentApplicationId,
          studentName,
          track,
          cluster,
          contactNumber,
        }),
      });
      const data = await response.json().catch(() => null);

      if (!response.ok || !data?.success || data.authRegistered === false) {
        setApiFeedback(
          data?.error ||
          "Unable to send your portal credentials. Please try again or contact the school registrar."
        );
        return;
      }

      if (typeof window !== "undefined") {
        localStorage.removeItem("studentAccountEmailPending");
      }

      if (data.message) {
        setApiFeedback(data.message);
      }
    } catch (err) {
      console.error("Failed to send credentials:", err);
      setApiFeedback(
        "Unable to connect to the email service. Please try again or contact the school registrar."
      );
    } finally {
      setIsSending(false);
    }
  }, []);

  useEffect(() => {
    if (
      email &&
      email !== "your registered email" &&
      applicationId &&
      accountEmailPending === "true" &&
      !autoSendAttempted.current
    ) {
      autoSendAttempted.current = true;
      let isCancelled = false;
      const timeoutId = setTimeout(() => {
        if (!isCancelled) {
          triggerSendEmail(email);
        }
      }, 100);
      return () => {
        isCancelled = true;
        clearTimeout(timeoutId);
      };
    }
  }, [email, applicationId, accountEmailPending, triggerSendEmail]);

  return (
    <main className="min-h-screen bg-[#eaf5ec] px-4 py-8">
      <div className="mx-auto max-w-4xl">
        {/* HEADER */}
        <header className="mb-6 rounded-2xl bg-white px-6 py-5 shadow-sm">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <h1 className="text-xl font-bold text-emerald-900 sm:text-2xl">
                Anselmo A. Sandoval Memorial National High School
              </h1>
              <p className="mt-1 text-sm text-gray-500">
                Online Enrollment System
              </p>
            </div>
          </div>
        </header>

        {/* PROGRESS */}
        <div className="mb-6 rounded-2xl bg-white px-4 py-5 shadow-sm sm:px-6">
          <div className="flex items-center">
            {[
              "Track Selection",
              "Cluster Selection",
              "Enrollment Form",
              "Requirements",
            ].map((label) => (
              <div key={label} className="flex flex-1 items-center last:flex-none">
                <div className="flex items-center">
                  <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-yellow-400 text-xs font-bold text-emerald-950 sm:h-9 sm:w-9 sm:text-sm">
                    ✓
                  </div>
                  <span className="ml-2 hidden text-xs font-semibold text-emerald-700 sm:block sm:text-sm">
                    {label}
                  </span>
                </div>
                <div className="mx-2 h-px flex-1 bg-yellow-400 sm:mx-3" />
              </div>
            ))}

            {/* STEP 5: ACTIVE */}
            <div className="flex items-center">
              <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-yellow-400 text-xs font-bold text-emerald-950 ring-4 ring-emerald-100 sm:h-9 sm:w-9 sm:text-sm">
                5
              </div>
              <span className="ml-2 hidden text-xs font-semibold text-emerald-700 sm:block sm:text-sm">
                Account
              </span>
            </div>
          </div>
        </div>

        {/* MAIN CARD */}
        <div className="rounded-2xl bg-white px-6 py-10 shadow-sm sm:px-12">
          {/* SUCCESS ICON */}
          <div className="flex justify-center">
            <div className="flex h-20 w-20 items-center justify-center rounded-full bg-green-100 ring-8 ring-green-50">
              <div className="flex h-12 w-12 items-center justify-center rounded-full bg-yellow-400 text-2xl font-bold text-emerald-950 shadow-md">
                ✓
              </div>
            </div>
          </div>

          {/* TITLE */}
          <div className="mt-6 text-center">
            <h2 className="text-2xl font-bold text-emerald-900 sm:text-3xl">
              Enrollment Submitted Successfully!
            </h2>
            <p className="mx-auto mt-3 max-w-2xl text-sm leading-6 text-gray-500">
              Your enrollment application and requirements have been received. Your login credentials have been automatically generated and sent to your email.
            </p>
          </div>

          {/* CREDENTIALS CARD */}
          <div className="mx-auto mt-8 max-w-2xl rounded-2xl border border-emerald-300 bg-emerald-50 p-6 shadow-sm">
            <div className="flex flex-col gap-4 sm:flex-row sm:items-start">
              <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full bg-yellow-400 text-2xl text-emerald-950 shadow-sm">
                ✉
              </div>

              <div className="flex-1">
                <div className="flex items-center justify-between gap-2">
                  <h3 className="font-bold text-emerald-900 text-base sm:text-lg">
                    Account Credentials Sent
                  </h3>
                  <span className="inline-flex items-center gap-1 rounded-full bg-emerald-100 px-2.5 py-0.5 text-xs font-semibold text-emerald-800">
                    <span className="h-1.5 w-1.5 rounded-full bg-emerald-600 animate-pulse" />
                    {isSending ? "Sending" : "Automatic"}
                  </span>
                </div>

                <p className="mt-1 text-sm leading-6 text-gray-600">
                  Your official portal login credentials, including your temporary password, have been sent to your registered email address.
                </p>

                {/* Email Box */}
                <div className="mt-4 rounded-xl bg-white p-4 shadow-xs border border-gray-100">
                  <p className="text-xs font-bold uppercase tracking-wider text-gray-500">
                    Registered Email (Username)
                  </p>
                  <p
                    suppressHydrationWarning
                    className="mt-1 font-mono text-sm sm:text-base font-semibold text-emerald-700 break-all"
                  >
                    {email}
                  </p>
                </div>

                {/* Resend button */}
                <div className="mt-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3 pt-3 border-t border-emerald-200">
                  <p className="text-xs text-gray-500">
                    Did not receive the email? Check your spam folder or resend it.
                  </p>
                  <button
                    type="button"
                    disabled={isSending}
                    onClick={() => triggerSendEmail(email)}
                    className="cursor-pointer text-xs font-bold text-emerald-700 hover:text-emerald-900 hover:underline disabled:opacity-50"
                  >
                    {isSending ? "Sending..." : "↻ Resend Email Credentials"}
                  </button>
                </div>
              </div>
            </div>
          </div>

          {/* Feedback note if any */}
          {feedbackMessage && (
            <div className="mx-auto mt-4 max-w-2xl rounded-xl border border-emerald-200 bg-emerald-50/80 px-4 py-3 text-xs text-emerald-900">
              ℹ️ {feedbackMessage}
            </div>
          )}

          {/* PASSWORD NOTICE */}
          <div className="mx-auto mt-6 max-w-2xl rounded-xl border border-amber-200 bg-amber-50 p-5">
            <h3 className="font-semibold text-amber-900 flex items-center gap-2">
              <span>⚠️</span> Important Security Reminders
            </h3>

            <ul className="mt-2 space-y-1.5 text-xs sm:text-sm leading-6 text-amber-800">
              <li>• Check your email inbox and spam folder for the account confirmation notice.</li>
              <li>• Your temporary password is only sent to your registered email and is never shown on this page.</li>
              <li>• Keep your temporary password confidential and do not share it with others.</li>
              <li>• You will be prompted to change this temporary password upon your first sign in.</li>
            </ul>
          </div>

          {/* APPLICATION STATUS */}
          <div className="mx-auto mt-6 max-w-2xl rounded-xl border border-gray-200 bg-gray-50 p-5">
            <h3 className="font-semibold text-emerald-900">
              What happens next?
            </h3>

            <div className="mt-4 space-y-4">
              <StatusItem
                number="1"
                title="Application & Credentials Dispatched"
                description="Your enrollment information has been recorded and temporary login credentials sent by email."
                completed
              />
              <StatusItem
                number="2"
                title="Application Review"
                description="The school registrar will review your information and submitted requirements."
              />
              <StatusItem
                number="3"
                title="Enrollment Verification"
                description="Your enrollment status will be updated after the school completes the review."
              />
              <StatusItem
                number="4"
                title="Section & Adviser Assignment"
                description="Once approved, your assigned section and adviser will be posted on your portal."
              />
            </div>
          </div>

          {/* BUTTON */}
          <div className="mt-8 flex justify-center">
            <Link
              href="/login"
              className="cursor-pointer rounded-xl bg-yellow-400 px-8 py-3.5 text-sm font-semibold text-emerald-950 shadow-sm transition hover:bg-yellow-300 hover:shadow-md"
            >
              Continue to Sign In
            </Link>
          </div>
        </div>
      </div>
    </main>
  );
}

/* ============================================================= */
/* STATUS ITEM                                                    */
/* ============================================================= */

function StatusItem({
  number,
  title,
  description,
  completed = false,
}: {
  number: string;
  title: string;
  description: string;
  completed?: boolean;
}) {
  return (
    <div className="flex gap-4">
      <div
        className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-sm font-bold ${completed ? "bg-yellow-400 text-emerald-950" : "bg-gray-200 text-gray-500"
          }`}
      >
        {completed ? "✓" : number}
      </div>

      <div>
        <h4 className={`text-sm font-semibold ${completed ? "text-emerald-700" : "text-gray-700"}`}>
          {title}
        </h4>
        <p className="mt-0.5 text-xs leading-5 text-gray-500">
          {description}
        </p>
      </div>
    </div>
  );
}
