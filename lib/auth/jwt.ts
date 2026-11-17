export function readJwtAal(token: string | undefined | null): string {
  if (!token) return "";

  const segment = token.split(".")[1];
  if (!segment) return "";

  try {
    const normalized = segment.replace(/-/g, "+").replace(/_/g, "/");
    const padded = normalized.padEnd(
      normalized.length + ((4 - (normalized.length % 4)) % 4),
      "="
    );
    const payload = JSON.parse(
      Buffer.from(padded, "base64").toString("utf8")
    ) as { aal?: string };
    return payload.aal || "";
  } catch {
    return "";
  }
}
