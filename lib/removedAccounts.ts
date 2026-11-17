import fs from "fs";
import path from "path";
import { createClient } from "@supabase/supabase-js";

export interface RemovedAccountRecord {
  email: string;
  userId?: string;
  role?: string;
  removed_at: string;
  removed_by?: string;
}

function getDataFilePath(): string {
  // Try relative to cwd or module
  const cwd = process.cwd();
  if (fs.existsSync(path.join(cwd, "data"))) {
    return path.join(cwd, "data", "removed_accounts.json");
  }
  // If cwd is repo root
  if (fs.existsSync(path.join(cwd, "online-enrollment", "data"))) {
    return path.join(cwd, "online-enrollment", "data", "removed_accounts.json");
  }
  return path.join(cwd, "data", "removed_accounts.json");
}

function readLocalRemovedAccounts(): RemovedAccountRecord[] {
  try {
    const filePath = getDataFilePath();
    if (!fs.existsSync(filePath)) {
      // Ensure directory
      fs.mkdirSync(path.dirname(filePath), { recursive: true });
      const initial: RemovedAccountRecord[] = [
        {
          email: "kraymikata@gmail.com",
          role: "student",
          removed_at: "2026-11-06T00:00:00.000Z",
          removed_by: "unknown",
        },
      ];
      fs.writeFileSync(filePath, JSON.stringify(initial, null, 2), "utf-8");
      return initial;
    }
    const raw = fs.readFileSync(filePath, "utf-8");
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch (err) {
    console.warn("Notice: could not read local removed_accounts.json:", err);
    return [
      {
        email: "kraymikata@gmail.com",
        role: "student",
        removed_at: "2026-11-06T00:00:00.000Z",
        removed_by: "unknown",
      },
    ];
  }
}

function writeLocalRemovedAccount(record: RemovedAccountRecord): void {
  try {
    const filePath = getDataFilePath();
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    const list = readLocalRemovedAccounts();
    const cleanEmail = record.email.trim().toLowerCase();
    const exists = list.some(
      (item) => item.email.trim().toLowerCase() === cleanEmail
    );
    if (!exists) {
      list.push(record);
      fs.writeFileSync(filePath, JSON.stringify(list, null, 2), "utf-8");
    }
  } catch (err) {
    console.warn("Notice: could not write to local removed_accounts.json:", err);
  }
}

function removeLocalRemovedAccount(email: string): void {
  try {
    const filePath = getDataFilePath();
    const list = readLocalRemovedAccounts();
    const cleanEmail = email.trim().toLowerCase();
    const filtered = list.filter(
      (item) => item.email.trim().toLowerCase() !== cleanEmail
    );

    if (filtered.length !== list.length) {
      fs.mkdirSync(path.dirname(filePath), { recursive: true });
      fs.writeFileSync(filePath, JSON.stringify(filtered, null, 2), "utf-8");
    }
  } catch (err) {
    console.warn("Notice: could not update local removed_accounts.json:", err);
  }
}

function getSupabaseAdmin() {
  const supabaseUrl =
    process.env.NEXT_PUBLIC_SUPABASE_URL ||
    "https://tmrimwhwwvojbsztnbxf.supabase.co";
  const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseKey) return null;
  return createClient(supabaseUrl, supabaseKey, {
    auth: { persistSession: false },
  });
}

/**
 * Record that an account has been removed by the administrator.
 */
export async function recordRemovedAccount(params: {
  email: string;
  userId?: string;
  role?: string;
  removedBy?: string;
}): Promise<void> {
  const cleanEmail = params.email.trim().toLowerCase();
  const record: RemovedAccountRecord = {
    email: cleanEmail,
    userId: params.userId,
    role: params.role || "student",
    removed_at: new Date().toISOString(),
    removed_by: params.removedBy || "unknown",
  };

  // 1. Save to local JSON store
  writeLocalRemovedAccount(record);

  // 2. Persist to Supabase if configured
  const supabaseAdmin = getSupabaseAdmin();
  if (supabaseAdmin) {
    // Try inserting into removed_accounts table
    try {
      await supabaseAdmin.from("removed_accounts").upsert(
        {
          email: cleanEmail,
          user_id: params.userId || null,
          role: params.role || "student",
          removed_at: record.removed_at,
          removed_by: record.removed_by,
        },
        { onConflict: "email" }
      );
    } catch {
      // Table might not exist yet; safe to ignore
    }

    // Try tagging student_applications if matching user_id
    if (params.userId) {
      try {
        const { data: apps } = await supabaseAdmin
          .from("student_applications")
          .select("id, student_details")
          .eq("user_id", params.userId);

        if (apps && apps.length > 0) {
          for (const app of apps) {
            const details =
              app.student_details && typeof app.student_details === "object"
                ? (app.student_details as Record<string, unknown>)
                : {};
            await supabaseAdmin
              .from("student_applications")
              .update({
                user_id: null,
                student_details: {
                  ...details,
                  account_removed: true,
                  account_status: "removed",
                  account_removed_at: record.removed_at,
                  account_removed_by: record.removed_by,
                },
              })
              .eq("id", app.id);
          }
        }
      } catch {
        // Safe to ignore
      }
    }
  }
}

/**
 * Clear the removed-account marker for an email that is being re-added.
 */
export async function clearRemovedAccount(rawEmail: string): Promise<void> {
  if (!rawEmail || typeof rawEmail !== "string") return;
  const cleanEmail = rawEmail.trim().toLowerCase();
  if (!cleanEmail) return;

  removeLocalRemovedAccount(cleanEmail);

  const supabaseAdmin = getSupabaseAdmin();
  if (!supabaseAdmin) return;

  try {
    await supabaseAdmin
      .from("removed_accounts")
      .delete()
      .ilike("email", cleanEmail);
  } catch (err) {
    console.warn("Notice: could not clear removed account record:", err);
  }
}

/**
 * Check whether an email belongs to an account that has been removed by the administrator.
 */
export async function isAccountRemoved(rawEmail: string): Promise<boolean> {
  if (!rawEmail || typeof rawEmail !== "string") return false;
  const cleanEmail = rawEmail.trim().toLowerCase();
  if (!cleanEmail) return false;

  const supabaseAdmin = getSupabaseAdmin();

  // Active staff and administrator profiles take precedence over older
  // removal markers so reinstated accounts can sign in and reset passwords.
  if (supabaseAdmin) {
    try {
      const { data: activeProfiles } = await supabaseAdmin
        .from("profiles")
        .select("role")
        .ilike("email", cleanEmail);

      const hasPrivilegedProfile = (activeProfiles || []).some((profile) => {
        const role = String(profile.role ?? "").trim().toLowerCase();
        return ["staff", "registrar", "admin", "ict_admin"].includes(role);
      });

      if (hasPrivilegedProfile) return false;
    } catch {
      // Safe to ignore and fall back to removal records.
    }
  }

  // 1. Check local data store
  const localList = readLocalRemovedAccounts();
  const foundInLocal = localList.some(
    (item) => item.email.trim().toLowerCase() === cleanEmail
  );
  if (foundInLocal) return true;

  // 2. Check Supabase
  if (!supabaseAdmin) return false;

  // Check removed_accounts table
  try {
    const { data: removedRecord } = await supabaseAdmin
      .from("removed_accounts")
      .select("email")
      .ilike("email", cleanEmail)
      .maybeSingle();

    if (removedRecord) return true;
  } catch {
    // Table might not exist yet
  }

  // Check activity_logs table
  try {
    const { data: logs } = await supabaseAdmin
      .from("activity_logs")
      .select("action")
      .ilike("action", "%Removed User Account%")
      .ilike("action", `%${cleanEmail}%`)
      .limit(1);

    if (logs && logs.length > 0) return true;
  } catch {
    // Table might not exist yet
  }

  // Check student_applications
  try {
    const { data: apps } = await supabaseAdmin
      .from("student_applications")
      .select("id, student_details")
      .limit(100);

    if (apps) {
      for (const app of apps) {
        const details =
          app.student_details && typeof app.student_details === "object"
            ? (app.student_details as Record<string, unknown>)
            : null;
        if (details) {
          const detailEmail =
            typeof details.email === "string" ? details.email.toLowerCase() : "";
          if (
            detailEmail === cleanEmail &&
            (details.account_removed === true || details.account_status === "removed")
          ) {
            return true;
          }
        }
      }
    }
  } catch {
    // Safe to ignore
  }

  return false;
}

