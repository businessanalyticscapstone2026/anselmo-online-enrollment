"use client";

import Link from "next/link";
import Image from "next/image";
import { usePathname, useRouter } from "next/navigation";
import { useState } from "react";
import { supabase } from "@/lib/supabaseClient";
import ConfirmDialog from "@/app/_components/ConfirmDialog";
import { Users, Sliders, History, LogOut, Menu, X } from "lucide-react";

const adminNavItems = [
  {
    href: "/admin/users",
    label: "Manage Users",
    icon: Users,
    exact: false,
  },
  {
    href: "/admin/system-management",
    label: "System Settings",
    icon: Sliders,
    exact: false,
  },
  {
    href: "/admin/activity-logs",
    label: "Activity Logs",
    icon: History,
    exact: false,
  },
];

export default function AdminDashboardShell({
  adminName,
  children,
}: {
  adminName: string;
  children: React.ReactNode;
}) {
  const pathname = usePathname();
  const router = useRouter();
  const [mobileOpen, setMobileOpen] = useState(false);
  const [showLogoutConfirm, setShowLogoutConfirm] = useState(false);
  async function handleLogout() {
    try {
      // Log the sign-out event before the session is cleared. The API derives
      // the admin's identity from the authenticated session.
      const { data: sessionData } = await supabase.auth.getSession();
      const token = sessionData.session?.access_token;

      await fetch("/api/auth/activity", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        credentials: "include",
        body: JSON.stringify({ event: "signout" }),
      }).catch(() => null);
    } catch {
      // Ignore background log error
    }

    await fetch("/api/auth/mfa/logout", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ area: "admin" }),
    }).catch(() => null);
    await supabase.auth.signOut();
    localStorage.removeItem("adminLoggedIn");
    localStorage.removeItem("adminEmail");
    router.replace("/login?area=admin");
    router.refresh();
  }

  const sidebar = (
    <div className="flex h-full flex-col bg-[#0b3d2e] text-emerald-50">
      {/* School Branding */}
      <div className="border-b border-emerald-800/80 px-5 py-5">
        <Link href="/admin/users" className="flex items-center gap-3">
          <div className="relative flex h-11 w-11 shrink-0 items-center justify-center overflow-hidden rounded-full border border-yellow-400/60">
            <Image
              src="/school-logo-trimmed.png"
              alt="AASMNHS logo"
              width={44}
              height={44}
              className="h-full w-full object-cover"
            />
          </div>
          <div>
            <p className="text-sm font-extrabold tracking-wide text-white">AASMNHS</p>
            <p className="mt-0.5 text-[10px] text-emerald-300">Administration Portal</p>
          </div>
        </Link>
      </div>

      <div className="px-4 pb-2 pt-6">
        <p className="px-3 text-[10px] font-bold uppercase tracking-[0.18em] text-emerald-300">
          Administration
        </p>
      </div>

      {/* Navigation Modules */}
      <nav className="flex-1 space-y-1 px-3">
        {adminNavItems.map(({ href, label, icon: Icon, exact }) => {
          const active = exact
            ? pathname === href
            : pathname === href || pathname.startsWith(href);
          return (
            <Link
              key={href}
              href={href}
              onClick={() => setMobileOpen(false)}
              className={`flex items-center gap-3 rounded-lg border px-3 py-3 text-sm transition ${active
                  ? "border-yellow-400/40 bg-yellow-400/15 font-semibold text-yellow-200"
                  : "border-transparent text-emerald-100 hover:border-emerald-700 hover:bg-emerald-800/50"
                }`}
            >
              <Icon size={18} strokeWidth={1.8} />
              <span>{label}</span>
              {active && (
                <span className="ml-auto h-1.5 w-1.5 rounded-full bg-yellow-400" />
              )}
            </Link>
          );
        })}
      </nav>

      {/* User Info & Logout Button */}
      <div className="border-t border-emerald-800/80 p-4">
        <div className="mb-3 rounded-lg bg-emerald-900/60 p-3">
          <div className="min-w-0">
            <p className="truncate text-xs font-semibold text-white">{adminName}</p>
            <p className="text-[10px] text-emerald-300">ICT Administrator</p>
          </div>
        </div>

        <button
          onClick={() => setShowLogoutConfirm(true)}
          className="flex w-full items-center gap-3 rounded-lg px-3 py-3 text-sm text-rose-200 transition hover:bg-rose-500/15"
        >
          <LogOut size={18} />
          Log out
        </button>
      </div>
    </div>
  );

  return (
    <div className="min-h-screen bg-[#eaf5ec] text-[#06281b]">
      {/* Desktop Sidebar */}
      <aside className="fixed inset-y-0 left-0 z-40 hidden w-67.5 border-r border-emerald-800 lg:block">
        {sidebar}
      </aside>

      {/* Mobile Sticky Header */}
      <div className="sticky top-0 z-30 flex items-center justify-between border-b border-[#c3e2cd] bg-[#eaf5ec]/95 px-4 py-3 backdrop-blur lg:hidden">
        <Link href="/admin/users" className="flex items-center gap-2">
          <div className="relative flex h-9 w-9 shrink-0 items-center justify-center overflow-hidden rounded-full border border-[#c3e2cd]">
            <Image
              src="/school-logo-trimmed.png"
              alt="AASMNHS logo"
              width={36}
              height={36}
              className="h-full w-full object-cover"
            />
          </div>
          <span className="text-sm font-bold text-[#06281b]">
            AASMNHS <span className="font-normal text-[#14532d]">Admin</span>
          </span>
        </Link>
        <div className="flex items-center gap-2">
          <button
            aria-label="Open navigation"
            onClick={() => setMobileOpen(!mobileOpen)}
            className="rounded-md border border-[#c3e2cd] p-2 text-[#0b3d2e]"
          >
            {mobileOpen ? <X size={19} /> : <Menu size={19} />}
          </button>
        </div>
      </div>

      {/* Mobile Drawer */}
      {mobileOpen && (
        <div className="fixed inset-0 z-40 lg:hidden">
          <button
            aria-label="Close navigation"
            className="absolute inset-0 bg-[#052e1c]/70"
            onClick={() => setMobileOpen(false)}
          />
          <aside className="absolute inset-y-0 left-0 w-70 shadow-2xl">
            {sidebar}
          </aside>
        </div>
      )}

      {/* Main Content Area */}
      <main className="min-h-screen lg:ml-67.5">
        <header className="hidden border-b border-[#c3e2cd] bg-[#d7eedd]/70 px-8 py-4 lg:flex lg:items-center">
          <div>
            <p className="text-xs font-semibold text-[#14532d]">
              ANSELMO A. SANDOVAL MEMORIAL NATIONAL HIGH SCHOOL
            </p>
            <p className="mt-1 text-sm text-[#0b3d2e]">
              Online Enrollment · ICT Administration Workspace
            </p>
          </div>
        </header>

        <div className="mx-auto w-full max-w-375 px-4 py-6 sm:px-6 lg:px-8 lg:py-8">
          {children}
        </div>

        <footer className="border-t border-[#c3e2cd] px-6 py-4 text-center text-[10px] text-[#3f5f50]">
          © {new Date().getFullYear()} Capstone Project - BatStateU Mabini Campus
        </footer>
      </main>

      <ConfirmDialog
        open={showLogoutConfirm}
        title="Log out?"
        message="Are you sure you want to log out of your account?"
        confirmLabel="Log out"
        onConfirm={() => {
          setShowLogoutConfirm(false);
          handleLogout();
        }}
        onCancel={() => setShowLogoutConfirm(false)}
      />
    </div>
  );
}
