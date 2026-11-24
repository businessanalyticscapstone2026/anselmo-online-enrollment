"use client";

import Link from "next/link";
import Image from "next/image";
import { usePathname, useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { supabase } from "@/lib/supabaseClient";
import ConfirmDialog from "@/app/_components/ConfirmDialog";
import {
  Users,
  Sliders,
  History,
  LogOut,
  Menu,
  X,
  Bell,
  ShieldAlert,
  Trash2,
} from "lucide-react";

type RejectedStudent = {
  userId: string;
  applicationId: string | null;
  fullName: string;
  email: string;
  remarks: string;
  rejectedAt: string | null;
};

function formatRejectedAt(value: string | null): string {
  if (!value) return "Recently";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Recently";
  return date.toLocaleString("en-PH", {
    dateStyle: "medium",
    timeStyle: "short",
  });
}

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
  const [notificationsOpen, setNotificationsOpen] = useState(false);
  const [rejectedStudents, setRejectedStudents] = useState<RejectedStudent[]>(
    []
  );
  const [notificationError, setNotificationError] = useState<string | null>(
    null
  );
  const [studentToDelete, setStudentToDelete] =
    useState<RejectedStudent | null>(null);
  const [deletingStudentId, setDeletingStudentId] = useState<string | null>(
    null
  );

  const loadRejectedStudents = useCallback(async () => {
    try {
      const { data: sessionData } = await supabase.auth.getSession();
      const token = sessionData.session?.access_token;
      const response = await fetch("/api/admin/users?view=notifications", {
        cache: "no-store",
        credentials: "include",
        headers: {
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
      });
      const data = await response.json().catch(() => null);

      if (!response.ok) {
        throw new Error(data?.error || "Unable to load notifications.");
      }

      setRejectedStudents(
        Array.isArray(data?.rejectedStudents) ? data.rejectedStudents : []
      );
      setNotificationError(null);
    } catch (err) {
      setNotificationError(
        err instanceof Error ? err.message : "Unable to load notifications."
      );
    }
  }, []);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void loadRejectedStudents();
    const interval = window.setInterval(() => {
      void loadRejectedStudents();
    }, 60000);

    return () => window.clearInterval(interval);
  }, [loadRejectedStudents]);

  useEffect(() => {
    const channel = supabase
      .channel("admin-rejected-notifications")
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "student_applications" },
        () => {
          void loadRejectedStudents();
        }
      )
      .subscribe();

    return () => {
      void supabase.removeChannel(channel);
    };
  }, [loadRejectedStudents]);

  function toggleNotifications() {
    setNotificationsOpen((open) => {
      if (!open) void loadRejectedStudents();
      return !open;
    });
  }

  async function handleDeleteRejectedStudent() {
    const target = studentToDelete;

    if (!target || deletingStudentId) return;

    setDeletingStudentId(target.userId);

    try {
      const { data: sessionData } = await supabase.auth.getSession();
      const token = sessionData.session?.access_token;
      const response = await fetch("/api/admin/users/delete", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        credentials: "include",
        body: JSON.stringify({
          userId: target.userId,
          email: target.email,
          role: "student",
        }),
      });
      const data = await response.json().catch(() => null);

      if (!response.ok || !data?.success) {
        throw new Error(data?.error || "Unable to remove the student account.");
      }

      setRejectedStudents((students) =>
        students.filter((student) => student.userId !== target.userId)
      );
      setStudentToDelete(null);
      setNotificationError(null);
      router.refresh();
    } catch (err) {
      setNotificationError(
        err instanceof Error
          ? err.message
          : "Unable to remove the student account."
      );
    } finally {
      setDeletingStudentId(null);
    }
  }

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

  const notificationBell = (
    <div className="relative">
      <button
        type="button"
        aria-label={
          rejectedStudents.length > 0
            ? `${rejectedStudents.length} rejected student notification${
                rejectedStudents.length === 1 ? "" : "s"
              }`
            : "Notifications"
        }
        aria-expanded={notificationsOpen}
        onClick={toggleNotifications}
        className="relative flex h-9 w-9 items-center justify-center rounded-full border border-[#c3e2cd] bg-white/80 text-[#0b3d2e] transition hover:border-emerald-400 hover:bg-white"
      >
        <Bell size={18} strokeWidth={1.9} />
        {rejectedStudents.length > 0 && (
          <span className="absolute -right-1 -top-1 flex h-5 min-w-5 items-center justify-center rounded-full bg-red-600 px-1 text-[10px] font-bold text-white shadow-sm">
            {rejectedStudents.length > 9 ? "9+" : rejectedStudents.length}
          </span>
        )}
      </button>

      {notificationsOpen && (
        <>
          <button
            type="button"
            aria-label="Close notifications"
            className="fixed inset-0 z-40 cursor-default"
            onClick={() => setNotificationsOpen(false)}
          />
          <div className="absolute right-0 top-full z-50 mt-2 w-[min(22rem,calc(100vw-2rem))] overflow-hidden rounded-xl border border-emerald-200 bg-white shadow-xl">
            <div className="flex items-start justify-between gap-3 border-b border-emerald-100 bg-emerald-50/70 px-4 py-3">
              <div>
                <p className="text-sm font-bold text-emerald-950">
                  Notifications
                </p>
                <p className="mt-0.5 text-[11px] text-emerald-700">
                  Students rejected by staff need account removal.
                </p>
              </div>
              <span className="rounded-full bg-red-100 px-2 py-0.5 text-[10px] font-bold text-red-700">
                {rejectedStudents.length}
              </span>
            </div>

            {notificationError && (
              <p className="border-b border-red-100 bg-red-50 px-4 py-2 text-[11px] font-medium text-red-700">
                {notificationError}
              </p>
            )}

            <div className="max-h-80 overflow-y-auto">
              {rejectedStudents.length === 0 ? (
                <div className="px-4 py-6 text-center">
                  <p className="text-xs font-semibold text-emerald-800">
                    No rejected students
                  </p>
                  <p className="mt-1 text-[11px] text-emerald-600">
                    You are all caught up.
                  </p>
                </div>
              ) : (
                <ul className="divide-y divide-emerald-100">
                  {rejectedStudents.map((student) => (
                    <li key={student.userId} className="px-4 py-3">
                      <div className="flex items-start gap-3">
                        <div className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-red-50 text-red-600">
                          <ShieldAlert size={16} />
                        </div>
                        <div className="min-w-0 flex-1">
                          <p className="truncate text-xs font-bold text-emerald-950">
                            {student.fullName}
                          </p>
                          <p className="truncate text-[11px] text-emerald-700">
                            {student.email}
                          </p>
                          {student.remarks && (
                            <p className="mt-1 line-clamp-2 text-[11px] text-red-700">
                              Reason: {student.remarks}
                            </p>
                          )}
                          <p className="mt-1 text-[10px] text-emerald-600">
                            Rejected {formatRejectedAt(student.rejectedAt)}
                          </p>
                        </div>
                        <button
                          type="button"
                          onClick={() => setStudentToDelete(student)}
                          disabled={deletingStudentId === student.userId}
                          className="inline-flex shrink-0 items-center gap-1 rounded-lg border border-red-200 bg-red-50 px-2.5 py-1.5 text-[10px] font-bold text-red-700 transition hover:border-red-300 hover:bg-red-100 disabled:opacity-50"
                        >
                          <Trash2 size={12} />
                          {deletingStudentId === student.userId
                            ? "Removing"
                            : "Delete"}
                        </button>
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </div>

            <div className="border-t border-emerald-100 bg-white px-4 py-2.5">
              <Link
                href="/admin/users"
                onClick={() => setNotificationsOpen(false)}
                className="text-[11px] font-bold text-emerald-700 hover:text-emerald-900 hover:underline"
              >
                Open Manage Users
              </Link>
            </div>
          </div>
        </>
      )}
    </div>
  );

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
          {notificationBell}
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
          <div className="ml-auto">{notificationBell}</div>
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

      <ConfirmDialog
        open={Boolean(studentToDelete)}
        title="Remove rejected student?"
        message={
          studentToDelete
            ? `Remove ${studentToDelete.fullName} (${studentToDelete.email}) from the portal? Their enrollment records will be archived and the account will no longer be able to sign in.`
            : ""
        }
        confirmLabel={
          deletingStudentId ? "Removing..." : "Remove account"
        }
        onConfirm={handleDeleteRejectedStudent}
        onCancel={() => {
          if (!deletingStudentId) setStudentToDelete(null);
        }}
      />
    </div>
  );
}
