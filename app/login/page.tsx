"use client";

import Image from "next/image";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, FormEvent, useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";
import ReCAPTCHA from "react-google-recaptcha";
import {
  AlertCircle,
  Eye,
  EyeOff,
  LockKeyhole,
  Mail,
  ShieldCheck,
} from "lucide-react";
import { supabase } from "@/lib/supabaseClient";
import { normalizeRole, portalAreaForRole } from "@/lib/auth/roles";
import { hasVerifiedTotpFactor, needsMfaStepUp } from "@/lib/auth/aal";
import { OtpVerification } from "./_components/OtpVerification";
import { TotpVerification } from "./_components/TotpVerification";

const ERROR_MESSAGES: Record<string, string> = {
  session: "Your session has expired. Please sign in again.",
  unauthorized: "This account is not authorized to access that portal.",
  mfa: "Please complete the verification step to continue.",
};

type Stage = "credentials" | "otp" | "totp";

function useMediaQuery(query: string): boolean | null {
  const subscribe = useCallback(
    (callback: () => void) => {
      const mediaQuery = window.matchMedia(query);
      mediaQuery.addEventListener("change", callback);
      return () => mediaQuery.removeEventListener("change", callback);
    },
    [query]
  );

  return useSyncExternalStore(
    subscribe,
    () => window.matchMedia(query).matches,
    () => null
  );
}

function LoginContent() {
  const router = useRouter();
  const searchParams = useSearchParams();

  const areaParam = searchParams.get("area");
  const forgotPasswordHref =
    areaParam === "admin"
      ? "/admin/forgot-password"
      : areaParam === "staff"
        ? "/staff/forgot-password"
        : "/forgot-password";

  const [stage, setStage] = useState<Stage>("credentials");
  const [verifiedArea, setVerifiedArea] = useState<"staff" | "admin" | null>(
    null
  );
  const [verifiedEmail, setVerifiedEmail] = useState("");

  const [email, setEmail] = useState(() =>
    typeof window !== "undefined"
      ? localStorage.getItem("studentEmail") || ""
      : ""
  );
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);

  const [error, setError] = useState<string | null>(() => {
    const code = searchParams.get("error");
    return code ? ERROR_MESSAGES[code] || null : null;
  });
  const [isAccountRemoved, setIsAccountRemoved] = useState(false);

  const [captchaToken, setCaptchaToken] = useState<string | null>(null);
  const captchaRef = useRef<ReCAPTCHA>(null);
  const recaptchaSiteKey = process.env.NEXT_PUBLIC_RECAPTCHA_SITE_KEY;
  const captchaRequired = Boolean(recaptchaSiteKey);
  const captchaMounted = useMediaQuery("(max-width: 420px)") !== null;
  const [captchaReady, setCaptchaReady] = useState(false);
  const captchaBoxRef = useRef<HTMLDivElement>(null);
  const [captchaScale, setCaptchaScale] = useState(1);

  useEffect(() => {
    const element = captchaBoxRef.current;
    if (!element) return;

    const RECAPTCHA_WIDTH = 304;

    const observer = new ResizeObserver(() => {
      const available = element.clientWidth;
      if (available > 0) {
        setCaptchaScale(Math.min(1, available / RECAPTCHA_WIDTH));
      }
    });

    observer.observe(element);
    return () => observer.disconnect();
  }, [captchaMounted, recaptchaSiteKey]);

  useEffect(() => {
    let active = true;

    const clearPreviousSession = async () => {
      await fetch("/api/auth/mfa/logout", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      }).catch(() => null);

      const { data } = await supabase.auth
        .getSession()
        .catch(() => ({ data: { session: null } }));

      if (!active || !data?.session) return;

      await supabase.auth.signOut().catch(() => null);
    };

    void clearPreviousSession();

    // The browser can restore this page from the back/forward cache without
    // re-running the mount effect. Clear any restored session in that case.
    const handlePageShow = (event: PageTransitionEvent) => {
      if (event.persisted) {
        void clearPreviousSession();
      }
    };

    window.addEventListener("pageshow", handlePageShow);

    return () => {
      active = false;
      window.removeEventListener("pageshow", handlePageShow);
    };
  }, []);

  const handleAuthFailure = async (message: string) => {
    await fetch("/api/auth/mfa/logout", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ area: verifiedArea }),
    }).catch(() => null);
    await supabase.auth.signOut().catch(() => null);

    setStage("credentials");
    setVerifiedArea(null);
    setVerifiedEmail("");
    setPassword("");
    setError(message);
  };

  const handleBackToCredentials = async () => {
    await handleAuthFailure("");
    setError(null);
  };

  const fetchDailyStatus = async (
    area: "staff" | "admin"
  ): Promise<"full" | "email" | "none" | null> => {
    try {
      const { data: sessionData } = await supabase.auth.getSession();
      const token = sessionData.session?.access_token;

      const response = await fetch("/api/auth/mfa/status", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        credentials: "include",
        body: JSON.stringify({ area }),
      });

      if (!response.ok) return null;

      const data = (await response.json()) as { status?: unknown };

      if (
        data.status === "full" ||
        data.status === "email" ||
        data.status === "none"
      ) {
        return data.status;
      }

      return null;
    } catch {
      return null;
    }
  };

  const completeAdminDailyPass = async (): Promise<boolean> => {
    try {
      const { data: sessionData } = await supabase.auth.getSession();
      const token = sessionData.session?.access_token;
      if (!token) return false;

      const response = await fetch("/api/auth/mfa/complete", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        credentials: "include",
        body: JSON.stringify({ area: "admin" }),
      });

      return response.ok;
    } catch {
      return false;
    }
  };

  const handleCredentialsSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setError(null);
    setIsAccountRemoved(false);

    const cleanEmail = email.trim().toLowerCase();

    if (!cleanEmail || !password) {
      setError("Please provide both email and password.");
      return;
    }

    if (captchaRequired && !captchaToken) {
      setError("Please complete the reCAPTCHA checkbox before signing in.");
      return;
    }

    setLoading(true);

    try {
      if (captchaRequired && captchaToken) {
        const captchaResponse = await fetch("/api/verify-recaptcha", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ token: captchaToken }),
        });

        const captchaResult = await captchaResponse.json();

        if (!captchaResponse.ok || !captchaResult.success) {
          setError(
            captchaResult.message ||
            "reCAPTCHA verification failed. Please try again."
          );
          return;
        }
      }

      const { error: authError } = await supabase.auth.signInWithPassword({
        email: cleanEmail,
        password,
      });

      if (authError) {
        const authErrorInfo = authError as {
          code?: string;
          status?: number;
          message?: string;
        };

        let isRemoved = false;

        try {
          const statusResponse = await fetch("/api/auth/check-account-status", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ email: cleanEmail }),
          });

          if (statusResponse.ok) {
            const statusData = await statusResponse.json();
            if (statusData?.isRemoved) {
              isRemoved = true;
            }
          }
        } catch {
          // Ignore status lookup errors and fall back to the auth error.
        }

        if (isRemoved) {
          setIsAccountRemoved(true);
          setError(
            "Your account has been removed by the administrator. Please contact the school registrar or ICT administrator for assistance."
          );
          return;
        }

        const isInvalidCredentials =
          authErrorInfo.code === "invalid_credentials" ||
          /invalid login credentials/i.test(authErrorInfo.message || "");

        if (
          authErrorInfo.code === "email_not_confirmed" ||
          /email not confirmed/i.test(authErrorInfo.message || "")
        ) {
          setError(
            "Your email address is not confirmed yet. Please use Forgot Password or contact the school registrar."
          );
        } else if (
          authErrorInfo.code === "over_request_rate_limit" ||
          authErrorInfo.status === 429
        ) {
          setError(
            "Too many sign-in attempts. Please wait a moment and try again."
          );
        } else if (authErrorInfo.code === "user_banned") {
          setError(
            "This account is not available. Please contact the school registrar."
          );
        } else if (isInvalidCredentials) {
          setError(
            "Invalid email or password. Please check your credentials and try again."
          );
        } else {
          console.warn(
            "Sign-in failed:",
            authErrorInfo.code,
            authErrorInfo.message
          );
          setError(
            "Unable to sign in right now. Please check your connection and try again."
          );
        }

        return;
      }

      const { data: userData, error: userLookupError } =
        await supabase.auth.getUser();

      if (userLookupError || !userData.user) {
        await supabase.auth.signOut();
        setError("Unable to load your account. Please try again.");
        return;
      }

      const user = userData.user;

      const { data: profile, error: profileError } = await supabase
        .from("profiles")
        .select("id, role, full_name")
        .eq("id", user.id)
        .maybeSingle();

      if (profileError || !profile || profile.id !== user.id) {
        await supabase.auth.signOut();
        setError(
          "Your account profile could not be verified. Please contact the ICT administrator."
        );
        return;
      }

      const role = normalizeRole(profile.role);
      const actualArea = portalAreaForRole(role);

      if (!actualArea) {
        await supabase.auth.signOut();
        setError(
          "This account does not have a valid portal role. Please contact the ICT administrator."
        );
        return;
      }

      // Record the sign-in for every role (student, staff, admin). The API
      // derives the account identity from this session, so logging must never
      // block a successful login and failures are ignored.
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
          body: JSON.stringify({ event: "signin" }),
        });
      } catch {
        // Ignore activity logging errors.
      }

      if (actualArea === "student") {
        if (typeof window !== "undefined") {
          localStorage.setItem("studentEmail", cleanEmail);

          const fullName = profile.full_name || user.user_metadata?.full_name;
          if (typeof fullName === "string" && fullName.trim()) {
            localStorage.setItem("studentName", fullName);
          }
        }

        router.replace("/student/dashboard");
        router.refresh();
        return;
      }

      setVerifiedEmail(cleanEmail);
      setVerifiedArea(actualArea);

      const dailyStatus = await fetchDailyStatus(actualArea);

      if (dailyStatus === "full") {
        router.replace(actualArea === "admin" ? "/admin" : "/staff/dashboard");
        router.refresh();
        return;
      }

      if (dailyStatus === "email" && actualArea === "admin") {
        setStage("totp");
        return;
      }

      setStage("otp");
    } catch (submitError) {
      console.error("Sign-in error:", submitError);
      setError(
        "Unable to sign in right now. Please check your connection and try again."
      );
    } finally {
      // reCAPTCHA tokens can only be verified once.
      captchaRef.current?.reset();
      setCaptchaToken(null);
      setLoading(false);
    }
  };

  const handleOtpVerified = async (result: { requiresTotp?: boolean }) => {
    if (verifiedArea === "staff") {
      router.replace("/staff/dashboard");
      router.refresh();
      return;
    }

    if (verifiedArea !== "admin") {
      return;
    }

    if (!result.requiresTotp) {
      router.replace("/admin");
      router.refresh();
      return;
    }

    const hasFactor = await hasVerifiedTotpFactor();

    if (!hasFactor) {
      router.replace("/admin/security");
      router.refresh();
      return;
    }

    const { data: sessionData } = await supabase.auth.getSession();
    const token = sessionData.session?.access_token;
    const stepUp = token ? await needsMfaStepUp(token) : true;

    if (!stepUp) {
      await completeAdminDailyPass();
      router.replace("/admin");
      router.refresh();
      return;
    }

    setStage("totp");
  };

  const handleTotpVerified = async () => {
    await completeAdminDailyPass();
    router.replace("/admin");
    router.refresh();
  };

  return (
    <main className="relative min-h-screen overflow-hidden bg-[#0b3d2e] text-emerald-50">
      <div
        className="pointer-events-none fixed inset-0 bg-cover bg-center opacity-40 brightness-75"
        style={{ backgroundImage: "url('/school-background.png')" }}
      />
      <div className="fixed inset-0 bg-linear-to-b from-[#0b3d2e]/75 via-[#0b3d2e]/60 to-[#052e1c]/85 pointer-events-none" />
      <div className="pointer-events-none fixed -top-40 left-1/2 h-96 w-180 -translate-x-1/2 rounded-full bg-yellow-400/10 blur-3xl" />
      <div className="pointer-events-none fixed top-1/3 -right-20 h-96 w-96 rounded-full bg-emerald-700/25 blur-3xl" />
      <div className="pointer-events-none fixed bottom-10 -left-20 h-96 w-96 rounded-full bg-yellow-400/10 blur-3xl" />

      <div className="relative z-10 flex min-h-screen flex-col">
        <header className="sticky top-0 z-50 w-full border-b border-emerald-800/70 bg-[#0b3d2e]/75 backdrop-blur-md">
          <div className="mx-auto flex max-w-6xl items-center justify-between gap-3 px-6 py-4">
            <Link href="/" className="group flex min-w-0 items-center gap-3.5">
              <div className="relative flex h-11 w-11 shrink-0 items-center justify-center overflow-hidden rounded-full shadow-md ring-2 ring-yellow-400/60 ring-offset-2 ring-offset-[#0b3d2e] transition-transform group-hover:scale-105">
                <Image
                  src="/school-logo-trimmed.png"
                  alt="AASMNHS School Logo"
                  width={44}
                  height={44}
                  className="h-full w-full object-cover"
                  priority
                />
              </div>

              <div className="min-w-0">
                <p className="truncate text-base font-bold tracking-wide text-white">
                  AASMNHS
                </p>
                <p className="truncate text-xs font-medium text-emerald-200">
                  Online Enrollment System
                </p>
              </div>
            </Link>

            <Link
              href="/"
              className="inline-flex shrink-0 items-center gap-2 rounded-lg border border-emerald-700 bg-emerald-900/40 px-3 py-2 text-[11px] font-semibold text-emerald-100 backdrop-blur-sm transition-all duration-200 hover:border-yellow-400/60 hover:bg-yellow-400 hover:text-[#052e1c] sm:px-4 sm:text-xs"
            >
              <span>Back to Home</span>
            </Link>
          </div>
        </header>

        <div className="mx-auto flex w-full max-w-md flex-1 flex-col justify-center px-6 py-10">
          <section
            key={stage}
            className="rounded-2xl border border-emerald-700/60 bg-white p-7 text-[#06281b] shadow-2xl animate-fade-in-up sm:p-8"
          >
            {stage === "credentials" && (
              <>
                <div className="mb-6 text-center">
                  <div className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-xl border border-emerald-200 bg-amber-50">
                    <ShieldCheck className="text-emerald-700" />
                  </div>

                  <h1 className="text-2xl font-extrabold">Welcome Back</h1>
                </div>

                {error && (
                  <div
                    role="alert"
                    className="mt-5 flex gap-2 rounded-lg border border-red-200 bg-red-50 p-3 text-xs text-red-700"
                  >
                    <AlertCircle size={16} className="shrink-0" />
                    <span>{error}</span>
                  </div>
                )}

                <form
                  onSubmit={handleCredentialsSubmit}
                  className="mt-5 space-y-4"
                >
                  <label className="block">
                    <span className="mb-2 block text-xs font-bold uppercase tracking-wider text-emerald-600">
                      Email Address
                    </span>

                    <span className="relative block">
                      <Mail
                        size={16}
                        className="absolute left-3 top-1/2 -translate-y-1/2 text-emerald-800"
                      />

                      <input
                        type="email"
                        autoComplete="username"
                        required
                        value={email}
                        onChange={(event) => {
                          setEmail(event.target.value);
                          if (isAccountRemoved) {
                            setIsAccountRemoved(false);
                            setError(null);
                          }
                        }}
                        placeholder="you@example.com"
                        className="w-full rounded-lg border border-emerald-200 bg-white py-3 pl-10 pr-3 text-sm text-emerald-950 outline-none placeholder:text-emerald-800 focus:border-emerald-200"
                      />
                    </span>
                  </label>

                  <label className="block">
                    <span className="mb-2 block text-xs font-bold uppercase tracking-wider text-emerald-600">
                      Password
                    </span>

                    <span className="relative block">
                      <LockKeyhole
                        size={16}
                        className="absolute left-3 top-1/2 -translate-y-1/2 text-emerald-800"
                      />

                      <input
                        type={showPassword ? "text" : "password"}
                        autoComplete="current-password"
                        required
                        value={password}
                        onChange={(event) => setPassword(event.target.value)}
                        placeholder="Enter your password"
                        className="w-full rounded-lg border border-emerald-200 bg-white py-3 pl-10 pr-11 text-sm text-emerald-950 outline-none placeholder:text-emerald-800 focus:border-emerald-200"
                      />

                      <button
                        type="button"
                        aria-label={
                          showPassword ? "Hide password" : "Show password"
                        }
                        onClick={() => setShowPassword(!showPassword)}
                        className="absolute right-3 top-1/2 -translate-y-1/2 text-emerald-700"
                      >
                        {showPassword ? <EyeOff size={16} /> : <Eye size={16} />}
                      </button>
                    </span>
                  </label>

                  {!isAccountRemoved && (
                    <div className="-mt-1 flex justify-end">
                      <Link
                        href={forgotPasswordHref}
                        className="text-xs font-semibold text-emerald-700 transition hover:text-emerald-700 hover:underline"
                      >
                        Forgot Password?
                      </Link>
                    </div>
                  )}

                  {recaptchaSiteKey && captchaMounted && (
                    <div
                      ref={captchaBoxRef}
                      className="relative flex min-h-[78px] w-full items-center justify-center rounded-lg"
                      aria-label="reCAPTCHA verification"
                    >
                      <div
                        className="overflow-hidden"
                        style={{
                          width: 304 * captchaScale,
                          height: 78 * captchaScale,
                        }}
                      >
                        <div
                          style={{
                            width: 304,
                            height: 78,
                            transform: `scale(${captchaScale})`,
                            transformOrigin: "top left",
                          }}
                          className={`transition-opacity duration-300 ease-out ${
                            captchaReady ? "opacity-100" : "opacity-0"
                          }`}
                        >
                          <ReCAPTCHA
                            ref={captchaRef}
                            sitekey={recaptchaSiteKey}
                            size="normal"
                            asyncScriptOnLoad={() => setCaptchaReady(true)}
                            onChange={(token) => setCaptchaToken(token)}
                            onExpired={() => setCaptchaToken(null)}
                            onErrored={() => {
                              setCaptchaReady(true);
                              setCaptchaToken(null);
                              setError(
                                "reCAPTCHA could not load. Check your internet connection and site key."
                              );
                            }}
                          />
                        </div>
                      </div>

                      {!captchaReady && (
                        <div className="pointer-events-none absolute inset-0 flex items-center justify-center gap-2 text-xs font-semibold text-emerald-700">
                          <span className="h-4 w-4 animate-spin rounded-full border-2 border-emerald-200 border-t-transparent" />
                          <span>Loading verification...</span>
                        </div>
                      )}
                    </div>
                  )}

                  <button
                    type="submit"
                    disabled={
                      loading || (captchaRequired && !captchaToken)
                    }
                    className="flex w-full items-center justify-center gap-2 rounded-lg bg-yellow-300 py-3.5 text-sm font-extrabold text-emerald-950 transition hover:bg-yellow-300 disabled:cursor-not-allowed disabled:opacity-60"
                  >
                    {loading ? (
                      <>
                        <span className="h-4 w-4 animate-spin rounded-full border-2 border-emerald-200 border-t-transparent" />
                        <span>Signing in...</span>
                      </>
                    ) : (
                      <span>Sign In</span>
                    )}
                  </button>
                </form>

                <p className="mt-5 text-center text-xs leading-5 text-emerald-800">
                  New student?{" "}
                  <Link
                    href="/enroll"
                    className="font-bold text-emerald-700 hover:underline"
                  >
                    Enroll Now
                  </Link>
                </p>
              </>
            )}

            {stage === "otp" && verifiedArea && (
              <OtpVerification
                area={verifiedArea}
                email={verifiedEmail}
                onVerified={handleOtpVerified}
                onBack={handleBackToCredentials}
                onAuthFailure={handleAuthFailure}
              />
            )}

            {stage === "totp" && (
              <TotpVerification
                onVerified={handleTotpVerified}
                onBack={handleBackToCredentials}
              />
            )}
          </section>
        </div>

        <footer className="border-t border-emerald-800 bg-[#0b3d2e]/60 px-6 py-4 text-center text-xs text-emerald-200">
          © {new Date().getFullYear()} Anselmo A. Sandoval Memorial National High
          School
        </footer>
      </div>
    </main>
  );
}

export default function LoginPage() {
  return (
    <Suspense
      fallback={
        <div className="flex min-h-screen flex-col items-center justify-center gap-3 bg-[#0b3d2e] text-emerald-50">
          <div className="h-10 w-10 animate-spin rounded-full border-4 border-emerald-800 border-t-yellow-400" />
          <p className="text-sm font-semibold text-emerald-100">Loading…</p>
        </div>
      }
    >
      <LoginContent />
    </Suspense>
  );
}
