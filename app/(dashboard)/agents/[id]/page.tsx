import { AgentCredentialActions, CapabilityToggle, RevokeCredentialButton } from "@/components/actions";
import { PageHeader, Status } from "@/components/page";
import { getAgent } from "@/lib/agents";
import { requireUser } from "@/lib/auth";
import { listActivity } from "@/lib/activity";
import { CAPABILITIES } from "@/lib/types";

export default async function AgentDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const user = await requireUser();
  const agent = await getAgent(user.accountId, (await params).id);
  const activity = await listActivity(user.accountId, { agentId: agent.id, limit: 8 });
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
          <div className="card"><h2>Access model</h2><p className="subtle">This identity can use only capabilities marked on. GitHub remains connected once at the account level; this agent receives permission, not a separate provider credential.</p></div>
        </div>
      </section>
    </>
  );
}
