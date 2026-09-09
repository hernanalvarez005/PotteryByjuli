// SSRF-safe validation for "importar imagen desde URL" (Productos →
// imágenes). Two layers on purpose: reject the URL/hostname on its face
// (sección 49's explicit blocklist), then resolve DNS and reject again if
// the hostname resolves to a private/reserved address — a hostname like
// "totally-legit-cdn.example.com" that happens to resolve to 127.0.0.1 or
// a cloud metadata endpoint has to be caught too, not just literal
// "localhost".

export const ALLOWED_IMAGE_CONTENT_TYPES = ["image/jpeg", "image/png", "image/webp"];
export const MAX_IMAGE_BYTES = 10 * 1024 * 1024; // 10 MB

/** True for any IPv4/IPv6 address that's loopback, private, link-local
 * (this covers the 169.254.169.254 cloud metadata endpoint), or otherwise
 * not a normal public host. */
export function isPrivateOrReservedIp(ip: string): boolean {
  // IPv4
  const v4 = ip.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (v4) {
    const [a, b] = [Number(v4[1]), Number(v4[2])];
    if (a === 127) return true; // loopback
    if (a === 10) return true; // private
    if (a === 172 && b >= 16 && b <= 31) return true; // private
    if (a === 192 && b === 168) return true; // private
    if (a === 169 && b === 254) return true; // link-local incl. cloud metadata
    if (a === 100 && b >= 64 && b <= 127) return true; // carrier-grade NAT
    if (a === 0) return true; // "this network"
    if (a >= 224) return true; // multicast/reserved
    return false;
  }
  // IPv6 (best-effort, string-based — good enough for the shapes that matter here)
  const lower = ip.toLowerCase();
  if (lower === "::1") return true; // loopback
  if (lower.startsWith("::ffff:")) return isPrivateOrReservedIp(lower.slice(7)); // IPv4-mapped
  if (lower.startsWith("fc") || lower.startsWith("fd")) return true; // unique local (fc00::/7)
  if (lower.startsWith("fe8") || lower.startsWith("fe9") || lower.startsWith("fea") || lower.startsWith("feb")) {
    return true; // link-local (fe80::/10)
  }
  return false;
}

const BLOCKED_HOSTNAMES = new Set(["localhost", "0.0.0.0", "metadata.google.internal"]);

export type UrlValidationResult = { ok: true; url: URL } | { ok: false; error: string };

/** First-pass check: scheme + obviously-blocked hostnames. Does not
 * resolve DNS — call resolvesToPublicAddress() for that before fetching. */
export function validateImageUrlShape(rawUrl: string): UrlValidationResult {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    return { ok: false, error: "URL inválida." };
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    return { ok: false, error: "Sólo se permiten URLs http o https." };
  }
  const hostname = url.hostname.toLowerCase();
  if (BLOCKED_HOSTNAMES.has(hostname)) {
    return { ok: false, error: "Ese host no está permitido." };
  }
  if (isPrivateOrReservedIp(hostname)) {
    return { ok: false, error: "Ese host no está permitido." };
  }
  return { ok: true, url };
}

export function isAllowedImageContentType(contentType: string | null): boolean {
  if (!contentType) return false;
  const base = contentType.split(";")[0].trim().toLowerCase();
  return ALLOWED_IMAGE_CONTENT_TYPES.includes(base);
}

export function extensionForContentType(contentType: string): string {
  const base = contentType.split(";")[0].trim().toLowerCase();
  if (base === "image/png") return "png";
  if (base === "image/webp") return "webp";
  return "jpg";
}
