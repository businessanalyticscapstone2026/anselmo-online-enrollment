/**
 * Extracts the best-effort client IP address from a request's forwarding
 * headers. Works behind Vercel, Cloudflare, and generic reverse proxies.
 */
export function getClientIp(request: Request): string {
  const headers = request.headers;

  const firstValue = (value: string | null): string => {
    if (!value) return "";
    return value.split(",")[0]?.trim() || "";
  };

  const normalize = (value: string): string => {
    const ip = value.trim();
    if (!ip) return "";

    // IPv4-mapped IPv6 addresses (e.g. ::ffff:203.0.113.5)
    if (ip.toLowerCase().startsWith("::ffff:")) {
      const mapped = ip.slice("::ffff:".length);
      if (mapped.includes(".")) return mapped;
    }

    return ip;
  };

  const candidates = [
    firstValue(headers.get("x-forwarded-for")),
    firstValue(headers.get("x-vercel-forwarded-for")),
    headers.get("cf-connecting-ip") || "",
    headers.get("x-real-ip") || "",
    headers.get("x-client-ip") || "",
  ];

  for (const candidate of candidates) {
    const normalized = normalize(candidate);
    if (normalized) return normalized;
  }

  return "";
}
