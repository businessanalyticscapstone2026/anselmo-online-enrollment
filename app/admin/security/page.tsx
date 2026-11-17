import { requireAdminSetupAccess } from "@/lib/auth/server";
import { adminRequiresTotp } from "@/lib/auth/mfaToken";
import { AdminSecuritySetup } from "./AdminSecuritySetup";

export const dynamic = "force-dynamic";

export default async function AdminSecurityPage() {
  const context = await requireAdminSetupAccess();

  return (
    <AdminSecuritySetup
      email={context.user?.email || context.profile?.email || ""}
      fullName={context.profile?.full_name || ""}
      totpRequired={adminRequiresTotp()}
    />
  );
}
