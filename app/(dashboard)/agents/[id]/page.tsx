export const metadata = { title: "Agent permissions" };
import Link from "next/link";
import { notFound } from "next/navigation";
import { PageHeader, Status } from "@/components/page";
import { ActivityTimeline } from "@/components/owner-ui";
import { getAgent } from "@/lib/agents";
import { requireUser } from "@/lib/auth";
import { listActivity } from "@/lib/activity";
import { permissionLabel } from "@/lib/owner-presentation";
import { CAPABILITIES } from "@/lib/types";
import { RelayError } from "@/lib/errors";

export default async function AgentDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const user = await requireUser();
  const agent = await getAgent(user.accountId, (await params).id).catch((error: unknown) => {
    if (error instanceof RelayError && error.status === 404) notFound();
    throw error;
  });
  const activity = await listActivity(user.accountId, { agentId: agent.id, limit: 8 });
  const grants = new Map(agent.grants.map((grant) => [grant.capability, grant.effect]));
  const lastUsed = agent.credentials.flatMap((credential) => credential.lastUsedAt ? [credential.lastUsedAt] : []).sort().at(-1);
  return <>
    <PageHeader eyebrow="Your Agent" title={agent.name} description={agent.description || "Agent registered with your account"} action={<Status value={agent.status} />} />
    <div className="owner-actions"><Link className="text-link" href={`/activity?agent=${encodeURIComponent(agent.id)}`}>View all activity</Link><Link className="text-link" href={`/agents/${agent.id}/advanced`}>Advanced Agent tools</Link></div>
    <section className="grid two-col section-gap"><div className="stack"><section className="card" id="permissions"><h2>Permissions</h2>
      <p className="subtle">These are this Agent’s recorded permissions. An allowed permission still requires the relevant service, policy and resource access. An active identity does not mean every service is ready.</p>
      <ul className="owner-list">{CAPABILITIES.filter((capability) => grants.get(capability) === "ALLOW").map((capability) => <li className="owner-row" key={capability}><span>{permissionLabel(capability)}</span><span className="owner-outcome success">Allowed by grant</span></li>)}</ul>
      {!agent.grants.some((grant) => grant.effect === "ALLOW") && <p>No permissions are currently granted.</p>}
      <details className="technical-details"><summary>Other permissions — not granted</summary><ul className="owner-list">{CAPABILITIES.filter((capability) => grants.get(capability) !== "ALLOW").map((capability) => <li className="owner-row" key={capability}><span>{permissionLabel(capability)}</span><span className="owner-outcome neutral">{grants.get(capability) === "DENY" ? "Denied by grant" : "Not granted"}</span></li>)}</ul></details>
    </section><section className="card"><h2>Recent activity</h2><ActivityTimeline activity={activity} /></section></div>
    <aside className="stack"><section className="card"><h2>About this Agent</h2><dl className="owner-facts"><dt>Status</dt><dd>{agent.status}</dd><dt>Last active</dt><dd>{lastUsed ? `${new Date(lastUsed).toLocaleString("en-US", { timeZone: "UTC" })} UTC` : "No activity recorded"}</dd><dt>Registered</dt><dd>{new Date(agent.createdAt).toLocaleDateString("en-US", { timeZone: "UTC" })}</dd></dl><p className="subtle">Application identity and runtime sessions can be inspected in Advanced Agent tools. A reported application name is not proof of a verified connection.</p></section>
    <section className="card"><h2>Connection access</h2><p className="subtle">Permissions do not automatically connect a service. Review your account’s connections alongside this Agent’s permissions.</p><Link className="text-link" href="/connections">View connections →</Link></section></aside></section>
  </>;
}
