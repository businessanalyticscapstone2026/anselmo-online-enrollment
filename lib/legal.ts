export interface LegalSection {
  heading: string;
  body: string;
}

export const LEGAL_DOCUMENT_TITLE =
  "Anselmo A. Sandoval Memorial National High School (AASMNHS) Online Enrollment System";

export const LEGAL_REVIEW_NOTICE =
  "This document is subject to review and approval by the school administration before deployment.";

export const TERMS_AND_CONDITIONS: LegalSection[] = [
  {
    heading: "Accurate Information",
    body: "Applicants must provide complete, correct, and truthful information in the enrollment form.",
  },
  {
    heading: "Required Documents",
    body: "Applicants must upload clear, valid, and complete enrollment requirements.",
  },
  {
    heading: "Application Review",
    body: "All submitted applications are subject to verification and approval by authorized school personnel. Submission does not guarantee enrollment.",
  },
  {
    heading: "Account Security",
    body: "Students are responsible for keeping their login credentials confidential and must not share their passwords with others.",
  },
  {
    heading: "Data Privacy",
    body: "Personal information and uploaded documents will be used only for legitimate school and enrollment-related purposes, in accordance with the Data Privacy Act of 2012 (RA 10173).",
  },
  {
    heading: "Enrollment Period",
    body: "Applications are accepted only during the official enrollment period set by the school. Once enrollment closes, new applications will no longer be accepted unless the school reopens enrollment.",
  },
  {
    heading: "Proper System Use",
    body: "Users must use the system responsibly and must not submit false information, fraudulent documents, or attempt unauthorized access.",
  },
  {
    heading: "Agreement",
    body: "By checking the agreement box and submitting your application, you confirm that you have read, understood, and agreed to these Terms and Conditions.",
  },
];

export const PRIVACY_NOTICE: LegalSection[] = [
  {
    heading: "Information We Collect",
    body: "We collect the personal information you provide in the enrollment form, including your name, birth date, address, contact details, guardian information, and the enrollment requirements you upload (such as report cards and identification documents).",
  },
  {
    heading: "Purpose of Collection",
    body: "Your information is collected and processed to evaluate and process your enrollment application, verify your eligibility, maintain student records, and communicate official school updates related to your enrollment.",
  },
  {
    heading: "Legal Basis",
    body: "We process your personal information in accordance with the Data Privacy Act of 2012 (RA 10173), its Implementing Rules and Regulations, and other applicable issuances, based on your consent and the school's legitimate educational purposes.",
  },
  {
    heading: "Storage and Retention",
    body: "Your information and uploaded documents are stored securely and retained only for as long as necessary to fulfill the purposes above or as required by law, after which they are securely disposed of.",
  },
  {
    heading: "Access and Disclosure",
    body: "Only authorized school personnel have access to your information. We do not sell or share your information with third parties, except when required by law or with your consent.",
  },
  {
    heading: "Security Measures",
    body: "We implement reasonable organizational, physical, and technical measures to protect your personal information against unauthorized access, alteration, disclosure, or destruction.",
  },
  {
    heading: "Your Rights",
    body: "As a data subject, you have the right to be informed, to object, to access, to rectify, to erase or block, to damages, to file a complaint, and to data portability under the Data Privacy Act.",
  },
  {
    heading: "Contact",
    body: "For questions or requests regarding your personal data, please contact the school's Data Protection Officer or the school administration office.",
  },
];
