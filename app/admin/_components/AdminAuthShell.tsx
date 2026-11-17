import Image from "next/image";
import Link from "next/link";
import type { ReactNode } from "react";

export function AdminAuthShell({ children }: { children: ReactNode }) {
  return (
    <main className="relative flex min-h-screen items-center justify-center overflow-hidden bg-[#0b3d2e] px-4 py-10 text-emerald-50">
      <div
        className="fixed inset-0 bg-cover bg-center opacity-40 brightness-75"
        style={{ backgroundImage: "url('/school.jpg')" }}
      />

      <div className="fixed inset-0 bg-linear-to-b from-[#0b3d2e]/75 via-[#0b3d2e]/60 to-[#052e1c]/85" />
      <div className="pointer-events-none fixed -top-40 left-1/2 h-96 w-180 -translate-x-1/2 rounded-full bg-yellow-400/10 blur-3xl" />
      <div className="pointer-events-none fixed bottom-10 -right-20 h-96 w-96 rounded-full bg-emerald-700/25 blur-3xl" />

      <div className="relative z-10 w-full max-w-md">
        <div className="mb-6 flex justify-center">
          <Link href="/" className="flex items-center gap-3">
            <div className="relative h-14 w-14 overflow-hidden rounded-full border-2 border-yellow-400/60">
              <Image
                src="/school-logo-trimmed.png"
                alt="AASMNHS school logo"
                fill
                className="object-cover"
              />
            </div>

            <div>
              <p className="font-extrabold tracking-wide text-white">AASMNHS</p>
              <p className="text-xs text-emerald-200">Administration Portal</p>
            </div>
          </Link>
        </div>

        {children}

        <p className="mt-5 text-center text-xs text-emerald-200">
          <Link href="/" className="hover:text-yellow-300 hover:underline">
            Back to Home
          </Link>
        </p>
      </div>
    </main>
  );
}
