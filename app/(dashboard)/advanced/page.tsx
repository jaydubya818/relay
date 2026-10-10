export const metadata = { title: "Developer tools" };
import Link from "next/link";
import { requireUser } from "@/lib/auth";
import { PageHeader, Status } from "@/components/page";
import { OwnerIcon } from "@/components/owner-icons";
import { ownerOperations } from "@/lib/owner-workspace";
import { runtimeActionsEnabled } from "@/lib/v2/deployment";

export default async function AdvancedPage() {
  const user = await requireUser(); const membership = await ownerOperations(user);
  const factory = user.role === "OWNER" && user.accountId === process.env.MYFACTORY_RELAY_ACCOUNT_ID && Boolean(process.env.MYFACTORY_CLIENT_TOKEN);
  const groups = [
    { id: "infrastructure", title: "Agent infrastructure", description: "Identity, scoped access and shared context.", tools: [
      ["MCP", "/developer", "Connect an Agent with its own scoped credentials.", "NOT_CHECKED"], ["Agent administration", "/advanced/agents", "Credential and identity diagnostics.", "AVAILABLE"], ["Memory", "/memory", "Inspect stored account memory and retrieval scope.", "AVAILABLE"],
    ] },
    { id: "execution", title: "Execution", description: "Inspect execution resources. Backend admission still applies.", tools: [
      ["Sandboxes", "/sandboxes", "Execution environments and resource access.", "NOT_CHECKED"], ["Browsers", "/browsers", "Browser sessions and ownership.", "NOT_CHECKED"], ["MyFactory", "/factory", "Bounded Work dispatch and receipt diagnostics.", factory ? "CONFIGURED" : "NOT_CONFIGURED"],
    ] },
    { id: "integrations", title: "Integrations", description: "Provider setup and event delivery.", tools: [
      ["Connection setup", "/advanced/connections", "OAuth, manual setup and connection evidence.", "AVAILABLE"], ["Events", "/events", "Recorded events, delivery inboxes and wake requests.", "NOT_CHECKED"],
    ] },
    { id: "governance", title: "Governance", description: "Policies, audit and measured diagnostics.", tools: [
      ["V2 operations", "/v2", !membership ? "Active V2 membership is required by the existing route." : runtimeActionsEnabled() ? "Runtime actions enabled; per-operation admission required." : "Runtime actions intentionally disabled by deployment policy.", !membership ? "UNAVAILABLE" : runtimeActionsEnabled() ? "ENABLED" : "DISABLED"],
      ["Audit", "/v2/activity", "Canonical V2 audit records; active membership required.", membership ? "AVAILABLE" : "UNAVAILABLE"], ["System health", "/advanced/health", "Database reads succeeded. Provider probes are run on request.", "NOT_CHECKED"],
    ] },
  ];
  return <><PageHeader eyebrow="ADVANCED WORKSPACE" title="Developer tools" description="The technical surface of Relay, organized around the work you need to do." /><p className="workspace-note">Signed in as {user.role === "OWNER" ? "an account owner" : "an account member"}. Existing server permissions apply. Availability describes configuration or route access; it is not proof of provider health.</p><section className="card">{groups.map((group) => <section className="technical-section" key={group.id} id={group.id} aria-labelledby={`tools-${group.id}`}><div><h2 id={`tools-${group.id}`}>{group.title}</h2><p>{group.description}</p></div><div>{group.tools.map(([label, href, description, status]) => <Link className="tool-row" key={href} href={href}><div><strong>{label}</strong><small>{description}</small></div><Status value={status} /><OwnerIcon name="Arrow" /></Link>)}</div></section>)}</section><p className="workspace-note">Not checked means no live probe has run. Disabled and not configured are intentional states, not unexplained failures.</p></>;
}
