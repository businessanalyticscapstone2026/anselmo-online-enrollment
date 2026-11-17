
"use client";

import Link from "next/link";
import { useState } from "react";

export default function ForgotPasswordPage() {
    const [email, setEmail] = useState("");
    const [loading, setLoading] = useState(false);
    const [message, setMessage] = useState("");
    const [error, setError] = useState("");

    async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
        e.preventDefault();
        setLoading(true);
        setMessage("");
        setError("");

        try {
            const response = await fetch("/api/request-password-reset", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ email: email.trim().toLowerCase() }),
            });

            const data = await response.json().catch(() => null);

            if (!response.ok || !data?.success) {
                setError(
                    data?.error ||
                    "Unable to send a reset email right now. Please try again later."
                );
                return;
            }

            setMessage(
                data.message ||
                "If an account exists for this email, a reset link will be sent. Please check your inbox and spam folder."
            );
        } catch (err) {
            console.error("Password reset request failed:", err);
            setError(
                "Unable to process your request right now. Please try again later."
            );
        } finally {
            setLoading(false);
        }
    }

    return (
        <main className="relative flex min-h-screen items-center justify-center overflow-hidden bg-[#0b3d2e] px-6 py-12 text-emerald-50">
            <div
                className="fixed inset-0 bg-cover bg-center opacity-40 brightness-75"
                style={{ backgroundImage: "url('/school-background.png')" }}
            />
            <div className="fixed inset-0 bg-linear-to-b from-[#0b3d2e]/75 via-[#0b3d2e]/60 to-[#052e1c]/85" />

            <div className="relative z-10 w-full max-w-md rounded-2xl border border-gray-200 bg-white p-8 text-gray-900 shadow-2xl">
                <div className="mb-6 text-center">
                    <div className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-full bg-emerald-50 text-2xl">
                        🔐
                    </div>

                    <h1 className="text-2xl font-bold text-emerald-900">
                        Forgot Password?
                    </h1>

                    <p className="mt-2 text-sm text-gray-500">
                        Enter your registered email address to request a reset link.
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

                <form onSubmit={handleSubmit} className="space-y-4">
                    <div>
                        <label
                            htmlFor="email"
                            className="mb-1.5 block text-xs font-bold uppercase text-gray-700"
                        >
                            Registered Email
                        </label>

                        <input
                            id="email"
                            type="email"
                            autoComplete="email"
                            required
                            maxLength={254}
                            value={email}
                            onChange={(e) => setEmail(e.target.value)}
                            placeholder="you@example.com"
                            className="w-full rounded-xl border border-gray-300 px-4 py-3 text-sm outline-none focus:border-emerald-300 focus:ring-2 focus:ring-emerald-100"
                        />
                    </div>

                    <button
                        type="submit"
                        disabled={loading}
                        className="w-full rounded-xl bg-yellow-400 py-3.5 text-sm font-bold text-emerald-950 transition hover:bg-yellow-300 disabled:cursor-not-allowed disabled:opacity-60"
                    >
                        {loading ? "Sending Request..." : "Send Reset Link"}
                    </button>
                </form>

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
