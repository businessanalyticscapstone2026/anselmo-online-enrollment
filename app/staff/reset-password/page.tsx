"use client";

import { FormEvent, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabaseClient";
import { needsMfaStepUp } from "@/lib/auth/aal";
import { TotpVerification } from "@/app/login/_components/TotpVerification";
import {
    LockKeyhole,
    Eye,
    EyeOff,
    AlertCircle,
    CheckCircle2,
} from "lucide-react";

export default function StaffResetPasswordPage() {
    const router = useRouter();

    const [password, setPassword] = useState("");
    const [confirmPassword, setConfirmPassword] = useState("");
    const [showPassword, setShowPassword] = useState(false);
    const [ready, setReady] = useState(false);
    const [needsTotp, setNeedsTotp] = useState(false);
    const [totpVerified, setTotpVerified] = useState(false);
    const [loading, setLoading] = useState(false);
    const [message, setMessage] = useState("");
    const [error, setError] = useState("");
    // Share one recovery attempt across React Strict Mode effect re-runs.
    const recoveryAttemptRef = useRef<Promise<void> | null>(null);

    useEffect(() => {
        let active = true;

        async function verifyRecoveryLink(): Promise<void> {
            try {
                const url = new URL(window.location.href);
                const code = url.searchParams.get("code");
                const tokenHash = url.searchParams.get("token_hash");
                const type = url.searchParams.get("type");
                const hashParams = new URLSearchParams(
                    url.hash.startsWith("#") ? url.hash.slice(1) : url.hash
                );

                // PKCE flow: exchange the one-time authorization code.
                if (code) {
                    const { error: exchangeError } =
                        await supabase.auth.exchangeCodeForSession(code);

                    if (exchangeError) throw exchangeError;
                } else if (tokenHash && type === "recovery") {
                    // Token-hash flow, if the email template uses it.
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
                        const { error: sessionError } =
                            await supabase.auth.setSession({
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
                        "The reset link is invalid, expired, or already used. Request a new reset email and open the newest link in this same browser."
                    );
                }

            } catch (err: unknown) {
                throw err;
            }
        }

        // In development, React Strict Mode runs effects twice. Exchanging the
        // same one-time PKCE code twice consumes the verifier on the first run
        // and causes "PKCE code verifier not found" on the second. Reuse the
        // same promise so the code is exchanged exactly once.
        if (!recoveryAttemptRef.current) {
            recoveryAttemptRef.current = verifyRecoveryLink();
        }

        recoveryAttemptRef.current
            .then(async () => {
                if (!active) return;

                const {
                    data: { session },
                } = await supabase.auth.getSession();

                const requiresSecondFactor = session
                    ? await needsMfaStepUp(session.access_token)
                    : false;

                if (!active) return;

                setNeedsTotp(requiresSecondFactor);
                setTotpVerified(!requiresSecondFactor);
                setReady(true);

                // Remove sensitive tokens/codes from the visible address bar.
                window.history.replaceState(
                    {},
                    document.title,
                    window.location.pathname
                );
            })
            .catch((err: unknown) => {
                if (!active) return;

                setError(
                    err instanceof Error
                        ? err.message
                        : "Could not verify the reset link. Please request a new one."
                );
            });

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
            console.error("Staff reset sign-out failed:", signOutError);
        }

        router.replace("/staff/forgot-password");
    }

    async function handleSubmit(e: FormEvent<HTMLFormElement>) {
        e.preventDefault();
        setError("");
        setMessage("");

        if (password.length < 8) {
            setError("Your password must be at least 8 characters long.");
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

            if (!session) {
                setError(
                    "Your reset session has expired. Request a new reset email and try again."
                );
                return;
            }

            if (await needsMfaStepUp(session.access_token)) {
                setNeedsTotp(true);
                setTotpVerified(false);
                setError(
                    "Verify your authenticator code before changing your password."
                );
                return;
            }

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

            setMessage("Password updated successfully. Redirecting to staff login...");

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

            await supabase.auth.signOut();

            window.setTimeout(() => {
                router.replace("/login?area=staff");
            }, 1500);
        } catch (err: unknown) {
            setError(
                err instanceof Error
                    ? err.message
                    : "Could not update your password. Request a new reset link."
            );
        } finally {
            setLoading(false);
        }
    }

    return (
        <main className="relative flex min-h-screen items-center justify-center overflow-hidden bg-[#0b3d2e] px-4 py-10 text-emerald-50">
            <div
                className="fixed inset-0 bg-cover bg-center opacity-40 brightness-75"
                style={{ backgroundImage: "url('/school-background.png')" }}
            />
            <div className="fixed inset-0 bg-linear-to-b from-[#0b3d2e]/75 via-[#0b3d2e]/60 to-[#052e1c]/85" />

            <section className="relative z-10 w-full max-w-md rounded-2xl border border-emerald-200 bg-white/95 p-7 shadow-2xl backdrop-blur-md sm:p-8">
                <div className="mb-6 text-center">
                    <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-xl border border-emerald-200 bg-amber-50">
                        <LockKeyhole size={27} className="text-emerald-700" />
                    </div>

                    <h1 className="text-2xl font-extrabold">Reset Your Password</h1>
                    <p className="mt-2 text-sm text-emerald-900">
                        Create a new password for your staff account.
                    </p>
                </div>

                {error && (
                    <div
                        role="alert"
                        className="mb-4 flex gap-2 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700"
                    >
                        <AlertCircle size={18} className="shrink-0" />
                        <span>{error}</span>
                    </div>
                )}

                {message && (
                    <div
                        role="status"
                        className="mb-4 flex gap-2 rounded-lg border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-700"
                    >
                        <CheckCircle2 size={18} className="shrink-0" />
                        <span>{message}</span>
                    </div>
                )}

                {!ready && !error && (
                    <p className="text-center text-sm text-emerald-900">
                        Verifying your reset link. Please wait...
                    </p>
                )}

                {ready && needsTotp && !totpVerified && (
                    <TotpVerification
                        onVerified={handleTotpVerified}
                        onBack={handleCancelTotp}
                        title="Verify Your Authenticator"
                        description="Enter the 6-digit code from your authenticator app before setting a new password."
                        submitLabel="Verify and Continue"
                        backLabel="Cancel password reset"
                    />
                )}

                {ready && (!needsTotp || totpVerified) && (
                    <form onSubmit={handleSubmit} className="space-y-4">
                        <label className="block">
                            <span className="mb-2 block text-xs font-bold uppercase tracking-wider">
                                New Password
                            </span>

                            <span className="relative block">
                                <input
                                    type={showPassword ? "text" : "password"}
                                    autoComplete="new-password"
                                    minLength={8}
                                    required
                                    value={password}
                                    onChange={(e) => setPassword(e.target.value)}
                                    placeholder="Enter new password"
                                    className="w-full rounded-lg border border-emerald-200 bg-white px-4 py-3 pr-12 text-sm text-emerald-950 outline-none focus:border-emerald-200"
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
                            <span className="mb-2 block text-xs font-bold uppercase tracking-wider">
                                Confirm New Password
                            </span>

                            <input
                                type="password"
                                autoComplete="new-password"
                                minLength={8}
                                required
                                value={confirmPassword}
                                onChange={(e) => setConfirmPassword(e.target.value)}
                                placeholder="Re-enter new password"
                                className="w-full rounded-lg border border-emerald-200 bg-white px-4 py-3 text-sm text-emerald-950 outline-none focus:border-emerald-200"
                            />
                        </label>

                        <button
                            type="submit"
                            disabled={loading}
                            className="w-full rounded-lg bg-yellow-300 py-3.5 text-sm font-extrabold text-emerald-950 transition hover:bg-yellow-300 disabled:opacity-60"
                        >
                            {loading ? "Updating Password..." : "Save New Password"}
                        </button>
                    </form>
                )}

                <button
                    type="button"
                    onClick={() => router.replace("/login?area=staff")}
                    className="mt-5 w-full text-center text-sm text-emerald-700 hover:underline"
                >
                    Back to Staff Login
                </button>
            </section>
        </main>
    );
}