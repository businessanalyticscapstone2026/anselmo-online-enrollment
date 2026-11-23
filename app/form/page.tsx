"use client";

import Image from "next/image";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useEffect, useState } from "react";
import EnrollmentProgress from "@/app/_components/EnrollmentProgress";
import LegalModal, { type LegalKind } from "@/app/_components/LegalModal";
import { ClipboardCheck } from "lucide-react";
import {
  getCanonicalCluster,
  getTrackConfig,
  getTrackLabel,
  isValidClusterForTrack,
} from "@/lib/clusters";
import {
  DISTANCE_LEARNING_MODALITIES,
  SPECIAL_NEEDS_DETAILS,
  SPECIAL_NEEDS_DIAGNOSES,
  SPECIAL_NEEDS_MANIFESTATIONS,
} from "@/lib/enrollmentFormOptions";

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

interface ApplicationDraft {
  firstName: string;
  middleName: string;
  lastName: string;
  extension: string;
  lrn: string;
  email: string;
  birthDate: string;
  age: number;
  placeOfBirth: string;
  gender: string;
  religion: string;
  contactNumber: string;
  collegeCourse: string;
  selectedTrack: string;
  selectedCluster: string;
  isIpCommunity: boolean;
  ipCommunityType: string;
  is4psBeneficiary: boolean;
  fourPsHouseholdId: string;
  specialNeedsProgram: boolean | null;
  specialNeedsGroup: string;
  specialNeedsCondition: string;
  specialNeedsDetail: string;
  hasPwdId: boolean | null;
  lastSchoolYearCompleted: string;
  lastSchoolAttended: string;
  lastSchoolId: string;
  preferredModalities: string[];
  currentAddress: AddressState;
  permanentAddress: AddressState;
  sameAsCurrentAddress: boolean;
  guardians: GuardianState[];
}

const initialAddress: AddressState = {
  houseNo: "",
  street: "",
  barangay: "",
  municipality: "",
  province: "",
  country: "PHILIPPINES",
  zipCode: "",
};

const initialGuardian: GuardianState = {
  lastName: "",
  firstName: "",
  middleName: "",
  contactNumber: "",
};

const FORM_DRAFT_KEY = "studentEnrollmentFormDraft";

interface SavedFormDraft {
  lrn: string;
  lastName: string;
  firstName: string;
  middleName: string;
  extension: string;
  email: string;
  dob: string;
  age: string;
  pob: string;
  gender: string;
  religion: string;
  contactNumber: string;
  collegeCourse: string;
  isIpCommunity: boolean;
  ipCommunityType: string;
  is4psBeneficiary: boolean;
  fourPsHouseholdId: string;
  specialNeedsProgram: boolean | null;
  specialNeedsGroup: string;
  specialNeedsCondition: string;
  specialNeedsDetail: string;
  hasPwdId: boolean | null;
  lastSchoolYearCompleted: string;
  lastSchoolAttended: string;
  lastSchoolId: string;
  preferredModalities: string[];
  currentAddress: AddressState;
  permanentAddress: AddressState;
  sameAsCurrentAddress: boolean;
  guardians: GuardianState[];
  agreedToTerms: boolean;
}

function stringValue(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function booleanValue(value: unknown): boolean {
  return value === true;
}

function nullableBoolean(value: unknown): boolean | null {
  return typeof value === "boolean" ? value : null;
}

function stringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string")
    : [];
}

function normalizeAddress(value: unknown): AddressState {
  const record =
    value && typeof value === "object"
      ? (value as Record<string, unknown>)
      : {};

  return {
    houseNo: keepDigits(stringValue(record.houseNo), 10),
    street: keepTextCharacters(stringValue(record.street)),
    barangay: keepTextAndNumberCharacters(stringValue(record.barangay)),
    municipality: keepTextCharacters(stringValue(record.municipality)),
    province: keepTextCharacters(stringValue(record.province)),
    country:
      keepTextCharacters(stringValue(record.country)) || initialAddress.country,
    zipCode: keepDigits(stringValue(record.zipCode), 4),
  };
}

function normalizeGuardians(value: unknown): GuardianState[] {
  const list = Array.isArray(value) ? value : [];
  const normalized = list.slice(0, 3).map((item) => {
    const record =
      item && typeof item === "object"
        ? (item as Record<string, unknown>)
        : {};

    return {
      lastName: keepNameCharacters(stringValue(record.lastName)),
      firstName: keepNameCharacters(stringValue(record.firstName)),
      middleName: keepNameCharacters(stringValue(record.middleName)),
      contactNumber: keepDigits(stringValue(record.contactNumber), 11),
    };
  });

  while (normalized.length < 3) {
    normalized.push({ ...initialGuardian });
  }

  return normalized;
}

function readSavedFormDraft(): Partial<SavedFormDraft> | null {
  if (typeof window === "undefined") return null;

  try {
    const raw = window.localStorage.getItem(FORM_DRAFT_KEY);
    if (!raw) return null;

    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return null;
    }

    return parsed as Partial<SavedFormDraft>;
  } catch {
    return null;
  }
}

const NAME_CHARACTERS = /[^A-Za-zÀ-ÖØ-öø-ÿ.'’\-\s]/g;
const TEXT_CHARACTERS = /[^A-Za-zÀ-ÖØ-öø-ÿ.,'’/&\-\s]/g;
const TEXT_AND_NUMBER_CHARACTERS = /[^A-Za-zÀ-ÖØ-öø-ÿ0-9.,'’/&\-\s]/g;
const NON_DIGITS = /\D/g;
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const CONTACT_PATTERN = /^\d{11}$/;
const ZIP_PATTERN = /^\d{4}$/;
function dateInputValue(value: Date): string {
  const year = value.getFullYear();
  const month = String(value.getMonth() + 1).padStart(2, "0");
  const day = String(value.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function calculateAgeFromBirthDate(value: string): string {
  if (!value) return "";

  const birth = new Date(`${value}T00:00:00`);
  if (Number.isNaN(birth.getTime())) return "";

  const today = new Date();
  let age = today.getFullYear() - birth.getFullYear();
  const monthDiff = today.getMonth() - birth.getMonth();

  if (monthDiff < 0 || (monthDiff === 0 && today.getDate() < birth.getDate())) {
    age -= 1;
  }

  return age >= 0 ? String(age) : "";
}

const TODAY = new Date();
const CURRENT_YEAR = TODAY.getFullYear();
const MIN_BIRTH_YEAR = CURRENT_YEAR - 30;
const MIN_BIRTH_DATE = `${MIN_BIRTH_YEAR}-01-01`;
const MAX_BIRTH_DATE = dateInputValue(TODAY);

function uppercaseValue(value: string): string {
  return value.toUpperCase();
}

function keepNameCharacters(value: string, maxLength = 100): string {
  return uppercaseValue(value.replace(NAME_CHARACTERS, "").slice(0, maxLength));
}

function keepTextCharacters(value: string, maxLength = 150): string {
  return uppercaseValue(value.replace(TEXT_CHARACTERS, "").slice(0, maxLength));
}

function keepTextAndNumberCharacters(value: string, maxLength = 150): string {
  return uppercaseValue(
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

  const [savedDraft] = useState(() => readSavedFormDraft());

  // Learner reference number (optional)
  const [lrn, setLrn] = useState(() =>
    keepDigits(stringValue(savedDraft?.lrn), 12)
  );

  // Student basic information states
  const [lastName, setLastName] = useState(() =>
    keepNameCharacters(
      stringValue(savedDraft?.lastName) ||
        (typeof window !== "undefined"
          ? localStorage.getItem("studentLastName") || ""
          : "")
    )
  );
  const [firstName, setFirstName] = useState(() =>
    keepNameCharacters(
      stringValue(savedDraft?.firstName) ||
        (typeof window !== "undefined"
          ? localStorage.getItem("studentFirstName") || ""
          : "")
    )
  );
  const [middleName, setMiddleName] = useState(() =>
    keepNameCharacters(stringValue(savedDraft?.middleName))
  );
  const [extension, setExtension] = useState(() =>
    keepNameCharacters(stringValue(savedDraft?.extension), 30)
  );
  const [email, setEmail] = useState(() =>
    keepEmailCharacters(
      stringValue(savedDraft?.email) ||
        (typeof window !== "undefined"
          ? localStorage.getItem("studentEmail") || ""
          : "")
    )
  );
  const [dob, setDob] = useState(() => stringValue(savedDraft?.dob));
  const [age, setAge] = useState(() =>
    keepDigits(stringValue(savedDraft?.age), 3)
  );
  const [pob, setPob] = useState(() =>
    keepTextCharacters(stringValue(savedDraft?.pob), 200)
  );
  const [gender, setGender] = useState(() => {
    const value = stringValue(savedDraft?.gender);
    return value === "male" || value === "female" ? value : "";
  });
  const [religion, setReligion] = useState(() =>
    keepTextCharacters(stringValue(savedDraft?.religion), 100)
  );
  const [contactNumber, setContactNumber] = useState(() =>
    keepDigits(stringValue(savedDraft?.contactNumber), 11)
  );
  const [collegeCourse, setCollegeCourse] = useState(() =>
    keepTextAndNumberCharacters(stringValue(savedDraft?.collegeCourse), 200)
  );

  // Address state management
  const [currentAddress, setCurrentAddress] = useState<AddressState>(() =>
    normalizeAddress(savedDraft?.currentAddress)
  );
  const [permanentAddress, setPermanentAddress] = useState<AddressState>(() =>
    savedDraft?.sameAsCurrentAddress === true
      ? normalizeAddress(savedDraft?.currentAddress)
      : normalizeAddress(savedDraft?.permanentAddress)
  );
  const [sameAsCurrentAddress, setSameAsCurrentAddress] = useState(
    () => savedDraft?.sameAsCurrentAddress === true
  );

  // Social information
  const [isIpCommunity, setIsIpCommunity] = useState(() =>
    booleanValue(savedDraft?.isIpCommunity)
  );
  const [ipCommunityType, setIpCommunityType] = useState(() =>
    keepTextCharacters(stringValue(savedDraft?.ipCommunityType), 150)
  );
  const [is4psBeneficiary, setIs4psBeneficiary] = useState(() =>
    booleanValue(savedDraft?.is4psBeneficiary)
  );
  const [fourPsHouseholdId, setFourPsHouseholdId] = useState(() =>
    keepDigits(stringValue(savedDraft?.fourPsHouseholdId), 20)
  );

  // Special needs education program
  const [specialNeedsProgram, setSpecialNeedsProgram] = useState<
    boolean | null
  >(() => nullableBoolean(savedDraft?.specialNeedsProgram));
  const [specialNeedsGroup, setSpecialNeedsGroup] = useState(() =>
    stringValue(savedDraft?.specialNeedsGroup)
  );
  const [specialNeedsCondition, setSpecialNeedsCondition] = useState(() =>
    stringValue(savedDraft?.specialNeedsCondition)
  );
  const [specialNeedsDetail, setSpecialNeedsDetail] = useState(() =>
    stringValue(savedDraft?.specialNeedsDetail)
  );
  const [hasPwdId, setHasPwdId] = useState<boolean | null>(() =>
    nullableBoolean(savedDraft?.hasPwdId)
  );

  // Returning learner / transfer details
  const [lastSchoolYearCompleted, setLastSchoolYearCompleted] = useState(() =>
    keepTextAndNumberCharacters(
      stringValue(savedDraft?.lastSchoolYearCompleted),
      20
    )
  );
  const [lastSchoolAttended, setLastSchoolAttended] = useState(() =>
    keepTextAndNumberCharacters(
      stringValue(savedDraft?.lastSchoolAttended),
      150
    )
  );
  const [lastSchoolId, setLastSchoolId] = useState(() =>
    keepDigits(stringValue(savedDraft?.lastSchoolId), 6)
  );

  // Distance learning modality preference
  const [preferredModalities, setPreferredModalities] = useState<string[]>(() =>
    stringArray(savedDraft?.preferredModalities).filter((item) =>
      DISTANCE_LEARNING_MODALITIES.some((option) => option === item)
    )
  );

  // Parent / guardian information
  const [guardians, setGuardians] = useState<GuardianState[]>(() =>
    normalizeGuardians(savedDraft?.guardians)
  );

  // Submission state
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [confirmDraft, setConfirmDraft] = useState<ApplicationDraft | null>(
    null
  );
  const [agreedToTerms, setAgreedToTerms] = useState(() =>
    booleanValue(savedDraft?.agreedToTerms)
  );
  const [legalModal, setLegalModal] = useState<LegalKind | null>(null);
  const [validationError, setValidationError] = useState("");
  const [submissionError, setSubmissionError] = useState<{
    kind: "connection" | "schema" | "general";
    message: string;
  } | null>(null);

  useEffect(() => {
    const draft: SavedFormDraft = {
      lrn,
      lastName,
      firstName,
      middleName,
      extension,
      email,
      dob,
      age,
      pob,
      gender,
      religion,
      contactNumber,
      collegeCourse,
      isIpCommunity,
      ipCommunityType,
      is4psBeneficiary,
      fourPsHouseholdId,
      specialNeedsProgram,
      specialNeedsGroup,
      specialNeedsCondition,
      specialNeedsDetail,
      hasPwdId,
      lastSchoolYearCompleted,
      lastSchoolAttended,
      lastSchoolId,
      preferredModalities,
      currentAddress,
      permanentAddress,
      sameAsCurrentAddress,
      guardians,
      agreedToTerms,
    };

    try {
      window.localStorage.setItem(FORM_DRAFT_KEY, JSON.stringify(draft));
    } catch {
      // Ignore storage failures (for example, private browsing quotas).
    }
  });


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

  const handleSpecialNeedsAnswer = (answer: boolean) => {
    setSpecialNeedsProgram(answer);
    if (!answer) {
      setSpecialNeedsGroup("");
      setSpecialNeedsCondition("");
      setSpecialNeedsDetail("");
    }
  };

  const handleSpecialNeedsCondition = (
    group: "diagnosis" | "manifestation",
    condition: string
  ) => {
    setSpecialNeedsGroup(group);
    setSpecialNeedsCondition(condition);
    setSpecialNeedsDetail("");
  };

  const toggleModality = (modality: string) => {
    setPreferredModalities((prev) =>
      prev.includes(modality)
        ? prev.filter((item) => item !== modality)
        : [...prev, modality]
    );
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
      dob > MAX_BIRTH_DATE
    ) {
      return "Please enter a valid date of birth that is not in the future.";
    }

    if (dob < MIN_BIRTH_DATE || dob > MAX_BIRTH_DATE) {
      return `Birth date must be between ${MIN_BIRTH_YEAR} and ${CURRENT_YEAR}.`;
    }

    const ageNumber = Number(age);
    if (
      !age.trim() ||
      !Number.isInteger(ageNumber) ||
      ageNumber < 10 ||
      ageNumber > 100
    ) {
      return "Age must be a whole number between 10 and 100.";
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
      const guardian = guardians[index] ?? initialGuardian;
      const label = guardianLabels[index];

      if (!guardians[index] && index !== 0) {
        return `${label}'s information is required.`;
      }

      const requiredGuardianFields: Array<[string, string]> =
        index === 0
          ? []
          : [
            ["last name", guardian.lastName],
            ["first name", guardian.firstName],
            ["contact number", guardian.contactNumber],
          ];
      const missingGuardianFields = requiredGuardianFields
        .filter(([, value]) => !value.trim())
        .map(([field]) => field);

      if (missingGuardianFields.length > 0) {
        return `${label}'s information is missing: ${missingGuardianFields.join(", ")}.`;
      }

      if (guardian.contactNumber && !CONTACT_PATTERN.test(guardian.contactNumber)) {
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

    if (specialNeedsProgram === null) {
      return "Please answer whether the learner is under the Special Needs Education Program.";
    }

    if (specialNeedsProgram) {
      if (!specialNeedsCondition) {
        return "Please select one diagnosis or manifestation under the Special Needs Education Program.";
      }

      const requiredDetail = SPECIAL_NEEDS_DETAILS[specialNeedsCondition];
      if (requiredDetail && !specialNeedsDetail) {
        return `Please select the required detail for ${specialNeedsCondition}.`;
      }
    }

    if (hasPwdId === null) {
      return "Please answer whether the learner has a PWD ID.";
    }

    if (lastSchoolId && !/^\d{6}$/.test(lastSchoolId)) {
      return "School ID must contain exactly 6 digits.";
    }

    if (isIpCommunity && !ipCommunityType.trim()) {
      return "Please specify the Indigenous People (IP) Community/Indigenous Cultural Community.";
    }

    if (is4psBeneficiary && !fourPsHouseholdId.trim()) {
      return "Please enter the 4Ps Household ID.";
    }

    if (!collegeCourse.trim()) {
      return "Please enter the course you want to take in college.";
    }

    if (preferredModalities.length === 0) {
      return "Please select at least one preferred distance learning modality.";
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
      lrn: lrn.trim(),
      email: email.trim().toLowerCase(),
      birthDate: dob,
      age: Number(age),
      placeOfBirth: pob.trim(),
      gender,
      religion: religion.trim(),
      contactNumber: contactNumber.trim(),
      collegeCourse: collegeCourse.trim(),
      selectedTrack,
      selectedCluster,
      isIpCommunity,
      ipCommunityType: isIpCommunity ? ipCommunityType.trim() : "",
      is4psBeneficiary,
      fourPsHouseholdId: is4psBeneficiary ? fourPsHouseholdId.trim() : "",
      specialNeedsProgram,
      specialNeedsGroup: specialNeedsProgram ? specialNeedsGroup : "",
      specialNeedsCondition: specialNeedsProgram ? specialNeedsCondition : "",
      specialNeedsDetail: specialNeedsProgram ? specialNeedsDetail : "",
      hasPwdId,
      lastSchoolYearCompleted: lastSchoolYearCompleted.trim(),
      lastSchoolAttended: lastSchoolAttended.trim(),
      lastSchoolId: lastSchoolId.trim(),
      preferredModalities: [...preferredModalities],
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

    setSubmissionError(null);
    setConfirmDraft(applicationDraft);
  };

  const submitConfirmedApplication = async () => {
    if (!confirmDraft || isSubmitting) return;

    const applicationDraft = confirmDraft;
    setConfirmDraft(null);
    setIsSubmitting(true);

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
          backgroundImage: "url('/school-background.png')",
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

            {/* LEARNER REFERENCE NUMBER & COLLEGE COURSE */}
            <section className="mb-10">
              <h4 className="mb-5 flex items-center gap-2 border-b border-gray-200 pb-3 text-lg font-bold text-emerald-900 sm:text-xl">
                Learner Reference No. (LRN), if applicable:
              </h4>

              <div className="grid gap-5 sm:grid-cols-2">
                <FormInput
                  label="LEARNER REFERENCE NO. (LRN)"
                  placeholder="e.g., 123456789012"
                  value={lrn}
                  onChange={(e) => setLrn(keepDigits(e.target.value, 12))}
                  inputMode="numeric"
                  maxLength={12}
                  title="Enter the 12-digit LRN if applicable."
                />
                <FormInput
                  label="WHAT COURSE DO YOU WANT TO TAKE IN COLLEGE?"
                  placeholder="e.g., Bachelor of Science in Computer Science"
                  value={collegeCourse}
                  onChange={(e) =>
                    setCollegeCourse(
                      keepTextAndNumberCharacters(e.target.value, 200)
                    )
                  }
                  required
                  minLength={2}
                  maxLength={200}
                />
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
                  onChange={(e) => {
                    setDob(e.target.value);
                    setAge(calculateAgeFromBirthDate(e.target.value));
                  }}
                  min={MIN_BIRTH_DATE}
                  max={MAX_BIRTH_DATE}
                  required
                />

                <FormInput
                  label="AGE"
                  type="number"
                  value={age}
                  onChange={(e) => setAge(keepDigits(e.target.value, 3))}
                  placeholder="e.g. 16"
                  min="10"
                  max="100"
                  inputMode="numeric"
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
                <div>
                  <FormCheckbox
                    label="Belonging to any Indigenous People (IP) Community/Indigenous Cultural Community?"
                    checked={isIpCommunity}
                    onChange={setIsIpCommunity}
                  />
                  {isIpCommunity && (
                    <div className="ml-7 mt-3 max-w-md">
                      <FormInput
                        label="PLEASE SPECIFY THE COMMUNITY"
                        placeholder="e.g., Ayta, Igorot, Mangyan"
                        value={ipCommunityType}
                        onChange={(e) =>
                          setIpCommunityType(
                            keepTextCharacters(e.target.value, 150)
                          )
                        }
                        required
                        maxLength={150}
                      />
                    </div>
                  )}
                </div>
                <div>
                  <FormCheckbox
                    label="Is your family a beneficiary of 4Ps?"
                    checked={is4psBeneficiary}
                    onChange={setIs4psBeneficiary}
                  />
                  {is4psBeneficiary && (
                    <div className="ml-7 mt-3 max-w-md">
                      <FormInput
                        label="IF YES, PLEASE PUT THE 4Ps HOUSEHOLD ID"
                        placeholder="e.g., 12345678901234"
                        value={fourPsHouseholdId}
                        onChange={(e) =>
                          setFourPsHouseholdId(keepDigits(e.target.value, 20))
                        }
                        required
                        inputMode="numeric"
                        maxLength={20}
                      />
                    </div>
                  )}
                </div>
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
                Mother&apos;s and legal guardian&apos;s details are required. Father&apos;s information and all middle names are optional.
              </p>

              <GuardianCard
                title="Father's Information"
                optional
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

            {/* SPECIAL NEEDS EDUCATION PROGRAM */}
            <section className="mb-10">
              <h4 className="mb-5 flex items-center gap-2 border-b border-gray-200 pb-3 text-lg font-bold text-emerald-900 sm:text-xl">
                Special Needs Education Program
              </h4>

              <div className="rounded-xl border border-gray-200 bg-gray-50/70 p-5 sm:p-6">
                <p className="text-sm font-semibold text-gray-800">
                  Is the Learner under the Special Needs Education Program?{" "}
                  <span className="text-red-600">*</span>
                </p>
                <div className="mt-3 flex flex-wrap gap-3">
                  <FormRadio
                    name="specialNeedsProgram"
                    label="Yes"
                    checked={specialNeedsProgram === true}
                    onChange={() => handleSpecialNeedsAnswer(true)}
                  />
                  <FormRadio
                    name="specialNeedsProgram"
                    label="No"
                    checked={specialNeedsProgram === false}
                    onChange={() => handleSpecialNeedsAnswer(false)}
                  />
                </div>

                {specialNeedsProgram === true && (
                  <div className="mt-6 space-y-6 border-t border-gray-200 pt-6">
                    <p className="text-xs font-bold uppercase tracking-wider text-emerald-700">
                      If Yes, check only 1, either from a1 or a2.
                    </p>

                    <div>
                      <p className="mb-3 text-xs font-bold uppercase tracking-wider text-gray-700">
                        a1. With Diagnosis from Licensed Medical Specialist
                      </p>
                      <div className="grid gap-2.5 sm:grid-cols-2">
                        {SPECIAL_NEEDS_DIAGNOSES.map((condition) => (
                          <div key={condition}>
                            <FormRadio
                              name="specialNeedsCondition"
                              label={condition}
                              checked={specialNeedsCondition === condition}
                              onChange={() =>
                                handleSpecialNeedsCondition("diagnosis", condition)
                              }
                            />
                            {specialNeedsCondition === condition &&
                              SPECIAL_NEEDS_DETAILS[condition] && (
                                <div className="ml-7 mt-2 flex flex-wrap gap-2.5">
                                  {SPECIAL_NEEDS_DETAILS[condition].map((detail) => (
                                    <FormRadio
                                      key={detail}
                                      name="specialNeedsDetail"
                                      label={detail}
                                      checked={specialNeedsDetail === detail}
                                      onChange={() => setSpecialNeedsDetail(detail)}
                                    />
                                  ))}
                                </div>
                              )}
                          </div>
                        ))}
                      </div>
                    </div>

                    <div>
                      <p className="mb-3 text-xs font-bold uppercase tracking-wider text-gray-700">
                        a2. With Manifestations
                      </p>
                      <div className="grid gap-2.5 sm:grid-cols-2">
                        {SPECIAL_NEEDS_MANIFESTATIONS.map((condition) => (
                          <FormRadio
                            key={condition}
                            name="specialNeedsCondition"
                            label={condition}
                            checked={specialNeedsCondition === condition}
                            onChange={() =>
                              handleSpecialNeedsCondition("manifestation", condition)
                            }
                          />
                        ))}
                      </div>
                    </div>
                  </div>
                )}

                <div className="mt-6 border-t border-gray-200 pt-6">
                  <p className="text-sm font-semibold text-gray-800">
                    b. Does the Learner have a PWD ID?{" "}
                    <span className="text-red-600">*</span>
                  </p>
                  <div className="mt-3 flex flex-wrap gap-3">
                    <FormRadio
                      name="hasPwdId"
                      label="Yes"
                      checked={hasPwdId === true}
                      onChange={() => setHasPwdId(true)}
                    />
                    <FormRadio
                      name="hasPwdId"
                      label="No"
                      checked={hasPwdId === false}
                      onChange={() => setHasPwdId(false)}
                    />
                  </div>
                </div>
              </div>
            </section>

            {/* RETURNING LEARNER / TRANSFER DETAILS */}
            <section className="mb-10">
              <h4 className="mb-5 flex items-center gap-2 border-b border-gray-200 pb-3 text-lg font-bold text-emerald-900 sm:text-xl">
                For Returning Learner (Balik-Aral) and Transfer/Move In
              </h4>
              <p className="mb-5 text-xs font-semibold uppercase tracking-wider text-gray-600">
                Leave blank if not applicable.
              </p>

              <div className="rounded-xl border border-gray-200 bg-gray-50/70 p-5 sm:p-6">
                <div className="grid gap-5 md:grid-cols-2">
                  <FormInput
                    label="LAST SCHOOL YEAR COMPLETED"
                    placeholder="e.g., 2025-2026"
                    value={lastSchoolYearCompleted}
                    onChange={(e) =>
                      setLastSchoolYearCompleted(
                        keepTextAndNumberCharacters(e.target.value, 20)
                      )
                    }
                    maxLength={20}
                  />
                  <FormInput
                    label="LAST SCHOOL ATTENDED"
                    placeholder="e.g., AASMNHS"
                    value={lastSchoolAttended}
                    onChange={(e) =>
                      setLastSchoolAttended(
                        keepTextAndNumberCharacters(e.target.value, 150)
                      )
                    }
                    maxLength={150}
                  />
                  <FormInput
                    label="SCHOOL ID"
                    placeholder="6 digits"
                    value={lastSchoolId}
                    onChange={(e) => setLastSchoolId(keepDigits(e.target.value, 6))}
                    inputMode="numeric"
                    pattern="[0-9]{6}"
                    maxLength={6}
                    title="Enter exactly 6 digits."
                  />
                </div>
              </div>
            </section>

            {/* DISTANCE LEARNING MODALITY PREFERENCE */}
            <section className="mb-10">
              <h4 className="mb-5 flex items-center gap-2 border-b border-gray-200 pb-3 text-lg font-bold text-emerald-900 sm:text-xl">
                Distance Learning Modality Preference
              </h4>
              <p className="mb-5 text-sm leading-relaxed text-gray-700">
                If the school will implement other distance learning modalities aside
                from face-to-face instruction, what would you prefer?
                Check all that apply. <span className="text-red-600">*</span>
              </p>

              <div className="grid gap-2.5 sm:grid-cols-2">
                {DISTANCE_LEARNING_MODALITIES.map((modality) => (
                  <FormCheckbox
                    key={modality}
                    label={modality}
                    checked={preferredModalities.includes(modality)}
                    onChange={() => toggleModality(modality)}
                  />
                ))}
              </div>
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

          {confirmDraft && (
            <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4">
              <div className="w-full max-w-md overflow-hidden rounded-2xl border border-emerald-200 bg-white shadow-2xl">
                <div className="flex items-center gap-3 border-b border-emerald-200 px-5 py-4">
                  <ClipboardCheck
                    className="shrink-0 text-emerald-700"
                    size={20}
                  />
                  <h2 className="font-bold text-emerald-950">
                    Confirm submission
                  </h2>
                </div>

                <div className="px-5 py-4 text-sm text-gray-700">
                  <p>
                    Please make sure all the information you filled up is
                    correct. Once submitted, you will proceed to upload your
                    enrollment requirements.
                  </p>
                  <p className="mt-3 font-semibold text-emerald-900">
                    Are you sure you want to proceed?
                  </p>
                </div>

                <div className="flex justify-end gap-2 border-t border-emerald-200 px-5 py-4">
                  <button
                    type="button"
                    onClick={() => setConfirmDraft(null)}
                    disabled={isSubmitting}
                    className="rounded-lg border border-gray-300 bg-white px-4 py-2.5 text-xs font-semibold text-gray-700 hover:bg-gray-50 disabled:opacity-60"
                  >
                    Cancel
                  </button>
                  <button
                    type="button"
                    onClick={submitConfirmedApplication}
                    disabled={isSubmitting}
                    className="inline-flex items-center justify-center gap-1.5 rounded-lg bg-yellow-300 px-4 py-2.5 text-xs font-bold text-emerald-950 hover:bg-yellow-300 disabled:opacity-60"
                  >
                    {isSubmitting ? (
                      <>
                        <span className="inline-block h-3.5 w-3.5 animate-spin rounded-full border-2 border-emerald-700/40 border-t-transparent" />
                        Submitting…
                      </>
                    ) : (
                      "Yes, proceed"
                    )}
                  </button>
                </div>
              </div>
            </div>
          )}
        </section>

        {/* Footer */}
        <footer className="border-t border-emerald-800/70 bg-[#0b3d2e]/60 px-6 py-5 backdrop-blur-sm">
          <div className="mx-auto flex max-w-6xl flex-col items-center justify-between gap-2 text-center sm:flex-row sm:text-left">
            <p className="text-xs text-emerald-200 sm:text-sm">
              © {new Date().getFullYear()} Capstone Project - BatStateU Mabini Campus
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
  min,
  max,
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
  min?: string;
  max?: string;
  minLength?: number;
  maxLength?: number;
  title?: string;
  autoComplete?: string;
}) {
  return (
    <div className="min-w-0">
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
        min={min}
        max={max}
        minLength={minLength}
        maxLength={maxLength}
        title={title}
        autoComplete={autoComplete}
        autoCapitalize={type === "text" ? "characters" : undefined}
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
/* REUSABLE FORM RADIO                                           */
/* ============================================================= */

function FormRadio({
  name,
  label,
  checked = false,
  onChange,
}: {
  name: string;
  label: string;
  checked?: boolean;
  onChange?: () => void;
}) {
  return (
    <label className="group inline-flex cursor-pointer items-start gap-2.5 rounded-lg border border-gray-200 bg-white px-3 py-2.5 transition hover:border-emerald-300 hover:bg-emerald-50/40">
      <input
        type="radio"
        name={name}
        checked={checked}
        onChange={() => onChange?.()}
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
  optional = false,
  value,
  onChange,
}: {
  title: string;
  optional?: boolean;
  value: GuardianState;
  onChange: (field: keyof GuardianState, value: string) => void;
}) {
  return (
    <div className="mb-5 rounded-xl border border-gray-200 bg-gray-50/70 p-5 sm:p-6">
      <h5 className="mb-4 text-xs font-bold uppercase tracking-wider text-emerald-700">
        {title} {optional && <span className="text-gray-500">(OPTIONAL)</span>}
      </h5>

      <div className="grid gap-5 md:grid-cols-3">
        <FormInput
          label="LAST NAME"
          placeholder="Dela Cruz"
          value={value.lastName}
          onChange={(e) => onChange("lastName", keepNameCharacters(e.target.value))}
          required={!optional}
          minLength={2}
          maxLength={100}
        />
        <FormInput
          label="FIRST NAME"
          placeholder="Juan"
          value={value.firstName}
          onChange={(e) => onChange("firstName", keepNameCharacters(e.target.value))}
          required={!optional}
          minLength={2}
          maxLength={100}
        />
        <FormInput
          label="MIDDLE NAME"
          placeholder="Santos"
          value={value.middleName}
          onChange={(e) => onChange("middleName", keepNameCharacters(e.target.value))}
          maxLength={100}
        />

        <div className="md:col-span-3">
          <FormInput
            label="CONTACT NUMBER"
            type="tel"
            placeholder="e.g., 09123456789"
            value={value.contactNumber}
            onChange={(e) => onChange("contactNumber", keepDigits(e.target.value, 11))}
            required={!optional}
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