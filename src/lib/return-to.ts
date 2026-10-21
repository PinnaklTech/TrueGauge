/**
 * Validate post-login return paths. Only same-origin relative paths starting with `/`
 * are allowed (blocks open redirects).
 */
export function isSafeReturnTo(value: unknown): value is string {
  if (typeof value !== "string") return false;
  const trimmed = value.trim();
  if (!trimmed.startsWith("/")) return false;
  if (trimmed.startsWith("//")) return false;
  if (trimmed.includes("://")) return false;
  if (trimmed.includes("\\")) return false;
  // Disallow protocol-relative and control characters
  if (/[\0-\x1f]/.test(trimmed)) return false;
  return true;
}

export function sanitizeReturnTo(value: unknown, fallback = "/"): string {
  return isSafeReturnTo(value) ? value.trim() : fallback;
}
