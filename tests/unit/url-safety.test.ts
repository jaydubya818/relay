/**
 * Unit tests for lib/url-safety.ts (safeReturnTo) and the URL-classification
 * helpers exported from components/factory-form.tsx (isLocalhostUrl,
 * isSafeExternalUrl).
 *
 * Covers QA-01/QA-36 returnTo validation and QA-08 workOrderUrl classification.
 */
import { describe, expect, it } from "vitest";
import { safeReturnTo } from "@/lib/url-safety";
import { isLocalhostUrl, isSafeExternalUrl } from "@/components/factory-form";

// ---------------------------------------------------------------------------
// safeReturnTo — QA-01 / QA-36 open-redirect guard
// ---------------------------------------------------------------------------
describe("safeReturnTo — valid relative paths", () => {
  it("accepts a simple relative path", () => expect(safeReturnTo("/agents")).toBe("/agents"));
  it("accepts a path with segments", () => expect(safeReturnTo("/agents/agt_sofie")).toBe("/agents/agt_sofie"));
  it("accepts a path with a query string", () => expect(safeReturnTo("/factory?q=1")).toBe("/factory?q=1"));
  it("accepts /v2 paths", () => expect(safeReturnTo("/v2/tasks")).toBe("/v2/tasks"));
});

describe("safeReturnTo — protocol-relative and backslash attacks", () => {
  it("rejects //evil.com", () => expect(safeReturnTo("//evil.com")).toBeNull());
  it("rejects //evil.com/path", () => expect(safeReturnTo("//evil.com/path")).toBeNull());
  it("rejects /\\evil.com", () => expect(safeReturnTo("/\\evil.com")).toBeNull());
  it("rejects /\\\\evil.com", () => expect(safeReturnTo("/\\\\evil.com")).toBeNull());
  // A single forward-slash alone is not a valid path (requires a non-slash follow char)
  it("rejects bare /", () => expect(safeReturnTo("/")).toBeNull());
  it("rejects ///triple-slash", () => expect(safeReturnTo("///triple")).toBeNull());
});

describe("safeReturnTo — absolute URL rejection", () => {
  it("rejects http://", () => expect(safeReturnTo("http://evil.com")).toBeNull());
  it("rejects https://", () => expect(safeReturnTo("https://evil.com")).toBeNull());
  it("rejects javascript: scheme", () => expect(safeReturnTo("javascript:alert(1)")).toBeNull());
  it("rejects ftp://", () => expect(safeReturnTo("ftp://evil.com")).toBeNull());
  it("rejects data: URI", () => expect(safeReturnTo("data:text/html,<b>x</b>")).toBeNull());
  it("rejects vbscript:", () => expect(safeReturnTo("vbscript:msgbox(1)")).toBeNull());
});

describe("safeReturnTo — encoded variants (Next.js searchParams decodes these before passing in)", () => {
  // Next.js already decodes searchParams values, so the validator sees decoded strings.
  it("rejects decoded //evil.com (from %2F%2Fevil.com)", () =>
    expect(safeReturnTo("//evil.com")).toBeNull());
  it("rejects decoded http://evil.com", () =>
    expect(safeReturnTo("http://evil.com")).toBeNull());
  // A genuine encoded path segment (e.g. /agents%2Fxyz) should be accepted since
  // Next.js passes it decoded as /agents/xyz → but the raw value is already relative.
  it("accepts a decoded path with encoded characters", () =>
    expect(safeReturnTo("/agents/sofie%20main")).toBe("/agents/sofie%20main"));
});

describe("safeReturnTo — redirect-loop and null/empty guards", () => {
  it("rejects /login (redirect loop)", () => expect(safeReturnTo("/login")).toBeNull());
  it("rejects /login?returnTo=…", () => expect(safeReturnTo("/login?returnTo=/agents")).toBeNull());
  it("rejects null", () => expect(safeReturnTo(null)).toBeNull());
  it("rejects undefined", () => expect(safeReturnTo(undefined)).toBeNull());
  it("rejects empty string", () => expect(safeReturnTo("")).toBeNull());
});

// ---------------------------------------------------------------------------
// isLocalhostUrl — QA-08 loopback detection
// ---------------------------------------------------------------------------
describe("isLocalhostUrl", () => {
  it("detects 127.0.0.1", () =>
    expect(isLocalhostUrl("http://127.0.0.1:8788/?workOrder=wo_1")).toBe(true));
  it("detects localhost", () =>
    expect(isLocalhostUrl("http://localhost:3000/")).toBe(true));
  it("detects ::1 (IPv6 loopback)", () =>
    expect(isLocalhostUrl("http://[::1]:8788/")).toBe(true));
  it("returns false for a public https URL", () =>
    expect(isLocalhostUrl("https://myfactory.example.com/wo/1")).toBe(false));
  it("returns false for an unparseable string", () =>
    expect(isLocalhostUrl("not a url")).toBe(false));
  it("returns false for javascript: scheme (not a network URL)", () =>
    expect(isLocalhostUrl("javascript:alert(1)")).toBe(false));
});

// ---------------------------------------------------------------------------
// isSafeExternalUrl — QA-08 link-render guard
// ---------------------------------------------------------------------------
describe("isSafeExternalUrl", () => {
  it("accepts a public https URL", () =>
    expect(isSafeExternalUrl("https://myfactory.example.com/wo/1")).toBe(true));
  it("accepts a public http URL", () =>
    expect(isSafeExternalUrl("http://myfactory.example.com/wo/1")).toBe(true));
  it("rejects 127.0.0.1 (loopback)", () =>
    expect(isSafeExternalUrl("http://127.0.0.1:8788/?workOrder=wo_1")).toBe(false));
  it("rejects localhost (loopback)", () =>
    expect(isSafeExternalUrl("http://localhost:3000/")).toBe(false));
  it("rejects ::1 (IPv6 loopback)", () =>
    expect(isSafeExternalUrl("http://[::1]:8788/")).toBe(false));
  it("rejects javascript: scheme", () =>
    expect(isSafeExternalUrl("javascript:alert(1)")).toBe(false));
  it("rejects ftp: scheme", () =>
    expect(isSafeExternalUrl("ftp://files.example.com/")).toBe(false));
  it("rejects data: URIs", () =>
    expect(isSafeExternalUrl("data:text/html,<b>x</b>")).toBe(false));
  it("rejects unparseable strings", () =>
    expect(isSafeExternalUrl("not a url")).toBe(false));
});
