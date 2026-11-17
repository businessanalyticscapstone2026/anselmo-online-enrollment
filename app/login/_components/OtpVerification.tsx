"use client";

import {
  FormEvent,
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";
import { AlertCircle, CheckCircle2, KeyRound, RefreshCw } from "lucide-react";

function formatWait(seconds: number): string {
  if (seconds >= 60) {
    const minutes = Math.ceil(seconds / 60);
    return `${minutes} min`;
  }

  return `${seconds}s`;
}

export function OtpVerification({
  area,
  email,
  onVerified,
  onBack,
  onAuthFailure,
}: {
  area: "staff" | "admin";
  email: string;
  onVerified: (result: { requiresTotp?: boolean }) => void;
  onBack: () => void;
  onAuthFailure: (message: string) => void;
}) {
  const [code, setCode] = useState("");
  const [sending, setSending] = useState(false);
  const [verifying, setVerifying] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [cooldown, setCooldown] = useState(0);
  const [lockedSeconds, setLockedSeconds] = useState(0);
  const autoSentRef = useRef(false);

  const sendCode = useCallback(async () => {
    setSending(true);
    setError("");

    try {
      const response = await fetch("/api/auth/mfa/send", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ area }),
      });

      const result = await response.json().catch(() => ({}));

      if (!response.ok || !result.success) {
        const message =
          result.error || "Unable to send a verification code right now.";

        if (response.status === 401 || response.status === 403) {
          onAuthFailure(message);
          return;
        }

        const retryAfterSeconds = Number(result.retryAfterSeconds);

        if (
          response.status === 429 &&
          Number.isFinite(retryAfterSeconds) &&
          retryAfterSeconds > 0
        ) {
          setLockedSeconds(Math.ceil(retryAfterSeconds));
        }

        setError(message);
        return;
      }

      setNotice(
        `A 6-digit code was sent to ${result.email || email
        }. Check your inbox and spam folder.`
      );
      setLockedSeconds(0);
      setCooldown(60);
    } catch (sendError) {
      console.error("OTP send error:", sendError);
      setError("Unable to send the code. Check your connection and try again.");
    } finally {
      setSending(false);
    }
  }, [area, email, onAuthFailure]);

  useEffect(() => {
    if (autoSentRef.current) return;
    autoSentRef.current = true;
    void sendCode();
  }, [sendCode]);

  useEffect(() => {
    if (cooldown <= 0) return;

    const timer = setTimeout(() => {
      setCooldown((value) => Math.max(0, value - 1));
    }, 1000);

    return () => clearTimeout(timer);
  }, [cooldown]);

  useEffect(() => {
    if (lockedSeconds <= 0) return;

    const timer = setTimeout(() => {
      setLockedSeconds((value) => Math.max(0, value - 1));
    }, 1000);

    return () => clearTimeout(timer);
  }, [lockedSeconds]);

  async function verify(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");

    if (!/^\d{6}$/.test(code)) {
      setError("Enter the 6-digit verification code from your email.");
      return;
    }

    setVerifying(true);

    try {
      const response = await fetch("/api/auth/mfa/verify", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ area, code }),
      });

      const result = await response.json().catch(() => ({}));

      if (!response.ok || !result.success) {
        const message = result.error || "Verification failed. Please try again.";

        if (response.status === 401 || response.status === 403) {
          onAuthFailure(message);
          return;
        }

        const retryAfterSeconds = Number(result.retryAfterSeconds);

        if (
          response.status === 429 &&
          Number.isFinite(retryAfterSeconds) &&
          retryAfterSeconds > 0
        ) {
          setLockedSeconds(Math.ceil(retryAfterSeconds));
        }

        setError(message);
        return;
      }

      onVerified({ requiresTotp: Boolean(result.requiresTotp) });
    } catch (verifyError) {
      console.error("OTP verify error:", verifyError);
      setError("Unable to verify the code. Check your connection and try again.");
    } finally {
      setVerifying(false);
    }
  }

  return (
    <div>
      <div className="mb-6 text-center">
        <div className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-xl border border-emerald-200 bg-amber-50">
          <KeyRound className="text-emerald-700" />
        </div>

        <h1 className="text-2xl font-extrabold">Email Verification</h1>

        <p className="mt-2 text-sm text-emerald-900">
          Enter the one-time code sent to{" "}
          <span className="font-semibold text-emerald-950">{email}</span>
        </p>
      </div>

      {error && (
        <div
          role="alert"
          className="mb-4 flex gap-2 rounded-lg border border-red-200 bg-red-50 p-3 text-xs text-red-700"
        >
          <AlertCircle size={16} className="shrink-0" />
          <span>{error}</span>
        </div>
      )}

      {notice && !error && (
        <div
          role="status"
          className="mb-4 flex gap-2 rounded-lg border border-emerald-200 bg-emerald-50 p-3 text-xs text-emerald-700"
        >
          <CheckCircle2 size={16} className="shrink-0" />
          <span>{notice}</span>
        </div>
      )}

      <form onSubmit={verify} className="space-y-4">
        <label className="block">
          <span className="mb-2 block text-xs font-bold uppercase tracking-wider text-emerald-600">
            Verification Code
          </span>

          <input
            type="text"
            inputMode="numeric"
            autoComplete="one-time-code"
            autoFocus
            maxLength={6}
            value={code}
            onChange={(event) =>
              setCode(event.target.value.replace(/\D+/g, "").slice(0, 6))
            }
            placeholder="000000"
            className="w-full rounded-lg border border-emerald-200 bg-white py-3.5 text-center text-2xl font-bold tracking-[0.5em] text-emerald-950 outline-none placeholder:text-emerald-700 focus:border-emerald-200"
          />
        </label>

        <button
          type="submit"
          disabled={verifying || sending || lockedSeconds > 0}
          className="w-full rounded-lg bg-yellow-300 py-3.5 text-sm font-extrabold text-emerald-950 transition hover:bg-yellow-300 disabled:cursor-not-allowed disabled:opacity-60"
        >
          {lockedSeconds > 0
            ? `Try again in ${formatWait(lockedSeconds)}`
            : verifying
              ? "Verifying..."
              : "Verify and Continue"}
        </button>
      </form>

      <div className="mt-4 flex flex-col items-center gap-2 text-center">
        <button
          type="button"
          onClick={sendCode}
          disabled={
            sending || cooldown > 0 || verifying || lockedSeconds > 0
          }
          className="inline-flex items-center gap-1.5 text-xs font-semibold text-emerald-700 underline-offset-4 hover:underline disabled:cursor-not-allowed disabled:opacity-60"
        >
          <RefreshCw size={13} className={sending ? "animate-spin" : undefined} />
          {lockedSeconds > 0
            ? `Try again in ${formatWait(lockedSeconds)}`
            : cooldown > 0
              ? `Resend code in ${cooldown}s`
              : sending
                ? "Sending new code..."
                : "Resend code"}
        </button>

        <button
          type="button"
          onClick={onBack}
          disabled={verifying}
          className="text-xs font-semibold text-emerald-800 underline-offset-4 hover:text-emerald-950 hover:underline disabled:opacity-60"
        >
          Use a different account
        </button>
      </div>

      <p className="mt-5 text-center text-xs leading-5 text-emerald-800">
        The code expires shortly and can only be used once. School staff will
        never ask you to share it.
      </p>
    </div>
  );
}
