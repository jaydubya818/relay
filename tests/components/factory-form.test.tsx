// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
/**
 * Component tests for FactoryForm.
 *
 * Covers:
 *  QA-08 — workOrderUrl rendering: localhost/loopback → non-link text with note;
 *           public https → link; javascript:/ftp: → plain text (no link).
 *  QA-11 — non-JSON error body → friendly message; corrected resubmit uses a
 *           NEW idempotency key; "Send another request" resets the form.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, fireEvent, waitFor, act } from "@testing-library/react";
import React from "react";
import { FactoryForm } from "@/components/factory-form";

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------
const mockPush = vi.fn();
const mockRefresh = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: mockPush, refresh: mockRefresh }),
}));

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
/**
 * Build a minimal HostedResult-shaped object to return from a mocked fetch
 * for the "create" operation.
 */
function makeResult(workOrderUrl: string) {
  return {
    requestId: "req-id-1",
    issueIdentifier: "REL-42",
    issueUrl: "https://linear.app/relay/issue/REL-42",
    receipt: {
      version: 1,
      issueId: "req-id-1",
      workOrderId: "wo_test_001",
      state: "ADMITTED",
      updatedAt: "2026-10-22T00:00:00Z",
      workOrderUrl,
    },
  };
}

function fillAndSubmit(container: HTMLElement) {
  fireEvent.change(screen.getByRole("textbox", { name: /title/i }), {
    target: { value: "My work title" },
  });
  fireEvent.change(screen.getByRole("textbox", { name: /description/i }), {
    target: { value: "Some description" },
  });
  fireEvent.change(screen.getByRole("textbox", { name: /acceptance criteria/i }), {
    target: { value: "Criteria line one" },
  });
  fireEvent.change(screen.getByRole("textbox", { name: /permitted repository paths/i }), {
    target: { value: "docs/" },
  });
  // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
  fireEvent.submit(container.querySelector("form")!);
}

// ---------------------------------------------------------------------------
// QA-08: workOrderUrl rendering
// ---------------------------------------------------------------------------
describe("FactoryForm — QA-08: workOrderUrl rendering", () => {
  let fetchSpy: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);
    vi.stubGlobal("crypto", { randomUUID: () => "stable-test-uuid" });
  });
  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it("renders a localhost workOrderUrl as plain text with the local-Mac note", async () => {
    fetchSpy.mockResolvedValueOnce({
      ok: true,
      json: async () => makeResult("http://127.0.0.1:8788/?workOrder=wo_test_001"),
    });
    const { container } = render(<FactoryForm configured />);
    fillAndSubmit(container);

    await waitFor(() => expect(screen.getByRole("status")).toBeInTheDocument());

    // The workOrderId text must appear
    expect(screen.getByText(/wo_test_001/)).toBeInTheDocument();
    // The workOrderId must NOT be inside an <a> tag
    const links = screen.queryAllByRole("link");
    const workOrderLink = links.find((l) => l.textContent?.includes("wo_test_001"));
    expect(workOrderLink).toBeUndefined();
    // The "(local Mac only)" note must be present
    expect(screen.getByText(/local Mac only/i)).toBeInTheDocument();
  });

  it("renders a 127.0.0.1 URL without a link — covers all loopback variants", async () => {
    for (const url of [
      "http://127.0.0.1:8788/",
      "http://localhost:3000/",
      "http://[::1]:8788/",
    ]) {
      fetchSpy.mockResolvedValueOnce({
        ok: true,
        json: async () => makeResult(url),
      });
      const { container, unmount } = render(<FactoryForm configured />);
      fillAndSubmit(container);
      await waitFor(() => expect(screen.getByRole("status")).toBeInTheDocument());
      const links = screen.queryAllByRole("link");
      const workOrderLink = links.find((l) => l.textContent?.includes("wo_test_001"));
      expect(workOrderLink, `expected no link for loopback URL: ${url}`).toBeUndefined();
      unmount();
    }
  });

  it("renders a public https workOrderUrl as a proper link", async () => {
    const publicUrl = "https://myfactory.example.com/workorders/wo_test_001";
    fetchSpy.mockResolvedValueOnce({
      ok: true,
      json: async () => makeResult(publicUrl),
    });
    const { container } = render(<FactoryForm configured />);
    fillAndSubmit(container);

    await waitFor(() => expect(screen.getByRole("status")).toBeInTheDocument());

    // The workOrderId must be an <a> with the correct href
    const link = screen.getByRole("link", { name: /wo_test_001/ });
    expect(link).toBeInTheDocument();
    expect(link).toHaveProperty("href", publicUrl);
    expect(screen.queryByText(/local Mac only/i)).toBeNull();
  });

  it("does NOT render javascript: URLs as links", async () => {
    fetchSpy.mockResolvedValueOnce({
      ok: true,
      // eslint-disable-next-line no-script-url
      json: async () => makeResult("javascript:alert(1)"),
    });
    const { container } = render(<FactoryForm configured />);
    fillAndSubmit(container);

    await waitFor(() => expect(screen.getByRole("status")).toBeInTheDocument());

    const links = screen.queryAllByRole("link");
    const dangerous = links.find((l) => l.getAttribute("href")?.startsWith("javascript"));
    expect(dangerous).toBeUndefined();
    // The workOrderId should still appear as plain text
    expect(screen.getByText(/wo_test_001/)).toBeInTheDocument();
  });

  it("does NOT render ftp: URLs as links", async () => {
    fetchSpy.mockResolvedValueOnce({
      ok: true,
      json: async () => makeResult("ftp://files.example.com/wo_test_001"),
    });
    const { container } = render(<FactoryForm configured />);
    fillAndSubmit(container);

    await waitFor(() => expect(screen.getByRole("status")).toBeInTheDocument());

    const links = screen.queryAllByRole("link");
    const ftpLink = links.find((l) => l.getAttribute("href")?.startsWith("ftp:"));
    expect(ftpLink).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// QA-11: error handling, idempotency key, and "Send another request"
// ---------------------------------------------------------------------------
describe("FactoryForm — QA-11: error handling and idempotency key semantics", () => {
  let fetchSpy: ReturnType<typeof vi.fn>;
  let uuidCounter: number;

  beforeEach(() => {
    fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);
    uuidCounter = 0;
    vi.stubGlobal("crypto", { randomUUID: () => `uuid-${++uuidCounter}` });
  });
  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it("shows a friendly error when the server returns non-JSON (e.g. HTML 500)", async () => {
    fetchSpy.mockResolvedValueOnce({
      ok: false,
      json: async () => { throw new SyntaxError("Unexpected token <"); },
    });
    const { container } = render(<FactoryForm configured />);
    fillAndSubmit(container);

    await waitFor(() => expect(screen.getByRole("alert")).toBeInTheDocument());

    const alert = screen.getByRole("alert");
    // Must contain a user-friendly message, not a raw SyntaxError
    expect(alert.textContent).not.toContain("SyntaxError");
    expect(alert.textContent).not.toContain("Unexpected token");
    expect(alert.textContent?.length).toBeGreaterThan(5);
  });

  it("shows a friendly error when the server returns a JSON error body", async () => {
    fetchSpy.mockResolvedValueOnce({
      ok: false,
      json: async () => ({ message: "MyFactory routing is not configured." }),
    });
    const { container } = render(<FactoryForm configured />);
    fillAndSubmit(container);

    await waitFor(() => expect(screen.getByRole("alert")).toBeInTheDocument());
    expect(screen.getByRole("alert").textContent).toContain("MyFactory routing is not configured.");
  });

  it("sends a DIFFERENT idempotency key when the user corrects fields and resubmits after a failure", async () => {
    // First submission fails
    fetchSpy
      .mockResolvedValueOnce({ ok: false, json: async () => ({ message: "Server error." }) })
      // Second submission succeeds
      .mockResolvedValueOnce({ ok: true, json: async () => ({ ...makeResult("https://example.com/"), requestId: "req-2" }) });

    const { container } = render(<FactoryForm configured />);

    // First submit
    fillAndSubmit(container);
    await waitFor(() => expect(screen.getByRole("alert")).toBeInTheDocument());

    const firstBody = JSON.parse(fetchSpy.mock.calls[0][1].body);
    const firstKey: string = firstBody.input.idempotencyKey;

    // Simulate editing the title (correcting the form)
    fireEvent.change(screen.getByRole("textbox", { name: /title/i }), {
      target: { value: "Corrected work title" },
    });

    // Second submit
    fireEvent.submit(container.querySelector("form")!);
    await waitFor(() => expect(screen.getByRole("status")).toBeInTheDocument());

    const secondBody = JSON.parse(fetchSpy.mock.calls[1][1].body);
    const secondKey: string = secondBody.input.idempotencyKey;

    expect(firstKey).toBeTruthy();
    expect(secondKey).toBeTruthy();
    expect(secondKey).not.toBe(firstKey);
  });

  it("the 'Send to MyFactory' button is disabled while a request is in-flight (prevents double-submit)", async () => {
    let resolveFirstFetch!: (v: unknown) => void;
    const inflight = new Promise((res) => { resolveFirstFetch = res; });
    fetchSpy.mockReturnValueOnce(inflight);

    const { container } = render(<FactoryForm configured />);
    fillAndSubmit(container);

    // Button should be disabled while in-flight
    const button = screen.getByRole("button", { name: /send to myfactory|checking/i });
    expect(button).toBeDisabled();

    // Resolve the in-flight request
    await act(async () => {
      resolveFirstFetch({ ok: true, json: async () => makeResult("https://example.com/") });
    });
  });

  it("'Send another request' resets the form and hides the result panel", async () => {
    fetchSpy.mockResolvedValueOnce({
      ok: true,
      json: async () => makeResult("https://example.com/"),
    });
    const { container } = render(<FactoryForm configured />);
    fillAndSubmit(container);

    await waitFor(() => expect(screen.getByRole("status")).toBeInTheDocument());
    expect(screen.getByText(/received by local factory/i)).toBeInTheDocument();

    // Click "Send another request"
    fireEvent.click(screen.getByRole("button", { name: /send another request/i }));

    // Result panel should be gone; form should be back
    expect(screen.queryByRole("status")).toBeNull();
    expect(screen.queryByText(/received by local factory/i)).toBeNull();
    expect(screen.getByRole("button", { name: /send to myfactory/i })).toBeInTheDocument();
  });

  it("'Send to MyFactory' is re-enabled after 'Send another request' (no permanent disabled)", async () => {
    fetchSpy.mockResolvedValueOnce({
      ok: true,
      json: async () => makeResult("https://example.com/"),
    });
    const { container } = render(<FactoryForm configured />);
    fillAndSubmit(container);

    await waitFor(() => expect(screen.getByRole("status")).toBeInTheDocument());

    fireEvent.click(screen.getByRole("button", { name: /send another request/i }));

    const sendButton = screen.getByRole("button", { name: /send to myfactory/i });
    expect(sendButton).not.toBeDisabled();
  });
});
