export function normalizeEmail(value: unknown): string {
  return typeof value === "string" ? value.trim().toLowerCase() : "";
}

export function joinNameParts(...parts: unknown[]): string {
  return parts
    .map((part) => (typeof part === "string" ? part.trim() : ""))
    .filter(Boolean)
    .join(" ")
    .replace(/\s+/g, " ")
    .trim();
}

export function nameFromEmail(value: unknown): string {
  const email = normalizeEmail(value);
  if (!email) return "";

  const localPart = email.split("@")[0] || "";
  const words = localPart.replace(/[._-]+/g, " ").replace(/\s+/g, " ").trim();

  if (!words) return "";

  return words.replace(/\b\w/g, (character) => character.toUpperCase());
}

export function formatAccountName(
  source: {
    fullName?: unknown;
    firstName?: unknown;
    middleName?: unknown;
    lastName?: unknown;
  },
  email?: unknown
): string {
  const explicitName = joinNameParts(source.fullName);
  if (explicitName) return explicitName;

  const compositeName = joinNameParts(
    source.firstName,
    source.middleName,
    source.lastName
  );
  if (compositeName) return compositeName;

  return nameFromEmail(email);
}
