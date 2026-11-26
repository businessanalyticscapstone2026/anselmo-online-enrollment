"use client";

import { useEffect, useState, useMemo } from "react";
import { supabase } from "@/lib/supabaseClient";
import { formatPhilippineDateTime } from "@/lib/activityLogger";
import {
  Users,
  Search,
  Trash2,
  AlertCircle,
  CheckCircle2,
  RotateCw,
  GraduationCap,
  Briefcase,
  ShieldAlert,
  UserPlus,
  Send,
  Copy,
} from "lucide-react";

type UserRecord = {
  id: string;
  fullName: string;
  email: string;
  role: string;
  createdAt?: string;
};

type StaffRole = "staff" | "registrar";

type AddStaffResult = {
  id: string;
  fullName: string;
  email: string;
  role: StaffRole;
  emailSent: boolean;
  warning?: string;
  setupUrl?: string;
  restored?: boolean;
};

type AddStaffApiResponse = {
  success?: boolean;
  error?: string;
  message?: string;
  emailSent?: boolean;
  warning?: string;
  setupUrl?: string;
  restored?: boolean;
  staff?: {
    id: string;
    fullName: string;
    email: string;
    role: string;
  };
};

export default function ManageUsersPage() {
  const [users, setUsers] = useState<UserRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);

  // Search & Filter state
  const [searchTerm, setSearchTerm] = useState("");
  const [roleFilter, setRoleFilter] = useState<"ALL" | "STUDENT" | "STAFF">("ALL");

  // Deletion modal state
  const [userToDelete, setUserToDelete] = useState<UserRecord | null>(null);
  const [deleting, setDeleting] = useState(false);

  // Add Staff modal state
  const [showAddStaff, setShowAddStaff] = useState(false);
  const [staffName, setStaffName] = useState("");
  const [staffEmail, setStaffEmail] = useState("");
  const [staffRole, setStaffRole] = useState<StaffRole>("staff");
  const [addingStaff, setAddingStaff] = useState(false);
  const [addStaffError, setAddStaffError] = useState<string | null>(null);
  const [addStaffResult, setAddStaffResult] = useState<AddStaffResult | null>(
    null
  );
  const [resendingSetup, setResendingSetup] = useState(false);
  const [setupLinkCopied, setSetupLinkCopied] = useState(false);

  // Load registered users
  async function fetchUsers(options?: { silent?: boolean }) {
    if (!options?.silent) {
      setLoading(true);
    }
    setError(null);

    try {
      const { data: sessionData } = await supabase.auth.getSession();
      const token = sessionData.session?.access_token;

      const res = await fetch("/api/admin/users", {
        headers: {
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        credentials: "include",
        cache: "no-store",
      });
      const data = await res.json();

      if (!res.ok) {
        throw new Error(data.error || "Failed to load users.");
      }

      setUsers(data.users || []);
    } catch (err) {
      console.error("Error fetching users:", err);
      setError(err instanceof Error ? err.message : "Unable to retrieve users.");
    } finally {
      if (!options?.silent) {
        setLoading(false);
      }
    }
  }

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    fetchUsers();
  }, []);

  // Filtered users: dynamic search by full name + role filter
  const filteredUsers = useMemo(() => {
    return users.filter((user) => {
      // 1. Search by full name (case-insensitive substring match)
      const matchesSearch = user.fullName
        .toLowerCase()
        .includes(searchTerm.toLowerCase().trim());

      // 2. Filter by user type (Student vs Staff)
      const isStudent = user.role.toLowerCase() === "student";
      const isStaff =
        ["staff", "registrar"].includes(user.role.toLowerCase()) ||
        user.role.toLowerCase().includes("staff");

      if (roleFilter === "STUDENT" && !isStudent) return false;
      if (roleFilter === "STAFF" && !isStaff) return false;

      return matchesSearch;
    });
  }, [users, searchTerm, roleFilter]);

  // Statistics
  const studentCount = users.filter((u) => u.role.toLowerCase() === "student").length;
  const staffCount = users.filter((u) =>
    ["staff", "registrar"].includes(u.role.toLowerCase())
  ).length;

  // Handle User Removal
  async function confirmDeleteUser() {
    if (!userToDelete) return;

    setDeleting(true);
    setError(null);
    setSuccessMessage(null);

    try {
      const { data: sessionData } = await supabase.auth.getSession();
      const token = sessionData.session?.access_token;

      const res = await fetch("/api/admin/users/delete", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        credentials: "include",
        body: JSON.stringify({
          userId: userToDelete.id,
          email: userToDelete.email,
          role: userToDelete.role,
        }),
      });

      const data = await res.json();

      if (!res.ok) {
        throw new Error(data.error || "Failed to remove user account.");
      }

      const wasStudent =
        userToDelete.role.trim().toLowerCase() === "student";

      setSuccessMessage(
        wasStudent
          ? `✓ Account for ${userToDelete.fullName} (${userToDelete.email}) was removed successfully. Their enrollment records were removed from all staff dashboards, and they can enroll again in the future.`
          : `✓ Account for ${userToDelete.fullName} (${userToDelete.email}) was removed successfully. Any enrollment records have been safely preserved.`
      );

      // Remove user from local state
      setUsers((prev) => prev.filter((u) => u.id !== userToDelete.id));
      setUserToDelete(null);
    } catch (err) {
      console.error("Error deleting user:", err);
      setError(
        err instanceof Error ? err.message : "Unable to remove user account."
      );
    } finally {
      setDeleting(false);
    }
  }

  function openAddStaffModal() {
    setShowAddStaff(true);
    setStaffName("");
    setStaffEmail("");
    setStaffRole("staff");
    setAddStaffError(null);
    setAddStaffResult(null);
    setResendingSetup(false);
    setSetupLinkCopied(false);
  }

  function closeAddStaffModal() {
    if (addingStaff || resendingSetup) return;
    setShowAddStaff(false);
  }

  async function submitAddStaff(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setAddStaffError(null);
    setAddStaffResult(null);

    const fullName = staffName.trim().replace(/\s+/g, " ");
    const email = staffEmail.trim().toLowerCase();

    if (fullName.length < 2) {
      setAddStaffError("Enter the staff member's full name.");
      return;
    }

    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      setAddStaffError("Enter a valid email address.");
      return;
    }

    setAddingStaff(true);

    try {
      const { data: sessionData } = await supabase.auth.getSession();
      const token = sessionData.session?.access_token;

      const res = await fetch("/api/admin/staff", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        credentials: "include",
        body: JSON.stringify({
          fullName,
          email,
          role: staffRole,
        }),
      });

      const data = (await res.json()) as AddStaffApiResponse;

      if (!res.ok || !data.success || !data.staff) {
        throw new Error(data.error || "Could not create the staff account.");
      }

      const resultRole: StaffRole =
        data.staff.role === "registrar" ? "registrar" : "staff";

      setAddStaffResult({
        id: data.staff.id,
        fullName: data.staff.fullName,
        email: data.staff.email,
        role: resultRole,
        emailSent: Boolean(data.emailSent),
        warning: data.warning,
        setupUrl: data.setupUrl,
        restored: data.restored,
      });

      setSuccessMessage(
        data.message ||
        `Staff account created for ${data.staff.email}.`
      );

      void fetchUsers();
    } catch (err) {
      console.error("Error creating staff account:", err);
      setAddStaffError(
        err instanceof Error
          ? err.message
          : "Unable to create the staff account."
      );
    } finally {
      setAddingStaff(false);
    }
  }

  async function resendStaffSetup() {
    if (!addStaffResult) return;

    setResendingSetup(true);
    setAddStaffError(null);
    setSetupLinkCopied(false);

    try {
      const { data: sessionData } = await supabase.auth.getSession();
      const token = sessionData.session?.access_token;

      const res = await fetch("/api/admin/staff/resend", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        credentials: "include",
        body: JSON.stringify({ email: addStaffResult.email }),
      });

      const data = (await res.json()) as AddStaffApiResponse;

      if (!res.ok || !data.success) {
        if (data.setupUrl) {
          setAddStaffResult((current) =>
            current
              ? {
                ...current,
                emailSent: false,
                warning: data.error,
                setupUrl: data.setupUrl,
              }
              : current
          );
        }

        throw new Error(data.error || "Could not resend the setup email.");
      }

      setAddStaffResult((current) =>
        current
          ? {
            ...current,
            emailSent: true,
            warning: undefined,
            setupUrl: undefined,
          }
          : current
      );

      setSuccessMessage(
        data.message || `Setup email resent to ${addStaffResult.email}.`
      );
    } catch (err) {
      console.error("Error resending staff setup email:", err);
      setAddStaffError(
        err instanceof Error
          ? err.message
          : "Unable to resend the setup email."
      );
    } finally {
      setResendingSetup(false);
    }
  }

  async function copySetupLink() {
    const setupUrl = addStaffResult?.setupUrl;
    if (!setupUrl) return;

    try {
      await navigator.clipboard.writeText(setupUrl);
      setSetupLinkCopied(true);
    } catch {
      setAddStaffError(
        "Could not copy the setup link. Select the link and copy it manually."
      );
    }
  }

  return (
    <div className="space-y-6">
      {/* Page Header */}
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-emerald-950 sm:text-3xl">
            Manage Users
          </h1>
          <p className="mt-1 text-xs text-emerald-900 sm:text-sm">
            View registered student and staff accounts, search dynamically, and manage portal access.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2 self-start">
          <button
            onClick={openAddStaffModal}
            className="inline-flex items-center gap-2 rounded-lg bg-yellow-400 px-4 py-2 text-xs font-bold text-emerald-950 transition hover:bg-yellow-300"
          >
            <UserPlus size={14} />
            <span>Add Staff</span>
          </button>

          <button
            onClick={() => fetchUsers()}
            disabled={loading}
            className="inline-flex items-center gap-2 rounded-lg border border-emerald-200 bg-white px-4 py-2 text-xs font-semibold text-emerald-700 transition hover:border-emerald-200 hover:bg-amber-50 disabled:opacity-50"
          >
            <RotateCw size={14} className={loading ? "animate-spin" : ""} />
            <span>Refresh</span>
          </button>
        </div>
      </div>

      {/* Notifications */}
      {successMessage && (
        <div
          role="status"
          className="flex items-center justify-between gap-3 rounded-xl border border-emerald-200 bg-emerald-50 p-4 text-xs text-emerald-700"
        >
          <div className="flex items-center gap-2">
            <CheckCircle2 size={16} className="shrink-0 text-emerald-700" />
            <span>{successMessage}</span>
          </div>
          <button
            onClick={() => setSuccessMessage(null)}
            className="text-emerald-700 hover:text-emerald-950"
          >
            ✕
          </button>
        </div>
      )}

      {error && (
        <div
          role="alert"
          className="flex items-center justify-between gap-3 rounded-xl border border-red-200 bg-red-50 p-4 text-xs text-red-700"
        >
          <div className="flex items-center gap-2">
            <AlertCircle size={16} className="shrink-0 text-red-700" />
            <span>{error}</span>
          </div>
          <button
            onClick={() => setError(null)}
            className="text-red-700 hover:text-emerald-950"
          >
            ✕
          </button>
        </div>
      )}

      {/* Metrics Cards */}
      <div className="grid gap-4 sm:grid-cols-3">
        <div className="rounded-xl border border-emerald-200 bg-white/90 p-5 shadow-sm">
          <div className="flex items-center justify-between">
            <p className="text-xs font-bold uppercase tracking-wider text-emerald-800">
              Total Users
            </p>
            <div className="flex h-8 w-8 items-center justify-center rounded-lg border border-emerald-200 bg-amber-50">
              <Users size={16} className="text-emerald-700" />
            </div>
          </div>
          <p className="mt-2 text-3xl font-extrabold text-emerald-950">{users.length}</p>
          <p className="mt-1 text-[11px] text-emerald-900">Registered portal accounts</p>
        </div>

        <div className="rounded-xl border border-emerald-200 bg-white/90 p-5 shadow-sm">
          <div className="flex items-center justify-between">
            <p className="text-xs font-bold uppercase tracking-wider text-emerald-800">
              Students
            </p>
            <div className="flex h-8 w-8 items-center justify-center rounded-lg border border-emerald-200 bg-emerald-50">
              <GraduationCap size={16} className="text-emerald-700" />
            </div>
          </div>
          <p className="mt-2 text-3xl font-extrabold text-emerald-700">{studentCount}</p>
          <p className="mt-1 text-[11px] text-emerald-900">Student accounts with portal access</p>
        </div>

        <div className="rounded-xl border border-emerald-200 bg-white/90 p-5 shadow-sm">
          <div className="flex items-center justify-between">
            <p className="text-xs font-bold uppercase tracking-wider text-emerald-800">
              Staff &amp; Registrars
            </p>
            <div className="flex h-8 w-8 items-center justify-center rounded-lg border border-amber-200 bg-amber-50">
              <Briefcase size={16} className="text-amber-700" />
            </div>
          </div>
          <p className="mt-2 text-3xl font-extrabold text-amber-700">{staffCount}</p>
          <p className="mt-1 text-[11px] text-emerald-900">Authorized school registrars</p>
        </div>
      </div>

      {/* Search & Filter Controls */}
      <div className="rounded-xl border border-emerald-200 bg-white/90 p-4 shadow-sm sm:p-5">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          {/* Dynamic Search Bar */}
          <div className="relative flex-1">
            <Search
              size={16}
              className="absolute left-3.5 top-1/2 -translate-y-1/2 text-emerald-800"
            />
            <input
              type="text"
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              placeholder="Search users by full name..."
              className="w-full rounded-lg border border-emerald-200 bg-white py-2.5 pl-10 pr-4 text-xs text-emerald-950 outline-none placeholder:text-emerald-800 focus:border-emerald-200 sm:text-sm"
            />
            {searchTerm && (
              <button
                onClick={() => setSearchTerm("")}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-xs text-emerald-800 hover:text-emerald-950"
              >
                Clear
              </button>
            )}
          </div>

          {/* User Type Filter Tabs */}
          <div className="flex items-center gap-1 rounded-lg border border-emerald-200 bg-white p-1 text-xs">
            <button
              onClick={() => setRoleFilter("ALL")}
              className={`rounded-md px-3 py-1.5 font-semibold transition ${roleFilter === "ALL"
                ? "bg-yellow-300 text-emerald-950"
                : "text-emerald-900 hover:text-emerald-950"
                }`}
            >
              All ({users.length})
            </button>
            <button
              onClick={() => setRoleFilter("STUDENT")}
              className={`rounded-md px-3 py-1.5 font-semibold transition ${roleFilter === "STUDENT"
                ? "bg-yellow-300 text-emerald-950"
                : "text-emerald-900 hover:text-emerald-950"
                }`}
            >
              Students ({studentCount})
            </button>
            <button
              onClick={() => setRoleFilter("STAFF")}
              className={`rounded-md px-3 py-1.5 font-semibold transition ${roleFilter === "STAFF"
                ? "bg-yellow-300 text-emerald-950"
                : "text-emerald-900 hover:text-emerald-950"
                }`}
            >
              Staff ({staffCount})
            </button>
          </div>
        </div>
      </div>

      {/* Users Table */}
      <div className="overflow-hidden rounded-xl border border-emerald-200 bg-white/90 shadow-sm">
        <div className="overflow-x-auto">
          <table className="w-full min-w-200 text-left text-xs sm:text-sm">
            <thead className="border-b border-emerald-200 bg-white text-[11px] uppercase tracking-wider text-emerald-900">
              <tr>
                <th className="px-5 py-4">Full Name</th>
                <th className="px-5 py-4">Email Address</th>
                <th className="px-5 py-4">User Type</th>
                <th className="px-5 py-4">Date &amp; Time Created</th>
                <th className="px-5 py-4 text-right">Action</th>
              </tr>
            </thead>

            <tbody className="divide-y divide-emerald-200/15">
              {loading && (
                <tr>
                  <td colSpan={5} className="px-5 py-12 text-center text-emerald-900">
                    <div className="inline-flex items-center gap-2 animate-fade-in">
                      <span className="h-4 w-4 animate-spin rounded-full border-2 border-emerald-200 border-t-transparent" />
                      <span>Loading registered system users...</span>
                    </div>
                  </td>
                </tr>
              )}

              {!loading && filteredUsers.length === 0 && (
                <tr>
                  <td colSpan={5} className="px-5 py-12 text-center text-emerald-900">
                    {searchTerm || roleFilter !== "ALL"
                      ? "No registered users match your search criteria."
                      : "No registered system users found."}
                  </td>
                </tr>
              )}

              {!loading &&
                filteredUsers.map((user) => {
                  const roleNormalized = user.role.toLowerCase();
                  const isStudent = roleNormalized === "student";
                  const isStaff = ["staff", "registrar"].includes(roleNormalized);

                  return (
                    <tr
                      key={user.id}
                      className="transition hover:bg-white/3"
                    >
                      <td className="px-5 py-4 font-semibold text-emerald-950">
                        {user.fullName}
                      </td>

                      <td className="px-5 py-4 font-mono text-xs text-emerald-900">
                        {user.email}
                      </td>

                      <td className="px-5 py-4">
                        <span
                          className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-[11px] font-bold ${isStudent
                            ? "bg-emerald-50 text-emerald-700 ring-1 ring-emerald-200"
                            : isStaff
                              ? "bg-amber-50 text-amber-700 ring-1 ring-amber-200"
                              : "bg-purple-50 text-purple-700 ring-1 ring-purple-200"
                            }`}
                        >
                          {isStudent
                            ? "Student"
                            : isStaff
                              ? "Staff / Registrar"
                              : "ICT Admin"}
                        </span>
                      </td>

                      <td className="whitespace-nowrap px-5 py-4 font-mono text-xs text-emerald-900">
                        {formatPhilippineDateTime(user.createdAt)}
                      </td>

                      <td className="px-5 py-4 text-right">
                        <button
                          onClick={() => setUserToDelete(user)}
                          className="inline-flex items-center gap-1.5 rounded-lg border border-red-200 bg-red-50 px-3 py-1.5 text-xs font-semibold text-red-700 transition hover:border-red-400 hover:bg-red-50"
                          title={`Remove ${user.fullName}`}
                        >
                          <Trash2 size={13} />
                          <span>Remove User</span>
                        </button>
                      </td>
                    </tr>
                  );
                })}
            </tbody>
          </table>
        </div>
      </div>

      {/* Add Staff Modal */}
      {showAddStaff && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 p-4 backdrop-blur-xs">
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="add-staff-title"
            className="max-h-[90vh] w-full max-w-lg overflow-y-auto rounded-2xl border border-emerald-200 bg-white p-6 text-emerald-700 shadow-2xl"
          >
            <div className="flex items-start justify-between gap-4">
              <div className="flex items-center gap-3">
                <div
                  className={`flex h-12 w-12 shrink-0 items-center justify-center rounded-full border ${addStaffResult
                    ? "border-emerald-200 bg-emerald-50 text-emerald-700"
                    : "border-emerald-200 bg-amber-50 text-emerald-700"
                    }`}
                >
                  {addStaffResult ? (
                    <CheckCircle2 size={24} />
                  ) : (
                    <UserPlus size={24} />
                  )}
                </div>
                <div>
                  <h3
                    id="add-staff-title"
                    className="text-lg font-bold text-emerald-950"
                  >
                    {addStaffResult
                      ? "Staff Account Created"
                      : "Add Staff Account"}
                  </h3>
                  <p className="text-xs text-emerald-900">
                    {addStaffResult
                      ? "Review the account and setup email status."
                      : "Create a staff or registrar dashboard account."}
                  </p>
                </div>
              </div>

              <button
                type="button"
                onClick={closeAddStaffModal}
                disabled={addingStaff || resendingSetup}
                className="rounded-lg px-2 py-1 text-lg leading-none text-emerald-800 transition hover:bg-emerald-50 hover:text-emerald-950 disabled:opacity-50"
                aria-label="Close add staff dialog"
              >
                ✕
              </button>
            </div>

            {addStaffError && (
              <div
                role="alert"
                className="mt-5 flex items-start gap-2 rounded-xl border border-red-200 bg-red-50 p-3 text-xs text-red-700"
              >
                <AlertCircle size={15} className="mt-0.5 shrink-0 text-red-700" />
                <span>{addStaffError}</span>
              </div>
            )}

            {!addStaffResult ? (
              <form onSubmit={submitAddStaff} className="mt-5 space-y-4">
                <div>
                  <label
                    htmlFor="staffFullName"
                    className="mb-1.5 block text-[11px] font-bold uppercase tracking-wider text-emerald-900"
                  >
                    Full Name
                  </label>
                  <input
                    id="staffFullName"
                    type="text"
                    required
                    minLength={2}
                    maxLength={120}
                    value={staffName}
                    onChange={(e) => setStaffName(e.target.value)}
                    placeholder="e.g. Maria Santos"
                    className="w-full rounded-lg border border-emerald-200 bg-white px-3.5 py-2.5 text-sm text-emerald-950 outline-none placeholder:text-emerald-800 focus:border-emerald-200"
                  />
                </div>

                <div>
                  <label
                    htmlFor="staffEmail"
                    className="mb-1.5 block text-[11px] font-bold uppercase tracking-wider text-emerald-900"
                  >
                    Email Address
                  </label>
                  <input
                    id="staffEmail"
                    type="email"
                    required
                    maxLength={254}
                    value={staffEmail}
                    onChange={(e) => setStaffEmail(e.target.value)}
                    placeholder="staff@aasmnhs.edu.ph"
                    className="w-full rounded-lg border border-emerald-200 bg-white px-3.5 py-2.5 text-sm text-emerald-950 outline-none placeholder:text-emerald-800 focus:border-emerald-200"
                  />
                </div>

                <div>
                  <label
                    htmlFor="staffRole"
                    className="mb-1.5 block text-[11px] font-bold uppercase tracking-wider text-emerald-900"
                  >
                    Role
                  </label>
                  <select
                    id="staffRole"
                    value={staffRole}
                    onChange={(e) =>
                      setStaffRole(e.target.value as StaffRole)
                    }
                    className="w-full rounded-lg border border-emerald-200 bg-white px-3.5 py-2.5 text-sm text-emerald-950 outline-none focus:border-emerald-200"
                  >
                    <option value="registrar">Registrar</option>
                  </select>
                </div>

                <div className="rounded-xl border border-emerald-200 bg-white p-3 text-[11px] leading-relaxed text-emerald-900">
                  A secure one-time setup link will be emailed to this address.
                  The staff member will create their own password, then sign in
                  through the staff verification flow.
                </div>

                <div className="mt-6 flex justify-end gap-3">
                  <button
                    type="button"
                    disabled={addingStaff}
                    onClick={closeAddStaffModal}
                    className="rounded-lg border border-emerald-200 px-4 py-2 text-xs font-semibold text-emerald-700 transition hover:bg-emerald-50 disabled:opacity-50"
                  >
                    Cancel
                  </button>

                  <button
                    type="submit"
                    disabled={addingStaff}
                    className="inline-flex items-center gap-2 rounded-lg bg-yellow-400 px-4 py-2 text-xs font-bold text-emerald-950 transition hover:bg-yellow-300 disabled:opacity-60"
                  >
                    {addingStaff ? (
                      <>
                        <span className="h-3 w-3 animate-spin rounded-full border-2 border-emerald-200 border-t-transparent" />
                        <span>Creating...</span>
                      </>
                    ) : (
                      <>
                        <UserPlus size={14} />
                        <span>Create Staff Account</span>
                      </>
                    )}
                  </button>
                </div>
              </form>
            ) : (
              <div className="mt-5 space-y-4">
                <div className="rounded-xl border border-emerald-200 bg-white p-4">
                  <p className="font-bold text-emerald-950">
                    {addStaffResult.fullName}
                  </p>
                  <p className="mt-0.5 font-mono text-xs text-emerald-900">
                    {addStaffResult.email}
                  </p>
                  <p className="mt-1 text-[11px] uppercase tracking-wider text-emerald-700">
                    {addStaffResult.role === "registrar"
                      ? "Registrar"
                      : "Staff"}
                  </p>
                </div>

                <div
                  className={`rounded-xl border p-4 text-xs leading-relaxed ${addStaffResult.emailSent
                    ? "border-emerald-200 bg-emerald-50 text-emerald-700"
                    : "border-amber-200 bg-amber-50 text-amber-700"
                    }`}
                >
                  {addStaffResult.emailSent ? (
                    <p>
                      Setup email sent. The staff member can create their
                      password using the link in their inbox.
                    </p>
                  ) : (
                    <div className="space-y-1">
                      <p className="font-semibold">
                        The account was created, but the setup email could not
                        be sent.
                      </p>
                      {addStaffResult.warning && (
                        <p className="text-[11px] opacity-90">
                          {addStaffResult.warning}
                        </p>
                      )}
                    </div>
                  )}
                </div>

                {addStaffResult.restored && (
                  <p className="rounded-xl border border-emerald-200 bg-emerald-50 p-3 text-[11px] leading-relaxed text-emerald-700">
                    A previous removal record for this email was cleared so the
                    account can sign in and reset its password again.
                  </p>
                )}

                {!addStaffResult.emailSent && addStaffResult.setupUrl && (
                  <div>
                    <label
                      htmlFor="fallbackSetupLink"
                      className="mb-1.5 block text-[11px] font-bold uppercase tracking-wider text-emerald-900"
                    >
                      Fallback Setup Link
                    </label>
                    <div className="flex gap-2">
                      <input
                        id="fallbackSetupLink"
                        type="text"
                        readOnly
                        value={addStaffResult.setupUrl}
                        onFocus={(e) => e.currentTarget.select()}
                        className="min-w-0 flex-1 rounded-lg border border-emerald-200 bg-white px-3 py-2 font-mono text-[10px] text-emerald-900 outline-none focus:border-emerald-200"
                      />
                      <button
                        type="button"
                        onClick={copySetupLink}
                        className="inline-flex shrink-0 items-center gap-1.5 rounded-lg border border-emerald-200 bg-amber-50 px-3 py-2 text-xs font-semibold text-emerald-700 transition hover:bg-amber-50"
                      >
                        <Copy size={13} />
                        <span>{setupLinkCopied ? "Copied" : "Copy"}</span>
                      </button>
                    </div>
                    <p className="mt-1.5 text-[10px] leading-relaxed text-emerald-800">
                      Share this one-time link only with the intended staff
                      member. It expires after use.
                    </p>
                  </div>
                )}

                <div className="mt-6 flex flex-wrap justify-end gap-3">
                  {!addStaffResult.emailSent && (
                    <button
                      type="button"
                      onClick={resendStaffSetup}
                      disabled={resendingSetup}
                      className="inline-flex items-center gap-2 rounded-lg border border-emerald-200 bg-amber-50 px-4 py-2 text-xs font-semibold text-emerald-700 transition hover:bg-amber-50 disabled:opacity-60"
                    >
                      {resendingSetup ? (
                        <>
                          <span className="h-3 w-3 animate-spin rounded-full border-2 border-emerald-200 border-t-transparent" />
                          <span>Sending...</span>
                        </>
                      ) : (
                        <>
                          <Send size={14} />
                          <span>Resend Setup Email</span>
                        </>
                      )}
                    </button>
                  )}

                  <button
                    type="button"
                    onClick={closeAddStaffModal}
                    disabled={resendingSetup}
                    className="rounded-lg bg-yellow-400 px-4 py-2 text-xs font-bold text-emerald-950 transition hover:bg-yellow-300 disabled:opacity-60"
                  >
                    Done
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Confirmation Modal */}
      {userToDelete && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 p-4 backdrop-blur-xs">
          <div className="w-full max-w-md rounded-2xl border border-emerald-200 bg-white p-6 text-emerald-700 shadow-2xl">
            <div className="flex items-center gap-3">
              <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full border border-red-200 bg-red-50 text-red-700">
                <ShieldAlert size={24} />
              </div>
              <div>
                <h3 className="text-lg font-bold text-emerald-950">
                  Remove User Account
                </h3>
                <p className="text-xs text-emerald-900">
                  Please confirm before removing this account
                </p>
              </div>
            </div>

            <div className="mt-5 rounded-xl border border-red-200 bg-red-50 p-4 text-xs leading-relaxed text-red-700">
              <p>
                Are you sure you want to remove the account for:
              </p>
              <div className="mt-2.5 rounded-lg border border-emerald-200 bg-white p-3 text-xs">
                <p className="font-bold text-emerald-950">{userToDelete.fullName}</p>
                <p className="mt-0.5 font-mono text-emerald-900">{userToDelete.email}</p>
                <p className="mt-1 text-[11px] text-emerald-700">
                  Role: <span className="uppercase">{userToDelete.role}</span> · Date &amp; Time Created: {formatPhilippineDateTime(userToDelete.createdAt)}
                </p>
              </div>
              <p className="mt-3 text-[11px] text-emerald-900">
                ⚠️ This will revoke their portal sign-in credentials.
                <br />
                {userToDelete.role.trim().toLowerCase() === "student" ? (
                  <span className="font-semibold text-emerald-700">
                    Note: This student&apos;s enrollment records will be removed
                    from all staff dashboards and enrollment lists. The student
                    can still enroll again in the future.
                  </span>
                ) : (
                  <span className="font-semibold text-emerald-700">
                    Note: Any submitted student enrollment applications and
                    uploaded documents will be safely preserved.
                  </span>
                )}
              </p>
            </div>

            <div className="mt-6 flex justify-end gap-3">
              <button
                type="button"
                disabled={deleting}
                onClick={() => setUserToDelete(null)}
                className="rounded-lg border border-emerald-200 px-4 py-2 text-xs font-semibold text-emerald-700 transition hover:bg-emerald-50 disabled:opacity-50"
              >
                Cancel
              </button>

              <button
                type="button"
                disabled={deleting}
                onClick={confirmDeleteUser}
                className="inline-flex items-center gap-2 rounded-lg bg-red-600 px-4 py-2 text-xs font-bold text-emerald-950 transition hover:bg-red-500 disabled:opacity-60"
              >
                {deleting ? (
                  <>
                    <span className="h-3 w-3 animate-spin rounded-full border-2 border-emerald-200 border-t-transparent" />
                    <span>Removing...</span>
                  </>
                ) : (
                  <>
                    <Trash2 size={14} />
                    <span>Confirm Removal</span>
                  </>
                )}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
