"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabaseClient";
import { needsMfaStepUp } from "@/lib/auth/aal";

export default function ResetPasswordPage() {
  const router = useRouter();
  const [ready, setReady] = useState(false);
  const [hasSession, setHasSession] = useState(false);
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [isStaffSetup, setIsStaffSetup] = useState(false);

  useEffect(() => {
    let active = true;

    async function verifyRecoveryLink() {
      try {
        const url = new URL(window.location.href);
        const code = url.searchParams.get("code");
        const tokenHash = url.searchParams.get("token_hash");
        const type = url.searchParams.get("type");
        const setupMode = url.searchParams.get("setup") === "staff";

        if (active) {
          setIsStaffSetup(setupMode);
        }
        const hashParams = new URLSearchParams(
          url.hash.startsWith("#") ? url.hash.slice(1) : url.hash
        );

        // PKCE flow: exchange the one-time authorization code.
        if (code) {
          const { error: exchangeError } =
            await supabase.auth.exchangeCodeForSession(code);

          if (exchangeError) throw exchangeError;
        } else if (tokenHash && type === "recovery") {
          // Token-hash flow used by the reset email link.
          const { error: verifyError } = await supabase.auth.verifyOtp({
            token_hash: tokenHash,
            type: "recovery",
          });

          if (verifyError) throw verifyError;
        } else {
          // Implicit flow: access token may be in the URL fragment.
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

        const {
          data: { session },
          error: sessionError,
        } = await supabase.auth.getSession();

        if (sessionError) throw sessionError;

        if (!session) {
          throw new Error(
            "The reset link is invalid, expired, or already used. Please request a new password reset link."
          );
        }

        // Admins have an authenticator factor. Changing the password on an
        // MFA-enabled account needs an AAL2 session, so hand them to the
        // admin reset flow which verifies the TOTP code first.
        const requiresSecondFactor = await needsMfaStepUp(
          session.access_token
        );

        if (requiresSecondFactor) {
          if (active) {
            router.replace("/admin/reset-password");
          }
          return;
        }

        if (active) {
          setHasSession(true);

          // Remove sensitive tokens/codes from the visible address bar.
          window.history.replaceState(
            {},
            document.title,
            window.location.pathname
          );
        }
      } catch (err: unknown) {
        if (active) {
          setError(
            err instanceof Error
              ? err.message
              : "Could not verify the reset link. Please request a new one."
          );
        }
      } finally {
        if (active) {
          setReady(true);
        }
      }
    }

    void verifyRecoveryLink();

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((event, session) => {
      if (event === "PASSWORD_RECOVERY" || session) {
        setHasSession(Boolean(session));
        setReady(true);
      }
    });
    return () => {
      active = false;
      subscription.unsubscribe();
    };
  }, [router]);

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setMessage("");
    setError("");

    if (password.length < 8) {
      setError("Your new password must be at least 8 characters long.");
      return;
    }

    if (password !== confirmPassword) {
      setError("The passwords do not match.");
      return;
    }

    setLoading(true);

    try {
      const {
        data: { session },
      } = await supabase.auth.getSession();

      if (session && (await needsMfaStepUp(session.access_token))) {
        router.replace("/admin/reset-password");
        return;
      }

      const { error: updateError } = await supabase.auth.updateUser({ password });

      if (updateError) {
        throw updateError;
      }

      try {
        const token = session?.access_token;
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

      setMessage(
        isStaffSetup
          ? "Your staff password has been created. Redirecting to sign in..."
          : "Your password has been updated. Redirecting to sign in..."
      );
      await supabase.auth.signOut();
      setTimeout(() => {
        router.push("/login");
        router.refresh();
      }, 1200);
    } catch (err) {
      console.error("Password update failed:", err);

      const code =
        err && typeof err === "object"
          ? String((err as { code?: unknown }).code || "")
          : "";
      const message = err instanceof Error ? err.message : "";

      // Admins with an enrolled authenticator must complete TOTP before the
      // password can be changed. Send them to the admin reset flow.
      if (
        code === "insufficient_aal" ||
        /aal2/i.test(message) ||
        /assurance level/i.test(message)
      ) {
        router.replace("/admin/reset-password");
        return;
      }

      setError(
        err instanceof Error
          ? err.message
          : "Unable to update your password. Please request a new reset link."
      );
    } finally {
      setLoading(false);
    }
  }

  return (
    <main className="relative flex min-h-screen items-center justify-center overflow-hidden bg-[#0b3d2e] px-6 py-12 text-emerald-50">
      <div
        className="fixed inset-0 bg-cover bg-center opacity-40 brightness-75"
        style={{ backgroundImage: "url('/school.jpg')" }}
      />
      <div className="fixed inset-0 bg-linear-to-b from-[#0b3d2e]/75 via-[#0b3d2e]/60 to-[#052e1c]/85" />

      <div className="relative z-10 w-full max-w-md rounded-2xl border border-gray-200 bg-white p-8 text-gray-900 shadow-2xl">
        <div className="mb-6 text-center">
          <div className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-full bg-emerald-50 text-2xl">
            🔐
          </div>

          <h1 className="text-2xl font-bold text-emerald-900">
            {isStaffSetup ? "Set Up Your Staff Account" : "Set a New Password"}
          </h1>

          <p className="mt-2 text-sm text-gray-500">
            {isStaffSetup
              ? "Create a password for your new staff portal account."
              : "Enter and confirm your new password below."}
          </p>
        </div>

        {message && (
          <div
            role="status"
            className="mb-4 rounded-xl border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-800"
          >
            {message}
          </div>
        )}

        {error && (
          <div
            role="alert"
            className="mb-4 rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-700"
          >
            {error}
          </div>
        )}

        {!ready ? (
          <p className="text-center text-sm text-gray-500">
            {isStaffSetup
              ? "Verifying your staff setup link..."
              : "Verifying your reset link..."}
          </p>
        ) : !hasSession ? (
          <div className="space-y-4">
            <p className="rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800">
              {isStaffSetup
                ? "This staff setup link is invalid or has expired. Ask the ICT administrator to resend it."
                : "This reset link is invalid or has expired. Please request a new password reset link."}
            </p>
            <Link
              href={isStaffSetup ? "/login" : "/forgot-password"}
              className="block w-full rounded-xl bg-yellow-400 py-3.5 text-center text-sm font-bold text-emerald-950 transition hover:bg-yellow-300"
            >
              {isStaffSetup ? "Back to Sign In" : "Request a New Link"}
            </Link>
          </div>
        ) : (
          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label
                htmlFor="password"
                className="mb-1.5 block text-xs font-bold uppercase text-gray-700"
              >
                New Password
              </label>

              <input
                id="password"
                type="password"
                autoComplete="new-password"
                required
                minLength={8}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="w-full rounded-xl border border-gray-300 px-4 py-3 text-sm outline-none focus:border-emerald-300 focus:ring-2 focus:ring-emerald-100"
              />
            </div>

            <div>
              <label
                htmlFor="confirmPassword"
                className="mb-1.5 block text-xs font-bold uppercase text-gray-700"
              >
                Confirm New Password
              </label>

              <input
                id="confirmPassword"
                type="password"
                autoComplete="new-password"
                required
                minLength={8}
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                className="w-full rounded-xl border border-gray-300 px-4 py-3 text-sm outline-none focus:border-emerald-300 focus:ring-2 focus:ring-emerald-100"
              />
            </div>

            <button
              type="submit"
              disabled={loading}
              className="w-full rounded-xl bg-yellow-400 py-3.5 text-sm font-bold text-emerald-950 transition hover:bg-yellow-300 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {loading
                ? isStaffSetup
                  ? "Creating Password..."
                  : "Updating Password..."
                : isStaffSetup
                ? "Create Password"
                : "Update Password"}
            </button>
          </form>
        )}

        <div className="mt-6 border-t border-gray-100 pt-5 text-center">
          <Link
            href="/login"
            className="text-sm font-semibold text-emerald-700 hover:underline"
          >
            Back to Sign In
          </Link>
        </div>
      </div>
    </main>
  );
}
