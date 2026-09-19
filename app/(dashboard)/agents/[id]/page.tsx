import { AgentCredentialActions, CapabilityToggle, RevokeCredentialButton } from "@/components/actions";
import { PageHeader, Status } from "@/components/page";
import { requireUser } from "@/lib/auth";
import { getDashboardAgent } from "@/lib/dashboard-agent";
import { listActivity } from "@/lib/activity";
import { CAPABILITIES } from "@/lib/types";
import { listAgentSessions } from "@/lib/agent-sessions";
import { listSandboxes } from "@/lib/sandboxes";
import { listBrowserSessions } from "@/lib/browsers";
import { listAccountInbox } from "@/lib/event-queries";
import { listConnections } from "@/lib/connections";

export default async function AgentDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const user = await requireUser();
  const agent = await getDashboardAgent(user.accountId, (await params).id);
  const [activity, sessions, allSandboxes, allBrowsers, allInbox, connections] = await Promise.all([listActivity(user.accountId, { agentId: agent.id, limit: 8 }), listAgentSessions(user.accountId, agent.id), listSandboxes(user.accountId), listBrowserSessions(user.accountId), listAccountInbox(user.accountId), listConnections(user.accountId)]);
  const sandboxes = allSandboxes.filter((resource) => resource.ownerAgentId === agent.id);
  const browsers = allBrowsers.filter((resource) => resource.ownerAgentId === agent.id);
  const inbox = allInbox.filter((item) => item.agentId === agent.id);
  const grants = new Map(agent.grants.map((grant: any) => [grant.capability, grant.effect]));
  return (
    <>
      <PageHeader eyebrow="Agent identity" title={agent.name} description={agent.description || "Scoped Relay agent identity"} action={<Status value={agent.status} />} />
      <section className="grid two-col">
        <div className="stack">
          <div className="card">
            <h2>Capabilities</h2>
            {CAPABILITIES.map((capability) => <div className="cap-row" key={capability}><div><strong className="mono">{capability}</strong><div className="subtle">{capability.startsWith("memory") ? "Durable account memory" : "Account-level GitHub connection"}</div></div><CapabilityToggle agentId={agent.id} capability={capability} allowed={grants.get(capability) === "ALLOW"} /></div>)}
          </div>
          <div className="card"><h2>Runtime sessions</h2><div className="stack">{sessions.map((session) => <div className="kv-line" key={session.id}><span className="mono">{session.id}</span><span>{session.runtime}</span><Status value={session.status} /></div>)}{!sessions.length && <div className="subtle">No runtime sessions yet.</div>}</div></div>
          <div className="card"><h2>Active resources</h2><div className="kv"><div className="key">Sandboxes</div><div>{sandboxes.filter((item) => item.status === "RUNNING").length}</div><div className="key">Browsers</div><div>{browsers.filter((item) => item.status === "RUNNING").length}</div><div className="key">Inbox</div><div>{inbox.filter((item) => item.status === "UNREAD").length} unread</div></div></div>
          <div className="card flush"><div style={{ padding: "18px 20px 5px" }}><h2>Inbox</h2></div><table><thead><tr><th>Event</th><th>Source</th><th>Status</th><th>Received</th></tr></thead><tbody>{inbox.slice(0, 6).map((item) => <tr key={item.id}><td>{item.type}</td><td>{item.source}</td><td><Status value={item.status} /></td><td className="subtle">{new Date(item.createdAt).toLocaleString()}</td></tr>)}</tbody></table>{!inbox.length && <div className="empty">No events routed to this Agent.</div>}</div>
          <div className="card flush">
            <div style={{ padding: "18px 20px 5px" }}><h2>Recent activity</h2></div>
            <table><thead><tr><th>Capability</th><th>Status</th><th>Latency</th><th>Time</th></tr></thead><tbody>{activity.map((item) => <tr key={item.id}><td className="mono">{item.capability}</td><td><Status value={item.status} /></td><td>{item.durationMs} ms</td><td className="subtle">{new Date(item.createdAt).toLocaleString()}</td></tr>)}</tbody></table>
            {!activity.length && <div className="empty">No capability calls from this agent yet.</div>}
          </div>
        </div>
        <div className="stack">
          <div className="card">
            <h2>Identity</h2>
            <div className="kv"><div className="key">Status</div><div>{agent.status}</div><div className="key">Agent ID</div><div className="mono subtle">{agent.id}</div><div className="key">Created</div><div>{new Date(agent.createdAt).toLocaleString()}</div></div>
          </div>
          <div className="card">
            <h2>Credentials</h2>
            <AgentCredentialActions agentId={agent.id} disabled={agent.status === "DISABLED"} />
            <div className="divider" />
            <div className="stack">{agent.credentials.map((credential: any) => <div className="inline" key={credential.id}><div><div className="mono">{credential.prefix}••••</div><div className="subtle">{credential.revokedAt ? "Revoked" : credential.lastUsedAt ? `Last used ${new Date(credential.lastUsedAt).toLocaleString()}` : "Never used"}</div></div><div className="right">{credential.revokedAt ? <Status value="REVOKED" /> : <RevokeCredentialButton agentId={agent.id} credentialId={credential.id} />}</div></div>)}</div>
          </div>
          <div className="card"><h2>Connection access</h2><div className="stack">{connections.map((connection) => <div className="agent-top" key={connection.id}><span>{connection.provider}</span><Status value={agent.grants.some((grant) => grant.effect === "ALLOW" && (connection.provider === "GOOGLE" ? grant.capability.startsWith("email.") || grant.capability.startsWith("calendar.") : grant.capability.startsWith("github."))) ? "GRANTED" : "NOT_GRANTED"} /></div>)}{!connections.length && <div className="subtle">No account connections configured.</div>}</div><div className="divider" /><p className="subtle">Provider credentials remain account-owned. This Agent receives capability authority, never a copied provider token.</p></div>
        </div>
      </section>
    </>
  );
}
