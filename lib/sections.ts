export type SectionRecord = {
  id: string | number;
  name: string;
  grade_level?: string | null;
  track?: string | null;
  strand?: string | null;
  cluster?: string | null;
  adviser_name?: string | null;
  school_year?: string | null;
  capacity?: number | null;
};

export function getSectionCluster(section: SectionRecord | null | undefined): string {
  if (!section) return "";
  const value = section.strand ?? section.cluster;
  return typeof value === "string" ? value.trim() : "";
}

/**
 * Standard AASMNHS Senior High School sections. Used as a fallback when the
 * `sections` table has not been created or is empty.
 */
export const DEFAULT_SECTIONS: SectionRecord[] = [
  { id: "sec-stem-11a", name: "11 - STEM Einstein", grade_level: "Grade 11", track: "academic", strand: "STEM", adviser_name: "Mrs. Maria Santos", capacity: 45, school_year: "2025-2026" },
  { id: "sec-stem-11b", name: "11 - STEM Newton", grade_level: "Grade 11", track: "academic", strand: "STEM", adviser_name: "Mr. John Dela Cruz", capacity: 45, school_year: "2025-2026" },
  { id: "sec-abm-11a", name: "11 - ABM Pacioli", grade_level: "Grade 11", track: "academic", strand: "ABM", adviser_name: "Ms. Elena Reyes", capacity: 45, school_year: "2025-2026" },
  { id: "sec-humss-11a", name: "11 - HUMSS Rizal", grade_level: "Grade 11", track: "academic", strand: "HUMSS", adviser_name: "Mr. Carlos Aquino", capacity: 45, school_year: "2025-2026" },
  { id: "sec-humss-11b", name: "11 - HUMSS Mabini", grade_level: "Grade 11", track: "academic", strand: "HUMSS", adviser_name: "Mrs. Gloria Ramos", capacity: 45, school_year: "2025-2026" },
  { id: "sec-gas-11a", name: "11 - GAS Bonifacio", grade_level: "Grade 11", track: "academic", strand: "GAS", adviser_name: "Mr. Antonio Luna", capacity: 45, school_year: "2025-2026" },
  { id: "sec-tvl-11a", name: "11 - TVL ICT Turing", grade_level: "Grade 11", track: "techpro", strand: "TVL-ICT", adviser_name: "Engr. Mark Castillo", capacity: 40, school_year: "2025-2026" },
  { id: "sec-tvl-11b", name: "11 - TVL HE Escoffier", grade_level: "Grade 11", track: "techpro", strand: "TVL-HE", adviser_name: "Ms. Teresa Garcia", capacity: 40, school_year: "2025-2026" },
  { id: "sec-tvl-11c", name: "11 - TVL IA Tesla", grade_level: "Grade 11", track: "techpro", strand: "TVL-IA", adviser_name: "Mr. Roberto Mendoza", capacity: 40, school_year: "2025-2026" },
];

export function resolveSectionList(
  sections: SectionRecord[] | null | undefined
): SectionRecord[] {
  if (!sections || sections.length === 0) return DEFAULT_SECTIONS;
  return sections;
}
