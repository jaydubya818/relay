export const metadata = { title: "Agents" };
import Link from "next/link";
import { PageHeader, Status } from "@/components/page";
import { EmptyState } from "@/components/owner-ui";
import { listAgents } from "@/lib/agents";
import { requireUser } from "@/lib/auth";

export default async function AgentsPage() {
  const user = await requireUser();
  const agents = await listAgents(user.accountId);
  return <>
    <PageHeader eyebrow="Your Relay" title="Agents" description="Know your Agents, review their permissions, and follow their activity." />
    {agents.length ? <section className="grid cards">{agents.map((agent) => <article className="card" key={agent.id}>
      <div className="owner-row"><h2 className="agent-name">{agent.name}</h2><Status value={agent.status} /></div>
      <p>{agent.description || "Agent registered with your account"}</p>
      <p className="subtle">Last active: {agent.lastActiveAt ? `${new Date(agent.lastActiveAt).toLocaleString("en-US", { timeZone: "UTC" })} UTC` : "No activity recorded"}</p>
      <div className="owner-actions"><Link className="button secondary" href={`/agents/${agent.id}`}>Permissions<span className="sr-only"> for {agent.name}</span></Link><Link className="text-link" href={`/activity?agent=${encodeURIComponent(agent.id)}`}>View activity<span className="sr-only"> for {agent.name}</span></Link></div>
    </article>)}</section> : <section className="card"><EmptyState title="No Agents are connected yet">Sofie will appear here after your MyEve setup is complete. You can then review what she can access and follow her activity.</EmptyState></section>}
    <p className="subtle section-gap">Agent setup is managed through your connected application. Existing administration tools are available in <Link className="text-link" href="/advanced/agents">Advanced</Link>.</p>
  </>;
}
