export const metadata = { title: "Home" };
import Link from "next/link";
import { requireUser } from "@/lib/auth";
import { listActivity } from "@/lib/activity";
import { ownerConnections, ownerDirectory, ownerOperations, ownerRecentCounts } from "@/lib/owner-workspace";
import { PageHeader, RelativeTime } from "@/components/page";
import { ActivityTimeline, EmptyState, AgentIdentityStatus, GettingStarted } from "@/components/owner-ui";
import { OwnerIcon } from "@/components/owner-icons";
import { permissionLabel, providerLabel } from "@/lib/owner-presentation";

export default async function HomePage() {
  const user = await requireUser();
  const asOf = new Date().toISOString();
  const since = new Date(Date.parse(asOf) - 86400000).toISOString();
  const [agents, connections, activity, counts, operations] = await Promise.all([ownerDirectory(user.accountId), ownerConnections(user.accountId), listActivity(user.accountId, { limit: 5 }), ownerRecentCounts(user.accountId, since), ownerOperations(user, asOf)]);
  const issues = [
    ...connections.filter((item) => ["ERROR", "AUTHENTICATION_EXPIRED", "REQUIRES_SETUP"].includes(item.state)).map((item) => ({ title: `${providerLabel(item.provider)} needs attention`, detail: item.authentication, href: "/connections" })),
    ...(operations?.pending ? [{ title: `${operations.pending} pending owner decision${operations.pending === 1 ? "" : "s"}`, detail: "Unexpired approval requests awaiting a decision.", href: `/v2/approvals?status=PENDING&asOf=${encodeURIComponent(asOf)}` }] : []),
    ...agents.filter((item) => item.expiring).map((item) => ({ title: `${item.name}: credential expires soon`, detail: "At least one active credential expires within 7 days.", href: `/agents/${item.id}?tab=security` })),
    ...(counts.denials ? [{ title: `${counts.denials} denied operation${counts.denials === 1 ? "" : "s"}`, detail: "Last 24 hours. Review the requested permissions.", href: `/activity?status=DENIED&since=${encodeURIComponent(since)}` }] : []),
    ...(counts.failures ? [{ title: `${counts.failures} failed operation${counts.failures === 1 ? "" : "s"}`, detail: "Last 24 hours. Inspect the recorded outcome.", href: `/activity?status=FAILED&since=${encodeURIComponent(since)}` }] : []),
  ];
  const metrics = [
    { label: "Total agents", value: agents.length, note: "Registered identities", href: "/agents" },
    { label: "Enabled agents", value: agents.filter((item) => item.status === "ACTIVE").length, note: "Enabled identities", href: "/agents?status=ACTIVE" },
    { label: "Running operations", value: operations?.running ?? "—", note: operations ? "Recorded V2 tasks" : "V2 membership required", href: operations ? "/v2/tasks?status=RUNNING" : "/advanced#governance" },
    { label: "Pending approvals", value: operations?.pending ?? "—", note: operations ? "Unexpired V2 requests" : "V2 membership required", href: operations ? `/v2/approvals?status=PENDING&asOf=${encodeURIComponent(asOf)}` : "/advanced#governance" },
    { label: "Failed operations", value: counts.failures, note: "Last 24 hours", href: `/activity?status=FAILED&since=${encodeURIComponent(since)}`, alert: counts.failures > 0 },
    { label: "Connected services", value: connections.filter((item) => ["GITHUB", "GOOGLE"].includes(item.provider.toUpperCase()) && item.state === "CONNECTED").length, note: "GitHub / Google configuration", href: "/connections?state=CONNECTED" },
  ];
  return <>
    <PageHeader eyebrow="AGENT OPERATIONS" title="Home" description="A clear view of your Agents, their access, and what needs you next." action={<Link className="button" href="/agents/new">+ Create Agent</Link>} />
    <section className="operation-strip" aria-label="Operational overview">{metrics.map((item) => <Link className={`operation-metric ${item.alert ? "alert" : ""}`} href={item.href} key={item.label}><span>{item.label}</span><strong>{item.value}</strong><small>{item.note}</small><span className="metric-link" aria-hidden="true">View →</span></Link>)}</section>
    {!agents.length && <GettingStarted />}
    <div className="operations-layout"><div className="stack"><section className="card"><div className="section-heading"><h2>Your Agents <span className="count">{agents.length}</span></h2><Link className="text-link" href="/agents">Manage agents →</Link></div>
      {agents.length ? agents.slice(0, 5).map((agent, index) => <Link className="agent-record" href={`/agents/${agent.id}`} key={agent.id}><span className={`agent-monogram tone-${index % 2}`}>{agent.name.slice(0, 1)}</span><div><strong>{agent.name}</strong><p>{agent.description || "Purpose not added"}</p><div className="agent-chips">{agent.allowed.slice(0, 2).map((cap) => <span key={cap}>{permissionLabel(cap)}</span>)}<span>{agent.allowed.length} permission{agent.allowed.length === 1 ? "" : "s"}</span></div></div><div className="record-end"><AgentIdentityStatus status={agent.status} /><small>{agent.lastActiveAt ? <>Credential used <RelativeTime value={agent.lastActiveAt} /></> : "No credential use yet"}</small></div></Link>) : <EmptyState title="No Agents are connected yet"><Link className="text-link" href="/agents/new">Create your first scoped Agent</Link>. You can also complete Sofie’s setup in MyEve.</EmptyState>}
    </section><section className="card"><div className="section-heading"><h2>Recent activity</h2><Link className="text-link" href="/activity">View activity →</Link></div><ActivityTimeline activity={activity} /></section></div>
    <aside className="stack"><section className="card"><div className="section-heading"><h2>Needs attention <span className="count">{issues.length}</span></h2></div>{issues.length ? <ul className="attention-list">{issues.slice(0, 5).map((issue) => <li key={issue.title}><Link href={issue.href}><span className="attention-indicator" />{issue.title}</Link><small>{issue.detail}</small></li>)}</ul> : <p className="subtle">{!agents.length ? "Your workspace is ready for setup. No Agent operations have been configured here yet." : "No recorded issues in the checks shown here. This does not confirm that Agents are online or services are healthy."}</p>}{issues.length > 5 && <Link className="text-link" href="/activity">Review more activity →</Link>}</section>
    <section className="card"><h2>Quick actions</h2><nav className="quick-actions" aria-label="Quick actions">{[["Create Agent", "/agents/new"], ["Connect service", "/connections"], ["Review permissions", "/agents"], ["View activity", "/activity"]].map(([label, href]) => <Link href={href} key={href}>{label}<OwnerIcon name="Arrow" /></Link>)}</nav></section><div className="workspace-note"><strong>Access is always explicit.</strong>A connection makes a service available. Agent grants and execution policies decide whether an operation can proceed.</div></aside></div>
  </>;
}
