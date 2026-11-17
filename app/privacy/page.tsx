import type { Metadata } from "next";
import LegalDocument from "@/app/_components/LegalDocument";
import { PRIVACY_NOTICE } from "@/lib/legal";

export const metadata: Metadata = {
  title: "Privacy Notice | AASMNHS Online Enrollment System",
  description:
    "Privacy Notice describing how the Anselmo A. Sandoval Memorial National High School (AASMNHS) Online Enrollment System collects and processes personal data.",
};

export default function PrivacyPage() {
  return (
    <LegalDocument
      title="Privacy Notice"
      intro="This Privacy Notice explains how the school collects, uses, stores, and protects the personal information you provide through the AASMNHS Online Enrollment System."
      sections={PRIVACY_NOTICE}
    />
  );
}
