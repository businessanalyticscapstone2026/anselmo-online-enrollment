export const SPECIAL_NEEDS_DIAGNOSES = [
  "Attention Deficit Hyperactivity Disorder",
  "Autism Spectrum Disorder",
  "Cerebral Palsy",
  "Emotional-Behavior Disorder",
  "Hearing Impairment",
  "Intellectual Disability",
  "Learning Disability",
  "Multiple Disabilities",
  "Orthopedic/Physical Handicap",
  "Speech/Language Disorder",
  "Special Health Problem/Chronic Disease",
  "Visual Impairment",
] as const;

export const SPECIAL_NEEDS_MANIFESTATIONS = [
  "Difficulty in Applying Knowledge",
  "Difficulty in Communicating",
  "Difficulty in Displaying Interpersonal Behavior (Emotional and Behavioral)",
  "Difficulty in Hearing",
  "Difficulty in Mobility (Walking, Climbing and Grasping)",
  "Difficulty in Performing Adaptive Skills (Self-Care)",
  "Difficulty in Remembering, Concentrating, Paying Attention and Understanding",
  "Difficulty in Seeing",
] as const;

export const SPECIAL_NEEDS_DETAILS: Record<string, readonly string[]> = {
  "Special Health Problem/Chronic Disease": ["Cancer", "Non-Cancer"],
  "Visual Impairment": ["Blind", "Low Vision"],
};

export const DISTANCE_LEARNING_MODALITIES = [
  "Blended (Combination)",
  "Educational Television",
  "Homeschooling",
  "Modular (Digital)",
  "Modular (Print)",
  "Online",
  "Radio-Based Television",
] as const;

export const SEMESTER_OPTIONS = ["1st", "2nd"] as const;
