import { PageHeader, Status } from "@/components/page";
import { listActivity } from "@/lib/activity";
import { listAgents } from "@/lib/agents";
import { requireUser } from "@/lib/auth";
import type { ActivityStatus } from "@/lib/types";

export default async function ActivityPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const user = await requireUser();
  const params = await searchParams;
  const [activity, agents] = await Promise.all([
    listActivity(user.accountId, { agentId: params.agent, capability: params.capability, status: params.status as ActivityStatus | undefined, provider: params.provider }),
    listAgents(user.accountId),
  ]);
  return (
    <>
      <PageHeader eyebrow="Plane" title="Activity" description="A compact operational ledger of what agents did—and what Relay prevented." />
      <form className="filters card">
        <div className="field"><label>Agent</label><select name="agent" defaultValue={params.agent ?? ""}><option value="">All agents</option>{agents.map((agent) => <option value={agent.id} key={agent.id}>{agent.name}</option>)}</select></div>
        <div className="field grow"><label>Capability</label><input name="capability" defaultValue={params.capability} placeholder="memory.read" /></div>
        <div className="field"><label>Status</label><select name="status" defaultValue={params.status ?? ""}><option value="">All statuses</option><option>SUCCESS</option><option>DENIED</option><option>FAILED</option></select></div>
        <div className="field"><label>Provider</label><select name="provider" defaultValue={params.provider ?? ""}><option value="">All providers</option><option>GITHUB</option><option>GOOGLE</option><option>SANDBOX</option><option>BROWSER</option><option>EVENTS</option></select></div>
        <button className="button">Filter</button>
      </form>
      <div className="card flush table-wrap">
        <table><thead><tr><th>Time</th><th>Agent</th><th>Session</th><th>Capability</th><th>Provider</th><th>Resource</th><th>Status</th><th>Latency</th></tr></thead><tbody>{activity.map((item) => <tr key={item.id}><td className="subtle">{new Date(item.createdAt).toLocaleString()}</td><td>{item.agentName ?? "System"}</td><td className="mono subtle">{item.sessionId.slice(0, 12)}</td><td className="mono">{item.capability}</td><td>{item.provider ?? "Relay"}</td><td className="mono subtle">{item.resourceId ?? "—"}</td><td><Status value={item.status} /></td><td>{item.durationMs} ms</td></tr>)}</tbody></table>
        {!activity.length && <div className="empty">No activity matches these filters.</div>}
      </div>
    </>
  );
}
