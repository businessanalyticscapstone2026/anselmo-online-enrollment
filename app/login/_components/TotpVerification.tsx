"use client";

import {
  FormEvent,
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";
import { AlertCircle, Smartphone } from "lucide-react";
import { supabase } from "@/lib/supabaseClient";

export function TotpVerification({
  onVerified,
  onBack,
  title = "Authenticator Check",
  description = "Enter the 6-digit code from your authenticator app to finish signing in.",
  submitLabel = "Verify and Enter Admin Portal",
  backLabel = "Use a different account",
}: {
  onVerified: () => void;
  onBack: () => void;
  title?: string;
  description?: string;
  submitLabel?: string;
  backLabel?: string;
}) {
  const [factorId, setFactorId] = useState("");
  const [challengeId, setChallengeId] = useState("");
  const [code, setCode] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [verifying, setVerifying] = useState(false);
  const startedRef = useRef(false);

  const startChallenge = useCallback(async (id: string) => {
    setError("");

    const { data, error: challengeError } = await supabase.auth.mfa.challenge({
      factorId: id,
    });

    if (challengeError || !data) {
      setError(
        challengeError?.message ||
        "Unable to start the authenticator challenge. Please try again."
      );
      setChallengeId("");
      return false;
    }

    setChallengeId(data.id);
    return true;
  }, []);

  useEffect(() => {
    if (startedRef.current) return;
    startedRef.current = true;

    (async () => {
      const { data, error: listError } = await supabase.auth.mfa.listFactors();

      if (listError) {
        setError(
          "Unable to load your authenticator settings. Please try again."
        );
        setLoading(false);
        return;
      }

      const factors = data?.all ?? [];
      const factor = factors.find(
        (item) => item.factor_type === "totp" && item.status === "verified"
      );

      if (!factor) {
        setError(
          "No authenticator app is enrolled for this account yet. Open the security setup page to add one."
        );
        setLoading(false);
        return;
      }

      setFactorId(factor.id);
      await startChallenge(factor.id);
      setLoading(false);
    })();
  }, [startChallenge]);

  async function verify(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");

    if (!/^\d{6}$/.test(code)) {
      setError("Enter the 6-digit code from your authenticator app.");
      return;
    }

    if (!factorId || !challengeId) {
      setError("The authenticator challenge is not ready yet. Please try again.");
      return;
    }

    setVerifying(true);

    const { data, error: verifyError } = await supabase.auth.mfa.verify({
      factorId,
      challengeId,
      code,
    });

    setVerifying(false);

    if (verifyError || !data) {
      const message =
        verifyError?.message ||
        "Incorrect or expired authenticator code. Please try again.";
      await startChallenge(factorId);
      setCode("");
      setError(message);
      return;
    }

    onVerified();
  }

  return (
    <div>
      <div className="mb-6 text-center">
        <div className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-xl border border-emerald-200 bg-amber-50">
          <Smartphone className="text-emerald-700" />
        </div>

        <h1 className="text-2xl font-extrabold">{title}</h1>

        <p className="mt-2 text-sm text-emerald-900">{description}</p>
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

      {loading ? (
        <div className="flex items-center justify-center gap-2 py-8 text-sm text-emerald-900">
          <span className="h-4 w-4 animate-spin rounded-full border-2 border-emerald-200 border-t-transparent" />
          Preparing authenticator challenge...
        </div>
      ) : (
        <form onSubmit={verify} className="space-y-4">
          <label className="block">
            <span className="mb-2 block text-xs font-bold uppercase tracking-wider text-emerald-600">
              Authenticator Code
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
            disabled={verifying || loading || !challengeId}
            className="w-full rounded-lg bg-yellow-300 py-3.5 text-sm font-extrabold text-emerald-950 transition hover:bg-yellow-300 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {verifying ? "Verifying..." : submitLabel}
          </button>
        </form>
      )}

      <div className="mt-4 flex flex-col items-center gap-2 text-center">
        <button
          type="button"
          onClick={onBack}
          disabled={verifying}
          className="text-xs font-semibold text-emerald-800 underline-offset-4 hover:text-emerald-950 hover:underline disabled:opacity-60"
        >
          {backLabel}
        </button>
      </div>
    </div>
  );
}
