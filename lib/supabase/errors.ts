export type DatabaseErrorLike =
  | {
      code?: string | null;
      message?: string | null;
      details?: string | null;
      hint?: string | null;
    }
  | null
  | undefined;

export type DatabaseErrorInfo = {
  code: string | null;
  message: string;
  details: string | null;
  hint: string | null;
};

export type DatabaseIssue =
  | "table_missing"
  | "column_mismatch"
  | "permission_denied"
  | "network"
  | "config"
  | "unknown";

export const RELOAD_SCHEMA_SQL = "NOTIFY pgrst, 'reload schema';";

export function toDatabaseErrorInfo(
  error: DatabaseErrorLike
): DatabaseErrorInfo {
  return {
    code: error?.code ? String(error.code) : null,
    message: error?.message ? String(error.message) : "Unknown database error",
    details: error?.details ? String(error.details) : null,
    hint: error?.hint ? String(error.hint) : null,
  };
}

export function classifyDatabaseError(
  error: DatabaseErrorLike
): DatabaseIssue {
  if (!error) return "unknown";

  const code = String(error.code || "");
  const message = String(error.message || "").toLowerCase();

  if (
    code === "42P01" ||
    code === "PGRST205" ||
    message.includes("could not find the table") ||
    (message.includes("relation") && message.includes("does not exist"))
  ) {
    return "table_missing";
  }

  if (
    code === "PGRST204" ||
    code === "42703" ||
    (message.includes("column") &&
      (message.includes("does not exist") || message.includes("schema cache")))
  ) {
    return "column_mismatch";
  }

  if (
    code === "42501" ||
    message.includes("row-level security") ||
    message.includes("permission denied") ||
    message.includes("insufficient privilege")
  ) {
    return "permission_denied";
  }

  if (
    code === "CONFIG_ERROR" ||
    message.includes("configuration missing") ||
    message.includes("missing supabase")
  ) {
    return "config";
  }

  if (
    message.includes("fetch failed") ||
    message.includes("network") ||
    message.includes("enotfound") ||
    message.includes("econnrefused") ||
    message.includes("etimedout") ||
    message.includes("econnreset")
  ) {
    return "network";
  }

  return "unknown";
}
