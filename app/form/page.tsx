"use client";

import Image from "next/image";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useEffect, useState } from "react";
import EnrollmentProgress from "@/app/_components/EnrollmentProgress";
import LegalModal, { type LegalKind } from "@/app/_components/LegalModal";
import {
  getCanonicalCluster,
  getTrackConfig,
  getTrackLabel,
  isValidClusterForTrack,
} from "@/lib/clusters";

interface AddressState {
  houseNo: string;
  street: string;
  barangay: string;
  municipality: string;
  province: string;
  country: string;
  zipCode: string;
}

interface GuardianState {
  lastName: string;
  firstName: string;
  middleName: string;
  contactNumber: string;
}

const initialAddress: AddressState = {
  houseNo: "",
  street: "",
  barangay: "",
  municipality: "",
  province: "",
  country: "Philippines",
  zipCode: "",
};

const initialGuardian: GuardianState = {
  lastName: "",
  firstName: "",
  middleName: "",
  contactNumber: "",
};

const NAME_CHARACTERS = /[^A-Za-zÀ-ÖØ-öø-ÿ.'’\-\s]/g;
const TEXT_CHARACTERS = /[^A-Za-zÀ-ÖØ-öø-ÿ.,'’/&\-\s]/g;
const TEXT_AND_NUMBER_CHARACTERS = /[^A-Za-zÀ-ÖØ-öø-ÿ0-9.,'’/&\-\s]/g;
const NON_DIGITS = /\D/g;
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const CONTACT_PATTERN = /^\d{11}$/;
const ZIP_PATTERN = /^\d{4}$/;

function capitalizeWords(value: string): string {
  return value.replace(
    /(^|\s)(\S)/g,
    (_match, separator: string, character: string) =>
      separator + character.toUpperCase()
  );
}

function keepNameCharacters(value: string, maxLength = 100): string {
  return capitalizeWords(value.replace(NAME_CHARACTERS, "").slice(0, maxLength));
}

function keepTextCharacters(value: string, maxLength = 150): string {
  return capitalizeWords(value.replace(TEXT_CHARACTERS, "").slice(0, maxLength));
}

function keepTextAndNumberCharacters(value: string, maxLength = 150): string {
  return capitalizeWords(
    value.replace(TEXT_AND_NUMBER_CHARACTERS, "").slice(0, maxLength)
  );
}

function keepDigits(value: string, maxLength = 11): string {
  return value.replace(NON_DIGITS, "").slice(0, maxLength);
}

function keepEmailCharacters(value: string): string {
  return value.replace(/\s/g, "").slice(0, 254);
}

function containsDigit(value: string): boolean {
  return /\d/.test(value);
}

function FormContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const trackParam = searchParams.get("track") || "";
  const clusterParam = searchParams.get("cluster") || "";
  const trackConfig = getTrackConfig(trackParam);
  const selectedTrack = trackConfig?.value ?? "";
  const selectedCluster = getCanonicalCluster(trackParam, clusterParam);
  const hasValidSelection =
    Boolean(trackConfig) && isValidClusterForTrack(trackParam, clusterParam);

  useEffect(() => {
    if (hasValidSelection) return;

    router.replace(
      trackConfig ? `/enroll/cluster?track=${trackConfig.value}` : "/enroll"
    );
  }, [hasValidSelection, trackConfig, router]);

  // Student basic information states
  const [lastName, setLastName] = useState(() =>
    typeof window !== "undefined"
      ? keepNameCharacters(localStorage.getItem("studentLastName") || "")
      : ""
  );
  const [firstName, setFirstName] = useState(() =>
    typeof window !== "undefined"
      ? keepNameCharacters(localStorage.getItem("studentFirstName") || "")
      : ""
  );
  const [middleName, setMiddleName] = useState("");
  const [extension, setExtension] = useState("");
  const [email, setEmail] = useState(() => (typeof window !== "undefined" ? localStorage.getItem("studentEmail") || "" : ""));
  const [dob, setDob] = useState("");
  const [pob, setPob] = useState("");
  const [gender, setGender] = useState("");
  const [religion, setReligion] = useState("");
  const [contactNumber, setContactNumber] = useState("");

  // Address state management
  const [currentAddress, setCurrentAddress] = useState<AddressState>(initialAddress);
  const [permanentAddress, setPermanentAddress] = useState<AddressState>(initialAddress);
  const [sameAsCurrentAddress, setSameAsCurrentAddress] = useState(false);

  // Social information
  const [isIpCommunity, setIsIpCommunity] = useState(false);
  const [is4psBeneficiary, setIs4psBeneficiary] = useState(false);

  // Parent / guardian information
  const [guardians, setGuardians] = useState<GuardianState[]>([
    { ...initialGuardian },
    { ...initialGuardian },
    { ...initialGuardian },
  ]);

  // Submission state
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [agreedToTerms, setAgreedToTerms] = useState(false);
  const [legalModal, setLegalModal] = useState<LegalKind | null>(null);
  const [validationError, setValidationError] = useState("");
  const [submissionError, setSubmissionError] = useState<{
    kind: "connection" | "schema" | "general";
    message: string;
  } | null>(null);


  const handleGuardianChange = (
    index: number,
    field: keyof GuardianState,
    value: string
  ) => {
    setGuardians((prev) =>
      prev.map((guardian, i) =>
        i === index ? { ...guardian, [field]: value } : guardian
      )
    );
  };

  // Handle current address changes
  const handleCurrentAddressChange = (field: keyof AddressState, value: string) => {
    setCurrentAddress((prev) => {
      const updated = { ...prev, [field]: value };
      if (sameAsCurrentAddress) {
        setPermanentAddress(updated);
      }
      return updated;
    });
  };

  // Handle toggle of "Same as Current Address" checkbox
  const handleSameAddressToggle = (checked: boolean) => {
    setSameAsCurrentAddress(checked);
    if (checked) {
      setPermanentAddress({ ...currentAddress });
    }
  };

  // Handle permanent address changes when not locked
  const handlePermanentAddressChange = (field: keyof AddressState, value: string) => {
    setPermanentAddress((prev) => ({ ...prev, [field]: value }));
  };

  function validateForm(): string {
    if (!lastName.trim() || !firstName.trim()) {
      return "Last name and first name are required.";
    }

    const textOnlyFields: Array<[string, string]> = [
      ["Last name", lastName],
      ["First name", firstName],
      ["Middle name", middleName],
      ["Extension", extension],
      ["Place of birth", pob],
      ["Religion", religion],
    ];
    const invalidTextField = textOnlyFields.find(([, value]) => containsDigit(value));

    if (invalidTextField) {
      return `${invalidTextField[0]} must contain letters only.`;
    }

    if (!EMAIL_PATTERN.test(email.trim())) {
      return "Please enter a valid email address.";
    }

    if (!dob) {
      return "Date of birth is required.";
    }

    const parsedDob = new Date(`${dob}T00:00:00Z`);

    if (
      Number.isNaN(parsedDob.getTime()) ||
      parsedDob.toISOString().slice(0, 10) !== dob ||
      parsedDob > new Date()
    ) {
      return "Please enter a valid date of birth that is not in the future.";
    }

    if (!pob.trim()) {
      return "Place of birth is required.";
    }

    if (gender !== "male" && gender !== "female") {
      return "Please select Male or Female.";
    }

    if (!CONTACT_PATTERN.test(contactNumber)) {
      return "Contact number must contain exactly 11 digits.";
    }

    if (
      !currentAddress.barangay.trim() ||
      !currentAddress.municipality.trim() ||
      !currentAddress.province.trim()
    ) {
      return "Please complete the current address (barangay, municipality/city, province).";
    }

    if (currentAddress.zipCode && !ZIP_PATTERN.test(currentAddress.zipCode)) {
      return "ZIP code must contain exactly 4 digits.";
    }

    if (
      !sameAsCurrentAddress &&
      (!permanentAddress.barangay.trim() ||
        !permanentAddress.municipality.trim() ||
        !permanentAddress.province.trim())
    ) {
      return "Please complete the permanent address (barangay, municipality/city, province).";
    }

    if (
      !sameAsCurrentAddress &&
      permanentAddress.zipCode &&
      !ZIP_PATTERN.test(permanentAddress.zipCode)
    ) {
      return "Permanent ZIP code must contain exactly 4 digits.";
    }

    const addressTextFields: Array<[string, string]> = [
      ["Street", currentAddress.street],
      ["Municipality / City", currentAddress.municipality],
      ["Province", currentAddress.province],
      ["Country", currentAddress.country],
      ...(sameAsCurrentAddress
        ? []
        : ([
          ["Permanent street", permanentAddress.street],
          ["Permanent municipality / city", permanentAddress.municipality],
          ["Permanent province", permanentAddress.province],
          ["Permanent country", permanentAddress.country],
        ] as Array<[string, string]>)),
    ];
    const invalidAddressField = addressTextFields.find(([, value]) =>
      containsDigit(value)
    );

    if (invalidAddressField) {
      return `${invalidAddressField[0]} must contain letters only.`;
    }

    const guardianLabels = ["Father", "Mother", "Legal Guardian"];

    for (let index = 0; index < guardianLabels.length; index++) {
      const guardian = guardians[index];
      const label = guardianLabels[index];

      if (!guardian) {
        return `${label}'s information is required.`;
      }

      const missingGuardianFields = [
        ["last name", guardian.lastName],
        ["first name", guardian.firstName],
        ["middle name", guardian.middleName],
        ["contact number", guardian.contactNumber],
      ]
        .filter(([, value]) => !value.trim())
        .map(([field]) => field);

      if (missingGuardianFields.length > 0) {
        return `${label}'s information is missing: ${missingGuardianFields.join(", ")}.`;
      }

      if (!CONTACT_PATTERN.test(guardian.contactNumber)) {
        return `${label}'s contact number must contain exactly 11 digits.`;
      }

      const invalidGuardianName = [
        ["last name", guardian.lastName],
        ["first name", guardian.firstName],
        ["middle name", guardian.middleName],
      ].find(([, value]) => containsDigit(value));

      if (invalidGuardianName) {
        return `${label}'s ${invalidGuardianName[0]} must contain letters only.`;
      }
    }

    if (!agreedToTerms) {
      return "You must read and agree to the Terms and Conditions before submitting your application.";
    }

    return "";
  }

  const handleContinue = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (isSubmitting) return;

    const formValidationMessage = validateForm();

    if (formValidationMessage) {
      setValidationError(formValidationMessage);
      setSubmissionError(null);
      window.setTimeout(() => {
        document
          .getElementById("form-validation-error")
          ?.scrollIntoView({ behavior: "smooth", block: "center" });
      }, 0);
      return;
    }

    setValidationError("");
    const cleanCurrentAddress = { ...currentAddress };
    const cleanPermanentAddress = sameAsCurrentAddress
      ? { ...currentAddress }
      : { ...permanentAddress };

    const applicationDraft = {
      firstName: firstName.trim(),
      middleName: middleName.trim(),
      lastName: lastName.trim(),
      extension: extension.trim(),
      email: email.trim().toLowerCase(),
      birthDate: dob,
      placeOfBirth: pob.trim(),
      gender,
      religion: religion.trim(),
      contactNumber: contactNumber.trim(),
      selectedTrack,
      selectedCluster,
      isIpCommunity,
      is4psBeneficiary,
      currentAddress: cleanCurrentAddress,
      permanentAddress: cleanPermanentAddress,
      sameAsCurrentAddress,
      guardians: guardians.map((guardian) => ({
        lastName: guardian.lastName.trim(),
        firstName: guardian.firstName.trim(),
        middleName: guardian.middleName.trim(),
        contactNumber: guardian.contactNumber.trim(),
      })),
    };

    setIsSubmitting(true);
    setSubmissionError(null);

    try {
      const response = await fetch("/api/submit-application", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(applicationDraft),
      });

      const result = await response.json().catch(() => null);

      if (!response.ok || !result?.success || !result?.id) {
        throw new Error(
          result?.message ||
          `The application could not be saved. Server returned ${response.status}.`
        );
      }

      // Clear credentials from any previous enrollment before storing the new one.
      localStorage.removeItem("studentPassword");
      localStorage.removeItem("studentPasswordApplicationId");
      localStorage.removeItem("studentAccountEmailPending");
      localStorage.removeItem("emailMessage");

      // Store local draft and IDs only after the server confirms the database save.
      localStorage.setItem(
        "studentApplicationDraft",
        JSON.stringify({
          ...applicationDraft,
          savedAt: new Date().toISOString(),
        })
      );
      localStorage.setItem("studentEmail", applicationDraft.email);
      localStorage.setItem("studentFirstName", applicationDraft.firstName);
      localStorage.setItem("studentLastName", applicationDraft.lastName);
      localStorage.setItem(
        "studentName",
        `${applicationDraft.firstName} ${applicationDraft.lastName}`.trim()
      );
      localStorage.setItem(
        "studentContactNumber",
        applicationDraft.contactNumber
      );
      localStorage.setItem("studentTrack", selectedTrack);
      localStorage.setItem("studentCluster", selectedCluster);
      localStorage.setItem("applicationId", String(result.id));
      localStorage.setItem("enrollmentId", String(result.id));
      localStorage.setItem("applicationId", result.id);

      if (result.emailSent === false) {
        localStorage.setItem("studentAccountEmailPending", "true");
      } else {
        localStorage.removeItem("studentAccountEmailPending");
      }

      router.push(
        `/enroll/requirements?track=${encodeURIComponent(
          selectedTrack
        )}&cluster=${encodeURIComponent(selectedCluster)}`
      );
    } catch (error) {
      const message =
        error instanceof Error
          ? error.message
          : "An unexpected error occurred while submitting your application.";

      const lowerMessage = message.toLowerCase();
      const kind =
        lowerMessage.includes("fetch") ||
          lowerMessage.includes("network") ||
          lowerMessage.includes("supabase host")
          ? "connection"
          : lowerMessage.includes("column") ||
            lowerMessage.includes("schema cache") ||
            lowerMessage.includes("student_details")
            ? "schema"
            : "general";

      setSubmissionError({ kind, message });
    } finally {
      setIsSubmitting(false);
    }
  };

  if (!hasValidSelection) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-[#eaf5ec] text-[#06281b]">
        <div className="text-center animate-fade-in-up">
          <div className="mx-auto h-8 w-8 animate-spin rounded-full border-2 border-emerald-200 border-t-transparent" />
          <p className="mt-3 text-sm font-semibold">
            Loading your enrollment details...
          </p>
        </div>
      </main>
    );
  }

  return (
    <main className="relative min-h-screen overflow-hidden bg-[#0b3d2e] text-emerald-50">
      {/* Background School Image */}
      <div
        className="fixed inset-0 bg-cover bg-center opacity-40 brightness-75 pointer-events-none"
        style={{
          backgroundImage: "url('/school.jpg')",
        }}
      />

      {/* Dark Green Gradient Overlay with Khaki Ambient Tints */}
      <div className="fixed inset-0 bg-linear-to-b from-[#0b3d2e]/75 via-[#0b3d2e]/60 to-[#052e1c]/85 pointer-events-none" />

      {/* Ambient Glows */}
      <div className="pointer-events-none fixed -top-40 left-1/2 h-96 w-180 -translate-x-1/2 rounded-full bg-yellow-400/10 blur-3xl" />
      <div className="pointer-events-none fixed top-1/3 -right-20 h-96 w-96 rounded-full bg-emerald-600/20 blur-3xl" />
      <div className="pointer-events-none fixed bottom-10 -left-20 h-96 w-96 rounded-full bg-yellow-400/10 blur-3xl" />

      {/* Page Content */}
      <div className="relative z-10 flex min-h-screen flex-col">
        {/* Sticky Header */}
        <header className="sticky top-0 z-50 w-full border-b border-emerald-800/70 bg-[#0b3d2e]/75 backdrop-blur-md">
          <div className="mx-auto flex max-w-6xl items-center justify-between px-6 py-4">
            {/* School Logo & Title */}
            <Link href="/" className="group flex items-center gap-3.5">
              <div className="relative flex h-11 w-11 items-center justify-center overflow-hidden rounded-full shadow-md ring-2 ring-yellow-400/60 ring-offset-2 ring-offset-[#0b3d2e] transition-transform group-hover:scale-105">
                <Image
                  src="/school-logo-trimmed.png"
                  alt="AASMNHS School Logo"
                  width={44}
                  height={44}
                  className="h-full w-full object-cover"
                  priority
                />
              </div>

              <div>
                <p className="text-base font-bold tracking-wide text-white">
                  AASMNHS
                </p>
                <p className="text-xs font-medium text-emerald-200">
                  Online Enrollment System
                </p>
              </div>
            </Link>
          </div>
        </header>

        <EnrollmentProgress activeStep={3} />

        {/* Main Content Area */}
        <section className="mx-auto w-full max-w-5xl flex-1 px-4 py-10 sm:px-6 sm:py-12">
          {/* Universal School Headings Banner */}
          <div className="text-center">
            {/* Status Pill Badge */}
            <div className="mb-6 inline-flex items-center gap-2.5 rounded-full border border-emerald-200 bg-emerald-50/80 px-4 py-1.5 text-xs font-semibold uppercase tracking-wider text-emerald-700 backdrop-blur-md shadow-lg shadow-black/20">
              <span className="relative flex h-2 w-2">
                <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-yellow-300 opacity-75"></span>
                <span className="relative inline-flex h-2 w-2 rounded-full bg-yellow-300"></span>
              </span>
              Grade 11 Online Enrollment • S.Y. 2026–2027
            </div>

            {/* School Name */}
            <h1 className="text-3xl font-extrabold leading-tight tracking-tight text-white drop-shadow-lg sm:text-4xl md:text-5xl lg:text-6xl">
              Anselmo A. Sandoval Memorial
              <span className="mt-1 block bg-linear-to-r from-yellow-300 via-yellow-400 to-emerald-300 bg-clip-text text-transparent">
                National High School
              </span>
            </h1>

            {/* Portal Subtitle */}
            <div className="mt-4 flex items-center justify-center gap-3">
              <span className="h-px w-10 bg-linear-to-r from-transparent to-yellow-300/70 sm:w-16" />
              <h2 className="text-lg font-semibold tracking-wide text-emerald-100 sm:text-xl md:text-2xl">
                Online Enrollment System
              </h2>
              <span className="h-px w-10 bg-linear-to-l from-transparent to-yellow-300/70 sm:w-16" />
            </div>

            {/* Step 3 Heading Box */}
            <div className="mt-8 rounded-xl border border-emerald-200 bg-emerald-50/70 p-5 backdrop-blur-md shadow-lg">
              <h3 className="text-xl font-bold text-emerald-700 sm:text-2xl">
                Step 3: Personal Information
              </h3>
              <p className="mx-auto mt-2 max-w-2xl text-sm leading-relaxed text-emerald-700/90 sm:text-base">
                Please provide the student&apos;s complete and accurate information to continue the enrollment process.
              </p>
            </div>
          </div>

          {/* Form Container - Pure White Background for High Contrast & Readability */}
          <form
            onSubmit={handleContinue}
            className="mt-10 rounded-2xl border border-gray-200 bg-white p-6 shadow-2xl sm:p-10 text-gray-900 ring-1 ring-black/5"
          >
            {validationError && (
              <div
                id="form-validation-error"
                role="alert"
                className="mb-8 flex items-start gap-3 rounded-xl border-2 border-red-300 bg-red-50 p-4 text-sm text-red-950"
              >
                <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-red-600 text-xs font-black text-white">
                  !
                </span>
                <div>
                  <p className="font-bold">Please check the form</p>
                  <p className="mt-1 text-xs text-red-800">{validationError}</p>
                </div>
              </div>
            )}

            {/* SELECTED TRACK & CLUSTER */}
            <section className="mb-10">
              <div className="flex flex-col gap-2 border-b border-gray-200 pb-3 sm:flex-row sm:items-center sm:justify-between">
                <h4 className="flex items-center gap-2 text-lg font-bold text-emerald-900 sm:text-xl">

                </h4>
                <div className="flex items-center gap-4">
                  <Link
                    href="/enroll"
                    className="text-xs font-semibold text-emerald-700 underline underline-offset-4 transition hover:text-emerald-900"
                  >
                    Change Track
                  </Link>
                  <Link
                    href={`/enroll/cluster?track=${selectedTrack}`}
                    className="text-xs font-semibold text-emerald-700 underline underline-offset-4 transition hover:text-emerald-900"
                  >
                    Change Cluster
                  </Link>
                </div>
              </div>

              <div className="mt-4 grid gap-4 sm:grid-cols-2">
                <div className="rounded-xl border border-emerald-100 bg-emerald-50 p-5">
                  <p className="text-xs font-semibold uppercase tracking-wider text-emerald-700">
                    Enrolled Senior High Track
                  </p>
                  <p className="mt-1 text-lg font-bold text-emerald-900 sm:text-xl">
                    {getTrackLabel(selectedTrack)}
                  </p>
                </div>

                <div className="rounded-xl border border-emerald-100 bg-emerald-50 p-5">
                  <p className="text-xs font-semibold uppercase tracking-wider text-emerald-700">
                    Selected Elective Cluster
                  </p>
                  <p className="mt-1 text-lg font-bold text-emerald-900 sm:text-xl">
                    {selectedCluster}
                  </p>
                  <span className="mt-3 inline-block rounded-lg bg-emerald-100 px-3 py-1 text-[10px] font-bold uppercase tracking-wider text-emerald-900 ring-1 ring-emerald-300">
                    Confirmed Selection
                  </span>
                </div>
              </div>
            </section>

            {/* STUDENT NAME */}
            <section className="mb-10">
              <h4 className="mb-5 flex items-center gap-2 border-b border-gray-200 pb-3 text-lg font-bold text-emerald-900 sm:text-xl">
                Student Name
              </h4>

              <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-4">
                <FormInput
                  label="LAST NAME"
                  placeholder="Dela Cruz"
                  value={lastName}
                  onChange={(e) => setLastName(keepNameCharacters(e.target.value))}
                  required
                  minLength={2}
                  maxLength={100}
                  autoComplete="family-name"
                />
                <FormInput
                  label="FIRST NAME"
                  placeholder="Juan Miguel"
                  value={firstName}
                  onChange={(e) => setFirstName(keepNameCharacters(e.target.value))}
                  required
                  minLength={2}
                  maxLength={100}
                  autoComplete="given-name"
                />
                <FormInput
                  label="MIDDLE NAME"
                  placeholder="Santos"
                  value={middleName}
                  onChange={(e) => setMiddleName(keepNameCharacters(e.target.value))}
                  maxLength={100}
                  autoComplete="additional-name"
                />
                <FormInput
                  label="EXTENSION (JR., III, ETC.)"
                  placeholder="e.g. Jr."
                  value={extension}
                  onChange={(e) => setExtension(keepNameCharacters(e.target.value, 30))}
                  maxLength={30}
                />
              </div>
            </section>

            {/* BASIC INFORMATION */}
            <section className="mb-10">
              <h4 className="mb-5 flex items-center gap-2 border-b border-gray-200 pb-3 text-lg font-bold text-emerald-900 sm:text-xl">
                Basic Information
              </h4>

              <div className="grid gap-5 sm:grid-cols-2">
                <div>
                  <FormInput
                    label="EMAIL ADDRESS"
                    type="email"
                    value={email}
                    onChange={(e) => setEmail(keepEmailCharacters(e.target.value))}
                    placeholder="student@email.com"
                    required
                    maxLength={254}
                    autoComplete="email"
                  />
                  <p className="mt-1 text-xs text-gray-500">
                    Your account password and confirmation will be automatically sent to this email address.
                  </p>
                </div>

                <FormInput
                  label="DATE OF BIRTH"
                  type="date"
                  value={dob}
                  onChange={(e) => setDob(e.target.value)}
                  required
                />

                <FormInput
                  label="PLACE OF BIRTH (MUNICIPALITY/CITY)"
                  placeholder="e.g., Mabini, Batangas"
                  value={pob}
                  onChange={(e) => setPob(keepTextCharacters(e.target.value, 200))}
                  required
                  minLength={2}
                  maxLength={200}
                />

                <div>
                  <label className="mb-2 block text-xs font-bold uppercase tracking-wider text-gray-700">
                    GENDER <span className="text-red-600">*</span>
                  </label>
                  <div
                    role="radiogroup"
                    aria-label="Gender"
                    className="grid grid-cols-2 gap-3"
                  >
                    {[
                      { value: "male", label: "Male" },
                      { value: "female", label: "Female" },
                    ].map((option) => {
                      const selected = gender === option.value;

                      return (
                        <label
                          key={option.value}
                          className={`flex cursor-pointer items-center justify-center gap-2.5 rounded-xl border-2 px-4 py-3.5 text-sm font-semibold transition ${selected
                              ? "border-emerald-600 bg-emerald-50 text-emerald-900 shadow-sm"
                              : "border-gray-300 bg-white text-gray-700 hover:border-emerald-300 hover:bg-emerald-50/40"
                            }`}
                        >
                          <input
                            type="radio"
                            name="gender"
                            value={option.value}
                            checked={selected}
                            onChange={() => setGender(option.value)}
                            required
                            className="sr-only"
                          />
                          <span
                            className={`flex h-4 w-4 items-center justify-center rounded-full border-2 ${selected
                                ? "border-emerald-600"
                                : "border-gray-400"
                              }`}
                          >
                            {selected && (
                              <span className="h-2 w-2 rounded-full bg-emerald-600" />
                            )}
                          </span>
                          <span>{option.label}</span>
                        </label>
                      );
                    })}
                  </div>
                </div>

                <FormInput
                  label="RELIGION"
                  placeholder="e.g., Roman Catholic"
                  value={religion}
                  onChange={(e) => setReligion(keepTextCharacters(e.target.value, 100))}
                  maxLength={100}
                />

                <FormInput
                  label="CONTACT NUMBER"
                  type="tel"
                  placeholder="e.g., 09123456789"
                  value={contactNumber}
                  onChange={(e) => setContactNumber(keepDigits(e.target.value, 11))}
                  required
                  inputMode="numeric"
                  pattern="[0-9]{7,11}"
                  minLength={7}
                  maxLength={11}
                  title="Enter 7 to 11 digits only."
                  autoComplete="tel"
                />
              </div>
            </section>

            {/* SOCIAL INFORMATION */}
            <section className="mb-10">
              <h4 className="mb-5 flex items-center gap-2 border-b border-gray-200 pb-3 text-lg font-bold text-emerald-900 sm:text-xl">
                Social Information
              </h4>

              <div className="space-y-3.5">
                <FormCheckbox
                  label="Belonging to any Indigenous People (IP) community"
                  checked={isIpCommunity}
                  onChange={setIsIpCommunity}
                />
                <FormCheckbox
                  label="Is your family an active beneficiary of 4Ps (Pantawid Pamilyang Pilipino Program)?"
                  checked={is4psBeneficiary}
                  onChange={setIs4psBeneficiary}
                />
              </div>
            </section>

            {/* CURRENT ADDRESS */}
            <section className="mb-10">
              <h4 className="mb-5 flex items-center gap-2 border-b border-gray-200 pb-3 text-lg font-bold text-emerald-900 sm:text-xl">
                Current Address
              </h4>

              <div className="rounded-xl border border-gray-200 bg-gray-50/70 p-5 sm:p-6">
                <div className="grid gap-5 md:grid-cols-2">
                  <FormInput
                    label="HOUSE NO."
                    placeholder="e.g., 123"
                    value={currentAddress.houseNo}
                    onChange={(e) => handleCurrentAddressChange("houseNo", keepDigits(e.target.value, 10))}
                    inputMode="numeric"
                    pattern="[0-9]*"
                    maxLength={10}
                    title="Enter numbers only."
                  />

                  <FormInput
                    label="SITIO / STREET NAME"
                    placeholder="e.g., Rizal St."
                    value={currentAddress.street}
                    onChange={(e) => handleCurrentAddressChange("street", keepTextCharacters(e.target.value))}
                    maxLength={150}
                  />

                  <FormInput
                    label="BARANGAY"
                    placeholder="e.g., Poblacion"
                    required
                    value={currentAddress.barangay}
                    onChange={(e) => handleCurrentAddressChange("barangay", keepTextAndNumberCharacters(e.target.value))}
                    minLength={2}
                    maxLength={150}
                  />

                  <FormInput
                    label="MUNICIPALITY / CITY"
                    placeholder="e.g., Mabini"
                    required
                    value={currentAddress.municipality}
                    onChange={(e) => handleCurrentAddressChange("municipality", keepTextCharacters(e.target.value))}
                    minLength={2}
                    maxLength={150}
                  />

                  <FormInput
                    label="PROVINCE"
                    placeholder="e.g., Batangas"
                    required
                    value={currentAddress.province}
                    onChange={(e) => handleCurrentAddressChange("province", keepTextCharacters(e.target.value))}
                    minLength={2}
                    maxLength={150}
                  />

                  <FormInput
                    label="COUNTRY"
                    value={currentAddress.country}
                    onChange={(e) => handleCurrentAddressChange("country", keepTextCharacters(e.target.value, 100))}
                    maxLength={100}
                  />

                  <FormInput
                    label="ZIP CODE"
                    placeholder="e.g., 4202"
                    value={currentAddress.zipCode}
                    onChange={(e) => handleCurrentAddressChange("zipCode", keepDigits(e.target.value, 4))}
                    inputMode="numeric"
                    pattern="[0-9]{4}"
                    maxLength={4}
                    title="Enter exactly 4 digits."
                  />
                </div>
              </div>
            </section>

            {/* PERMANENT ADDRESS */}
            <section className="mb-10">
              <div className="mb-5 flex flex-col gap-3 border-b border-gray-200 pb-3 sm:flex-row sm:items-center sm:justify-between">
                <h4 className="flex items-center gap-2 text-lg font-bold text-emerald-900 sm:text-xl">
                  Permanent Address
                </h4>

                {/* Same as Current Address Checkbox */}
                <label className="inline-flex cursor-pointer items-center gap-2.5 rounded-lg border border-gray-300 bg-white px-3.5 py-2 text-xs font-semibold text-gray-700 shadow-sm transition hover:border-emerald-300 hover:bg-gray-50">
                  <input
                    type="checkbox"
                    checked={sameAsCurrentAddress}
                    onChange={(e) => handleSameAddressToggle(e.target.checked)}
                    className="h-4 w-4 rounded border-gray-300 accent-emerald-700 focus:ring-1 focus:ring-yellow-300"
                  />
                  <span>Same as Current Address</span>
                </label>
              </div>

              {/* Sync notification banner */}
              {sameAsCurrentAddress && (
                <div className="mb-4 flex items-center gap-2.5 rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-2.5 text-xs font-medium text-emerald-800 shadow-sm">
                  <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-yellow-400 text-xs font-black text-emerald-950">
                    ✓
                  </span>
                  <span>
                    Permanent Address is locked and synchronized with Current Address. Uncheck the box above to edit separately.
                  </span>
                </div>
              )}

              <div className="rounded-xl border border-gray-200 bg-gray-50/70 p-5 sm:p-6">
                <div className="grid gap-5 md:grid-cols-2">
                  <FormInput
                    label="HOUSE NO."
                    placeholder="e.g., 123"
                    value={sameAsCurrentAddress ? currentAddress.houseNo : permanentAddress.houseNo}
                    onChange={(e) => handlePermanentAddressChange("houseNo", keepDigits(e.target.value, 10))}
                    readOnly={sameAsCurrentAddress}
                    inputMode="numeric"
                    pattern="[0-9]*"
                    maxLength={10}
                    title="Enter numbers only."
                  />

                  <FormInput
                    label="SITIO / STREET NAME"
                    placeholder="e.g., Rizal St."
                    value={sameAsCurrentAddress ? currentAddress.street : permanentAddress.street}
                    onChange={(e) => handlePermanentAddressChange("street", keepTextCharacters(e.target.value))}
                    readOnly={sameAsCurrentAddress}
                    maxLength={150}
                  />

                  <FormInput
                    label="BARANGAY"
                    placeholder="e.g., Poblacion"
                    required
                    value={sameAsCurrentAddress ? currentAddress.barangay : permanentAddress.barangay}
                    onChange={(e) => handlePermanentAddressChange("barangay", keepTextAndNumberCharacters(e.target.value))}
                    readOnly={sameAsCurrentAddress}
                    minLength={2}
                    maxLength={150}
                  />

                  <FormInput
                    label="MUNICIPALITY / CITY"
                    placeholder="e.g., Mabini"
                    required
                    value={sameAsCurrentAddress ? currentAddress.municipality : permanentAddress.municipality}
                    onChange={(e) => handlePermanentAddressChange("municipality", keepTextCharacters(e.target.value))}
                    readOnly={sameAsCurrentAddress}
                    minLength={2}
                    maxLength={150}
                  />

                  <FormInput
                    label="PROVINCE"
                    placeholder="e.g., Batangas"
                    required
                    value={sameAsCurrentAddress ? currentAddress.province : permanentAddress.province}
                    onChange={(e) => handlePermanentAddressChange("province", keepTextCharacters(e.target.value))}
                    readOnly={sameAsCurrentAddress}
                    minLength={2}
                    maxLength={150}
                  />

                  <FormInput
                    label="COUNTRY"
                    value={sameAsCurrentAddress ? currentAddress.country : permanentAddress.country}
                    onChange={(e) => handlePermanentAddressChange("country", keepTextCharacters(e.target.value, 100))}
                    readOnly={sameAsCurrentAddress}
                    maxLength={100}
                  />

                  <FormInput
                    label="ZIP CODE"
                    placeholder="e.g., 4202"
                    value={sameAsCurrentAddress ? currentAddress.zipCode : permanentAddress.zipCode}
                    onChange={(e) => handlePermanentAddressChange("zipCode", keepDigits(e.target.value, 4))}
                    readOnly={sameAsCurrentAddress}
                    inputMode="numeric"
                    pattern="[0-9]{4}"
                    maxLength={4}
                    title="Enter exactly 4 digits."
                  />
                </div>
              </div>
            </section>

            {/* PARENT / GUARDIAN INFORMATION */}
            <section className="mb-10">
              <h4 className="mb-5 flex items-center gap-2 border-b border-gray-200 pb-3 text-lg font-bold text-emerald-900 sm:text-xl">
                Parent&apos;s / Guardian Information
              </h4>

              <p className="mb-5 text-xs font-semibold uppercase tracking-wider text-red-600">
                All parent / guardian details are required. Please complete every field.
              </p>

              <GuardianCard
                title="Father's Information"
                value={guardians[0]}
                onChange={(field, value) => handleGuardianChange(0, field, value)}
              />
              <GuardianCard
                title="Mother's Information"
                value={guardians[1]}
                onChange={(field, value) => handleGuardianChange(1, field, value)}
              />
              <GuardianCard
                title="Legal Guardian's Information"
                value={guardians[2]}
                onChange={(field, value) => handleGuardianChange(2, field, value)}
              />
            </section>

            {/* SUBMISSION / RLS NOTICE */}
            {submissionError && (
              <div
                className={`mb-6 rounded-2xl border-2 p-5 text-sm shadow-md ${submissionError.kind === "connection"
                  ? "border-amber-400 bg-amber-50/95 text-amber-950"
                  : "border-red-300 bg-red-50 text-red-950"
                  }`}
              >
                <div className="flex items-start gap-3">
                  <span className="text-2xl">
                    {submissionError.kind === "connection" ? "🌐" : "⚠️"}
                  </span>
                  <div className="flex-1">
                    <p className="font-bold text-base text-gray-900">
                      {submissionError.kind === "connection"
                        ? "Supabase Project Unreachable (Connection Notice)"
                        : submissionError.kind === "schema"
                          ? "Database Schema Error"
                          : "Application Submission Error"}
                    </p>

                    <p className="mt-1 text-xs text-gray-700">
                      {submissionError.message}
                    </p>

                    {submissionError.kind === "connection" && (
                      <div className="mt-3 rounded-xl bg-white p-3.5 text-xs border border-amber-200 text-gray-800 space-y-2">
                        <p className="font-semibold text-amber-900">
                          Why is this happening?
                        </p>
                        <ul className="list-disc pl-4 space-y-1 text-gray-600">
                          <li>
                            <strong>Project Paused:</strong> Free-tier Supabase projects automatically pause after 7 days of inactivity. Go to your{" "}
                            <a
                              href="https://supabase.com/dashboard"
                              target="_blank"
                              rel="noreferrer"
                              className="underline font-bold text-emerald-700"
                            >
                              Supabase Dashboard
                            </a>{" "}
                            and click <strong>&quot;Restore Project&quot;</strong>.
                          </li>
                          <li>
                            <strong>New Project URL:</strong> If you created a new Supabase project, make sure the{" "}
                            <code className="bg-gray-100 px-1 py-0.5 rounded font-mono text-xs">
                              NEXT_PUBLIC_SUPABASE_URL
                            </code>{" "}
                            in{" "}
                            <code className="bg-gray-100 px-1 py-0.5 rounded font-mono text-xs">
                              .env.local
                            </code>{" "}
                            matches your new project&apos;s URL.
                          </li>
                        </ul>
                      </div>
                    )}


                    <div className="mt-4 flex flex-wrap gap-2">
                      <button
                        type="button"
                        onClick={() => {
                          const form = document.querySelector("form");
                          form?.requestSubmit();
                        }}
                        className="rounded-lg bg-yellow-400 px-4 py-2 text-xs font-bold text-emerald-950 hover:bg-yellow-300 transition"
                      >
                        Try Saving Again
                      </button>

                    </div>
                  </div>
                </div>
              </div>
            )}


            {/* TERMS AND CONDITIONS AGREEMENT */}
            <div className="mt-8 rounded-xl border border-gray-200 bg-gray-50/70 p-4">
              <label className="group flex cursor-pointer items-start gap-3">
                <input
                  type="checkbox"
                  checked={agreedToTerms}
                  disabled={isSubmitting}
                  onChange={(e) => setAgreedToTerms(e.target.checked)}
                  className="mt-0.5 h-4 w-4 rounded border-gray-300 accent-emerald-700 focus:ring-1 focus:ring-yellow-300"
                />
                <span className="text-sm text-gray-700">
                  I have read and agree to the{" "}
                  <button
                    type="button"
                    onClick={(event) => {
                      event.preventDefault();
                      setLegalModal("terms");
                    }}
                    className="font-bold text-emerald-700 hover:underline"
                  >
                    Terms and Conditions
                  </button>{" "}
                  and{" "}
                  <button
                    type="button"
                    onClick={(event) => {
                      event.preventDefault();
                      setLegalModal("privacy");
                    }}
                    className="font-bold text-emerald-700 hover:underline"
                  >
                    Privacy Notice
                  </button>
                  . <span className="text-red-600">*</span>
                </span>
              </label>
            </div>

            {/* FORM ACTION CONTROLS */}
            <div className="flex flex-col-reverse gap-4 border-t border-gray-200 pt-8 sm:flex-row sm:items-center sm:justify-between">
              <Link
                href={
                  trackParam
                    ? `/enroll/cluster?track=${encodeURIComponent(trackParam)}`
                    : "/enroll/cluster"
                }
                className="rounded-lg border border-gray-300 bg-white px-6 py-3.5 text-center text-sm font-semibold text-gray-700 shadow-sm transition hover:bg-gray-50 hover:text-gray-900"
              >
                Back to Cluster Selection
              </Link>

              <button
                type="submit"
                disabled={isSubmitting}
                className="flex items-center justify-center gap-2 rounded-lg bg-linear-to-r from-yellow-400 via-yellow-300 to-yellow-300 px-8 py-3.5 text-sm font-bold text-emerald-950 shadow-lg shadow-amber-300/25 transition-all duration-300 hover:scale-[1.02] hover:bg-yellow-300 hover:shadow-[0_0_20px_rgba(23,107,77,0.4)] disabled:cursor-not-allowed disabled:opacity-70"
              >
                {isSubmitting ? (
                  <>
                    <span className="inline-block h-4 w-4 animate-spin rounded-full border-2 border-emerald-200 border-t-transparent" />
                    <span>Saving...</span>
                  </>
                ) : (
                  <span>Continue to Requirements</span>
                )}
              </button>
            </div>
          </form>

          {legalModal && (
            <LegalModal kind={legalModal} onClose={() => setLegalModal(null)} />
          )}
        </section>

        {/* Footer */}
        <footer className="border-t border-emerald-800/70 bg-[#0b3d2e]/60 px-6 py-5 backdrop-blur-sm">
          <div className="mx-auto flex max-w-6xl flex-col items-center justify-between gap-2 text-center sm:flex-row sm:text-left">
            <p className="text-xs text-emerald-200 sm:text-sm">
              © {new Date().getFullYear()} Anselmo A. Sandoval Memorial National High School
            </p>
            <p className="text-xs text-emerald-300">
              Mabini, Batangas • DepEd Region IV-A CALABARZON
            </p>
          </div>
        </footer>
      </div>
    </main>
  );
}

export default function EnrollmentFormPage() {
  return (
    <Suspense
      fallback={
        <div className="flex min-h-screen items-center justify-center bg-[#eaf5ec] text-[#06281b]">
          <div className="text-center animate-fade-in-up">
            <div className="mx-auto h-8 w-8 animate-spin rounded-full border-2 border-emerald-200 border-t-transparent"></div>
            <p className="mt-3 text-sm font-semibold">Loading enrollment form...</p>
          </div>
        </div>
      }
    >
      <FormContent />
    </Suspense>
  );
}

/* ============================================================= */
/* REUSABLE FORM INPUT                                           */
/* ============================================================= */

function FormInput({
  label,
  placeholder,
  type = "text",
  value,
  defaultValue,
  onChange,
  required = false,
  readOnly = false,
  disabled = false,
  inputMode,
  pattern,
  minLength,
  maxLength,
  title,
  autoComplete,
}: {
  label: string;
  placeholder?: string;
  type?: string;
  value?: string;
  defaultValue?: string;
  onChange?: (e: React.ChangeEvent<HTMLInputElement>) => void;
  required?: boolean;
  readOnly?: boolean;
  disabled?: boolean;
  inputMode?: React.HTMLAttributes<HTMLInputElement>["inputMode"];
  pattern?: string;
  minLength?: number;
  maxLength?: number;
  title?: string;
  autoComplete?: string;
}) {
  return (
    <div>
      <label className="mb-2 block text-xs font-bold uppercase tracking-wider text-gray-700">
        {label} {required && <span className="text-red-600">*</span>}
      </label>

      <input
        type={type}
        placeholder={placeholder}
        value={value}
        defaultValue={defaultValue}
        onChange={onChange}
        required={required}
        readOnly={readOnly}
        disabled={disabled}
        inputMode={inputMode}
        pattern={pattern}
        minLength={minLength}
        maxLength={maxLength}
        title={title}
        autoComplete={autoComplete}
        autoCapitalize={type === "text" ? "words" : undefined}
        className="portal-input"
      />
    </div>
  );
}

/* ============================================================= */
/* REUSABLE FORM CHECKBOX                                        */
/* ============================================================= */

function FormCheckbox({
  label,
  checked = false,
  onChange,
}: {
  label: string;
  checked?: boolean;
  onChange?: (checked: boolean) => void;
}) {
  return (
    <label className="group flex cursor-pointer items-start gap-3 rounded-xl border border-gray-200 bg-gray-50/70 p-3.5 transition hover:border-emerald-200 hover:bg-emerald-50/30">
      <input
        type="checkbox"
        checked={checked}
        onChange={(e) => onChange?.(e.target.checked)}
        className="mt-0.5 h-4 w-4 rounded border-gray-300 accent-emerald-700 focus:ring-1 focus:ring-yellow-300"
      />
      <span className="text-sm font-medium text-gray-700 transition group-hover:text-gray-900">
        {label}
      </span>
    </label>
  );
}

/* ============================================================= */
/* GUARDIAN CARD COMPONENT                                       */
/* ============================================================= */

function GuardianCard({
  title,
  value,
  onChange,
}: {
  title: string;
  value: GuardianState;
  onChange: (field: keyof GuardianState, value: string) => void;
}) {
  return (
    <div className="mb-5 rounded-xl border border-gray-200 bg-gray-50/70 p-5 sm:p-6">
      <h5 className="mb-4 text-xs font-bold uppercase tracking-wider text-emerald-700">
        {title}
      </h5>

      <div className="grid gap-5 md:grid-cols-3">
        <FormInput
          label="LAST NAME"
          placeholder="Dela Cruz"
          value={value.lastName}
          onChange={(e) => onChange("lastName", keepNameCharacters(e.target.value))}
          required
          minLength={2}
          maxLength={100}
        />
        <FormInput
          label="FIRST NAME"
          placeholder="Juan"
          value={value.firstName}
          onChange={(e) => onChange("firstName", keepNameCharacters(e.target.value))}
          required
          minLength={2}
          maxLength={100}
        />
        <FormInput
          label="MIDDLE NAME"
          placeholder="Santos"
          value={value.middleName}
          onChange={(e) => onChange("middleName", keepNameCharacters(e.target.value))}
          required
          maxLength={100}
        />

        <div className="md:col-span-3">
          <FormInput
            label="CONTACT NUMBER"
            type="tel"
            placeholder="e.g., 09123456789"
            value={value.contactNumber}
            onChange={(e) => onChange("contactNumber", keepDigits(e.target.value, 11))}
            required
            inputMode="numeric"
            pattern="[0-9]{11}"
            minLength={11}
            maxLength={11}
            title="Enter exactly 11 digits."
          />
        </div>
      </div>
    </div>
  );
}