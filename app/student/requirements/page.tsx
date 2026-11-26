import { redirect } from "next/navigation";
import { requireStudentAccess } from "@/lib/auth/server";
import { getStudentDashboardData } from "@/lib/studentDashboardData";
import { normalizeEnrollmentStatus } from "@/lib/enrollmentStatus";
import ResubmitRequirementsForm from "./ResubmitRequirementsForm";

export const dynamic = "force-dynamic";

export default async function StudentRequirementsPage() {
  const { user, profile } = await requireStudentAccess();

  if (!user) {
    return null;
  }

  const email = profile?.email || user.email || "";
  const { application } = await getStudentDashboardData({
    userId: user.id,
    email,
  });

  if (
    !application ||
    normalizeEnrollmentStatus(application.status) !== "denied"
  ) {
    redirect("/student/dashboard");
  }

  const remarks =
    typeof application.registrar_remarks === "string"
      ? application.registrar_remarks
      : "";

  return <ResubmitRequirementsForm remarks={remarks} />;
}
