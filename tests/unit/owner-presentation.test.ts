import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { createElement } from "react";
import { ActivityTimeline } from "@/components/owner-ui";
import { Status } from "@/components/page";
import { ownerNavigation, advancedNavigation, activityLabel, permissionLabel } from "@/lib/owner-presentation";
import { CAPABILITIES } from "@/lib/types";

describe("owner presentation without authority changes", () => {
  it("keeps infrastructure out of primary navigation and intentionally reachable in Advanced", () => {
    expect(ownerNavigation.map(([label]) => label)).toEqual(["Home", "Agents", "Connections", "Activity", "Settings"]);
    expect(advancedNavigation.map(([, href]) => href)).toEqual(expect.arrayContaining(["/developer", "/factory", "/events", "/sandboxes", "/browsers", "/memory", "/v2"]));
  });
  it("labels every current grant without inventing permissions", () => {
    for (const capability of CAPABILITIES) expect(permissionLabel(capability)).not.toBe(capability);
    expect(permissionLabel("future.permission")).toBe("future.permission");
    expect(activityLabel("custom.action")).toBe("Recorded action: custom.action");
  });
  it("keeps denied actions distinct from completed work and retains exact audit references", () => {
    const html = renderToStaticMarkup(createElement(ActivityTimeline, { activity: [{ id: "audit-123", agentId: "agent", agentName: "Sofie", sessionId: "session", capability: "memory.read", provider: null, resourceType: null, resourceId: null, action: "memory.read", status: "DENIED", durationMs: 1, createdAt: "2026-01-15T12:00:00Z", metadata: {} }] }));
    expect(html).toContain("Not allowed"); expect(html).not.toContain("Completed");
    expect(html).toContain("audit-123"); expect(html).toContain("memory.read");
  });
  it("does not style disabled or unconfigured systems as failures", () => {
    for (const value of ["DISABLED", "NOT_CONFIGURED", "NOT_CHECKED"]) {
      expect(renderToStaticMarkup(createElement(Status, { value }))).toContain("status neutral");
    }
  });
});
