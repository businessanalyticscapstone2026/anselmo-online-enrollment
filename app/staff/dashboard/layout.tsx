import { requirePortalAccess } from "@/lib/auth/server";
import StaffDashboardShell from "./StaffDashboardShell";

export default async function StaffDashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const { profile, user } = await requirePortalAccess("staff");

  const metadataName =
    typeof user?.user_metadata?.full_name === "string"
      ? user.user_metadata.full_name
      : null;

  const staffName =
    profile?.full_name || metadataName || user?.email || "Registrar";

  return (
    <StaffDashboardShell staffName={staffName}>{children}</StaffDashboardShell>
  );
}
