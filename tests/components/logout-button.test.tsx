// @vitest-environment happy-dom
import "@testing-library/jest-dom/vitest";
/**
 * Component tests for LogoutButton.
 *
 * Covers QA-35:
 *  - A failed logout (non-OK response) shows a role="alert" error message
 *    and does NOT navigate to /login.
 *  - A successful logout navigates to /login.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, fireEvent, waitFor } from "@testing-library/react";
import React from "react";
import { LogoutButton } from "@/components/actions";

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------
const mockPush = vi.fn();
const mockRefresh = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: mockPush, refresh: mockRefresh }),
}));

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------
describe("LogoutButton — QA-35", () => {
  let fetchSpy: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);
    mockPush.mockReset();
    mockRefresh.mockReset();
  });
  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it("shows a role='alert' error and does NOT navigate when the logout API returns a non-OK response", async () => {
    fetchSpy.mockResolvedValueOnce({
      ok: false,
      json: async () => ({ error: "Session already expired." }),
    });

    render(<LogoutButton />);
    fireEvent.click(screen.getByRole("button", { name: /sign out/i }));

    await waitFor(() => expect(screen.getByRole("alert")).toBeInTheDocument());

    expect(screen.getByRole("alert").textContent).toContain("Session already expired.");
    expect(mockPush).not.toHaveBeenCalled();
  });

  it("does NOT navigate when the logout API returns a network-level error", async () => {
    fetchSpy.mockRejectedValueOnce(new TypeError("Failed to fetch"));

    render(<LogoutButton />);
    fireEvent.click(screen.getByRole("button", { name: /sign out/i }));

    await waitFor(() => expect(screen.getByRole("alert")).toBeInTheDocument());

    expect(screen.getByRole("alert").textContent).toBeTruthy();
    expect(mockPush).not.toHaveBeenCalled();
  });

  it("navigates to /login when the logout API succeeds", async () => {
    fetchSpy.mockResolvedValueOnce({ ok: true, json: async () => ({ ok: true }) });

    render(<LogoutButton />);
    fireEvent.click(screen.getByRole("button", { name: /sign out/i }));

    await waitFor(() => expect(mockPush).toHaveBeenCalledWith("/login"));
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("disables the button while the logout request is in-flight", async () => {
    let resolveLogout!: (v: unknown) => void;
    const inflight = new Promise((res) => { resolveLogout = res; });
    fetchSpy.mockReturnValueOnce(inflight);

    render(<LogoutButton />);
    fireEvent.click(screen.getByRole("button", { name: /sign out/i }));

    // Button should be disabled while in-flight
    const button = screen.getByRole("button", { name: /signing out/i });
    expect(button).toBeDisabled();

    // Let it resolve so we don't leak the promise
    resolveLogout({ ok: true, json: async () => ({ ok: true }) });
    await waitFor(() => expect(mockPush).toHaveBeenCalled());
  });

  it("re-enables the button after a failed logout so the user can retry", async () => {
    fetchSpy.mockResolvedValueOnce({
      ok: false,
      json: async () => ({ error: "Internal error." }),
    });

    render(<LogoutButton />);
    fireEvent.click(screen.getByRole("button", { name: /sign out/i }));

    await waitFor(() => expect(screen.getByRole("alert")).toBeInTheDocument());

    // Button should be enabled again for retry
    expect(screen.getByRole("button", { name: /sign out/i })).not.toBeDisabled();
  });
});
