"use client";

import { FormEvent, useEffect, useState } from "react";
import {
  AlertCircle,
  CheckCircle2,
  MonitorSmartphone,
  RefreshCw,
  ShieldCheck,
} from "lucide-react";
import { supabase } from "@/lib/supabaseClient";

function formatWait(seconds: number): string {
  if (seconds >= 60) {
    return `${Math.ceil(seconds / 60)} min`;
  }

  return `${seconds}s`;
}

export function DeviceVerification({
  area,
  email,
  initialCooldown = 0,
  onVerified,
  onBack,
  onAuthFailure,
}: {
  area: "staff" | "admin";
  email: string;
  initialCooldown?: number;
  onVerified: () => void;
  onBack: () => void;
  onAuthFailure: (message: string) => void;
}) {
  const [code, setCode] = useState("");
  const [sending, setSending] = useState(false);
  const [verifying, setVerifying] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState(
    `A 6-digit device verification code was sent to ${email}. Check your inbox and spam folder.`
  );
  const [cooldown, setCooldown] = useState(Math.max(0, initialCooldown));

  useEffect(() => {
    if (cooldown <= 0) return;

    const timer = setTimeout(() => {
      setCooldown((value) => Math.max(0, value - 1));
    }, 1000);

    return () => clearTimeout(timer);
  }, [cooldown]);

  async function getAccessToken(): Promise<string | null> {
    const { data } = await supabase.auth.getSession();
    return data.session?.access_token ?? null;
  }

  async function resendCode() {
    setSending(true);
    setError("");

    try {
      const token = await getAccessToken();
      const response = await fetch("/api/auth/device/check", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        credentials: "include",
        body: JSON.stringify({ area }),
      });

      const result = await response.json().catch(() => ({}));

      if (!response.ok || !result.success) {
        const message =
          result.error || "Unable to send a device verification code right now.";

        if (response.status === 401 || response.status === 403) {
          onAuthFailure(message);
          return;
        }

        setError(message);
        return;
      }

      if (result.trusted) {
        onVerified();
        return;
      }

      const retryAfterSeconds = Number(result.retryAfterSeconds);

      if (Number.isFinite(retryAfterSeconds) && retryAfterSeconds > 0) {
        setCooldown(Math.ceil(retryAfterSeconds));
      } else {
        setCooldown(60);
      }

      setNotice(
        `A new device verification code was sent to ${
          result.email || email
        }. Check your inbox and spam folder.`
      );
    } catch (sendError) {
      console.error("Device verification send error:", sendError);
      setError("Unable to send the code. Check your connection and try again.");
    } finally {
      setSending(false);
    }
  }

  async function verify(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");

    if (!/^\d{6}$/.test(code)) {
      setError("Enter the 6-digit device verification code from your email.");
      return;
    }

    setVerifying(true);

    try {
      const token = await getAccessToken();
      const response = await fetch("/api/auth/device/verify", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        credentials: "include",
        body: JSON.stringify({ area, code }),
      });

      const result = await response.json().catch(() => ({}));

      if (!response.ok || !result.success) {
        const message =
          result.error || "Device verification failed. Please try again.";

        if (response.status === 401 || response.status === 403) {
          onAuthFailure(message);
          return;
        }

        setError(message);
        return;
      }

      onVerified();
    } catch (verifyError) {
      console.error("Device verification error:", verifyError);
      setError(
        "Unable to verify this device. Check your connection and try again."
      );
    } finally {
      setVerifying(false);
    }
  }

  return (
    <div>
      <div className="mb-6 text-center">
        <div className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-xl border border-emerald-200 bg-amber-50">
          <MonitorSmartphone className="text-emerald-700" />
        </div>

        <h1 className="text-2xl font-extrabold">New Device Verification</h1>

        <p className="mt-2 text-sm text-emerald-900">
          We noticed a sign-in from a device we do not recognize. Enter the code
          sent to{" "}
          <span className="font-semibold text-emerald-950">{email}</span> to
          trust this device.
        </p>
      </div>

      <div className="mb-4 flex gap-2 rounded-lg border border-emerald-200 bg-emerald-50 p-3 text-xs text-emerald-700">
        <ShieldCheck size={16} className="shrink-0" />
        <span>
          This extra step protects the {area === "admin" ? "admin" : "staff"}{" "}
          portal whenever your account is used on a new browser or device.
        </span>
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
            Device Verification Code
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
          disabled={verifying || sending}
          className="w-full rounded-lg bg-yellow-300 py-3.5 text-sm font-extrabold text-emerald-950 transition hover:bg-yellow-300 disabled:cursor-not-allowed disabled:opacity-60"
        >
          {verifying ? "Verifying device..." : "Trust This Device & Continue"}
        </button>
      </form>

      <div className="mt-4 flex flex-col items-center gap-2 text-center">
        <button
          type="button"
          onClick={resendCode}
          disabled={sending || cooldown > 0 || verifying}
          className="inline-flex items-center gap-1.5 text-xs font-semibold text-emerald-700 underline-offset-4 hover:underline disabled:cursor-not-allowed disabled:opacity-60"
        >
          <RefreshCw size={13} className={sending ? "animate-spin" : undefined} />
          {cooldown > 0
            ? `Resend code in ${formatWait(cooldown)}`
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
        Only approve this device if you are the one signing in. School staff will
        never ask you to share this code.
      </p>
    </div>
  );
}
