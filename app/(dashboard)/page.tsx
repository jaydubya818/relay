import Link from "next/link";
import { requireUser } from "@/lib/auth";
import { getOverview } from "@/lib/overview";
import { listActivity } from "@/lib/activity";
import { PageHeader, Status } from "@/components/page";

export default async function OverviewPage() {
  const user = await requireUser();
  const overview = getOverview(user.accountId);
  const activity = listActivity(user.accountId, { limit: 6 });
  const metrics = [
    ["Agents", overview.counts.agents, "Durable identities"],
    ["Operations / 24h", overview.counts.operations, "Capability calls"],
    ["Connections", overview.counts.connections, "Account-owned"],
    ["Failures / 24h", overview.counts.failures, "Provider or runtime"],
  ];
  return (
    <>
      <PageHeader eyebrow="Capability plane" title="Overview" description="One durable layer for agent memory, permissions, connections, and operational truth." />
      <section className="grid metrics">
        {metrics.map(([label, value, note]) => <div className="card" key={label}><div className="metric-label">{label}</div><div className="metric-value">{value}</div><div className="metric-note">{note}</div></div>)}
      </section>
      <section className="grid two-col">
        <div className="stack">
          <div className="card flush">
            <div style={{ padding: "18px 20px 5px" }}><h2>Agents</h2></div>
            <table><tbody>{overview.agents.map((agent: any) => <tr key={agent.id}><td><Link href={`/agents/${agent.id}`}><strong>{agent.name}</strong></Link></td><td><Status value={agent.status} /></td><td style={{ textAlign: "right" }}><Link className="subtle" href={`/agents/${agent.id}`}>Manage →</Link></td></tr>)}</tbody></table>
            {!overview.agents.length && <div className="empty">No agents yet. Create the first durable identity.</div>}
          </div>
          <div className="card flush">
            <div style={{ padding: "18px 20px 5px" }}><h2>Recent activity</h2></div>
            <table><thead><tr><th>Agent</th><th>Capability</th><th>Status</th><th>Latency</th></tr></thead><tbody>
              {activity.map((item) => <tr key={item.id}><td>{item.agentName ?? "System"}</td><td className="mono">{item.capability}</td><td><Status value={item.status} /></td><td>{item.durationMs} ms</td></tr>)}
            </tbody></table>
            {!activity.length && <div className="empty">Capability operations will appear here.</div>}
          </div>
        </div>
        <div className="stack">
          <div className="card">
            <h2>Capability plane</h2>
            <div className="kv"><div className="key">Memory</div><div><Status value="HEALTHY" /></div><div className="key">GitHub</div><div><Status value={overview.githubStatus} /></div><div className="key">MCP</div><div><Status value="HEALTHY" /></div></div>
          </div>
          <div className="card">
            <h2>Get started</h2>
            <div className="stack subtle">
              <div>✓ Create account</div>
              <div>{overview.counts.agents >= 1 ? "✓" : "○"} Create first agent</div>
              <div>{overview.counts.agents >= 2 ? "✓" : "○"} Add second agent</div>
              <div>{overview.counts.connections >= 1 ? "✓" : "○"} Connect GitHub</div>
              <div>{overview.counts.operations >= 1 ? "✓" : "○"} Run first capability</div>
            </div>
          </div>
        </div>
      </section>
    </>
  );
}
