export const metadata = { title: "Agents" };
import Link from "next/link";
import { PageHeader, Status, RelativeTime } from "@/components/page";
import { EmptyState } from "@/components/owner-ui";
import { requireUser } from "@/lib/auth";
import { ownerDirectory } from "@/lib/owner-workspace";
import { activityLabel, providerLabel, permissionLabel } from "@/lib/owner-presentation";

export default async function AgentsPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const user = await requireUser(); const params = await searchParams; const all = await ownerDirectory(user.accountId);
  const query = (params.q ?? "").trim().toLowerCase();
  const agents = all.filter((agent) => (!query || `${agent.name} ${agent.description} ${agent.allowed.join(" ")}`.toLowerCase().includes(query)) && (!params.status || agent.status === params.status));
  return <><PageHeader eyebrow="IDENTITY & ACCESS" title="Agents" description="Give every Agent a clear purpose and the right amount of access." action={<Link className="button" href="/agents/new">+ Create Agent</Link>} />
    <section className="card"><form className="directory-toolbar" aria-label="Search agents"><div className="field"><label htmlFor="agent-search">Search agents</label><input id="agent-search" name="q" defaultValue={params.q} placeholder="Name, purpose or capability…" /></div><div className="field"><label htmlFor="agent-status">Status</label><select id="agent-status" name="status" defaultValue={params.status ?? ""}><option value="">All statuses</option><option value="ACTIVE">Active</option><option value="DISABLED">Disabled</option><option value="DRAFT">Draft</option></select></div><button className="button secondary">Search</button></form>
    <div className="directory-table-head" aria-hidden="true"><span>Agent / purpose</span><span>Access & credentials</span><span>Status</span></div>
    {agents.map((agent, index) => <article className="directory-row" key={agent.id}><Link className="agent-record" href={`/agents/${agent.id}`}><span className={`agent-monogram tone-${index % 2}`}>{agent.name.slice(0, 1)}</span><div><strong>{agent.name}</strong><p>{agent.description || "Purpose not added"}</p><div className="agent-chips">{agent.allowed.slice(0, 2).map((cap) => <span key={cap}>{permissionLabel(cap)}</span>)}<span>{agent.allowed.length} grants</span></div></div></Link><div className="directory-meta"><span>{agent.services.map(providerLabel).join(" · ") || "Relay capabilities only"}</span><span>Credential: {agent.credentialState === "ACTIVE" ? "Active" : agent.credentialState === "EXPIRED" ? "Expired" : "Not configured"}</span><span>{agent.recent ? activityLabel(agent.recent.action) : "No recorded activity"}</span></div><div className="record-end"><Status value={agent.status} /><small><RelativeTime value={agent.lastActiveAt} /></small><Link className="text-link" href={`/agents/${agent.id}`}>Configure<span className="sr-only"> {agent.name}</span> →</Link></div></article>)}
    {!agents.length && <EmptyState title={all.length ? "No matching Agents" : "No Agents are connected yet"}>{all.length ? <Link className="text-link" href="/agents">Clear search and filters</Link> : "Create your first Agent with explicitly scoped permissions. Sofie can also connect through MyEve."}</EmptyState>}
    <div className="directory-footer">{agents.length} of {all.length} Agents · Services listed reflect capability grants, not proof of a healthy connection.</div></section></>;
}
