export const metadata = { title: "Home" };
import Link from "next/link";
import { requireUser } from "@/lib/auth";
import { listAgents } from "@/lib/agents";
import { listConnections } from "@/lib/connections";
import { listActivity } from "@/lib/activity";
import { PageHeader, Status } from "@/components/page";
import { ActivityTimeline, EmptyState } from "@/components/owner-ui";
import { providerLabel } from "@/lib/owner-presentation";

export default async function HomePage() {
  const user = await requireUser();
  const [agents, connections, activity] = await Promise.all([
    listAgents(user.accountId), listConnections(user.accountId), listActivity(user.accountId, { limit: 6 }),
  ]);
  const attention = connections.filter((connection) => connection.status === "ERROR");
  return <>
    <PageHeader eyebrow="Relay" title="Home" description="Your agents and connections. See what they can access and what they have been doing." />
    {attention.length > 0 && <section className="card section-gap" aria-labelledby="attention-title"><h2 id="attention-title">Needs attention</h2>
      {attention.map((connection) => <p key={connection.id}>{providerLabel(connection.provider)} needs attention. <Link className="text-link" href="/connections">Review connection</Link></p>)}
    </section>}
    <section className="grid two-col owner-home">
      <div className="stack"><section className="card"><div className="owner-section-head"><h2>Agents</h2><Link className="text-link" href="/agents">View all agents</Link></div>
        {agents.length ? <ul className="owner-list">{agents.slice(0, 6).map((agent) => <li key={agent.id}><Link className="owner-row" href={`/agents/${agent.id}`}><div><strong>{agent.name}</strong><p className="subtle">{agent.description || "Agent registered with your account"}</p></div><Status value={agent.status} /></Link></li>)}</ul>
          : <EmptyState title="No Agents are connected yet">Sofie will appear here after your MyEve setup is complete. Return here to review permissions and activity.</EmptyState>}
      </section><section className="card"><div className="owner-section-head"><h2>Recent activity</h2><Link className="text-link" href="/activity">View all activity</Link></div><ActivityTimeline activity={activity} /></section></div>
      <div className="stack"><section className="card"><div className="owner-section-head"><h2>Connections</h2><Link className="text-link" href="/connections">View connections</Link></div>
        {connections.length ? <ul className="owner-list">{connections.map((connection) => <li className="owner-row" key={connection.id}><strong>{providerLabel(connection.provider)}</strong><Status value={connection.status} /></li>)}</ul>
          : <EmptyState title="No service connections yet">Services connected to this account will appear here. Your MyEve setup manages Sofie’s access to Relay.</EmptyState>}
      </section><section className="card owner-trust"><h2>You stay in control</h2><p>Each Agent has its own permissions. A connection does not automatically give every Agent access.</p><Link className="text-link" href="/agents">Review your Agents →</Link></section></div>
    </section>
  </>;
}
