import { secondsUntilManilaMidnight } from "./manilaDay";

export type MfaArea = "staff" | "admin";

export const MFA_COOKIE_NAMES: Record<MfaArea, string> = {
  staff: "aasmnhs_mfa_staff",
  admin: "aasmnhs_mfa_admin",
};

type MfaTokenPayload = {
  u: string;
  a: MfaArea;
  e: number;
  f?: boolean;
};

function getMfaSecret(): string {
  return (process.env.MFA_SESSION_SECRET || "").trim();
}

export function adminRequiresTotp(): boolean {
  return (process.env.ADMIN_REQUIRE_TOTP || "true").trim().toLowerCase() !== "false";
}

export function mfaCookieMaxAgeSeconds(): number {
  return secondsUntilManilaMidnight();
}

function bytesToBase64Url(bytes: Uint8Array): string {
  let binary = "";
  for (let index = 0; index < bytes.length; index += 1) {
    binary += String.fromCharCode(bytes[index]);
  }
  return btoa(binary)
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

function base64UrlToBytes(value: string): Uint8Array {
  const normalized = value.replace(/-/g, "+").replace(/_/g, "/");
  const padded = normalized.padEnd(
    normalized.length + ((4 - (normalized.length % 4)) % 4),
    "="
  );
  const binary = atob(padded);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return bytes;
}

async function signPayload(payload: string, secret: string): Promise<Uint8Array> {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );

  const signature = await crypto.subtle.sign(
    "HMAC",
    key,
    new TextEncoder().encode(payload)
  );

  return new Uint8Array(signature);
}

function constantTimeEqual(left: Uint8Array, right: Uint8Array): boolean {
  if (left.length !== right.length) return false;

  let mismatch = 0;
  for (let index = 0; index < left.length; index += 1) {
    mismatch |= left[index] ^ right[index];
  }
  return mismatch === 0;
}

export async function createMfaToken(params: {
  userId: string;
  area: MfaArea;
  full?: boolean;
  ttlSeconds?: number;
}): Promise<string> {
  const secret = getMfaSecret();
  if (!secret) {
    throw new Error("MFA_SESSION_SECRET is not configured.");
  }

  const ttl = params.ttlSeconds ?? secondsUntilManilaMidnight();
  const payload: MfaTokenPayload = {
    u: params.userId,
    a: params.area,
    e: Math.floor(Date.now() / 1000) + ttl,
    f: params.full === true,
  };

  const encodedPayload = bytesToBase64Url(
    new TextEncoder().encode(JSON.stringify(payload))
  );
  const signature = await signPayload(encodedPayload, secret);

  return `${encodedPayload}.${bytesToBase64Url(signature)}`;
}

export async function verifyMfaToken(
  token: string | undefined | null,
  expected: { userId: string; area: MfaArea },
  options?: { requireFull?: boolean }
): Promise<boolean> {
  const secret = getMfaSecret();
  if (!secret || !token) return false;

  const [encodedPayload, encodedSignature] = token.split(".");
  if (!encodedPayload || !encodedSignature) return false;

  try {
    const expectedSignature = await signPayload(encodedPayload, secret);
    const providedSignature = base64UrlToBytes(encodedSignature);

    if (!constantTimeEqual(expectedSignature, providedSignature)) {
      return false;
    }

    const payload = JSON.parse(
      new TextDecoder().decode(base64UrlToBytes(encodedPayload))
    ) as Partial<MfaTokenPayload>;

    if (
      payload.u !== expected.userId ||
      payload.a !== expected.area ||
      typeof payload.e !== "number"
    ) {
      return false;
    }

    if (options?.requireFull && payload.f !== true) {
      return false;
    }

    return payload.e > Math.floor(Date.now() / 1000);
  } catch {
    return false;
  }
}
