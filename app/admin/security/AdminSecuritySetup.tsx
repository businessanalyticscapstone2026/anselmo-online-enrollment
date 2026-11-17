"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { FormEvent, useCallback, useEffect, useState } from "react";
import {
  AlertCircle,
  CheckCircle2,
  LogOut,
  QrCode,
  ShieldCheck,
  Smartphone,
} from "lucide-react";
import { supabase } from "@/lib/supabaseClient";
import { AdminAuthShell } from "../_components/AdminAuthShell";
import { TotpVerification } from "@/app/login/_components/TotpVerification";

type TotpFactor = {
  id: string;
  factor_type: string;
  status: string;
  friendly_name?: string | null;
};

type Enrollment = {
  factorId: string;
  qrCode: string;
  secret: string;
};

export function AdminSecuritySetup({
  email,
  fullName,
  totpRequired,
}: {
  email: string;
  fullName: string;
  totpRequired: boolean;
}) {
  const router = useRouter();

  const [loading, setLoading] = useState(true);
  const [currentLevel, setCurrentLevel] = useState("aal1");
  const [factors, setFactors] = useState<TotpFactor[]>([]);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");

  const [enrolling, setEnrolling] = useState(false);
  const [enrollment, setEnrollment] = useState<Enrollment | null>(null);
  const [enrollCode, setEnrollCode] = useState("");
  const [verifying, setVerifying] = useState(false);

  const loadStatus = useCallback(async () => {
    try {
      const [aalResult, factorResult] = await Promise.all([
        supabase.auth.mfa.getAuthenticatorAssuranceLevel(),
        supabase.auth.mfa.listFactors(),
      ]);

      if (aalResult.error) throw aalResult.error;
      if (factorResult.error) throw factorResult.error;

      setCurrentLevel(aalResult.data?.currentLevel || "aal1");
      setFactors((factorResult.data?.all || []) as TotpFactor[]);
      setError("");
    } catch (loadError) {
      console.error("Admin security status error:", loadError);
      setError(
        "Unable to load your authenticator status. Refresh the page or sign in again."
      );
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    const timer = setTimeout(() => {
      void loadStatus();
    }, 0);

    return () => clearTimeout(timer);
  }, [loadStatus]);

  const verifiedFactor = factors.find(
    (factor) => factor.factor_type === "totp" && factor.status === "verified"
  );

  const unverifiedFactors = factors.filter(
    (factor) => factor.factor_type === "totp" && factor.status !== "verified"
  );

  async function handleSignOut() {
    await fetch("/api/auth/mfa/logout", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ area: "admin" }),
    }).catch(() => null);
    await supabase.auth.signOut().catch(() => null);

    router.replace("/login?area=admin");
    router.refresh();
  }

  const markDailyPass = useCallback(async () => {
    try {
      const { data: sessionData } = await supabase.auth.getSession();
      const token = sessionData.session?.access_token;
      if (!token) return;

      await fetch("/api/auth/mfa/complete", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        credentials: "include",
        body: JSON.stringify({ area: "admin" }),
      });
    } catch {
      // The daily pass is best-effort; AAL2 still protects the session.
    }
  }, []);

  async function startEnrollment() {
    setEnrolling(true);
    setError("");
    setMessage("");
    setEnrollment(null);
    setEnrollCode("");

    try {
      for (const factor of unverifiedFactors) {
        await supabase.auth.mfa.unenroll({ factorId: factor.id });
      }

      const { data, error: enrollError } = await supabase.auth.mfa.enroll({
        factorType: "totp",
        friendlyName: "AASMNHS ICT Admin",
      });

      if (enrollError || !data) {
        setError(
          enrollError?.message ||
          "Unable to start authenticator setup. Please try again."
        );
        return;
      }

      setEnrollment({
        factorId: data.id,
        qrCode: data.totp.qr_code,
        secret: data.totp.secret,
      });
    } catch (enrollError) {
      console.error("Authenticator enroll error:", enrollError);
      setError("Unable to start authenticator setup. Please try again.");
    } finally {
      setEnrolling(false);
    }
  }

  async function completeEnrollment(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");

    if (!enrollment) return;

    if (!/^\d{6}$/.test(enrollCode)) {
      setError("Enter the 6-digit code shown in your authenticator app.");
      return;
    }

    setVerifying(true);

    try {
      const { data: challenge, error: challengeError } =
        await supabase.auth.mfa.challenge({
          factorId: enrollment.factorId,
        });

      if (challengeError || !challenge) {
        setError(
          challengeError?.message ||
          "Unable to verify the authenticator code. Please try again."
        );
        return;
      }

      const { data, error: verifyError } = await supabase.auth.mfa.verify({
        factorId: enrollment.factorId,
        challengeId: challenge.id,
        code: enrollCode,
      });

      if (verifyError || !data) {
        setError(
          verifyError?.message ||
          "That code was not accepted. Check your phone's clock and try again."
        );
        return;
      }

      await markDailyPass();

      setMessage(
        "Authenticator app enrolled successfully. Redirecting to the admin dashboard..."
      );
      setEnrollment(null);
      router.replace("/admin");
      router.refresh();
    } catch (verifyError) {
      console.error("Authenticator verification error:", verifyError);
      setError("Unable to verify the authenticator code. Please try again.");
    } finally {
      setVerifying(false);
    }
  }

  return (
    <AdminAuthShell>
      <section className="rounded-2xl border border-emerald-200 bg-white/95 p-7 shadow-2xl backdrop-blur-md sm:p-8">
        <div className="mb-6 text-center">
          <div className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-xl border border-emerald-200 bg-amber-50">
            <ShieldCheck className="text-emerald-700" />
          </div>

          <h1 className="text-2xl font-extrabold">Account Security</h1>

          <p className="mt-2 text-sm text-emerald-900">
            {fullName ? `${fullName} • ` : ""}
            {email || "ICT Administrator"}
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

        {loading ? (
          <div className="flex animate-fade-in items-center justify-center gap-2 py-8 text-sm text-emerald-900">
            <span className="h-4 w-4 animate-spin rounded-full border-2 border-emerald-200 border-t-transparent" />
            Checking your security settings...
          </div>
        ) : currentLevel === "aal2" && verifiedFactor ? (
          <div className="space-y-4 text-center">
            <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-full border border-emerald-200 bg-emerald-50 text-emerald-700">
              <CheckCircle2 size={30} />
            </div>

            <div>
              <h2 className="text-lg font-bold text-emerald-950">
                Your account is fully secured
              </h2>
              <p className="mt-1 text-sm text-emerald-900">
                Email verification and authenticator sign-in are both active.
              </p>
            </div>

            <Link
              href="/admin"
              className="block w-full rounded-lg bg-yellow-300 py-3.5 text-sm font-extrabold text-emerald-950 transition hover:bg-yellow-300"
            >
              Go to Admin Dashboard
            </Link>
          </div>
        ) : verifiedFactor ? (
          <div>
            <p className="mb-4 rounded-lg border border-amber-200 bg-amber-50 p-3 text-xs text-amber-700">
              An authenticator app is already enrolled. Verify it now to finish
              signing in.
            </p>

            <TotpVerification
              onVerified={async () => {
                await markDailyPass();
                router.replace("/admin");
                router.refresh();
              }}
              onBack={handleSignOut}
            />

            {!totpRequired && (
              <Link
                href="/admin"
                className="mt-4 block w-full rounded-lg border border-emerald-200 py-3 text-center text-sm font-semibold text-emerald-700 transition hover:bg-amber-50"
              >
                Continue without verifying
              </Link>
            )}
          </div>
        ) : enrollment ? (
          <div>
            <div className="mb-4 text-center">
              <div className="mx-auto mb-2 flex h-12 w-12 items-center justify-center rounded-xl border border-emerald-200 bg-amber-50">
                <QrCode className="text-emerald-700" />
              </div>

              <h2 className="text-lg font-bold text-emerald-950">
                Scan the QR code
              </h2>

              <p className="mt-1 text-xs text-emerald-900">
                Use Google Authenticator, Microsoft Authenticator, or Authy.
              </p>
            </div>

            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={enrollment.qrCode}
              alt="Authenticator app QR code"
              className="mx-auto mb-4 h-44 w-44 rounded-lg border border-emerald-200 bg-white p-2"
            />

            <div className="mb-4 rounded-lg border border-emerald-200 bg-white/70 p-3">
              <p className="text-[11px] font-bold uppercase tracking-wider text-emerald-800">
                Manual setup key
              </p>
              <p className="mt-1 break-all font-mono text-xs text-emerald-700">
                {enrollment.secret}
              </p>
            </div>

            <form onSubmit={completeEnrollment} className="space-y-4">
              <label className="block">
                <span className="mb-2 block text-xs font-bold uppercase tracking-wider text-emerald-600">
                  Code from the app
                </span>

                <input
                  type="text"
                  inputMode="numeric"
                  autoComplete="one-time-code"
                  autoFocus
                  maxLength={6}
                  value={enrollCode}
                  onChange={(event) =>
                    setEnrollCode(
                      event.target.value.replace(/\D+/g, "").slice(0, 6)
                    )
                  }
                  placeholder="000000"
                  className="w-full rounded-lg border border-emerald-200 bg-white py-3.5 text-center text-2xl font-bold tracking-[0.5em] text-emerald-950 outline-none placeholder:text-emerald-700 focus:border-emerald-200"
                />
              </label>

              <button
                type="submit"
                disabled={verifying}
                className="w-full rounded-lg bg-yellow-300 py-3.5 text-sm font-extrabold text-emerald-950 transition hover:bg-yellow-300 disabled:cursor-not-allowed disabled:opacity-60"
              >
                {verifying ? "Verifying..." : "Finish Setup"}
              </button>
            </form>

            <button
              type="button"
              onClick={() => {
                setEnrollment(null);
                setEnrollCode("");
                setError("");
                setLoading(true);
                void loadStatus();
              }}
              disabled={verifying}
              className="mt-3 w-full text-center text-xs font-semibold text-emerald-800 hover:text-emerald-950 hover:underline disabled:opacity-60"
            >
              Cancel setup
            </button>
          </div>
        ) : (
          <div className="space-y-4">
            <div className="rounded-xl border border-emerald-200 bg-white/70 p-4">
              <div className="flex gap-3">
                <Smartphone
                  size={20}
                  className="mt-0.5 shrink-0 text-emerald-700"
                />
                <div className="text-xs leading-5 text-emerald-600">
                  <p className="font-bold text-emerald-950">
                    Add an authenticator app
                  </p>
                  <p className="mt-1">
                    Each admin sign-in will require a 6-digit code from your
                    phone in addition to your password and email code. This
                    protects the portal even if your password is compromised.
                  </p>
                </div>
              </div>
            </div>

            <button
              type="button"
              onClick={startEnrollment}
              disabled={enrolling}
              className="w-full rounded-lg bg-yellow-300 py-3.5 text-sm font-extrabold text-emerald-950 transition hover:bg-yellow-300 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {enrolling ? "Preparing setup..." : "Set Up Authenticator App"}
            </button>

            {!totpRequired && (
              <Link
                href="/admin"
                className="block w-full rounded-lg border border-emerald-200 py-3 text-center text-sm font-semibold text-emerald-700 transition hover:bg-amber-50"
              >
                Skip for now
              </Link>
            )}

            {totpRequired && (
              <p className="text-center text-[11px] leading-5 text-emerald-800">
                Authenticator setup is required for all ICT Administrators. You
                cannot reach the admin dashboard until it is complete.
              </p>
            )}
          </div>
        )}

        <div className="mt-6 border-t border-emerald-200 pt-5 text-center">
          <button
            type="button"
            onClick={handleSignOut}
            className="inline-flex items-center gap-1.5 text-xs font-semibold text-emerald-800 hover:text-emerald-950 hover:underline"
          >
            <LogOut size={13} />
            Sign out
          </button>
        </div>
      </section>
    </AdminAuthShell>
  );
}
