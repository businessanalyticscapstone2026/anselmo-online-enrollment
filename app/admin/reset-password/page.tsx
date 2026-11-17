"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { FormEvent, useEffect, useState } from "react";
import { supabase } from "@/lib/supabaseClient";
import { needsMfaStepUp } from "@/lib/auth/aal";
import {
  AlertCircle,
  CheckCircle2,
  Eye,
  EyeOff,
  LockKeyhole,
} from "lucide-react";
import { TotpVerification } from "@/app/login/_components/TotpVerification";
import { AdminAuthShell } from "../_components/AdminAuthShell";

export default function AdminResetPasswordPage() {
  const router = useRouter();
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [ready, setReady] = useState(false);
  const [sessionValid, setSessionValid] = useState(false);
  const [needsTotp, setNeedsTotp] = useState(false);
  const [totpVerified, setTotpVerified] = useState(false);
  const [completed, setCompleted] = useState(false);
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  useEffect(() => {
    let active = true;

    async function verifyRecoveryLink() {
      try {
        const url = new URL(window.location.href);
        const errorCode =
          url.searchParams.get("error_code") || url.searchParams.get("error");

        if (errorCode) {
          throw new Error(
            "This reset link is invalid or has expired. Request a new reset email and open the newest link in this browser."
          );
        }

        const code = url.searchParams.get("code");
        const tokenHash = url.searchParams.get("token_hash");
        const type = url.searchParams.get("type");
        const hashParams = new URLSearchParams(
          url.hash.startsWith("#") ? url.hash.slice(1) : url.hash
        );

        if (!code) {
          if (tokenHash && type === "recovery") {
            const { error: verifyError } = await supabase.auth.verifyOtp({
              token_hash: tokenHash,
              type: "recovery",
            });

            if (verifyError) throw verifyError;
          } else {
            const accessToken = hashParams.get("access_token");
            const refreshToken = hashParams.get("refresh_token");
            const hashType = hashParams.get("type");

            if (
              accessToken &&
              refreshToken &&
              (!hashType || hashType === "recovery")
            ) {
              const { error: sessionError } = await supabase.auth.setSession({
                access_token: accessToken,
                refresh_token: refreshToken,
              });

              if (sessionError) throw sessionError;
            }
          }
        }

        const {
          data: { session },
          error: sessionError,
        } = await supabase.auth.getSession();

        if (sessionError) throw sessionError;

        if (!session) {
          throw new Error(
            "This reset link is invalid, has expired, or was already used. Request a new reset email and open the newest link in this browser."
          );
        }

        // `listFactors()` queries the Auth server directly. On recovery
        // sessions `getAuthenticatorAssuranceLevel()` can report `aal1`
        // because `session.user.factors` is empty, which silently skips the
        // authenticator step and triggers the AAL2 updateUser error.
        const requiresSecondFactor = await needsMfaStepUp(
          session.access_token
        );

        if (!active) return;

        setNeedsTotp(requiresSecondFactor);
        setTotpVerified(!requiresSecondFactor);
        setSessionValid(true);
        setReady(true);

        window.history.replaceState(
          {},
          document.title,
          window.location.pathname
        );
      } catch (err: unknown) {
        if (!active) return;

        setError(
          err instanceof Error
            ? err.message
            : "Could not verify the reset link. Please request a new one."
        );
        setReady(true);
      }
    }

    void verifyRecoveryLink();

    return () => {
      active = false;
    };
  }, []);

  async function handleTotpVerified() {
    setTotpVerified(true);
    setError("");
  }

  async function handleCancelTotp() {
    try {
      await supabase.auth.signOut();
    } catch (signOutError) {
      console.error("Admin reset sign-out failed:", signOutError);
    }

    router.replace("/admin/forgot-password");
  }

  async function handleSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError("");
    setMessage("");

    if (password.length < 8) {
      setError("Your password must be at least 8 characters long.");
      return;
    }

    if (password.length > 72) {
      setError("Your password must be 72 characters or fewer.");
      return;
    }

    if (password !== confirmPassword) {
      setError("The passwords do not match.");
      return;
    }

    const {
      data: { session },
    } = await supabase.auth.getSession();

    if (!session) {
      setError(
        "Your reset session has expired. Request a new reset email and try again."
      );
      return;
    }

    const requiresSecondFactor = await needsMfaStepUp(session.access_token);

    if (requiresSecondFactor) {
      setNeedsTotp(true);
      setTotpVerified(false);
      setError(
        "Verify your authenticator code before changing your password."
      );
      return;
    }

    setLoading(true);

    try {
      const { error: updateError } = await supabase.auth.updateUser({
        password,
      });

      if (updateError) {
        const code = (updateError as { code?: string }).code || "";
        const message = updateError.message || "";

        // Safety net: if MFA detection was bypassed, fall back to the
        // authenticator step instead of showing a raw AAL2 error.
        if (
          code === "insufficient_aal" ||
          /aal2/i.test(message) ||
          /assurance level/i.test(message)
        ) {
          setNeedsTotp(true);
          setTotpVerified(false);
          setError(
            "Verify your authenticator code before changing your password."
          );
          return;
        }

        throw updateError;
      }

      setPassword("");
      setConfirmPassword("");
      setMessage(
        "Your password has been updated successfully. You can now sign in with your new password."
      );
      setCompleted(true);

      try {
        const { data: sessionData } = await supabase.auth.getSession();
        const token = sessionData.session?.access_token;
        await fetch("/api/auth/activity", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            ...(token ? { Authorization: `Bearer ${token}` } : {}),
          },
          credentials: "include",
          body: JSON.stringify({ event: "password-reset" }),
        });
      } catch {
        // Ignore background log error.
      }

      const { error: signOutError } = await supabase.auth.signOut();

      if (signOutError) {
        console.error("Admin recovery sign-out failed:", signOutError);
      }
    } catch (err: unknown) {
      setError(
        err instanceof Error
          ? err.message
          : "Could not update your password. Request a new reset link and try again."
      );
    } finally {
      setLoading(false);
    }
  }

  return (
    <AdminAuthShell>
      <section className="rounded-2xl border border-emerald-200 bg-white/95 p-7 shadow-2xl backdrop-blur-md sm:p-8">
        <div className="mb-6 text-center">
          <div className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-xl border border-emerald-200 bg-amber-50">
            <LockKeyhole className="text-emerald-700" />
          </div>

          <h1 className="text-2xl font-extrabold">Reset Your Password</h1>

          <p className="mt-2 text-sm text-emerald-900">
            Create a new password for your admin account.
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

        {message && (
          <div
            role="status"
            className="mb-4 flex gap-2 rounded-lg border border-emerald-200 bg-emerald-50 p-3 text-xs text-emerald-700"
          >
            <CheckCircle2 size={16} className="shrink-0" />
            <span>{message}</span>
          </div>
        )}

        {!ready && (
          <p className="text-center text-sm text-emerald-900">
            Verifying your reset link. Please wait...
          </p>
        )}

        {ready && sessionValid && needsTotp && !totpVerified && !completed && (
          <TotpVerification
            onVerified={handleTotpVerified}
            onBack={handleCancelTotp}
            title="Verify Your Authenticator"
            description="Enter the 6-digit code from your authenticator app before setting a new admin password."
            submitLabel="Verify and Continue"
            backLabel="Cancel password reset"
          />
        )}

        {ready && sessionValid && (!needsTotp || totpVerified) && !completed && (
          <form onSubmit={handleSubmit} className="space-y-4">
            <label className="block">
              <span className="mb-2 block text-xs font-bold uppercase tracking-wider text-emerald-600">
                New Password
              </span>

              <span className="relative block">
                <input
                  type={showPassword ? "text" : "password"}
                  autoComplete="new-password"
                  minLength={8}
                  maxLength={72}
                  required
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="Enter new password"
                  className="w-full rounded-lg border border-emerald-200 bg-white px-4 py-3 pr-12 text-sm text-emerald-950 outline-none placeholder:text-emerald-800 focus:border-emerald-200"
                />

                <button
                  type="button"
                  aria-label={showPassword ? "Hide password" : "Show password"}
                  onClick={() => setShowPassword(!showPassword)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-emerald-700"
                >
                  {showPassword ? <EyeOff size={18} /> : <Eye size={18} />}
                </button>
              </span>
            </label>

            <label className="block">
              <span className="mb-2 block text-xs font-bold uppercase tracking-wider text-emerald-600">
                Confirm New Password
              </span>

              <input
                type="password"
                autoComplete="new-password"
                minLength={8}
                maxLength={72}
                required
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                placeholder="Re-enter new password"
                className="w-full rounded-lg border border-emerald-200 bg-white px-4 py-3 text-sm text-emerald-950 outline-none placeholder:text-emerald-800 focus:border-emerald-200"
              />
            </label>

            <button
              type="submit"
              disabled={loading}
              className="w-full rounded-lg bg-yellow-300 py-3.5 text-sm font-extrabold text-emerald-950 transition hover:bg-yellow-300 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {loading ? "Updating Password..." : "Save New Password"}
            </button>
          </form>
        )}

        {ready && !sessionValid && !completed && (
          <div className="space-y-3">
            <Link
              href="/admin/forgot-password"
              className="block w-full rounded-lg bg-yellow-300 py-3.5 text-center text-sm font-extrabold text-emerald-950 transition hover:bg-yellow-300"
            >
              Request a New Reset Link
            </Link>

            <Link
              href="/login?area=admin"
              className="block w-full text-center text-sm font-semibold text-emerald-700 underline-offset-4 hover:underline"
            >
              Back to Admin Login
            </Link>
          </div>
        )}

        {completed && (
          <Link
            href="/login?area=admin"
            className="block w-full rounded-lg bg-yellow-300 py-3.5 text-center text-sm font-extrabold text-emerald-950 transition hover:bg-yellow-300"
          >
            Back to Admin Login
          </Link>
        )}

        {ready && sessionValid && (!needsTotp || totpVerified) && !completed && (
          <div className="mt-5 border-t border-emerald-200 pt-5 text-center">
            <Link
              href="/login?area=admin"
              className="text-sm font-semibold text-emerald-700 underline-offset-4 hover:underline"
            >
              Back to Admin Login
            </Link>
          </div>
        )}
      </section>
    </AdminAuthShell>
  );
}
