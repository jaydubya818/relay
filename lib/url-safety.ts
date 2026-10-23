/**
 * Returns the value if it is a safe same-origin relative return path for use
 * in a post-login redirect, null otherwise.
 *
 * Accepted: relative paths that start with / followed by a non-/ non-\ character
 * and do not start with /login.
 *
 * Rejected:
 *  - Absolute URLs with a scheme (http://, https://, javascript://, ftp://, …)
 *  - Protocol-relative URLs (//evil.com)
 *  - Backslash variants (/\evil.com) — some browsers normalise these to //host
 *  - /login prefix (redirect loops)
 *  - Empty or non-string values
 *
 * Callers receive a decoded string from Next.js searchParams; this function does
 * NOT decode its input. If you need to accept encoded values, decode first.
 */
export function safeReturnTo(value: string | undefined | null): string | null {
  if (!value || typeof value !== "string") return null;
  // Absolute URL: any string with a scheme (e.g. http:, https:, javascript:, ftp:)
  if (/^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(value)) return null;
  // Protocol-relative (// prefix) or backslash variant (/\)
  if (value.startsWith("//") || value.startsWith("/\\")) return null;
  // Must be a relative path: /[non-slash non-backslash]…
  if (!/^\/[^/\\]/.test(value)) return null;
  // Avoid redirect loops back to /login
  if (value.startsWith("/login")) return null;
  return value;
}
