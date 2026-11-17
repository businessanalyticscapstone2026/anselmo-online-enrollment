"use client";

import Link from "next/link";
import { FormEvent, useState } from "react";
import { supabase } from "@/lib/supabaseClient";
import { AlertCircle, CheckCircle2, KeyRound, Mail } from "lucide-react";
import { AdminAuthShell } from "../_components/AdminAuthShell";

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export default function AdminForgotPasswordPage() {
  const [email, setEmail] = useState("");
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  async function handleSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError("");
    setMessage("");

    const cleanEmail = email.trim().toLowerCase();

    if (!cleanEmail) {
      setError("Enter your registered admin email address.");
      return;
    }

    if (cleanEmail.length > 254 || !EMAIL_PATTERN.test(cleanEmail)) {
      setError("Enter a valid email address.");
      return;
    }

    setLoading(true);

    try {
      const { error: resetError } =
        await supabase.auth.resetPasswordForEmail(cleanEmail, {
          redirectTo: `${window.location.origin}/admin/reset-password`,
        });

      if (resetError) {
        console.error("Admin password reset request failed:", resetError);

        setError(
          resetError.status === 429
            ? "Too many reset requests. Please wait a few minutes and try again."
            : "Unable to send a reset email right now. Please try again later."
        );
        return;
      }

      setMessage(
        "If an admin account exists for that email, a password reset link has been sent. Check your inbox and spam folder, and open the link in this browser."
      );
    } catch (err: unknown) {
      console.error("Admin password reset request failed:", err);
      setError(
        "Unable to send a reset email right now. Please try again later."
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
            <KeyRound className="text-emerald-700" />
          </div>

          <h1 className="text-2xl font-extrabold">Forgot Password?</h1>

          <p className="mt-2 text-sm text-emerald-900">
            Enter your registered admin email to request a reset link.
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

        <form onSubmit={handleSubmit} className="space-y-4">
          <label className="block">
            <span className="mb-2 block text-xs font-bold uppercase tracking-wider text-emerald-600">
              Admin Email
            </span>

            <span className="relative block">
              <Mail
                size={16}
                className="absolute left-3 top-1/2 -translate-y-1/2 text-emerald-800"
              />

              <input
                type="email"
                autoComplete="email"
                required
                maxLength={254}
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="admin@aasmnhs.edu.ph"
                className="w-full rounded-lg border border-emerald-200 bg-white py-3 pl-10 pr-3 text-sm text-emerald-950 outline-none placeholder:text-emerald-800 focus:border-emerald-200"
              />
            </span>
          </label>

          <button
            type="submit"
            disabled={loading}
            className="w-full rounded-lg bg-yellow-300 py-3.5 text-sm font-extrabold text-emerald-950 transition hover:bg-yellow-300 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {loading ? "Sending Reset Link..." : "Send Reset Link"}
          </button>
        </form>

        <div className="mt-5 border-t border-emerald-200 pt-5 text-center">
          <Link
            href="/login?area=admin"
            className="text-sm font-semibold text-emerald-700 underline-offset-4 hover:underline"
          >
            Back to Admin Login
          </Link>
        </div>
      </section>
    </AdminAuthShell>
  );
}
