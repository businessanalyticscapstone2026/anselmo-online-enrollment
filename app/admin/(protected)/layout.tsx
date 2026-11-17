import { requirePortalAccess } from "@/lib/auth/server";
import AdminDashboardShell from "./AdminDashboardShell";

export default async function AdminProtectedLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const { profile, user } = await requirePortalAccess("admin");

  const metadataName =
    typeof user?.user_metadata?.full_name === "string"
      ? user.user_metadata.full_name
      : null;

  const adminName =
    profile?.full_name || metadataName || user?.email || "ICT Administrator";

  return (
    <AdminDashboardShell adminName={adminName}>
      {children}
    </AdminDashboardShell>
  );
}
