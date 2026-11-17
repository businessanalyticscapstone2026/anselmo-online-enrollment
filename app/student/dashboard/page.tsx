import { requireStudentAccess } from "@/lib/auth/server";
import { getStudentDashboardData } from "@/lib/studentDashboardData";
import StudentDashboardView from "./StudentDashboardView";

export const dynamic = "force-dynamic";

export default async function StudentDashboardPage() {
  const { user, profile } = await requireStudentAccess();

  if (!user) {
    return null;
  }

  const email = profile?.email || user.email || "";

  const { application, section, studentProfile } = await getStudentDashboardData({
    userId: user.id,
    email,
  });

  const metadata = user.user_metadata ?? {};
  const nameFromApplication = [
    application?.first_name,
    application?.middle_name,
    application?.last_name,
  ]
    .filter(Boolean)
    .join(" ");

  const fullName =
    profile?.full_name ||
    (typeof metadata.full_name === "string" ? metadata.full_name : "") ||
    nameFromApplication ||
    "Student";

  return (
    <StudentDashboardView
      userId={user.id}
      email={email}
      fullName={fullName}
      initialApplication={application}
      initialSection={section}
      initialStudentProfile={studentProfile}
      fallbackTrack={
        typeof metadata.track === "string" ? metadata.track : ""
      }
    />
  );
}
