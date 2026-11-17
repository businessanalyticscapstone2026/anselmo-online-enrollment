import type { Metadata } from "next";
import LegalDocument from "@/app/_components/LegalDocument";
import { TERMS_AND_CONDITIONS } from "@/lib/legal";

export const metadata: Metadata = {
  title: "Terms and Conditions | AASMNHS Online Enrollment System",
  description:
    "Terms and Conditions for the Anselmo A. Sandoval Memorial National High School (AASMNHS) Online Enrollment System.",
};

export default function TermsPage() {
  return (
    <LegalDocument
      title="Terms and Conditions"
      intro="Please read these Terms and Conditions carefully before using the AASMNHS Online Enrollment System."
      sections={TERMS_AND_CONDITIONS}
    />
  );
}
